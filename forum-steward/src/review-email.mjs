import { APPROVAL_RECORD_HEADER, encodeApprovalRecordHeader } from "./approval-record.mjs";
import { escapeHtml } from "./summary.mjs";

export const MAX_EMAIL_ENTRY_CHARS = 1_200;
export const MAX_EMAIL_VISIBLE_REPLY_CHARS = 1_800;

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" ? url.href : "";
  } catch {
    return "";
  }
}

function safeActionUrl(value) {
  const url = new URL(value);
  if (!["https:", "mailto:"].includes(url.protocol)) throw new Error("Unsafe review action URL");
  return url.href;
}

function shortText(value, limit) {
  const text = String(value ?? "").trim();
  if (text.length <= limit) return { text, truncated: false };
  const candidate = text.slice(0, limit);
  const boundary = candidate.lastIndexOf(" ");
  return { text: `${candidate.slice(0, boundary > limit * 0.7 ? boundary : limit).trimEnd()}…`, truncated: true };
}

function singleLine(value, fallback, limit = 80) {
  const text = String(value ?? "").replace(/[\r\n\0]+/g, " ").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, limit);
}

function topicFor(result, entry) {
  const sourceHeadings = (result.relevant_sources ?? [])
    .map((source) => singleLine(source.section, "", 50))
    .filter(Boolean)
    .slice(0, 2);
  return singleLine(sourceHeadings.join(" · ") || entry.category || entry.title, "Forum HRM");
}

function basisFor(result) {
  const headings = [...new Set((result.relevant_sources ?? [])
    .map((source) => singleLine(source.section, "", 50))
    .filter(Boolean))]
    .slice(0, 3);
  return headings.length ? `Podstawa HRM: ${headings.join(" · ")}` : "";
}

function mailtoLink({ to, subject, body }) {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function fallbackActionLinks({ to, approval, hasProposedReply }) {
  const approveSubject = `HRM APPROVE ${approval.approvalId}`;
  const rejectSubject = `HRM REJECT ${approval.approvalId}`;
  const editSubject = `HRM EDIT ${approval.approvalId}`;
  return {
    mode: "email_fallback",
    approve: hasProposedReply ? mailtoLink({ to, subject: approveSubject, body: "ZATWIERDZAM" }) : "",
    reject: mailtoLink({ to, subject: rejectSubject, body: "NIE ODPOWIADAJ" }),
    edit: mailtoLink({
      to,
      subject: editSubject,
      body: "POPRAWIAM\n---ODPOWIEDŹ---\n\n---KONIEC---",
    }),
  };
}

function buttonHtml(href, label, color) {
  if (!href) return "";
  return `<a href="${escapeHtml(safeActionUrl(href))}" style="box-sizing:border-box;display:block;width:100%;min-height:52px;margin:12px 0 0;padding:14px 16px;border:2px solid #123b2e;border-radius:6px;background:${color};color:#fff;font:700 16px/20px Arial,sans-serif;text-align:center;text-decoration:none">${escapeHtml(label)}</a>`;
}

function textAction(label, href) {
  if (!href) return "";
  return label;
}

export function buildAnalysisEmail({ entry, analysis, recipient, approval, actionLinks }) {
  const result = analysis.result;
  const to = String(recipient ?? "").trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new Error("Invalid HRM_NOTIFY_EMAIL");
  if (!approval?.approvalId || !approval?.block || !approval?.record) throw new Error("Signed approval record is required");
  const proposedPolishReply = String(approval.record.proposedPolishReply ?? "");
  const hasProposedReply = approval.record.hasProposedReply === true;
  if (hasProposedReply !== Boolean(proposedPolishReply.trim())) throw new Error("Invalid proposed reply availability");
  if (!actionLinks?.reject || !actionLinks?.edit || (hasProposedReply && !actionLinks?.approve)) {
    throw new Error("Review action links are required");
  }

  const gatewayMode = actionLinks.mode === "gateway";
  const discussionUrl = safeUrl(entry.url || entry.discussionUrl);
  const topic = topicFor(result, entry);
  const subject = hasProposedReply
    ? `[HRM] Odpowiedź do zatwierdzenia — ${topic}`
    : `[HRM] Potrzebna Twoja decyzja — ${topic}`;
  const authorAndCategory = [singleLine(entry.author, "Nieznany autor", 60), singleLine(entry.category, "Forum HRM", 60)].join(" · ");
  const polishEntry = result.original_language === "pl" ? analysis.bodyInfo.body : result.polish_translation;
  const visibleEntry = shortText(polishEntry || result.summary_pl, MAX_EMAIL_ENTRY_CHARS);
  const visibleReply = shortText(proposedPolishReply, MAX_EMAIL_VISIBLE_REPLY_CHARS);
  const contextNeeded = visibleEntry.truncated || analysis.bodyInfo.truncated || result.requires_aleksander_response || result.interpretation_warning;
  const context = contextNeeded ? shortText(result.summary_pl, 420).text : "";
  const basis = basisFor(result);
  const approveLabel = visibleReply.truncated
    ? "ZOBACZ I ZATWIERDŹ PEŁNĄ ODPOWIEDŹ"
    : "ZATWIERDŹ I OPUBLIKUJ";
  const canApproveFromEmail = hasProposedReply && (!visibleReply.truncated || gatewayMode);

  const actionText = hasProposedReply
    ? [
      canApproveFromEmail ? textAction(approveLabel, actionLinks.approve) : "Pełna odpowiedź wymaga bezpiecznego ekranu zatwierdzenia.",
      textAction("POPRAW", actionLinks.edit),
      textAction("NIE ODPOWIADAJ", actionLinks.reject),
    ].filter(Boolean).join("\n\n")
    : [
      "Agent nie proponuje gotowej odpowiedzi.",
      textAction("NAPISZ ODPOWIEDŹ", actionLinks.edit),
      textAction("NIE ODPOWIADAJ", actionLinks.reject),
    ].join("\n\n");
  const originalLabel = result.original_language === "pl" ? "Otwórz wpis na GitHubie" : "Otwórz oryginał na GitHubie";
  const originalLinkText = discussionUrl ? `${originalLabel}: ${discussionUrl}` : "";

  const text = `HRM

${hasProposedReply ? "Odpowiedź do zatwierdzenia" : "Potrzebna Twoja decyzja"}

${authorAndCategory}

NAPISAŁ:
${visibleEntry.text || "(pusty wpis)"}${visibleEntry.truncated ? "\n\nPełny wpis jest dostępny na GitHubie." : ""}
${context ? `\nKONTEKST:\n${context}\n` : ""}
${hasProposedReply ? `PROPONOWANA ODPOWIEDŹ:\n${visibleReply.text}${visibleReply.truncated ? "\n\nPełna odpowiedź jest dostępna na bezpiecznym ekranie zatwierdzenia." : ""}\n` : ""}
${basis ? `${basis}\n` : ""}
${actionText}

${originalLinkText}
`;

  const contextHtml = context
    ? `<h2 style="margin:24px 0 8px;font-size:18px;line-height:1.3">KONTEKST</h2><p style="margin:0;overflow-wrap:anywhere">${escapeHtml(context)}</p>`
    : "";
  const basisHtml = basis ? `<p style="margin:20px 0 0;color:#40564c">${escapeHtml(basis)}</p>` : "";
  const proposalHtml = hasProposedReply
    ? `<h2 style="margin:24px 0 8px;font-size:18px;line-height:1.3">PROPONOWANA ODPOWIEDŹ</h2>
<div style="white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;border:1px solid #a9b8b0;border-radius:6px;background:#fff">${escapeHtml(visibleReply.text)}</div>
${visibleReply.truncated ? "<p style=\"margin:10px 0 0\"><strong>Pełna odpowiedź jest dostępna na bezpiecznym ekranie zatwierdzenia.</strong></p>" : ""}`
    : `<p style="margin:24px 0 0;padding:16px;border-left:4px solid #8a5a00;background:#fff7df"><strong>Agent nie proponuje gotowej odpowiedzi.</strong></p>`;
  const approveHtml = canApproveFromEmail ? buttonHtml(actionLinks.approve, approveLabel, "#185b43") : "";
  const editLabel = hasProposedReply ? "POPRAW" : "NAPISZ ODPOWIEDŹ";
  const actionsHtml = `${approveHtml}${buttonHtml(actionLinks.edit, editLabel, "#315a78")}${buttonHtml(actionLinks.reject, "NIE ODPOWIADAJ", "#742c35")}`;
  const originalHtml = discussionUrl
    ? `<p style="margin:22px 0 0"><a href="${escapeHtml(discussionUrl)}" style="display:block;min-height:44px;line-height:44px;color:#164b3a;font-weight:700;text-align:center">${escapeHtml(originalLabel.toUpperCase())}</a></p>`
    : "";

  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f1ea;color:#17211d;font-family:Arial,sans-serif;font-size:16px;line-height:1.55">
<main style="box-sizing:border-box;width:100%;max-width:640px;margin:0 auto;padding:24px 16px 40px">
<p style="margin:0 0 14px;font-size:20px;font-weight:700;letter-spacing:.08em">HRM</p>
<h1 style="margin:0 0 8px;font-size:22px;line-height:1.25">${hasProposedReply ? "Odpowiedź do zatwierdzenia" : "Potrzebna Twoja decyzja"}</h1>
<p style="margin:0 0 24px;color:#40564c;overflow-wrap:anywhere">${escapeHtml(authorAndCategory)}</p>
<h2 style="margin:0 0 8px;font-size:18px;line-height:1.3">NAPISAŁ</h2>
<div style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(visibleEntry.text || "(pusty wpis)")}</div>
${visibleEntry.truncated ? "<p><strong>Pokazano skrócony fragment. Pełny wpis jest dostępny na GitHubie.</strong></p>" : ""}
${contextHtml}${proposalHtml}${basisHtml}
<section aria-label="Decyzja" style="margin-top:24px">${actionsHtml}</section>
${originalHtml}
</main></body></html>`;

  return {
    to,
    subject,
    text,
    html,
    headers: { [APPROVAL_RECORD_HEADER]: encodeApprovalRecordHeader(approval.block) },
  };
}
