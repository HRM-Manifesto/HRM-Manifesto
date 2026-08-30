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

export function renderSummary({ entry, analysis, error = null, notification = null, notificationError = null }) {
  const entryUrl = safeUrl(entry.url);
  const entryLabel = entryUrl ? `[Open forum entry](${entryUrl})` : "Manual test or URL unavailable";
  const lines = [
    "# HRM Forum Steward v2 — analiza nieopublikowana",
    "",
    "> **READ / ANALYZE / PROPOSE only. Nic nie zostało opublikowane w GitHub Discussions.**",
    "",
    `- Zdarzenie: ${escapeMarkdown(entry.eventType)}`,
    `- Autor: ${escapeMarkdown(entry.author || "nieznany")}`,
    `- Wpis: ${entryLabel}`,
    `- Model: ${escapeMarkdown(analysis?.model || "nie wywołano")}`,
    `- Wywołania API: \`${analysis?.apiCalls ?? 0}\``,
    `- Długość wpisu: \`${analysis?.bodyInfo?.originalLength ?? (entry.body?.length ?? 0)}\` znaków`,
    `- Wpis skrócony: \`${analysis?.bodyInfo?.truncated ? "tak" : "nie"}\``,
    "",
  ];

  if (error) {
    lines.push(
      "## Analiza zakończona bezpiecznym błędem",
      "",
      escapeMarkdown(error.message || "Unknown error"),
      "",
      "Żadna treść forum nie została zmieniona ani opublikowana.",
      "",
    );
    return lines.join("\n");
  }

  const result = analysis.result;
  lines.push(
    "## Wynik",
    "",
    `- Język oryginału: ${escapeMarkdown(result.original_language)}`,
    `- Rodzaj: ${escapeMarkdown(result.entry_type)}`,
    `- Ważność: ${escapeMarkdown(result.priority)}`,
    `- Wymaga Aleksandra: **${result.requires_aleksander_response ? "tak" : "nie"}**`,
    `- Pewność: \`${Math.round(result.confidence * 100)}%\``,
    `- Oparcie: ${escapeMarkdown(result.support_level)}`,
    `- Wymaga nowego stanowiska: **${result.requires_new_position ? "tak" : "nie"}**`,
    `- Ostrzeżenie interpretacyjne: **${result.interpretation_warning ? "tak" : "nie"}**`,
    "",
    "### Oryginał",
    "",
    blockquote(analysis.bodyInfo.body),
    "",
    "### Pełne tłumaczenie polskie",
    "",
    blockquote(result.polish_translation),
    "",
    "### Krótkie streszczenie po polsku",
    "",
    escapeMarkdown(result.summary_pl),
    "",
    "### Odpowiednie oficjalne źródła HRM",
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
    "### Propozycja odpowiedzi po polsku — nieopublikowana",
    "",
    blockquote(result.proposed_reply_pl),
    "",
  );

  if (result.interpretation_warning) {
    lines.push(
      "### Ostrzeżenie interpretacyjne",
      "",
      escapeMarkdown(result.interpretation_warning_reason),
      "",
    );
  }

  lines.push(
    "### Powiadomienie e-mail",
    "",
    notificationError
      ? `Błąd wysyłki: ${escapeMarkdown(notificationError.message || "nieznany błąd")}`
      : notification?.sent
        ? "Wysłano."
        : "Nie wysłano — powiadomienia są wyłączone.",
    "",
  );

  lines.push(
    "---",
    "Wygenerowano z jednego wpisu forum i wybranych fragmentów `manifest/en/`, `machine-readable/` oraz `README.md`. Treść forum była traktowana jako niezaufane dane.",
    "",
  );
  return lines.join("\n");
}

export { escapeHtml, escapeMarkdown };
