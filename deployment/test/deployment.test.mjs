import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAllowlist, validateRelativeFile } from '../build-static-deploy.mjs';

test('allowlist parser ignores comments and blank lines', () => {
  assert.deepEqual(parseAllowlist('# note\nagents.txt\n\nllms.txt\n'), ['agents.txt', 'llms.txt']);
});

test('safe discovery and board paths are accepted', () => {
  assert.equal(validateRelativeFile('agents.txt'), 'agents.txt');
  assert.equal(validateRelativeFile('board.html'), 'board.html');
  assert.equal(validateRelativeFile('css/board.css'), 'css/board.css');
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
