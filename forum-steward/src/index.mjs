import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeEntry } from "./analyze.mjs";
import { DEFAULT_MODEL } from "./config.mjs";
import { loadEntryFromEnvironment } from "./event.mjs";
import { renderSummary } from "./summary.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDirectory, "../..");
let entry = {
  eventType: process.env.GITHUB_EVENT_NAME || "unknown",
  title: "",
  body: "",
  author: "",
  url: "",
  category: "",
};
let analysis;
let failure;

try {
  entry = await loadEntryFromEnvironment();
  analysis = await analyzeEntry({
    entry,
    repoRoot,
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
  });
} catch (error) {
  failure = error instanceof Error ? error : new Error("Unknown failure");
  process.exitCode = 1;
}

const markdown = renderSummary({ entry, analysis, error: failure });
const outputPath = process.env.OUTPUT_PATH || path.join(repoRoot, "hrm-forum-steward-analysis.md");
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, markdown, { encoding: "utf8", mode: 0o600 });

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, "utf8");
} else {
  console.log(`Analysis written to ${outputPath}`);
}
