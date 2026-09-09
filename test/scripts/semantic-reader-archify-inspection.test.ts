import test from 'node:test';
import assert from 'node:assert/strict';
import { archifyFixture } from '../fixtures/reader-archify/fixture.mjs';
import { createArchifyProjection, readerArchifyDigest, readerArchifyRuntime } from '../../scripts/semantic-reader-archify.mjs';
import { inspectReaderArchify, readerArchifyFocus } from '../../scripts/semantic-reader-archify-inspection.mjs';
import { buildReaderAssetBundle } from '../../scripts/semantic-reader-assets.mjs';
import { createReaderAssetLoader } from '../../scripts/semantic-reader-loader.mjs';

function branching() {
  const d: any = archifyFixture(), refs = d.mainlines[0].stages[0].refs;
  d.mainlines[0].stages = [
    { id: 'entry', title: '入口', keys: ['start'], refs: [refs[0]] },
    { id: 'success', title: '完成', keys: ['finish'], refs: [refs[1]], outcome: 'success' },
    { id: 'failure', title: '中止', keys: ['start'], refs: [refs[0]], outcome: 'failure', boundary: 'async' },
  ];
  d.mainlines[0].edges = [{ from: 'entry', to: 'success' }, { from: 'entry', to: 'failure' }, { from: 'failure', to: 'entry' }];
  return d;
}
async function runtimeData() {
  const d: any = branching();
  d.runtime = { schema_version: 1, repository_id: d.repository, snapshot_id: d.snapshot, semantic_overlay_hash: d.overlayHash,
    execution_id: 'execution-test', trace_digest: 'd'.repeat(64), observations: [{ observation_id: 'observation', execution_id: 'execution-test', trace_id: 'trace', span_id: 'span', parent_span_id: null,
      name: 'start', definition_key: 'start', file_path: 'src/flow.ts', start_time_unix_nano: '1', end_time_unix_nano: '2', attributes: {}, basis: { kind: 'runtime_observed', scope: 'single_execution' } }],
    capability_candidates: [], diagnostics: [], coverage: { status: 'partial', span_count: 1, matched_span_count: 1, unmatched_span_count: 0, reason_codes: [] } };
  d.runtime.observation_set_hash = await readerArchifyDigest(d.runtime);
  return d;
}
async function rehash(d) {
  const { observation_set_hash, ...body } = d.runtime;
  d.runtime.observation_set_hash = await readerArchifyDigest(body);
}
function lazy(d) {
  const bundle = buildReaderAssetBundle(d), paths: string[] = [];
  const loader = createReaderAssetLoader(bundle.bootstrap, async path => {
    paths.push(path); return bundle.assets.find(a => a.path === path)!.content;
  });
  return { data: bundle.bootstrap, loader, paths };
}

test('candidate paths handle cycles without asserting execution or changing static topology', async () => {
  const d = branching(), before = JSON.stringify(d), p = await createArchifyProjection(d, 'flow');
  const failed = readerArchifyFocus(p, { path: 'failure' });
  assert.deepEqual(failed.stage_ids.sort(), ['entry', 'failure']);
  assert.equal(failed.node_ids.length, 1); assert.equal(failed.edge_ids.length, 0);
  assert.equal(failed.basis, 'llm_inferred'); assert.equal(failed.execution, 'unknown');
  const stage = readerArchifyFocus(p, { stage: 'success' });
  assert.deepEqual(stage.stage_ids, ['success']);
  assert.equal(readerArchifyFocus(p, { path: 'success' }).edge_ids.length, 1);
  assert.equal(p.spec.connections.length, 1); assert.equal(JSON.stringify(d), before);
});

test('matching observations stay separate and bind the exported input digest', async () => {
  const d = await runtimeData(), p = await createArchifyProjection(d, 'flow');
  assert.equal(p.exploration.runtime.status, 'partial');
  assert.equal(p.exploration.runtime.observations.length, 1);
  assert.equal(p.exploration.runtime.stage_execution, 'unknown');
  assert.equal(p.exploration.runtime.other_paths, 'unknown');
  assert.ok(p.edges.every(e => e.basis === 'compiler_exact' && !('observed' in e)));
  const next = structuredClone(d); next.runtime.observations[0].end_time_unix_nano = '3'; await rehash(next);
  const changed = await createArchifyProjection(next, 'flow');
  assert.notEqual(changed.input_sha256, p.input_sha256);
  assert.deepEqual(changed.spec, p.spec);
});

for (const [name, change, shouldRehash] of [
  ['snapshot', d => d.runtime.snapshot_id = 'other', true],
  ['overlay', d => d.runtime.semantic_overlay_hash = 'other', true],
  ['repository', d => d.runtime.repository_id = 'other', true],
  ['Execution', d => d.runtime.observations[0].execution_id = 'other', true],
  ['digest', d => d.runtime.observations[0].name = 'changed', false],
  ['basis', d => d.runtime.observations[0].basis.kind = 'llm_inferred', true],
  ['definition', d => d.runtime.observations[0].definition_key = 'not-present', true],
  ['source binding', d => d.runtime.coverage.reason_codes.push('trace_source_binding_unverified'), true],
] as [string, (d: any) => void, boolean][]) {
  test('runtime mismatch hides records even with supplied valid flag: ' + name, async () => {
    const d = await runtimeData(); change(d); if (shouldRehash) await rehash(d); d.runtimeBinding = { valid: true };
    const result = await readerArchifyRuntime(d, ['start', 'finish']);
    assert.equal(result.status, 'unavailable'); assert.deepEqual(result.observations, []);
  });
}

test('node detail loads only selected definition and source, and retains each Behavior Fact basis', async () => {
  const d: any = branching();
  d.facts.push({ fact_id: 'behavior', kind: 'effect', subject: { kind: 'definition', definition_key: 'start' }, basis: { kind: 'static_possible' }, evidence_ids: ['e0'], value: { kind: 'call' } });
  const p = await createArchifyProjection(d, 'flow'), { data, loader, paths } = lazy(d);
  assert.equal(data.facts.length, 0); assert.equal(paths.length, 0);
  const detail = await inspectReaderArchify(data, p, { kind: 'node', id: p.nodes[0].id }, loader);
  assert.equal(detail.evidence[0].excerpt, 'function start() { finish(); }');
  assert.equal(detail.behavior[0].basis.kind, 'static_possible');
  assert.equal(loader.hasDefinition('finish'), false); assert.equal(loader.hasCalls(), false);
  assert.ok(paths.every(path => path !== data.assetManifest.definitions.finish?.path));
});

test('relation detail verifies exact frozen call fact and exposes source Evidence', async () => {
  const d = branching(), p = await createArchifyProjection(d, 'flow'), { data, loader } = lazy(d);
  const detail = await inspectReaderArchify(data, p, { kind: 'edge', id: p.edges[0].id }, loader);
  assert.equal(detail.edge.basis, 'compiler_exact'); assert.equal(detail.evidence[0].line, 1);
  assert.equal(detail.binding.snapshot, d.snapshot); assert.equal(detail.coverage.status, 'partial');
  data.facts[0].value.target_definition_key = 'start';
  await assert.rejects(inspectReaderArchify(data, p, { kind: 'edge', id: p.edges[0].id }, loader), /停止加载/);
});

test('mismatched source or Evidence cannot replace a previously checked detail', async () => {
  const d = branching(), p = await createArchifyProjection(d, 'flow'), { data, loader } = lazy(d);
  const selection = { kind: 'node', id: p.nodes[0].id }, good = await inspectReaderArchify(data, p, selection, loader);
  data.files[0].source += '// wrong version';
  await assert.rejects(inspectReaderArchify(data, p, selection, loader), /停止加载/);
  assert.equal(good.evidence[0].excerpt, 'function start() { finish(); }');
});
