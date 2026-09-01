import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const documents = [
  ['README.md', 'https://github.com/HRM-Manifesto/HRM-Manifesto/blob/main/README.md'],
  ['manifest/en/manifesto.md', 'https://hrm.se/manifesto.html'],
  ['manifest/en/charter.md', 'https://hrm.se/charter.html'],
  ['manifest/en/decalogue.md', 'https://hrm.se/decalogue.html'],
  ['manifest/en/threshold.md', 'https://hrm.se/threshold.html'],
  ['manifest/en/declaration.md', 'https://hrm.se/declaration.html'],
];

function sections(document, url, markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const result = [];
  let heading = 'Document introduction';
  let buffer = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) result.push({ document, title: document.split('/').pop().replace('.md', ''), section: heading, url, text });
    buffer = [];
  };
  for (const line of lines) {
    const match = /^(#{1,3})\s+(.+)$/.exec(line);
    if (match) {
      flush();
      heading = match[2].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return result;
}

const indexed = [];
for (const [document, url] of documents) {
  indexed.push(...sections(document, url, await readFile(path.join(root, document), 'utf8')));
}
const output = `<?php\n// Generated from official HRM repository sources. Do not edit by hand.\nreturn json_decode(<<<'HRM_JSON'\n${JSON.stringify(indexed, null, 2)}\nHRM_JSON, true, flags: JSON_THROW_ON_ERROR);\n`;
const targetDir = path.join(root, 'agent-steward', 'php', 'resources');
await mkdir(targetDir, { recursive: true });
await writeFile(path.join(targetDir, 'sources.php'), output, 'utf8');
console.log(`Indexed ${indexed.length} official HRM sections.`);
