import { appendFile } from "node:fs/promises";
import { processApprovalMailbox } from "./email-approval.mjs";
import { withApprovalMailbox } from "./imap-mailbox.mjs";

let report;
let failure;
try {
  report = await withApprovalMailbox({
    handler: (mailbox) => processApprovalMailbox({ mailbox }),
  });
  if (report.failures || report.confirmationFailures) process.exitCode = 1;
} catch {
  failure = "Procesor przerwał bezpiecznie z powodu błędu połączenia lub konfiguracji.";
  process.exitCode = 1;
}

const lines = [
  "# HRM Email Approval Processor",
  "",
  failure || "Przetwarzanie zakończone.",
  "",
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

if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines, "utf8");
else console.log(lines);
