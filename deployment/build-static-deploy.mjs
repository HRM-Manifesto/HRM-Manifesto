import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const websiteRoot = path.join(repositoryRoot, 'website');
const stagingRoot = path.join(repositoryRoot, 'deployment', 'dist');
const allowlistPath = path.join(repositoryRoot, 'deployment', 'hrm-static-files.txt');
const checksumFile = 'SHA256SUMS.txt';
const checksumPaths = [
  'documents/en/HRM_Manifesto_Version_1.0_EN.docx',
  'documents/pl/HRM_Manifest_Wersja_1.0_PL.docx',
  'documents/sv/HRM_Manifest_Version_1.0_SV.docx',
  'llms.txt',
  'agents.txt',
  'manifest.json',
];

const protectedPathPatterns = [
  /(^|\/)documents(\/|$)/i,
  /(^|\/)(manifesto|charter|decalogue|declaration)([._/-]|$)/i,
  /(^|\/)threshold(?:\.[^/]+)?$/i,
  /(^|\/)archive([._/-]|$)/i,
  /(^|\/)sha256sums\.txt$/i,
  /(^|\/)license([._/-]|$)/i,
];

function parseAllowlist(text) {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function validateRelativeFile(file) {
  const normalized = file.replaceAll('\\', '/');
  if (
    normalized !== file ||
    normalized.startsWith('/') ||
    normalized.includes('../') ||
    normalized.includes('/..') ||
    path.posix.normalize(normalized) !== normalized
  ) {
    throw new Error(`Unsafe deployment path: ${file}`);
  }
  if (protectedPathPatterns.some((pattern) => pattern.test(normalized))) {
    throw new Error(`Protected HRM Version 1.0 path cannot be deployed: ${file}`);
  }
  return normalized;
}

async function verifyPublicChecksums() {
  const checksumText = await readFile(path.join(websiteRoot, checksumFile), 'utf8');
  const entries = checksumText
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const match = /^([0-9a-f]{64})  ([^\s]+)$/u.exec(line);
      if (!match) throw new Error(`Invalid public checksum line: ${line}`);
      return { expected: match[1], file: match[2] };
    });

  if (
    entries.length !== checksumPaths.length ||
    entries.some((entry, index) => entry.file !== checksumPaths[index])
  ) {
    throw new Error('Public checksum manifest must contain only the six reviewed HRM distribution files in canonical order.');
  }

  for (const entry of entries) {
    const bytes = await readFile(path.join(websiteRoot, ...entry.file.split('/')));
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== entry.expected) {
      throw new Error(`Public checksum mismatch: ${entry.file}`);
    }
  }
}

async function buildStaticDeploy() {
  const allowlist = parseAllowlist(await readFile(allowlistPath, 'utf8'));
  if (allowlist.length === 0) {
    throw new Error('Deployment allowlist is empty.');
  }
  if (new Set(allowlist).size !== allowlist.length) {
    throw new Error('Deployment allowlist contains duplicate paths.');
  }

  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });

  for (const rawFile of allowlist) {
    const file = validateRelativeFile(rawFile);
    const source = path.join(websiteRoot, ...file.split('/'));
    const sourceStat = await stat(source);
    if (!sourceStat.isFile()) {
      throw new Error(`Allowlisted path is not a regular file: ${file}`);
    }
    const destination = path.join(stagingRoot, ...file.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { force: false });
  }

  // The checksum path remains forbidden in the editable allowlist. It is added only
  // after its exact six-file shape and every digest have been independently verified.
  await verifyPublicChecksums();
  await cp(path.join(websiteRoot, checksumFile), path.join(stagingRoot, checksumFile), { force: false });

  await readFile(path.join(repositoryRoot, 'integrity', 'SHA256SUMS.txt'), 'utf8');
  process.stdout.write(`Prepared ${allowlist.length + 1} reviewed file(s) for deployment.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await buildStaticDeploy();
}

export { buildStaticDeploy, parseAllowlist, validateRelativeFile, verifyPublicChecksums };
