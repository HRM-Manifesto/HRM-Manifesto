import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { APPROVAL_RECORD_HEADER, decodeApprovalRecordHeader } from "./approval-record.mjs";
import { IMAP_LOOKBACK_DAYS, MAX_EMAIL_SOURCE_BYTES } from "./config.mjs";
import { imapDiagnostic, imapStage } from "./imap-diagnostics.mjs";

export const IMAP_FOLDERS = {
  root: "HRM",
  processed: "HRM/Processed",
  rejected: "HRM/Rejected",
  failed: "HRM/Failed",
  invalid: "HRM/Invalid",
};

const CHILD_FOLDERS = {
  processed: "Processed",
  rejected: "Rejected",
  failed: "Failed",
  invalid: "Invalid",
};

function requiredSingleLine(value, field, maxLength = 500) {
  const text = String(value ?? "").trim();
  if (!text || text.length > maxLength || /[\r\n\0]/.test(text)) throw new Error(`Invalid ${field}`);
  return text;
}

export function imapConfigFromEnvironment(environment) {
  const host = requiredSingleLine(environment.IMAP_HOST, "IMAP_HOST");
  if (/[:/\\]/.test(host) || /\s/.test(host)) throw new Error("IMAP_HOST must be a host name only");
  const port = Number(environment.IMAP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid IMAP_PORT");
  const user = requiredSingleLine(environment.IMAP_USERNAME, "IMAP_USERNAME");
  const pass = requiredSingleLine(environment.IMAP_PASSWORD, "IMAP_PASSWORD", 10_000);
  return {
    host,
    port,
    secure: true,
    auth: { user, pass },
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 45_000,
  };
}

function expectedPath(parts, delimiter, prefix = "") {
  return `${prefix || ""}${parts.join(delimiter || "")}`;
}

function alreadyExists(error) {
  const codes = [error?.serverResponseCode, error?.code].map((value) => String(value ?? "").toUpperCase());
  if (codes.includes("ALREADYEXISTS")) return true;
  return error?.responseStatus === "NO" && /(?:already\s+exists|exists)/i.test(String(error?.response ?? error?.message ?? ""));
}

async function createIdempotently(client, request, expected, existingPaths) {
  const existing = existingPaths.get(expected.toLowerCase());
  if (existing) return existing;
  try {
    const result = await client.mailboxCreate(request);
    const path = typeof result?.path === "string" && result.path ? result.path : expected;
    existingPaths.set(path.toLowerCase(), path);
    return path;
  } catch (error) {
    if (alreadyExists(error)) {
      existingPaths.set(expected.toLowerCase(), expected);
      return expected;
    }
    throw error;
  }
}

export async function ensureImapFolders(client) {
  const listed = await client.list();
  const existingPaths = new Map((listed ?? []).map((entry) => [String(entry.path).toLowerCase(), String(entry.path)]));
  const namespace = client.namespace ?? {};
  const listedDelimiter = (listed ?? []).find((entry) => Object.hasOwn(entry, "delimiter"))?.delimiter;
  const delimiter = Object.hasOwn(namespace, "delimiter") ? namespace.delimiter : (listedDelimiter ?? null);
  const prefix = namespace.prefix ?? "";
  const rootExpected = expectedPath(["HRM"], delimiter, prefix);
  const root = await createIdempotently(client, "HRM", rootExpected, existingPaths);

  if (typeof delimiter === "string" && delimiter.length > 0) {
    const nested = { root };
    try {
      for (const [key, child] of Object.entries(CHILD_FOLDERS)) {
        const expected = expectedPath(["HRM", child], delimiter, prefix);
        nested[key] = await createIdempotently(client, ["HRM", child], expected, existingPaths);
      }
      return { folders: nested, delimiter, nested: true };
    } catch {
      // Some IMAP servers report a delimiter but reject inferior mailboxes.
      // Fall back to independent, flat mailbox names without deleting any folder.
    }
  }

  const flat = { root };
  for (const [key, child] of Object.entries(CHILD_FOLDERS)) {
    const flatName = `HRM-${child}`;
    const expected = expectedPath([flatName], delimiter, prefix);
    flat[key] = await createIdempotently(client, flatName, expected, existingPaths);
  }
  return { folders: flat, delimiter, nested: false };
}

function parsedAddresses(addressObject) {
  return (addressObject?.value ?? []).map((entry) => entry.address).filter(Boolean);
}

export async function withApprovalMailbox({
  environment = process.env,
  handler,
  clientFactory = (config) => new ImapFlow(config),
  parser = simpleParser,
  now = new Date(),
}) {
  let config;
  try {
    config = imapConfigFromEnvironment(environment);
  } catch (error) {
    throw imapDiagnostic(error, { category: "CONFIG", stage: "CONFIG_VALIDATE" });
  }

  let client;
  try {
    client = clientFactory(config);
  } catch (error) {
    throw imapDiagnostic(error, { category: "CONFIG", stage: "CLIENT_CREATE" });
  }

  let lock;
  let result;
  let failure;
  try {
    await imapStage({ stage: "CONNECT", connection: true }, () => client.connect());
    const folderState = await imapStage(
      { category: "FOLDER_CREATE", stage: "FOLDER_DISCOVER_CREATE" },
      () => ensureImapFolders(client),
    );
    lock = await imapStage(
      { category: "INBOX_LOCK", stage: "INBOX_LOCK" },
      () => client.getMailboxLock("INBOX"),
    );
    const since = new Date(new Date(now).getTime() - IMAP_LOOKBACK_DAYS * 24 * 60 * 60 * 1_000);
    const uids = await imapStage(
      { category: "SEARCH", stage: "INBOX_SEARCH" },
      () => client.search({ since }, { uid: true }),
    );
    let messages = [];
    if (uids.length) {
      messages = await imapStage({ category: "FETCH", stage: "MESSAGE_FETCH_PARSE" }, async () => {
        const metadata = await client.fetchAll(uids, { uid: true, envelope: true, internalDate: true, size: true }, { uid: true });
        const candidates = metadata.filter((message) => {
          const subject = String(message.envelope?.subject ?? "");
          return message.size <= MAX_EMAIL_SOURCE_BYTES
            && (subject.startsWith("[HRM Forum] Review required")
              || subject.startsWith("[HRM] Odpowiedź do zatwierdzenia")
              || subject.startsWith("[HRM] Potrzebna Twoja decyzja")
              || subject.startsWith("HRM "));
        });
        if (!candidates.length) return [];
        const sources = await client.fetchAll(candidates.map((message) => message.uid), { uid: true, source: true, internalDate: true }, { uid: true });
        return Promise.all(sources.map(async (message) => {
          const parsed = await parser(message.source, {
            skipHtmlToText: true,
            skipTextToHtml: true,
            skipImageLinks: true,
            maxHtmlLengthToParse: 64_000,
          });
          let approvalRecord = "";
          const encodedRecord = parsed.headers?.get?.(APPROVAL_RECORD_HEADER.toLowerCase());
          if (encodedRecord) {
            try {
              approvalRecord = decodeApprovalRecordHeader(encodedRecord);
            } catch {
              approvalRecord = "invalid";
            }
          }
          return {
            uid: message.uid,
            subject: String(parsed.subject ?? ""),
            text: String(parsed.text ?? ""),
            approvalRecord,
            fromAddresses: parsedAddresses(parsed.from),
            internalDate: message.internalDate ?? parsed.date ?? null,
          };
        }));
      });
    }

    const mailbox = {
      folders: folderState.folders,
      folderMode: folderState.nested ? "nested" : "flat",
      messages: messages.sort((a, b) => Number(a.uid) - Number(b.uid)),
      async move(uid, folder) {
        if (!Object.values(folderState.folders).includes(folder) || !Number.isSafeInteger(Number(uid))) {
          throw imapDiagnostic(new Error("Invalid move request"), { category: "MOVE", stage: "MOVE_VALIDATE" });
        }
        return imapStage(
          { category: "MOVE", stage: "MESSAGE_MOVE" },
          () => client.messageMove(Number(uid), folder, { uid: true }),
        );
      },
    };
    result = await imapStage({ category: "UNKNOWN", stage: "PROCESS" }, () => handler(mailbox));
  } catch (error) {
    failure = imapDiagnostic(error);
  }

  if (lock) {
    try {
      lock.release();
    } catch (error) {
      if (!failure) failure = imapDiagnostic(error, { category: "INBOX_LOCK", stage: "INBOX_RELEASE" });
    }
  }
  if (client?.usable !== false) {
    try {
      await client.logout();
    } catch (error) {
      if (!failure) failure = imapDiagnostic(error, { category: "LOGOUT", stage: "LOGOUT" });
    }
  }
  if (failure) throw failure;
  return result;
}
