import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('explicit existing preview directory is rejected before processing and preserves its contents', t => {
  const directory = mkdtempSync(join(tmpdir(), 'semantic-preview-preserve-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'keep.txt'), 'frozen bytes');
  const result = spawnSync(process.execPath, ['scripts/run-semantic-preview.mjs', '--output=' + directory], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /Explicit output must be a new directory/);
  assert.equal(readFileSync(join(directory, 'keep.txt'), 'utf8'), 'frozen bytes');
});

test('empty explicit preview directory cannot fall back to destructive default output', () => {
  const result = spawnSync(process.execPath, ['scripts/run-semantic-preview.mjs', '--output='], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /Explicit output must name a new directory/);
});
