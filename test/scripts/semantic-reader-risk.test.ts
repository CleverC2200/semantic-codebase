import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error standalone reader model
import { createReaderRiskModel } from '../../scripts/semantic-reader-risk.mjs';
const definition = (key: string, name = key) => ({ definition_key: key, qualified_name: name, file_path: 'a.ts' });
const call = (from: string, to: string | null, site: string) => ({ kind: 'call_target', subject: { definition_key: from }, value: { target_definition_key: to, call_site_evidence_id: site }, evidence_ids: [site] });

test('importance marks evidence-bound funds sensitivity independently of call count and does not turn name hints into confirmation', () => {
  const data = { snapshot: 's1', definitions: [definition('pay', 'submitPayment'), definition('read')], facts: [], evidence: { e: { evidence_id: 'e', file_path: 'a.ts' } },
    importanceAnnotations: [{ definition_key: 'pay', snapshot: 's1', category: 'funds', status: 'confirmed', actor: 'reviewer', reason: '调用外部付款接口', evidence_ids: ['e'], reversibility: 'irreversible' }] };
  const model = createReaderRiskModel(data);
  assert.equal(model.importance('pay').sensitivity[0].label, '资金敏感');
  assert.equal(model.importance('pay').sensitivity[0].status, 'confirmed');
  assert.equal(model.importance('pay').reversibility, 'irreversible');
  assert.equal(model.importance('read').reversibility, 'unknown');
  const candidate = createReaderRiskModel({ ...data, importanceAnnotations: [] }).importance('pay');
  assert.equal(candidate.sensitivity[0].status, 'candidate');
  const stale = createReaderRiskModel({ ...data, snapshot: 's2' }).importance('pay');
  assert.equal(stale.sensitivity.some((x: { status: string }) => x.status === 'confirmed'), false);
});

test('bounded impact separates sites and callers, terminates cycles, and exposes unknown and truncated scope', () => {
  const data = { snapshot: 's1', coverage: { status: 'partial' }, definitions: ['focus', 'a', 'b', 'up'].map(k => definition(k)), evidence: {}, facts: [
    call('a', 'focus', '1'), call('a', 'focus', '2'), call('b', 'focus', '3'), call('focus', 'focus', '4'), call('up', 'a', '5'), call('a', 'up', '6'), call('up', null, '7'),
  ] };
  const model = createReaderRiskModel(data);
  const impact = model.impact('focus', { maxDepth: 3, maxNodes: 10, maxEdges: 20 });
  assert.equal(impact.directCallSites, 3);
  assert.deepEqual(impact.directCallers, ['a', 'b']);
  assert.equal(impact.selfCallSites, 1);
  assert.deepEqual(impact.reached, ['a', 'b', 'up']);
  assert.equal(impact.completeness.status, 'complete');
  assert.equal(impact.coverage.status, 'partial');
  assert.ok(impact.unknowns.includes('non_call_dependencies_not_covered'));
  const limited = model.impact('focus', { maxDepth: 1, maxNodes: 2, maxEdges: 2 });
  assert.equal(limited.completeness.status, 'truncated');
  assert.ok(limited.reached.length <= 1);
});

test('public contract inheritance impact follows only same-snapshot evidence-backed inheritance within budget', () => {
  const relation = (from: string, to: string, id: string) => ({ kind: 'INHERITS', snapshot_id: 's1', source: { kind: 'definition', definition_key: from }, target: { kind: 'definition', definition_key: to }, evidence_ids: [id] });
  const data = { snapshot: 's1', definitions: ['Base', 'Child', 'Leaf'].map(k => ({ ...definition(k), kind: 'class' })), facts: [], evidence: { a: {}, b: {} },
    relations: [relation('Child', 'Base', 'a'), relation('Leaf', 'Child', 'b'), { ...relation('Base', 'Leaf', 'missing'), snapshot_id: 'old' }] };
  const model = createReaderRiskModel(data);
  const result = model.contractImpact('Base', { maxDepth: 3 });
  assert.equal(result.relationKind, 'INHERITS');
  assert.deepEqual(result.reached, ['Child', 'Leaf']);
  assert.equal(result.paths[1].relations[0].kind, 'INHERITS');
  assert.ok(result.unknowns.includes('database_config_event_dependencies_not_covered'));
  assert.equal(model.contractImpact('Base', { maxDepth: 0 }).completeness.status, 'truncated');
});
