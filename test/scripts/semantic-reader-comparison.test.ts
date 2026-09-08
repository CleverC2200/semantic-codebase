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

test('indentation changes in non-JavaScript languages are never called spacing-only behavior', () => {
  const before = snapshot('s1', 'old', 'def run():\n  if ready:\n    send()\n');
  const after = snapshot('s2', 'new', 'def run():\n  if ready:\n  send()\n');
  for (const data of [before, after]) { data.files[0].path = 'a.py'; data.definitions[0].file_path = 'a.py'; }
  const change = compareReaderSnapshots(before, after, { correspondences: [{ baseSnapshot: 's1', targetSnapshot: 's2', baseKey: 'old', targetKey: 'new', actor: 'r', reason: 'fixture' }] }).changes[0];
  assert.equal(describeReaderChange(change, before, after).classification, 'behavior_unknown');
});

test('import rejects malformed spans, stale facts and inferred authority; imported decisions remain unverified', async () => {
  const base = snapshot('s', 'run', 'function run() {}');
  const evidence = { e: { evidence_id: 'e', file_path: 'a.ts', source_digest: base.files[0].source_digest, span: { start_byte: 0, end_byte: 1 } } };
  const fact = { fact_id: 'f', kind: 'call_target', subject: { kind: 'definition', definition_key: 'run' }, value: { target_definition_key: 'run', call_site_evidence_id: 'e' }, evidence_ids: ['e'], basis: { kind: 'static_possible' } };
  for (const span of [{}, { start_byte: '<img src=x>', end_byte: '<img src=x>' }, { start_byte: 0.5, end_byte: 1 }]) {
    await assert.rejects(validateReaderBundle({ ...base, evidence: { e: { ...evidence.e, span } } }), /EVIDENCE/);
  }
  await assert.rejects(validateReaderBundle({ ...base, evidence: { e: { ...evidence.e, snapshot_id: 'old' } } }), /EVIDENCE/);
  for (const invalid of [{ ...fact, snapshot_id: 'old' }, { ...fact, basis: { kind: 'llm_inferred' } }]) await assert.rejects(validateReaderBundle({ ...base, evidence, facts: [invalid] }), /EVIDENCE/);
  const imported = await validateReaderBundle({ ...base, evidence, importanceAnnotations: [{ definition_key: 'run', snapshot: 's', category: 'funds', status: 'confirmed', basis: 'llm_inferred', actor: 'json', reason: 'claim', evidence_ids: ['e'], reversibility: 'read_only' }] });
  // @ts-expect-error standalone reader risk projection
  const { createReaderRiskModel } = await import('../../scripts/semantic-reader-risk.mjs');
  assert.equal(createReaderRiskModel(imported).importance('run').sensitivity[0].status, 'candidate');
  assert.equal(createReaderRiskModel(imported).importance('run').reversibility, 'unknown');
});

test('assignment changes compare complete source evidence even when extractor operation contains only left side', () => {
  const before = snapshot('s1', 'old', "function run() { ctx.status = 'pending'; }");
  const after = snapshot('s2', 'new', "function run() { ctx.status = 'done'; }");
  const enrich = (data: ReturnType<typeof snapshot>, key: string) => ({ ...data,
    evidence: { write: { evidence_id: 'write', file_path: 'a.ts', span: { start_byte: 17, end_byte: Buffer.byteLength(data.files[0].source) - 2 } } },
    facts: [{ kind: 'effect', subject: { definition_key: key }, value: { effect_kind: 'state', operation: 'ctx.status' }, evidence_ids: ['write'] }] });
  const a = enrich(before, 'old'), b = enrich(after, 'new');
  const change = compareReaderSnapshots(a, b, { correspondences: [{ baseSnapshot: 's1', targetSnapshot: 's2', baseKey: 'old', targetKey: 'new', actor: 'r', reason: 'fixture' }] }).changes[0];
  const writes = describeReaderChange(change, a, b).items.find((item: { kind: string }) => item.kind === 'writes');
  assert.match(writes.before[0].source[0], /pending/);
  assert.match(writes.after[0].source[0], /done/);
  assert.equal(writes.beforeFacts[0].evidence_ids[0], 'write');
});

test('a comment inside an assignment stays a presentation-only edit while evidence preserves the original text', () => {
  const before = snapshot('s1', 'old', "function run() { ctx.status = 'done'; }");
  const after = snapshot('s2', 'new', "function run() { ctx.status = /* note */ 'done'; }");
  const enrich = (data: ReturnType<typeof snapshot>, key: string) => ({ ...data,
    evidence: { write: { evidence_id: 'write', file_path: 'a.ts', span: { start_byte: 16, end_byte: Buffer.byteLength(data.files[0].source) - 2 } } },
    facts: [{ kind: 'effect', subject: { definition_key: key }, value: { effect_kind: 'state', operation: 'ctx.status' }, evidence_ids: ['write'] }] });
  const a = enrich(before, 'old'), b = enrich(after, 'new');
  const change = compareReaderSnapshots(a, b, { correspondences: [{ baseSnapshot: 's1', targetSnapshot: 's2', baseKey: 'old', targetKey: 'new', actor: 'r', reason: 'fixture' }] }).changes[0];
  const result = describeReaderChange(change, a, b);
  assert.equal(result.classification, 'comments_or_spacing_only');
  assert.equal(result.items.length, 0);
});

test('controlled high-call and sensitive-operation fixtures support version-bound review records', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (name: string) => JSON.parse(readFileSync(new URL('../fixtures/reader-comparison/' + name + '.json', import.meta.url), 'utf8'));
  const base = await validateReaderBundle(read('before')), target = await validateReaderBundle(read('after'));
  // @ts-expect-error standalone risk projection
  const { createReaderRiskModel } = await import('../../scripts/semantic-reader-risk.mjs');
  const risk = createReaderRiskModel(target);
  assert.equal(risk.impact('after-run').directCallers.length, 12);
  assert.equal(risk.importance('after-submitPayment').sensitivity[0].status, 'candidate');
  assert.equal(risk.importance('after-submitPayment').reversibility, 'state_write');
  const correspondences = ['run','submitPayment'].map(name => ({ baseSnapshot: 'before', targetSnapshot: 'after', baseKey: 'before-'+name, targetKey: 'after-'+name, actor: 'fixture reviewer', reason: 'controlled correspondence' }));
  const result = compareReaderSnapshots(base, target, { correspondences });
  for (const name of ['run','submitPayment']) {
    const change = result.changes.find((c: { after?: { definition_key: string } }) => c.after?.definition_key === 'after-'+name);
    const review = reviewReaderChange(change, base, target, { impact: risk.impact('after-'+name), verificationRecords: read('verification') });
    assert.equal(review.runtimeObserved, false);
    assert.equal(review.gaps.filter((g: string) => g.startsWith('verification_missing:')).length, 0);
    assert.equal(review.behavior.classification, 'supported_fact_changes');
  }
});

test('comments inside extracted conditions do not create a condition-change item', () => {
  const before = snapshot('s1', 'old', 'function run() { if (ready) return 1; }');
  const after = snapshot('s2', 'new', 'function run() { if (/* note */ ready) return 1; }');
  const facts = (key: string, condition: string) => [{ kind: 'control_flow', subject: { definition_key: key }, value: { blocks: [{ kind: 'branch', source_excerpt: condition }] }, evidence_ids: [] }];
  const a = { ...before, facts: facts('old', 'ready') }, b = { ...after, facts: facts('new', '/* note */ ready') };
  const change = compareReaderSnapshots(a, b, { correspondences: [{ baseSnapshot: 's1', targetSnapshot: 's2', baseKey: 'old', targetKey: 'new', actor: 'r', reason: 'fixture' }] }).changes[0];
  assert.equal(describeReaderChange(change, a, b).classification, 'comments_or_spacing_only');
});
