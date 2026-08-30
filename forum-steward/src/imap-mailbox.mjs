import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { IMAP_LOOKBACK_DAYS, MAX_EMAIL_SOURCE_BYTES } from "./config.mjs";

export const IMAP_FOLDERS = {
  root: "HRM",
  processed: "HRM/Processed",
  rejected: "HRM/Rejected",
  failed: "HRM/Failed",
  invalid: "HRM/Invalid",
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

async function ensureFolders(client) {
  for (const folder of Object.values(IMAP_FOLDERS)) await client.mailboxCreate(folder);
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
  const config = imapConfigFromEnvironment(environment);
  const client = clientFactory(config);
  let lock;
  try {
    await client.connect();
    await ensureFolders(client);
    lock = await client.getMailboxLock("INBOX");
    const since = new Date(new Date(now).getTime() - IMAP_LOOKBACK_DAYS * 24 * 60 * 60 * 1_000);
    const uids = await client.search({ since }, { uid: true });
    let messages = [];
    if (uids.length) {
      const metadata = await client.fetchAll(uids, { uid: true, envelope: true, internalDate: true, size: true }, { uid: true });
      const candidates = metadata.filter((message) => {
        const subject = String(message.envelope?.subject ?? "");
        return message.size <= MAX_EMAIL_SOURCE_BYTES
          && (subject.startsWith("[HRM Forum] Review required") || subject.startsWith("HRM "));
      });
      if (candidates.length) {
        const sources = await client.fetchAll(candidates.map((message) => message.uid), { uid: true, source: true, internalDate: true }, { uid: true });
        messages = await Promise.all(sources.map(async (message) => {
          const parsed = await parser(message.source, {
            skipHtmlToText: true,
            skipTextToHtml: true,
            skipImageLinks: true,
            maxHtmlLengthToParse: 64_000,
          });
          return {
            uid: message.uid,
            subject: String(parsed.subject ?? ""),
            text: String(parsed.text ?? ""),
            fromAddresses: parsedAddresses(parsed.from),
            internalDate: message.internalDate ?? parsed.date ?? null,
          };
        }));
      }
    }

    const mailbox = {
      messages: messages.sort((a, b) => Number(a.uid) - Number(b.uid)),
      async move(uid, folder) {
        if (!Object.values(IMAP_FOLDERS).includes(folder) || !Number.isSafeInteger(Number(uid))) {
          throw new Error("Invalid IMAP move request");
        }
        await client.messageMove(Number(uid), folder, { uid: true });
      },
    };
    return await handler(mailbox);
  } finally {
    if (lock) lock.release();
    if (client?.usable !== false) {
      try { await client.logout(); } catch { /* connection may already be closed */ }
    }
  }
}
