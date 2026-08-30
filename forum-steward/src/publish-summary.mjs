import { escapeMarkdown } from "./summary.mjs";

function blockquote(value) {
  return String(value ?? "").split(/\r?\n/).map((line) => `> ${escapeMarkdown(line)}`).join("\n");
}

export function renderPublishSummary({ result = null, error = null }) {
  const lines = [
    "# HRM Publish Approved Reply",
    "",
  ];
  if (error) {
    lines.push(
      "- PUBLISHED: **NO**",
      "- Status: bezpieczne przerwanie",
      "",
      escapeMarkdown(error.message || "Nieznany błąd"),
      "",
      "Żadna odpowiedź nie została opublikowana.",
      "",
    );
    return lines.join("\n");
  }
  if (!result?.published) {
    lines.push(
      "- PUBLISHED: **NO**",
      "",
      escapeMarkdown(result?.reason || "Publikacja nie została zatwierdzona."),
      "",
    );
    return lines.join("\n");
  }

  lines.push(
    "- PUBLISHED: **YES**",
    `- Discussion: [#${result.target.discussionNumber}](${result.target.discussionUrl})`,
    `- Original language: ${escapeMarkdown(result.originalLanguage)}`,
    `- Translation API calls: \`${result.apiCalls}\``,
    `- URL: [published comment](${result.publishedComment.url})`,
    "",
    "## Approved Polish reply",
    "",
    blockquote(result.approvedPolishReply),
    "",
    "## Published reply",
    "",
    blockquote(result.publishedReply),
    "",
    "> Opublikowano wyłącznie po ręcznym uruchomieniu workflow i wpisaniu dokładnego potwierdzenia PUBLISH.",
    "",
  );
  return lines.join("\n");
}
