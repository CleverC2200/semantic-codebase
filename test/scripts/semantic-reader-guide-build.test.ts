import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// @ts-expect-error frozen reader input/output seam
import { applyReaderGuide } from '../../scripts/semantic-reader-guide-build.mjs';

test('a guide binds flows and presentation corrections without altering analysis, and rejects foreign source versions', () => {
  const source = 'function run() { return 1; }', digest = createHash('sha256').update(source).digest('hex');
  const data = { repository: 'r', snapshot: 's', files: [{ path: 'a.ts', source, source_digest: digest, verified: true }],
    definitions: [{ definition_key: 'run', snapshot_id: 's', file_path: 'a.ts', qualified_name: 'run', line: 1, endLine: 1, content_hash: digest, definition_span: { start_byte: 0, end_byte: source.length }, presentation: { basis: 'llm_inferred', verified: false, purpose: '返回值' } }],
    facts: [{ id: 'fact' }], evidence: { e: { source_digest: digest } } };
  const guide = { repository: 'r', snapshot: 's', source_digests: { 'a.ts': digest }, overview: { purpose: '示例', capabilities: [] },
    mainlines: [{ id: 'result', title: '返回值', source_digests: { 'a.ts': digest }, stages: [{ id: 'return', anchors: [{ file: 'a.ts', function: 'run', match: 'return 1;' }] }], edges: [] }],
    corrections: [{ definition_key: 'run', content_hash: digest, logic: '返回常量 1。', reason: '源码直接返回常量' }] };
  const out = applyReaderGuide(data, guide);
  assert.equal(out.mainlines[0].available, true);
  assert.equal(out.definitions[0].presentation.logic, '返回常量 1。');
  assert.equal(out.definitions[0].presentation.verified, false);
  assert.deepEqual(out.facts, data.facts);
  assert.deepEqual(out.evidence, data.evidence);
  assert.equal('logic' in data.definitions[0].presentation, false);
  assert.throws(() => applyReaderGuide({ ...data, snapshot: 'old' }, guide), /GUIDE_VERSION/);
  const corrupt = structuredClone(data); corrupt.files[0].source += ' ';
  assert.throws(() => applyReaderGuide(corrupt, guide), /GUIDE_SOURCE/);
});
