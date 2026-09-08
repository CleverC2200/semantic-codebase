import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// @ts-expect-error public local reader review seam
import { reviewReaderRequirements, createReaderRequirementReview, createReaderRequirementStore, readerRequirementDigest } from '../../scripts/semantic-reader-requirements.mjs';

function fixture() {
  const source = 'function remaining(held) { return held ? [] : [1]; }';
  const digest = createHash('sha256').update(source).digest('hex');
  const data = { repository: 'repo', snapshot: 's', overlayHash: 'o',
    files: [{ path: 'context.ts', source, source_digest: digest, verified: true }],
    definitions: [{ definition_key: 'dedup', snapshot_id: 's', file_path: 'context.ts', qualified_name: 'remaining', content_hash: digest, definition_span: { start_byte: 0, end_byte: source.length }, evidence_ids: ['e'] }],
    evidence: { e: { evidence_id: 'e', snapshot_id: 's', file_path: 'context.ts', source_digest: digest, span: { start_byte: 0, end_byte: source.length } } }, mainlines: [] };
  const document = { schema: 'reader-requirements-v1', set: { id: 'dedup-rules', version: '1', title: '去重规则', source: '独立 fixture', clauses: [{ id: 'R1', text: '已持有时返回空集合', source: '需求原文' }, { id: 'R2', text: '缺证据规则', source: '需求原文' }] }, reviews: [] as any[] };
  return { data, document };
}

test('clauses lead to version-bound implementation evidence; a declared result with no evidence stays unknown', async () => {
  const { data, document } = fixture();
  document.reviews.push(await createReaderRequirementReview(data, document.set, { id: 'review-1', clauseId: 'R1', decision: 'supported', condition: 'held 为真', rationale: '返回空数组的分支支持该条款', actor: 'reader', definitionKeys: ['dedup'], evidenceIds: ['e'] }));
  document.reviews.push({ ...document.reviews[0], id: 'review-2', clauseId: 'R2', evidenceIds: [] });
  const result = await reviewReaderRequirements(data, document);
  assert.equal(result.clauses[0].decision, 'supported');
  assert.equal(result.clauses[0].proofLevel, 'static_support');
  assert.equal(result.clauses[0].runtimeObserved, false);
  assert.equal(result.clauses[0].evidence[0].file_path, 'context.ts');
  assert.equal(result.clauses[1].decision, 'unknown');
  assert.ok(result.clauses[1].gaps.includes('evidence_missing'));
  assert.equal(result.clauses[0].text, '已持有时返回空集合');
});

test('a locally saved review round-trips with rule-scoped verification while tampered artifacts cannot prove a check', async () => {
  const { data, document } = fixture();
  const review = await createReaderRequirementReview(data, document.set, { id: 'review-1', clauseId: 'R1', decision: 'supported', condition: 'held 为真', rationale: '分支返回空集合', actor: 'reader', definitionKeys: ['dedup'], evidenceIds: ['e'] });
  const content = 'Controlled fixture: held=true returns []';
  review.verification.push({ id: 'check', repository: data.repository, snapshot: data.snapshot, overlayHash: data.overlayHash,
    setDigest: review.setDigest, clauseIds: ['R1'], definitionKeys: ['dedup'], kind: 'local_test', status: 'passed', condition: 'held=true',
    artifact: { name: 'fixture-receipt.txt', content, sha256: await readerRequirementDigest(content) } });
  document.reviews.push(review);
  let saved = '';
  const storage = { getItem: () => saved || null, setItem: (_key: string, value: string) => { saved = value; } };
  const store = createReaderRequirementStore(data, storage);
  await store.save(document);
  const restored = createReaderRequirementStore(data, storage).documents()[0];
  assert.deepEqual(restored, document);
  const accepted = await reviewReaderRequirements(data, restored);
  assert.equal(accepted.clauses[0].proofLevel, 'local_test_record');
  assert.equal(accepted.clauses[0].runtimeObserved, false);
  restored.reviews[0].verification[0].artifact.content = 'tampered';
  const rejected = await reviewReaderRequirements(data, restored);
  assert.equal(rejected.clauses[0].proofLevel, 'static_support');
  assert.ok(rejected.clauses[0].gaps.includes('verification_artifact_invalid'));
});

test('changed requirements or source invalidate old judgements and opposing evidence remains a visible conflict', async () => {
  const { data, document } = fixture();
  const review = await createReaderRequirementReview(data, document.set, { id: 'r', clauseId: 'R1', decision: 'supported', condition: 'held=true', rationale: '分支支持', actor: 'reader', definitionKeys: ['dedup'], evidenceIds: ['e'] });
  document.reviews.push(review);
  for (const change of ['snapshot', 'source', 'definition', 'evidence', 'requirement']) {
    const next = structuredClone(data), doc = structuredClone(document);
    if (change === 'snapshot') next.snapshot = 'new';
    if (change === 'source') next.files[0].source += ' ';
    if (change === 'definition') next.definitions[0].definition_key = 'same-name-other-definition';
    if (change === 'evidence') next.evidence.e.source_digest = 'wrong';
    if (change === 'requirement') doc.set.clauses[0].text = '同版本改写了要求';
    const result = await reviewReaderRequirements(next, doc);
    assert.equal(result.clauses[0].decision, 'unknown', change);
    assert.equal(result.clauses[0].state, 'needs_review', change);
    assert.equal(result.clauses[0].reviews[0].rationale, '分支支持');
  }
  document.reviews.push({ ...review, id: 'opposing', decision: 'violated', rationale: '存在未解决的相反依据' });
  const conflict = await reviewReaderRequirements(data, document);
  assert.equal(conflict.clauses[0].state, 'conflict');
  assert.equal(conflict.clauses[0].decision, 'unknown');
});

test('runtime proof is an imported observation scoped to this rule and execution, never a trusted flag', async () => {
  const { data, document } = fixture();
  const review = await createReaderRequirementReview(data, document.set, { id: 'r', clauseId: 'R1', decision: 'supported', condition: 'held=true', rationale: '分支支持', actor: 'reader', definitionKeys: ['dedup'], evidenceIds: ['e'] });
  const body = { repository_id: 'repo', snapshot_id: 's', semantic_overlay_hash: 'o', execution_id: 'exec', observations: [{ execution_id: 'exec', definition_key: 'dedup' }], coverage: { status: 'partial', reason_codes: [] } };
  const withRuntime = { ...data, runtime: { ...body, observation_set_hash: await readerRequirementDigest(body) }, runtimeBinding: { valid: true } };
  review.verification.push({ id: 'run', repository: 'repo', snapshot: 's', overlayHash: 'o', setDigest: review.setDigest, clauseIds: ['R1'], definitionKeys: ['dedup'], kind: 'runtime_observed', status: 'passed', condition: 'held=true', executionId: 'exec', artifact: { name: 'run.txt', content: 'execution exec observed held=true', sha256: await readerRequirementDigest('execution exec observed held=true') } });
  document.reviews.push(review);
  assert.equal((await reviewReaderRequirements(withRuntime, document)).clauses[0].runtimeObserved, true);
  withRuntime.runtime.execution_id = 'forged';
  assert.equal((await reviewReaderRequirements(withRuntime, document)).clauses[0].runtimeObserved, false);
});

test('the panel preserves immutable judgement origin and shows conflicts after storage merges', async () => {
  // @ts-expect-error browser document workflow public seam
  const { createReaderRequirementPanel } = await import('../../scripts/semantic-reader-requirements-ui.mjs');
  const { data, document } = fixture();
  document.reviews.push(await createReaderRequirementReview(data, document.set, { id: 'local', clauseId: 'R1', decision: 'violated', condition: '特殊输入', rationale: '原始人工反例', actor: 'reader', definitionKeys: ['dedup'], evidenceIds: ['e'] }));
  const storage = new Map<string,string>();
  const adapter = { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) };
  const button = (attr: string) => ({ dataset: {}, hasAttribute: (name: string) => name === attr });
  const upload = (attr: string, value: unknown) => ({ value: 'file', hasAttribute: (name: string) => name === attr, files: [{ size: 1, text: async () => JSON.stringify(value) }] });
  const panel = createReaderRequirementPanel({ ...data, requirements: document }, { storage: adapter, onChange() {} });
  await panel.open();
  await panel.handleChange(upload('data-requirement-import', { ...document, reviews: [{ ...document.reviews[0], decision: 'supported', rationale: '不应覆盖人工记录' }] }));
  assert.match(panel.view(), /原始人工反例/);
  assert.doesNotMatch(panel.view(), /<p>不应覆盖人工记录<\/p>/);
  assert.match(panel.view(), /REQUIREMENT_RECORD_CONFLICT/);
  await createReaderRequirementStore(data, adapter).save(document);
  const generated = { ...document, reviews: [{ ...document.reviews[0], id: 'ai', decision: 'supported', rationale: '源自模型的支持解释', origin: 'llm_inferred' }] };
  const second = createReaderRequirementPanel({ ...data, requirements: generated }, { storage: adapter, onChange() {} });
  await second.open(); await second.handleClick(button('data-requirement-save'));
  assert.match(second.view(), /存在冲突/); assert.match(second.view(), /原始人工反例/);
  const third = createReaderRequirementPanel({ ...data, requirements: generated }, { storage: adapter, onChange() {} });
  await third.open(); await third.handleChange(upload('data-requirement-verification', [{ clauseIds: ['R1'], kind: 'local_test' }]));
  // An invalid artifact cannot change the epistemic origin of its copied judgement.
  assert.equal((third.view().match(/AI 推断，未验证/g) ?? []).length, 2);
});
