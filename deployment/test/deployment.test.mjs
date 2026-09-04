import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAllowlist, validateRelativeFile, verifyPublicChecksums } from '../build-static-deploy.mjs';

test('allowlist parser ignores comments and blank lines', () => {
  assert.deepEqual(parseAllowlist('# note\nagents.txt\n\nllms.txt\n'), ['agents.txt', 'llms.txt']);
});

test('safe discovery and board paths are accepted', () => {
  assert.equal(validateRelativeFile('agents.txt'), 'agents.txt');
  assert.equal(validateRelativeFile('board.html'), 'board.html');
  assert.equal(validateRelativeFile('css/board.css'), 'css/board.css');
  assert.equal(validateRelativeFile('journal/index.html'), 'journal/index.html');
  assert.equal(validateRelativeFile('journal/protect-possible-ai-subject.html'), 'journal/protect-possible-ai-subject.html');
});

test('SEO deployment keeps technical resources out of the sitemap', async () => {
  const { readFile } = await import('node:fs/promises');
  const { default: path } = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..', '..');
  const sitemap = await readFile(path.join(root, 'website', 'sitemap.xml'), 'utf8');
  const robots = await readFile(path.join(root, 'website', 'robots.txt'), 'utf8');
  const home = await readFile(path.join(root, 'website', 'index.html'), 'utf8');

  assert.match(robots, /Sitemap: https:\/\/hrm\.se\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/hrm\.se\/ai-rights-and-subjecthood\.html<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  assert.doesNotMatch(sitemap, /hrm-knowledge-capsule\.schema\.json|agents\.txt|llms\.txt|manifest\.json/);
  assert.match(home, /"@type":"WebSite"/);
  assert.match(home, /href="ai-rights-and-subjecthood\.html"/);
  assert.match(home, /href="journal\/"/);
  assert.match(sitemap, /<loc>https:\/\/hrm\.se\/journal\/<\/loc><lastmod>2026-09-04<\/lastmod>/);
  assert.match(sitemap, /<loc>https:\/\/hrm\.se\/journal\/protect-possible-ai-subject\.html<\/loc><lastmod>2026-09-04<\/lastmod>/);
});

test('protected HRM Version 1.0 paths are rejected', () => {
  for (const file of [
    'manifesto.html',
    'charter.md',
    'documents/en/HRM_Manifesto_Version_1.0_EN.docx',
    'SHA256SUMS.txt',
    'archive.html',
  ]) {
    assert.throws(() => validateRelativeFile(file), /Protected HRM Version 1\.0/);
  }
});

test('path traversal and absolute paths are rejected', () => {
  for (const file of ['../README.md', '/etc/passwd', 'css/../manifesto.html', 'css\\board.css']) {
    assert.throws(() => validateRelativeFile(file), /Unsafe deployment path/);
  }
});

test('public checksums match the exact six-file distribution manifest', async () => {
  await verifyPublicChecksums();
});

test('service payload builder maps web roots and excludes runtime secrets', async () => {
  const { readFile } = await import('node:fs/promises');
  const { default: path } = await import('node:path');
  const script = await readFile(path.resolve(import.meta.dirname, '..', 'build-services-deploy.mjs'), 'utf8');
  assert.match(script, /public_html/);
  assert.match(script, /Forbidden runtime or secret file/);
  assert.match(script, /config\|board-config/);
});

test('service deployment saves an exact rollback artifact before code deployment', async () => {
  const { readFile } = await import('node:fs/promises');
  const { default: path } = await import('node:path');
  const workflow = await readFile(path.resolve(import.meta.dirname, '..', '..', '.github', 'workflows', 'hrm-services-deploy.yml'), 'utf8');
  assert.match(workflow, /Save code rollback artifact before deployment/);
  assert.doesNotMatch(workflow, /mariadb-dump/);
  assert.match(workflow, /password_verify\(getenv\("BOARD_ADMIN_PASSWORD"\)/);
  assert.match(workflow, /cmp payload\/gateway\/src\/BoardAdmin\.php remote-verify\/BoardAdmin\.php/);
  assert.ok(workflow.indexOf('Save code rollback artifact before deployment') < workflow.indexOf('Deploy tested code and create missing configuration'));
});
