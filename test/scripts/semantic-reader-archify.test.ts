import test from 'node:test';
import assert from 'node:assert/strict';
import { createArchifyMainlineSpec } from '../../scripts/semantic-reader-archify.mjs';

test('exports only current-version mainline definitions and resolved calls', () => {
  const data = { snapshot: 'a'.repeat(64), repository: 'https://github.com/example/repo', revision: 'b'.repeat(40), mainlines: [{ id: 'flow', title: '同步', available: true, snapshot: 'a'.repeat(64), stages: [{ title: '同步', keys: ['a', 'b', 'missing'] }] }], definitions: [{ definition_key: 'a', qualified_name: 'A.run', file_path: 'src/a.ts', line: 3, end_line: 8 }, { definition_key: 'b', qualified_name: 'B.save', file_path: 'src/b.ts', line: 10, end_line: 12 }], facts: [{ kind: 'call_target', subject: { definition_key: 'a' }, value: { target_definition_key: 'b' }, evidence_ids: ['evidence-a'] }, { kind: 'call_target', subject: { definition_key: 'a' }, value: { target_definition_key: 'missing' } }] };
  const spec = createArchifyMainlineSpec(data, 'flow');
  assert.equal(spec.components.length, 2);
  assert.equal(spec.components[0].tag, '同步');
  assert.deepEqual(spec.connections.map(edge => [edge.from, edge.to]), [['fn-1', 'fn-2']]);
  assert.match(spec.connections[0].label, /Evidence evidence-a/);
  assert.equal(spec.meta.repository.revision, data.revision);
  assert.match(spec.cards[0].items[0], /Snapshot/);
});

test('refuses a projection without a real Git revision', () => {
  assert.throws(() => createArchifyMainlineSpec({ snapshot: 'a'.repeat(64), mainlines: [{ id: 'flow', title: '同步', available: true, snapshot: 'a'.repeat(64), stages: [] }] }, 'flow'), /Git revision/);
});
