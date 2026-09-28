import fs from "node:fs";

const [expectedPath, actualPath, label = "HTML"] = process.argv.slice(2);
if (!expectedPath || !actualPath) {
  console.error("usage: node verify-html-identity.mjs EXPECTED ACTUAL [LABEL]");
  process.exit(2);
}

const expected = fs.readFileSync(expectedPath, "utf8");
const actual = fs.readFileSync(actualPath, "utf8");

function htmlLang(html) {
  const m = html.match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i);
  return m ? m[1].trim() : "";
}
function textTag(html, tag) {
  const rx = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + ">", "i");
  const m = html.match(rx);
  if (!m) return "";
  return m[1]
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
function canonical(html) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/\brel\s*=\s*["']canonical["']/i.test(tag)) continue;
    const m = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (m) return m[1].trim();
  }
  return "";
}

const fields = {
  lang: [htmlLang(expected), htmlLang(actual)],
  title: [textTag(expected, "title"), textTag(actual, "title")],
  h1: [textTag(expected, "h1"), textTag(actual, "h1")],
  canonical: [canonical(expected), canonical(actual)],
};

const errors = [];
for (const [name, pair] of Object.entries(fields)) {
  const [exp, got] = pair;
  if (!exp) continue;
  if (!got) errors.push(`${name}: missing in live HTML (expected ${JSON.stringify(exp)})`);
  else if (exp !== got) errors.push(`${name}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(got)}`);
}
if (!/<!doctype html|<html\b/i.test(actual)) errors.push("not HTML");

if (errors.length) {
  console.error(`${label}: HTML identity verification FAILED`);
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}
console.log(`${label}: HTML identity verified: lang=${fields.lang[0] || "n/a"}, title=${JSON.stringify(fields.title[0])}, h1=${JSON.stringify(fields.h1[0])}`);
