import { appendFile } from "node:fs/promises";
import { loadPublishInputs, runPublishApprovedReply } from "./publish.mjs";
import { renderPublishSummary } from "./publish-summary.mjs";

let result;
let failure;
try {
  const inputs = await loadPublishInputs();
  result = await runPublishApprovedReply({ inputs });
} catch (error) {
  failure = error instanceof Error ? error : new Error("Unknown publication failure");
  process.exitCode = 1;
}

const markdown = renderPublishSummary({ result, error: failure });
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, "utf8");
} else {
  console.log(markdown);
}
