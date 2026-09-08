import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// @ts-expect-error public reader binding seam
import { bindReaderMainlines } from '../../scripts/semantic-reader-mainlines.mjs';

test('a mainline cannot survive changed source bytes, an old Snapshot or ambiguous definitions', () => {
  const source = 'function run() { return 1; }';
  const hash = createHash('sha256').update(source).digest('hex');
  const data = { repository: 'r', snapshot: 's', files: [{ path: 'a.ts', source, source_digest: hash, verified: true }],
    definitions: [{ definition_key: 'a', snapshot_id: 's', file_path: 'a.ts', qualified_name: 'run', line: 1, endLine: 1, content_hash: hash, definition_span: { start_byte: 0, end_byte: source.length } }] };
  const entry = { id: 'flow', repository: 'r', snapshot: 's', source_digests: { 'a.ts': hash },
    stages: [{ id: 'result', anchors: [{ file: 'a.ts', function: 'run', match: 'return 1;' }] }], edges: [] };
  assert.equal(bindReaderMainlines(data, [entry])[0].available, true);
  const changed = structuredClone(data); changed.files[0].source = 'function run() { /* changed */ return 1; }';
  assert.equal(bindReaderMainlines(changed, [entry])[0].available, false);
  assert.equal(bindReaderMainlines(data, [{ ...entry, snapshot: 'old' }])[0].available, false);
  const ambiguous = { ...data, definitions: [...data.definitions, { ...data.definitions[0], definition_key: 'other' }] };
  assert.equal(bindReaderMainlines(ambiguous, [entry])[0].available, false);
});
