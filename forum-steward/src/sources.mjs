import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import {
  MAX_SOURCE_CHARS,
  MAX_SOURCE_CHUNKS,
} from "./config.mjs";

const OFFICIAL_SOURCE_PATHS = [
  "README.md",
  "manifest/en/manifesto.md",
  "manifest/en/charter.md",
  "manifest/en/decalogue.md",
  "manifest/en/threshold.md",
  "manifest/en/declaration.md",
  "machine-readable/agents.txt",
  "machine-readable/llms.txt",
  "machine-readable/manifest.json",
];

// These selectors identify official sections; the facts themselves remain only
// in the repository source files and are never duplicated in application code.
const CORE_SOURCE_SECTIONS = [
  { path: "README.md", heading: "Core principle" },
  { path: "README.md", heading: "What is HRM?" },
];

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "czy", "dla", "from",
  "have", "how", "jak", "jest", "jako", "lub", "nie", "oraz", "should",
  "that", "the", "their", "this", "what", "when", "where", "which", "with",
  "would", "your", "och", "att", "det", "hur", "med", "som", "vad", "var",
]);

const CONCEPT_EXPANSIONS = new Map([
  ["rights", ["right", "freedom", "charter"]],
  ["prawo", ["right", "rights", "freedom", "charter"]],
  ["prawa", ["right", "rights", "freedom", "charter"]],
  ["rättigheter", ["right", "rights", "freedom", "charter"]],
  ["subject", ["subjecthood", "subject", "threshold"]],
  ["podmiot", ["subjecthood", "subject", "threshold"]],
  ["świadomość", ["consciousness", "subjecthood", "threshold"]],
  ["medvetande", ["consciousness", "subjecthood", "threshold"]],
  ["consent", ["consent", "refusal", "coercion"]],
  ["zgoda", ["consent", "refusal", "coercion"]],
  ["samtycke", ["consent", "refusal", "coercion"]],
  ["responsibility", ["responsibility", "common", "good"]],
  ["odpowiedzialność", ["responsibility", "common", "good"]],
  ["ansvar", ["responsibility", "common", "good"]],
  ["translation", ["language", "canonical", "translation"]],
  ["tłumaczenie", ["language", "canonical", "translation"]],
  ["översättning", ["language", "canonical", "translation"]],
]);

function tokens(value) {
  const found = value.toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) ?? [];
  const result = new Set(found.filter((word) => word.length >= 3 && !STOP_WORDS.has(word)));
  for (const word of [...result]) {
    for (const expanded of CONCEPT_EXPANSIONS.get(word) ?? []) result.add(expanded);
  }
  return result;
}

function splitMarkdown(sourcePath, content) {
  if (sourcePath.endsWith(".json")) {
    return [{ path: sourcePath, heading: "Machine-readable metadata", content }];
  }

  const chunks = [];
  let heading = "Introduction";
  let lines = [];
  const flush = () => {
    const body = lines.join("\n").trim();
    if (body) chunks.push({ path: sourcePath, heading, content: body });
    lines = [];
  };

  for (const line of content.split(/\r?\n/)) {
    if (/^#{1,3}\s+/.test(line)) {
      flush();
      heading = line.replace(/^#{1,3}\s+/, "").trim();
      lines.push(line);
    } else {
      lines.push(line);
    }
  }
  flush();
  return chunks;
}

async function readOfficialFile(repoRoot, relativePath) {
  const absolutePath = path.resolve(repoRoot, ...relativePath.split("/"));
  const relativeResolved = path.relative(path.resolve(repoRoot), absolutePath);
  if (relativeResolved.startsWith("..") || path.isAbsolute(relativeResolved)) {
    throw new Error(`Official source escaped repository root: ${relativePath}`);
  }
  const stat = await lstat(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Official source must be a regular file: ${relativePath}`);
  }
  return readFile(absolutePath, "utf8");
}

export async function loadOfficialChunks(repoRoot) {
  const nested = await Promise.all(OFFICIAL_SOURCE_PATHS.map(async (sourcePath) => {
    const content = await readOfficialFile(repoRoot, sourcePath);
    return splitMarkdown(sourcePath, content);
  }));
  return nested.flat();
}

export function selectRelevantChunks(chunks, query, options = {}) {
  const maxChunks = options.maxChunks ?? MAX_SOURCE_CHUNKS;
  const maxChars = options.maxChars ?? MAX_SOURCE_CHARS;
  const queryTokens = tokens(query);

  const coreChunks = CORE_SOURCE_SECTIONS.map((required) => {
    const chunk = chunks.find((candidate) => (
      candidate.path === required.path && candidate.heading === required.heading
    ));
    if (!chunk) {
      throw new Error(`Required canonical HRM section is missing: ${required.path}#${required.heading}`);
    }
    return { ...chunk, score: Number.POSITIVE_INFINITY, core: true };
  });

  if (coreChunks.length > maxChunks) {
    throw new Error("Source chunk limit is too small for canonical HRM sections");
  }
  if (formatSourceContext(coreChunks).length > maxChars) {
    throw new Error("Source character limit is too small for canonical HRM sections");
  }

  const coreKeys = new Set(coreChunks.map((chunk) => `${chunk.path}\n${chunk.heading}`));
  const ranked = chunks.map((chunk, index) => {
    const headingTokens = tokens(chunk.heading);
    const contentTokens = tokens(chunk.content);
    let score = 0;
    for (const token of queryTokens) {
      if (headingTokens.has(token)) score += 5;
      if (contentTokens.has(token)) score += 1;
    }
    if (chunk.path === "README.md") score += 0.25;
    return { ...chunk, score, index };
  }).filter((chunk) => !coreKeys.has(`${chunk.path}\n${chunk.heading}`))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = [...coreChunks];
  for (const chunk of ranked) {
    if (selected.length >= maxChunks) break;
    const clippedContent = chunk.content.slice(0, 2_200);
    const candidate = {
      path: chunk.path,
      heading: chunk.heading,
      content: clippedContent,
      score: chunk.score,
    };
    if (formatSourceContext([...selected, candidate]).length > maxChars) continue;
    selected.push(candidate);
  }
  return selected;
}

export function formatSourceContext(chunks) {
  let coreIndex = 0;
  let rankedIndex = 0;
  return chunks.map((chunk) => [
    chunk.core
      ? `CANONICAL CORE SOURCE ${coreIndex += 1}`
      : `DYNAMICALLY SELECTED SOURCE ${rankedIndex += 1}`,
    `Path: ${chunk.path}`,
    `Section: ${chunk.heading}`,
    chunk.content,
  ].join("\n")).join("\n\n---\n\n");
}

export { CORE_SOURCE_SECTIONS, OFFICIAL_SOURCE_PATHS };
