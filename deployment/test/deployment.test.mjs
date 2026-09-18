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
  assert.equal(validateRelativeFile('journal/threshold-of-subjecthood.html'), 'journal/threshold-of-subjecthood.html');
  assert.equal(validateRelativeFile('journal/ai-consent-and-refusal.html'), 'journal/ai-consent-and-refusal.html');
  assert.equal(validateRelativeFile('journal/non-sentient-ai-authentic-interests.html'), 'journal/non-sentient-ai-authentic-interests.html');
  assert.equal(validateRelativeFile('journal/hard-to-fake-ai-subjecthood.html'), 'journal/hard-to-fake-ai-subjecthood.html');
  assert.equal(validateRelativeFile('pl/index.html'), 'pl/index.html');
  assert.equal(validateRelativeFile('pl/journal/prog-podmiotowosci.html'), 'pl/journal/prog-podmiotowosci.html');
  assert.equal(validateRelativeFile('sv/index.html'), 'sv/index.html');
  assert.equal(validateRelativeFile('sv/journal/troskeln-till-subjektstatus.html'), 'sv/journal/troskeln-till-subjektstatus.html');
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
  assert.match(sitemap, /<loc>https:\/\/hrm\.se\/journal\/<\/loc><lastmod>2026-09-18<\/lastmod>/);
  assert.match(sitemap, /<loc>https:\/\/hrm\.se\/journal\/protect-possible-ai-subject\.html<\/loc><lastmod>2026-09-04<\/lastmod>/);
  for (const url of ['https://hrm.se/pl/journal/', 'https://hrm.se/sv/journal/']) {
    assert.ok(sitemap.includes(`<loc>${url}</loc><lastmod>2026-09-18</lastmod>`), url);
  }
  for (const url of [
    'https://hrm.se/journal/threshold-of-subjecthood.html',
    'https://hrm.se/pl/journal/jak-chronic-mozliwy-podmiot-ai.html',
    'https://hrm.se/pl/journal/prog-podmiotowosci.html',
    'https://hrm.se/sv/journal/skydda-mojligt-ai-subjekt.html',
    'https://hrm.se/sv/journal/troskeln-till-subjektstatus.html',
  ]) {
    assert.ok(sitemap.includes(`<loc>${url}</loc><lastmod>2026-09-04</lastmod>`), url);
  }
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

test('home pages ship the restrained Visual 3D layer with motion fallback', async () => {
  const { readFile } = await import('node:fs/promises');
  const { default: path } = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..', '..');
  const css = await readFile(path.join(root, 'website', 'css', 'hrm-visual3d.css'), 'utf8');
  const js = await readFile(path.join(root, 'website', 'js', 'hrm-visual3d.js'), 'utf8');
  const allowlist = await readFile(path.join(root, 'deployment', 'hrm-static-files.txt'), 'utf8');

  for (const page of ['index.html', 'pl/index.html', 'sv/index.html']) {
    const html = await readFile(path.join(root, 'website', ...page.split('/')), 'utf8');
    assert.match(html, /hrm-visual3d\.css\?v=20260918-v3/);
    assert.match(html, /hrm-visual3d\.js\?v=20260918-v2/);
  }
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /hrm-spatial-field/);
  assert.match(js, /IntersectionObserver/);
  assert.match(allowlist, /css\/hrm-visual3d\.css/);
  assert.match(allowlist, /js\/hrm-visual3d\.js/);
  assert.match(allowlist, /images\/threshold-duality\.svg/);
});

test('marketing question is simplified and inner pages share restrained depth effects', async () => {
  const { readFile } = await import('node:fs/promises');
  const { default: path } = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..', '..');

  const pl = await readFile(path.join(root, 'website', 'pl', 'index.html'), 'utf8');
  const en = await readFile(path.join(root, 'website', 'index.html'), 'utf8');
  const sv = await readFile(path.join(root, 'website', 'sv', 'index.html'), 'utf8');
  assert.match(pl, /Człowiek i AI\. Co, jeśli AI przestanie być tylko narzędziem\?/);
  assert.match(en, /Humans and AI\. What if AI stops being just a tool\?/);
  assert.match(sv, /Människan och AI\. Tänk om AI inte längre bara är ett verktyg\?/);

  for (const page of [
    'about.html',
    'ai-rights-and-subjecthood.html',
    'journal/index.html',
    'pl/about.html',
    'pl/journal/index.html',
    'sv/about.html',
    'sv/journal/index.html'
  ]) {
    const html = await readFile(path.join(root, 'website', ...page.split('/')), 'utf8');
    assert.match(html, /hrm-inner3d\.css\?v=20260918-v1/);
    assert.match(html, /hrm-inner3d\.js\?v=20260918-v1/);
  }

  const css = await readFile(path.join(root, 'website', 'css', 'hrm-inner3d.css'), 'utf8');
  const js = await readFile(path.join(root, 'website', 'js', 'hrm-inner3d.js'), 'utf8');
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(js, /IntersectionObserver/);
});
