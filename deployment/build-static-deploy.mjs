import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const websiteRoot = path.join(repositoryRoot, 'website');
const stagingRoot = path.join(repositoryRoot, 'deployment', 'dist');
const allowlistPath = path.join(repositoryRoot, 'deployment', 'hrm-static-files.txt');

const protectedPathPatterns = [
  /(^|\/)documents(\/|$)/i,
  /(^|\/)(manifesto|charter|decalogue|declaration|threshold)([._/-]|$)/i,
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

  await readFile(path.join(repositoryRoot, 'integrity', 'SHA256SUMS.txt'), 'utf8');
  process.stdout.write(`Prepared ${allowlist.length} reviewed file(s) for deployment.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await buildStaticDeploy();
}

export { buildStaticDeploy, parseAllowlist, validateRelativeFile };
