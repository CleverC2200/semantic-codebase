import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// @ts-expect-error standalone reader model
import { compareReaderSnapshots, validateReaderBundle } from '../../scripts/semantic-reader-comparison.mjs';
function snapshot(id: string, key: string, source: string) {
  return { schema: 'reader-snapshot-v1', repository: 'repo', snapshot: id, coverage: { status: 'partial' },
    files: [{ path: 'a.ts', source, verified: true, source_digest: createHash('sha256').update(source).digest('hex') }],
    definitions: [{ definition_key: key, qualified_name: 'run', kind: 'function', file_path: 'a.ts', definition_span: { start_byte: 0, end_byte: Buffer.byteLength(source) }, line: 1, endLine: 1 }], facts: [], evidence: {}, relations: [] };
}

test('snapshot comparison requires explicit correspondence for changed files and keeps both versions', async () => {
  const before = snapshot('s1', 'old', 'function run() { return 1; }');
  const after = snapshot('s2', 'new', 'function run() { return 2; }');
  const unknown = compareReaderSnapshots(before, after);
  assert.equal(unknown.changes.filter((c: { kind: string }) => c.kind === 'modified').length, 0);
  assert.equal(unknown.unknowns.includes('definition_correspondence_unconfirmed'), true);
  const compared = compareReaderSnapshots(before, after, { correspondences: [{ baseSnapshot: 's1', targetSnapshot: 's2', baseKey: 'old', targetKey: 'new', actor: 'reviewer', reason: '核对声明范围' }] });
  assert.equal(compared.changes.length, 1);
  assert.equal(compared.changes[0].kind, 'modified');
  assert.equal(compared.changes[0].beforeSource, 'function run() { return 1; }');
  assert.equal(compared.changes[0].afterSource, 'function run() { return 2; }');
  const unchanged = compareReaderSnapshots(before, snapshot('s3', 'different-key', before.files[0].source));
  assert.equal(unchanged.changes[0].kind, 'unchanged');
  const altered = { ...after, files: [{ ...after.files[0], source: 'tampered' }] };
  await assert.rejects(validateReaderBundle(altered), /SOURCE_DIGEST/);
  assert.equal((await validateReaderBundle(after)).snapshot, 's2');
});

// @ts-expect-error standalone reader model
import { describeReaderChange } from '../../scripts/semantic-reader-comparison.mjs';

test('change explanations separate comment-only edits from contracts, conditions and writes', () => {
  const before = snapshot('s1', 'old', 'function run() { return 1; }');
  const after = snapshot('s2', 'new', 'function run() { /* note */ return 1; }');
  const correspondence = { baseSnapshot: 's1', targetSnapshot: 's2', baseKey: 'old', targetKey: 'new', actor: 'r', reason: '核对' };
  let change = compareReaderSnapshots(before, after, { correspondences: [correspondence] }).changes[0];
  assert.equal(describeReaderChange(change, before, after).classification, 'comments_or_spacing_only');
  const oldFacts = [{ fact_id: 'c1', kind: 'control_flow', subject: { definition_key: 'old' }, value: { blocks: [{ kind: 'branch', source_excerpt: 'amount > 0' }] }, evidence_ids: [] }];
  const newFacts = [{ fact_id: 'c2', kind: 'control_flow', subject: { definition_key: 'new' }, value: { blocks: [{ kind: 'branch', source_excerpt: 'amount >= 0' }] }, evidence_ids: [] }];
  const changed = snapshot('s2', 'new', 'function run() { return 2; }');
  change = compareReaderSnapshots(before, changed, { correspondences: [correspondence] }).changes[0];
  const described = describeReaderChange(change, { ...before, facts: oldFacts }, { ...changed, facts: newFacts });
  assert.equal(described.items[0].kind, 'conditions');
  assert.deepEqual(described.items[0].before, ['amount > 0']);
  assert.deepEqual(described.items[0].after, ['amount >= 0']);
  assert.equal(described.items[0].status, 'static_possible');
});

// @ts-expect-error standalone reader model
import { reviewReaderChange } from '../../scripts/semantic-reader-comparison.mjs';

test('review ties verification to the compared versions and separates local checks from actual execution', () => {
  const before = snapshot('s1', 'old', 'function run() { return 1; }'), after = snapshot('s2', 'new', 'function run() { return 2; }');
  const change = compareReaderSnapshots(before, after, { correspondences: [{ baseSnapshot: 's1', targetSnapshot: 's2', baseKey: 'old', targetKey: 'new', actor: 'r', reason: '核对' }] }).changes[0];
  const result = reviewReaderChange(change, before, after, { verificationRecords: [
    { id: 'v1', repository: 'repo', baseSnapshot: 's1', targetSnapshot: 's2', definitionKeys: ['new'], kind: 'local_test', status: 'passed', checks: ['returns'], summary: '返回值边界', artifact: 'receipt.json' },
    { id: 'stale', repository: 'repo', baseSnapshot: 's1', targetSnapshot: 'other', definitionKeys: ['new'], kind: 'runtime_observed', status: 'passed', checks: ['returns'], artifact: 'old.json' },
  ] });
  assert.equal(result.verification.length, 1);
  assert.equal(result.verification[0].kind, 'local_test');
  assert.equal(result.runtimeObserved, false);
  assert.ok(result.gaps.includes('real_execution_not_proven'));
});

test('imported runtime binding is recalculated and rejects forged flags or modified observations', async () => {
  const data = snapshot('s', 'run', 'function run() {}');
  // @ts-expect-error standalone canonical serializer
  const { readerCanonicalJson } = await import('../../scripts/semantic-reader-comparison.mjs');
  const body = { repository_id: 'repo', snapshot_id: 's', semantic_overlay_hash: 'h', execution_id: 'exec', observations: [{ execution_id: 'exec', definition_key: 'run' }] };
  const runtime = { ...body, observation_set_hash: createHash('sha256').update(readerCanonicalJson(body)).digest('hex') };
  const valid = await validateReaderBundle({ ...data, overlayHash: 'h', runtime });
  assert.equal(valid.runtimeBinding.valid, true);
  const forged = await validateReaderBundle({ ...data, overlayHash: 'h', runtime: { ...runtime, execution_id: 'other' }, runtimeBinding: { valid: true } });
  assert.equal(forged.runtimeBinding.valid, false);
});
