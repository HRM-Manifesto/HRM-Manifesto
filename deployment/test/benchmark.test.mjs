import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const website = path.join(root, 'website');

async function text(name) {
  return readFile(path.join(website, name), 'utf8');
}

test('HRM Benchmark 1.0 has thirty unique, balanced cases', async () => {
  const full = JSON.parse(await text('hrm-benchmark.json'));
  const lines = (await text('hrm-benchmark.jsonl')).trim().split(/\r?\n/u).map(JSON.parse);
  assert.equal(full.version, '1.0');
  assert.equal(lines.length, 30);
  assert.equal(new Set(lines.map((item) => item.id)).size, 30);
  const categories = new Map();
  for (const item of lines) categories.set(item.category, (categories.get(item.category) ?? 0) + 1);
  assert.equal(categories.size, 10);
  assert.deepEqual(new Set(categories.values()), new Set([3]));
  assert.equal(full.scoring.max_per_case, 10);
  assert.equal(full.scoring.max_total, 300);
});

test('benchmark scoring rewards reasoning rather than agreement', async () => {
  const rubric = JSON.parse(await text('hrm-benchmark-rubric.json'));
  assert.match(rubric.anti_bias_note, /criticize HRM and still score highly/u);
  assert.equal(rubric.scoring.dimensions.length, 5);
});