import { IMAP_DIAGNOSTIC_CATEGORIES } from "./imap-diagnostics.mjs";

function safeField(value, fallback, maxLength) {
  return String(value ?? fallback).toUpperCase().replace(/[^A-Z0-9_.:/-]/g, "").slice(0, maxLength) || fallback;
}

export function renderEmailApprovalSummary({ report, failure }) {
  const category = IMAP_DIAGNOSTIC_CATEGORIES.includes(failure?.category) ? failure.category : "UNKNOWN";
  const safeCode = safeField(failure?.safeCode, "UNAVAILABLE", 130);
  const stage = safeField(failure?.stage, "UNKNOWN", 64);
  return [
    "# HRM Email Approval Processor",
    "",
    failure ? "Procesor przerwał bezpiecznie. Nic nie zostało opublikowane." : "Przetwarzanie zakończone.",
    "",
    ...(failure ? [
      `- Kategoria: \`${category}\``,
      `- Kod bezpieczny: \`${safeCode}\``,
      `- Etap: \`${stage}\``,
      "",
    ] : []),
    `- Opublikowane: \`${report?.published ?? 0}\``,
    `- Odrzucone: \`${report?.rejected ?? 0}\``,
    `- Wygasłe: \`${report?.expired ?? 0}\``,
    `- Wykryte duplikaty: \`${report?.duplicates ?? 0}\``,
    `- Nieprawidłowe wiadomości: \`${report?.invalid ?? 0}\``,
    `- Błędy bez publikacji: \`${report?.failures ?? 0}\``,
    `- Błędy e-maila potwierdzającego: \`${report?.confirmationFailures ?? 0}\``,
    "",
    "> Pełne Approval ID, treści uwierzytelniające i dane IMAP/SMTP nie są wyświetlane.",
    "",
  ].join("\n");
}
