import nodemailer from "nodemailer";
import { createApprovalRecord } from "./approval-record.mjs";
import { registerGatewayCase } from "./gateway-client.mjs";
import { reviewEmailDecision } from "./notification.mjs";
import { buildAnalysisEmail, fallbackActionLinks } from "./review-email.mjs";

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

export { buildAnalysisEmail } from "./review-email.mjs";

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
  createApprovalImpl = createApprovalRecord,
  registerGatewayImpl = registerGatewayCase,
  now = new Date(),
  randomBytesImpl,
}) {
  if (String(environment.HRM_EMAIL_ENABLED ?? "true").toLowerCase() === "false") {
    return { sent: false, reason: "disabled" };
  }
  const decision = reviewEmailDecision({ entry, analysis, environment });
  if (!decision.send) return { sent: false, reason: decision.reason };
  const { from, transport } = smtpConfigFromEnvironment(environment);
  const approval = createApprovalImpl({
    entry,
    analysis,
    repository: environment.GITHUB_REPOSITORY,
    secret: environment.HRM_APPROVAL_SECRET,
    now,
    randomBytesImpl,
  });
  const gateway = await registerGatewayImpl({ entry, approval, environment });
  if (gateway?.created === false) return { sent: false, reason: "duplicate" };
  const actionLinks = gateway?.created
    ? { mode: "gateway", ...gateway.links }
    : fallbackActionLinks({
      to: environment.HRM_NOTIFY_EMAIL,
      approval,
      hasProposedReply: approval.record.hasProposedReply,
    });
  const message = buildAnalysisEmail({
    entry,
    analysis,
    recipient: environment.HRM_NOTIFY_EMAIL,
    approval,
    actionLinks,
  });
  const transporter = transportFactory(transport);
  await transporter.sendMail({ from, ...message });
  return { sent: true, reason: "sent" };
}

export function buildDecisionConfirmationEmail({ recipient, outcome }) {
  const to = emailAddress(recipient, "HRM_NOTIFY_EMAIL");
  if (outcome.kind === "rejected") {
    return {
      to,
      subject: "[HRM Forum] Odpowiedź odrzucona",
      text: "HRM Forum Steward: odpowiedź nie została opublikowana.\n",
    };
  }
  if (outcome.kind === "expired") {
    return {
      to,
      subject: "[HRM Forum] Zatwierdzenie wygasło",
      text: "HRM Forum Steward: identyfikator zatwierdzenia wygasł. Wymagana jest ponowna analiza i nowe powiadomienie.\n",
    };
  }
  if (outcome.kind !== "published" && outcome.kind !== "already_published") {
    throw new Error("Invalid confirmation outcome");
  }
  const published = outcome.publication;
  return {
    to,
    subject: "[HRM Forum] Odpowiedź opublikowana",
    text: `ODPOWIEDŹ HRM OPUBLIKOWANA

Discussion:
${published.discussionUrl}

Język:
${published.originalLanguage}

Zatwierdzona odpowiedź polska:
${published.approvedPolishReply}

Opublikowana odpowiedź:
${published.publishedReply}

Link:
${published.url}
`,
  };
}

export async function sendDecisionConfirmation({
  outcome,
  environment = process.env,
  transportFactory = nodemailer.createTransport,
}) {
  const { from, transport } = smtpConfigFromEnvironment(environment);
  const message = buildDecisionConfirmationEmail({
    recipient: environment.HRM_NOTIFY_EMAIL,
    outcome,
  });
  const transporter = transportFactory(transport);
  await transporter.sendMail({ from, ...message });
  return { sent: true };
}
