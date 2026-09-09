import test from 'node:test';
import assert from 'node:assert/strict';
import { archifyFixture } from '../fixtures/reader-archify/fixture.mjs';
import { createArchifyMainlineSpec, createArchifyProjection } from '../../scripts/semantic-reader-archify.mjs';


test('projection preserves definition identity, evidence, source ranges and immutable input', async () => {
  const data = archifyFixture(), before = JSON.stringify(data);
  const p = await createArchifyProjection(data, 'flow');
  assert.equal(p.spec.components.length, 2);
  assert.deepEqual(p.nodes.map(n => n.definition_key), ['start', 'finish']);
  assert.equal(p.edges[0].basis, 'compiler_exact');
  assert.deepEqual(p.edges[0].evidence_ids, ['e0']);
  assert.equal(p.spec.components[1].sources[0].line, 2);
  assert.equal(p.spec.components[1].sources[0].end_line, 2);
  assert.equal(p.binding.snapshot, data.snapshot);
  assert.equal(p.binding.repository, data.repository);
  assert.equal(p.binding.revision, data.revision);
  assert.match(p.input_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await createArchifyMainlineSpec(data, 'flow'), p.spec);
  assert.equal(JSON.stringify(data), before);
});

for (const [name, mutate] of [
  ['missing revision', d => { d.revision = null; }],
  ['missing definition', d => { d.definitions.pop(); }],
  ['stale definition', d => { d.definitions[0].snapshot_id = 'old'; }],
  ['missing source', d => { d.files = []; }],
  ['changed source bytes', d => { d.files[0].source += '// changed'; }],
  ['bad evidence digest', d => { d.evidence.e0.source_digest = 'old'; }],
  ['stale evidence snapshot', d => { d.evidence.e0.snapshot_id = 'old'; }],
  ['out of range evidence', d => { d.evidence.e0.span.end_byte = 99999; }],
  ['missing definition evidence', d => { d.definitions[0].evidence_ids = []; }],
  ['missing call evidence', d => { d.facts[0].evidence_ids = []; }],
  ['missing nested call evidence', d => { d.facts[0].value.call_site_evidence_id = 'absent'; }],
  ['stale fact snapshot', d => { d.facts[0].snapshot_id = 'old'; }],
  ['stale stage source', d => { d.mainlines[0].stages[0].refs[0].source_digest = 'old'; }],
  ['bad stage excerpt', d => { d.mainlines[0].stages[0].refs[0].excerpt = 'invented'; }],
  ['stale mainline snapshot', d => { d.mainlines[0].snapshot = 'old'; }],
  ['duplicate definition', d => { d.definitions.push(d.definitions[0]); }],
] as [string, (d: any) => void][]) {
  test('fails closed: ' + name, async () => { const d = archifyFixture(); mutate(d); await assert.rejects(createArchifyProjection(d, 'flow')); });
}

test('unknown and inferred calls remain enumerated boundaries without arrows', async () => {
  const d: any = archifyFixture();
  d.facts.push({ ...d.facts[0], fact_id: 'unknown', value: { target_definition_key: null } });
  d.facts.push({ ...d.facts[0], fact_id: 'inferred', basis: { kind: 'llm_inferred' } });
  d.relationCandidates.push({ candidate_id: 'candidate' });
  const p = await createArchifyProjection(d, 'flow');
  assert.equal(p.spec.connections.length, 1);
  assert.ok(p.unknowns.some(u => u.reason === 'unresolved_call'));
  assert.ok(p.unknowns.some(u => u.reason === 'unverified_basis'));
  assert.ok(p.unknowns.some(u => u.reason === 'relation_candidates_not_projected'));
  assert.equal(p.coverage.status, 'partial');
});

test('conflicting targets at one call site never produce unique arrows', async () => {
  const d = archifyFixture();
  d.facts.push({ ...d.facts[0], fact_id: 'conflict', value: { ...d.facts[0].value, target_definition_key: 'start' } });
  const p = await createArchifyProjection(d, 'flow');
  assert.equal(p.spec.connections.length, 0);
  assert.ok(p.unknowns.some(u => u.reason === 'ambiguous_call_site'));
});

test('outside-scope competing target and alternate Evidence ID cannot hide ambiguity', async () => {
  const d: any = archifyFixture();
  d.evidence.alternate = { ...d.evidence.e0, evidence_id: 'alternate' };
  d.facts.push({ ...d.facts[0], fact_id: 'outside', value: { target_definition_key: 'not-in-mainline', call_site_evidence_id: 'alternate' }, evidence_ids: ['alternate'] });
  const p = await createArchifyProjection(d, 'flow');
  assert.equal(p.spec.connections.length, 0);
  assert.ok(p.unknowns.some(u => u.reason === 'ambiguous_call_site'));
});
