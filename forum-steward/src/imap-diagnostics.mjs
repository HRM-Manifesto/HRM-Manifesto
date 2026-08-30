export const IMAP_DIAGNOSTIC_CATEGORIES = [
  "CONFIG",
  "DNS_CONNECT",
  "TLS",
  "AUTH",
  "FOLDER_CREATE",
  "INBOX_LOCK",
  "SEARCH",
  "FETCH",
  "MOVE",
  "LOGOUT",
  "UNKNOWN",
];

const DNS_CODES = new Set([
  "CONNECT_TIMEOUT", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "EHOSTUNREACH",
  "ENETUNREACH", "ENOTFOUND", "ETIMEDOUT", "GREETING_TIMEOUT",
]);

function candidateCodes(error) {
  return [
    error?.serverResponseCode,
    error?.code,
    error?.responseStatus,
    error?.cause?.serverResponseCode,
    error?.cause?.code,
    error?.cause?.responseStatus,
  ].filter((value) => typeof value === "string" && value);
}

export function safeImapCode(error) {
  const codes = candidateCodes(error)
    .map((value) => value.toUpperCase().replace(/[^A-Z0-9_.:-]/g, "").slice(0, 64))
    .filter(Boolean);
  return [...new Set(codes)].slice(0, 2).join("/") || "UNAVAILABLE";
}

function connectionCategory(error) {
  if (error?.authenticationFailed || candidateCodes(error).some((code) => /AUTH|LOGIN|CREDENTIAL/i.test(code))) {
    return "AUTH";
  }
  if (candidateCodes(error).some((code) => (
    /TLS|SSL|CERT|SELF_SIGNED|VERIFY|WRONG_VERSION|EPROTO|CIPHER/i.test(code)
  ))) {
    return "TLS";
  }
  if (candidateCodes(error).some((code) => DNS_CODES.has(code.toUpperCase()))) {
    return "DNS_CONNECT";
  }
  return "UNKNOWN";
}

export class ImapDiagnosticError extends Error {
  constructor({ category, stage, safeCode = "UNAVAILABLE" }) {
    super("IMAP operation failed safely");
    this.name = "ImapDiagnosticError";
    this.category = IMAP_DIAGNOSTIC_CATEGORIES.includes(category) ? category : "UNKNOWN";
    this.stage = String(stage ?? "UNKNOWN").toUpperCase().replace(/[^A-Z0-9_.:-]/g, "_").slice(0, 64) || "UNKNOWN";
    this.safeCode = String(safeCode ?? "UNAVAILABLE").toUpperCase().replace(/[^A-Z0-9_.:/-]/g, "").slice(0, 130) || "UNAVAILABLE";
  }
}

export function imapDiagnostic(error, { category = "UNKNOWN", stage = "UNKNOWN", connection = false } = {}) {
  if (error instanceof ImapDiagnosticError) return error;
  return new ImapDiagnosticError({
    category: connection ? connectionCategory(error) : category,
    stage,
    safeCode: safeImapCode(error),
  });
}

export async function imapStage(options, operation) {
  try {
    return await operation();
  } catch (error) {
    throw imapDiagnostic(error, options);
  }
}

export function imapDiagnosticSummary(error) {
  const diagnostic = imapDiagnostic(error);
  return {
    category: diagnostic.category,
    safeCode: diagnostic.safeCode,
    stage: diagnostic.stage,
  };
}
