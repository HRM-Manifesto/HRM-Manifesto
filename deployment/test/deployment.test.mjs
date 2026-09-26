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
  assert.match(home, /href="agents\.html"/);
  assert.match(home, /href="verify\.html"/);
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
    assert.match(html, /hrm-visual3d\.css\?v=20260918-v4/);
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

test('HRM.se 2.0 foregrounds durable Core, AI Gateway and verification in all three languages', async () => {
  const { readFile } = await import('node:fs/promises');
  const { default: path } = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..', '..');
  const pages = [
    ['index.html', /A framework for coexistence between biological, digital and future subjects/],
    ['pl/index.html', /Ramy współistnienia podmiotów biologicznych, cyfrowych i przyszłych/],
    ['sv/index.html', /Ett ramverk för samexistens mellan biologiska, digitala och framtida subjekt/],
  ];
  for (const [page, headline] of pages) {
    const source = await readFile(path.join(root, 'website', ...page.split('/')), 'utf8');
    assert.match(source, headline);
    assert.match(source, /href="verify\.html"/);
    assert.match(source, /href="agents\.html"/);
    assert.match(source, /hrm-visual3d\.css\?v=20260918-v4/);
    assert.match(source, /hrm-v3\.css\?v=20260924-v1/);
  }
  for (const page of ['verify.html','pl/verify.html','sv/verify.html']) {
    const source = await readFile(path.join(root, 'website', ...page.split('/')), 'utf8');
    assert.match(source, /1904f9b333a11c316f0e2acca391bcebb1c1f2072c98536b02162e405f374553/);
    assert.match(source, /9C609B0EBE5470DB/);
    assert.match(source, /swh:1:snp:516ef481fb1260facde4acaffe28155c0901a0a4/);
  }
  for (const page of ['agents.html','pl/agents.html','sv/agents.html']) {
    const source = await readFile(path.join(root, 'website', ...page.split('/')), 'utf8');
    assert.match(source, /ai\/1\.0\.0\/catalog\.json/);
    assert.match(source, /ai\/1\.0\.0\/units\.jsonl/);
  }
});


test('Radar 2.0 preserves privacy while measuring idea reach and journeys', async () => {
  const { readFile } = await import('node:fs/promises');
  const { default: path } = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..', '..');
  const client = await readFile(path.join(root, 'website', 'js', 'hrm.js'), 'utf8');
  const collector = await readFile(path.join(root, 'website', 'radar', 'collect.php'), 'utf8');
  const summary = await readFile(path.join(root, 'website', 'radar', 'summary.php'), 'utf8');

  assert.match(client, /HRM Radar 2\.0/);
  assert.match(client, /idea_view/);
  assert.match(client, /engaged_300/);
  assert.match(client, /internal_click/);
  assert.match(collector, /2\.1-referrer-page/);
  assert.match(client, /referrer_page/);
  assert.match(collector, /referrer_page/);
  assert.match(summary, /referrer_pages/);
  assert.match(collector, /'idea'=>/);
  assert.match(collector, /'target'=>/);
  assert.doesNotMatch(collector, /'user_agent'=>|'ip'=>/);
  assert.match(summary, /'radar_version'=>'2\.0'/);
  assert.match(summary, /'source_quality'=>/);
  assert.match(summary, /'agent_pages'=>/);
  assert.match(summary, /'agent_ideas'=>/);
  assert.match(summary, /'transitions'=>/);
  assert.match(summary, /'fingerprinting'=>false/);
});
