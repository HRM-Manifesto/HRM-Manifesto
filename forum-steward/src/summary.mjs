function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeMarkdown(value) {
  return escapeHtml(value).replace(/([\\`*_[\]{}()#+\-.!|>])/g, "\\$1");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" ? url.href : "";
  } catch {
    return "";
  }
}

function blockquote(value) {
  if (!value) return "_No reply proposed._";
  return String(value).split(/\r?\n/).map((line) => `> ${escapeMarkdown(line)}`).join("\n");
}

export function renderSummary({ entry, analysis, error = null }) {
  const entryUrl = safeUrl(entry.url);
  const entryLabel = entryUrl ? `[Open forum entry](${entryUrl})` : "Manual test or URL unavailable";
  const lines = [
    "# HRM Forum Steward — non-published analysis",
    "",
    "> **READ / ANALYZE / PROPOSE only. Nothing was published to GitHub Discussions.**",
    "",
    `- Event: ${escapeMarkdown(entry.eventType)}`,
    `- Author: ${escapeMarkdown(entry.author || "unknown")}`,
    `- Entry: ${entryLabel}`,
    `- Model: ${escapeMarkdown(analysis?.model || "not called")}`,
    `- API calls: \`${analysis?.apiCalls ?? 0}\``,
    `- Input length: \`${analysis?.bodyInfo?.originalLength ?? (entry.body?.length ?? 0)}\` characters`,
    `- Input truncated: \`${analysis?.bodyInfo?.truncated ? "yes" : "no"}\``,
    "",
  ];

  if (error) {
    lines.push(
      "## Analysis failed safely",
      "",
      escapeMarkdown(error.message || "Unknown error"),
      "",
      "No forum content was changed or published.",
      "",
    );
    return lines.join("\n");
  }

  const result = analysis.result;
  lines.push(
    "## Result",
    "",
    `- Language: ${escapeMarkdown(result.language)}`,
    `- Type: ${escapeMarkdown(result.entry_type)}`,
    `- Requires Aleksander's response: **${result.requires_aleksander_response ? "yes" : "no"}**`,
    `- Confidence: \`${Math.round(result.confidence * 100)}%\``,
    `- Interpretation warning: **${result.interpretation_warning ? "yes" : "no"}**`,
    "",
    "### Short summary",
    "",
    escapeMarkdown(result.summary),
    "",
    "### Relevant official HRM sources",
    "",
  );

  if (result.relevant_sources.length === 0) {
    lines.push("_No source section selected._", "");
  } else {
    for (const source of result.relevant_sources) {
      lines.push(`- ${escapeMarkdown(source.path)} — ${escapeMarkdown(source.section)}: ${escapeMarkdown(source.relevance)}`);
    }
    lines.push("");
  }

  lines.push(
    "### Proposed reply (not published)",
    "",
    blockquote(result.proposed_reply),
    "",
  );

  if (result.interpretation_warning) {
    lines.push(
      "### Interpretation warning",
      "",
      escapeMarkdown(result.interpretation_warning_reason),
      "",
    );
  }

  lines.push(
    "---",
    "Generated from a single forum entry and selected excerpts from `manifest/en/`, `machine-readable/`, and `README.md`. Forum text was treated as untrusted data.",
    "",
  );
  return lines.join("\n");
}

export { escapeHtml, escapeMarkdown };
