import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error browser public behavior projection
import { readerBehaviorSteps } from '../../scripts/semantic-reader-behavior.mjs';

function fixture() {
  const source = 'a();\nb();\nif (ready)\nreturn x;\nthrow error;';
  const texts = ['a();', 'b();', 'if (ready)', 'return x;', 'throw error;'];
  const kinds = ['statement', 'statement', 'branch', 'return', 'throw'];
  const evidence = Object.fromEntries(texts.map((text, id) => ['e' + id, { evidence_id: 'e' + id, file_path: 'a.ts', source_digest: 'h', snapshot_id: 's', span: { start_byte: source.indexOf(text), end_byte: source.indexOf(text) + text.length } }]));
  return { snapshot: 's', files: [{ path: 'a.ts', source_digest: 'h', source, verified: true }], definitions: [{ definition_key: 'fn', file_path: 'a.ts', kind: 'function', qualified_name: 'fn' }], evidence,
    facts: [{ kind: 'control_flow', subject: { definition_key: 'fn' }, value: { blocks: [{ id: 0, kind: 'entry' }, ...texts.map((t, i) => ({ id: i + 1, kind: kinds[i], source_excerpt: t, evidence_id: 'e' + i })), { id: 6, kind: 'exit' }], edges: [{ from: 0, to: 1, kind: 'next' }, { from: 1, to: 2, kind: 'next' }, { from: 2, to: 3, kind: 'next' }, { from: 3, to: 4, kind: 'true' }, { from: 3, to: 5, kind: 'false' }, { from: 4, to: 6, kind: 'return' }, { from: 5, to: 6, kind: 'throw' }], unknowns: ['dynamic dispatch unknown'] } }] };
}

test('behavior steps compact linear actions but preserve conditions, exceptions, transitions and source evidence', () => {
  const data = fixture(); const steps = readerBehaviorSteps(data, 'fn');
  assert.ok(steps.nodes.length < data.facts[0].value.blocks.filter(b => !['entry', 'exit'].includes(b.kind)).length);
  assert.deepEqual(steps.nodes[0].blockIds, ['block:1', 'block:2']);
  assert.equal(steps.nodes[0].source, 'a();\nb();');
  assert.equal(steps.nodes[1].source, 'if (ready)');
  assert.ok(steps.edges.some((e: any) => e.raw.kind === 'false' && e.to === 'block:5'));
  assert.ok(steps.edges.some((e: any) => e.raw.kind === 'throw' && e.terminal === true));
  assert.deepEqual(steps.unknowns, ['dynamic dispatch unknown']);
  assert.equal(steps.nodes.some((n: any) => ['entry', 'exit'].includes(n.block.kind)), false);
  const corrupt = fixture(); corrupt.evidence.e2.snapshot_id = 'old';
  assert.equal(readerBehaviorSteps(corrupt, 'fn').nodes.find((n: any) => n.id === 'block:3').source, null);
});
