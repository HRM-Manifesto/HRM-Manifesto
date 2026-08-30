import { appendFile } from "node:fs/promises";
import { processApprovalMailbox } from "./email-approval.mjs";
import { renderEmailApprovalSummary } from "./email-approval-summary.mjs";
import { imapDiagnosticSummary } from "./imap-diagnostics.mjs";
import { withApprovalMailbox } from "./imap-mailbox.mjs";

let report;
let failure;
try {
  report = await withApprovalMailbox({
    handler: (mailbox) => processApprovalMailbox({ mailbox }),
  });
  if (report.failures || report.confirmationFailures) process.exitCode = 1;
} catch (error) {
  failure = imapDiagnosticSummary(error);
  process.exitCode = 1;
}

const lines = renderEmailApprovalSummary({ report, failure });

if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines, "utf8");
else console.log(lines);
