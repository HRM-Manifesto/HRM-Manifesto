import nodemailer from "nodemailer";

const TYPE_LABELS = {
  question: "New question",
  criticism: "New criticism",
  proposal: "New proposal",
  translation: "New translation topic",
  "philosophical discussion": "New philosophical discussion",
  spam: "Possible spam",
  other: "New discussion",
};

function singleLine(value, field) {
  const result = String(value ?? "").trim();
  if (!result || result.length > 500 || /[\r\n\0]/.test(result)) {
    throw new Error(`Invalid ${field}`);
  }
  return result;
}

function emailAddress(value, field) {
  const result = singleLine(value, field);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result)) {
    throw new Error(`Invalid ${field}`);
  }
  return result;
}

function fromHeader(value) {
  const result = singleLine(value, "SMTP_FROM");
  if (!result.includes("@") || /[\r\n\0]/.test(result)) throw new Error("Invalid SMTP_FROM");
  return result;
}

export function workflowUrlForRepository(repository) {
  const value = String(repository ?? "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("Invalid GITHUB_REPOSITORY");
  }
  return `https://github.com/${value}/actions/workflows/hrm-publish-approved-reply.yml`;
}

function publicationTarget(entry) {
  if (entry.nodeId) return entry.nodeId;
  if (entry.discussionNumber) return String(entry.discussionNumber);
  return "niedostępny w teście ręcznym";
}

function sourcesText(sources) {
  if (!sources.length) return "brak wskazanych sekcji";
  return sources.map((source) => (
    `- ${source.path} — ${source.section}: ${source.relevance}`
  )).join("\n");
}

export function buildAnalysisEmail({ entry, analysis, recipient, repository }) {
  const result = analysis.result;
  const to = emailAddress(recipient, "HRM_NOTIFY_EMAIL");
  const workflowUrl = workflowUrlForRepository(repository);
  const typeLabel = TYPE_LABELS[result.entry_type] ?? TYPE_LABELS.other;
  const reviewSuffix = result.requires_aleksander_response ? " — response review needed" : "";
  const subject = `[HRM Forum] ${typeLabel}${reviewSuffix}`;
  const original = analysis.bodyInfo.body || "(pusty wpis)";
  const truncation = analysis.bodyInfo.truncated
    ? `\n\n[UWAGA: wpis skrócono do ${analysis.bodyInfo.body.length} znaków z ${analysis.bodyInfo.originalLength}.]`
    : "";

  const text = `HRM FORUM STEWARD

Ta analiza służy wyłącznie do ręcznej oceny. Nic nie zostało opublikowane.

Link do dyskusji:
${entry.url || entry.discussionUrl || "brak linku (test ręczny)"}

Target do workflow publikującego:
${publicationTarget(entry)}

Autor:
${entry.author || "nieznany"}

Język oryginału:
${result.original_language}

ORYGINAŁ:
${original}${truncation}

TŁUMACZENIE POLSKIE:
${result.polish_translation || "(brak — pusty wpis)"}

STRESZCZENIE:
${result.summary_pl}

RODZAJ:
${result.entry_type}

WAŻNOŚĆ:
${result.priority}

CZY WYMAGA ALEKSANDRA:
${result.requires_aleksander_response ? "tak" : "nie"}

ŹRÓDŁA HRM:
${sourcesText(result.relevant_sources)}

OPARCIE ODPOWIEDZI:
${result.support_level}

NOWE STANOWISKO ALEKSANDRA:
${result.requires_new_position ? "tak" : "nie"}

INTERPRETATION WARNING:
${result.interpretation_warning ? "tak" : "nie"}
${result.interpretation_warning_reason || ""}

PROPOZYCJA ODPOWIEDZI PO POLSKU:
${result.proposed_reply_pl || "(brak propozycji)"}

Ta odpowiedź NIE została opublikowana.
Aby ją opublikować, zatwierdź lub popraw wersję polską i uruchom ręcznie workflow HRM Publish Approved Reply.

Workflow publikujący:
${workflowUrl}
`;

  return { to, subject, text };
}

export function smtpConfigFromEnvironment(environment) {
  const host = singleLine(environment.SMTP_HOST, "SMTP_HOST");
  if (/[:/\\]/.test(host) || /\s/.test(host)) throw new Error("SMTP_HOST must be a host name only");
  const port = Number(environment.SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid SMTP_PORT");
  const user = singleLine(environment.SMTP_USERNAME, "SMTP_USERNAME");
  const pass = String(environment.SMTP_PASSWORD ?? "");
  if (!pass || pass.length > 10_000 || /[\r\n\0]/.test(pass)) throw new Error("Invalid SMTP_PASSWORD");
  const from = fromHeader(environment.SMTP_FROM);

  return {
    from,
    transport: {
      host,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user, pass },
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    },
  };
}

export async function sendAnalysisEmail({
  entry,
  analysis,
  environment = process.env,
  transportFactory = nodemailer.createTransport,
}) {
  if (String(environment.HRM_EMAIL_ENABLED ?? "true").toLowerCase() === "false") {
    return { sent: false, reason: "disabled" };
  }
  const { from, transport } = smtpConfigFromEnvironment(environment);
  const message = buildAnalysisEmail({
    entry,
    analysis,
    recipient: environment.HRM_NOTIFY_EMAIL,
    repository: environment.GITHUB_REPOSITORY,
  });
  const transporter = transportFactory(transport);
  await transporter.sendMail({ from, ...message });
  return { sent: true, reason: "sent" };
}
