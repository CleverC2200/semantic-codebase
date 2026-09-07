import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error standalone browser presentation model
import { createReaderGraphModel, layoutReaderGraph } from '../../scripts/semantic-reader-graph.mjs';
// @ts-expect-error standalone presentation source binding
import { bindReaderMainlines } from '../../scripts/semantic-reader-mainlines.mjs';

const def = (key: string, file = 'a.ts', owner?: string) => ({ definition_key: key, qualified_name: key, kind: 'function', file_path: file, container_definition_key: owner, line: 1 });
const call = (source: string, target: string | null, site: string) => ({ kind: 'call_target', subject: { definition_key: source }, value: { target_definition_key: target, call_site_evidence_id: site, call: 'sameExpression' } });

test('file graph keeps isolated functions, external boundaries, and distinct unresolved sites', () => {
  const facts = [call('a', 'b', '1'), call('a', 'external', '2'), call('a', null, '3'), call('a', null, '4'), call('external', 'elsewhere', '5')];
  const model = createReaderGraphModel({ definitions: [def('a'), def('b'), def('isolated'), def('external', 'b.ts'), def('elsewhere', 'c.ts')], facts });
  const graph = model.fileGraph('a.ts');
  assert.equal(graph.functionCount, 3);
  assert.equal(graph.nodes.find((n: { id: string }) => n.id === 'external').kind, 'external');
  assert.ok(graph.nodes.some((n: { id: string }) => n.id === 'isolated'));
  assert.ok(!graph.nodes.some((n: { id: string }) => n.id === 'elsewhere'));
  assert.equal(graph.nodes.filter((n: { kind: string }) => n.kind === 'unknown').length, 2);
  assert.equal(graph.edges.flatMap((e: { facts: unknown[] }) => e.facts).length, 4);
  assert.deepEqual(facts[0], call('a', 'b', '1'));
});

test('source groups preserve every function and call when folded or expanded, including internal calls', () => {
  const definitions = [{ ...def('Owner'), kind: 'class' }, ...Array.from({ length: 15 }, (_, i) => def('m' + i, 'a.ts', 'Owner'))];
  const facts = [call('m0', 'm1', '1'), call('m1', 'm0', '2')];
  const model = createReaderGraphModel({ definitions, facts });
  const folded = model.fileGraph('a.ts');
  assert.equal(folded.nodes.length, 1);
  assert.equal(folded.nodes[0].keys.length, 15);
  assert.equal(folded.edges[0].from, folded.edges[0].to);
  assert.equal(folded.edges[0].facts.length, 2);
  const expanded = model.fileGraph('a.ts', [folded.nodes[0].id]);
  assert.equal(expanded.nodes.length, 15);
  assert.equal(expanded.edges.length, 2);
  const layout = layoutReaderGraph(expanded);
  assert.equal(new Set(layout.nodes.map((n: { x: number; y: number }) => n.x + ':' + n.y)).size, 15);
  assert.deepEqual(layoutReaderGraph(expanded), layout);
});

test('missing control flow and files with declarations only do not fabricate a route', () => {
  const model = createReaderGraphModel({ definitions: [{ ...def('Shape'), kind: 'interface' }], facts: [] });
  assert.equal(model.fileGraph('a.ts').nodes.length, 0);
  assert.equal(model.controlGraph('missing').edges.length, 0);
  assert.match(model.controlGraph('missing').unknowns[0], /未提取/);
});

test('mainline explanations require verified source digest and an exact function-scoped excerpt', () => {
  const data = { snapshot: 's1', files: [{ path: 'a.ts', source_digest: 'h1', verified: true, source: '// header\nfunction run() {\n  return 1;\n}' }], definitions: [{ ...def('run'), line: 2, endLine: 4 }] };
  const entries = [{ id: 'flow', source_digests: { 'a.ts': 'h1' }, stages: [{ id: 'return', anchors: [{ file: 'a.ts', function: 'run', match: 'return 1;' }] }], edges: [] }];
  const [bound] = bindReaderMainlines(data, entries);
  assert.equal(bound.available, true);
  assert.equal(bound.basis, 'llm_inferred');
  assert.equal(bound.verified, false);
  assert.equal(bound.stages[0].refs[0].startLine, 3);
  assert.equal(bound.stages[0].refs[0].snapshot, 's1');
  for (const file of [{ ...data.files[0], source_digest: 'new' }, { ...data.files[0], verified: false }, { ...data.files[0], source: '// header\nfunction run() {\n  return 2;\n}' }]) {
    const [changed] = bindReaderMainlines({ ...data, files: [file] }, entries);
    assert.equal(changed.available, false);
    assert.deepEqual(changed.stages, []);
    assert.deepEqual(changed.edges, []);
  }
});

test('file function order follows source positions rather than snapshot serialization order', () => {
  const model = createReaderGraphModel({ definitions: [{ ...def('later'), line: 30 }, { ...def('first'), line: 2 }, { ...def('middle'), line: 12 }], facts: [] });
  assert.deepEqual(model.functions.map((d: { qualified_name: string }) => d.qualified_name), ['first', 'middle', 'later']);
});

test('a same-file class call target stays inside the file boundary without being labeled a function', () => {
  const model = createReaderGraphModel({ definitions: [def('run'), { ...def('LocalClass'), kind: 'class' }], facts: [call('run', 'LocalClass', 'constructor-site')] });
  const graph = model.fileGraph('a.ts');
  assert.equal(graph.functionCount, 1);
  assert.equal(graph.nodes.find((n: { id: string }) => n.id === 'LocalClass').kind, 'definition');
  assert.equal(graph.nodes.filter((n: { kind: string }) => n.kind.startsWith('external')).length, 0);
  assert.equal(graph.edges[0].to, 'LocalClass');
});

test('file catalogue stays compact, preserves source order, and groups only by known owners', () => {
  const model = createReaderGraphModel({ definitions: [
    { ...def('Owner'), kind: 'class', qualified_name: 'Parser' },
    { ...def('later', 'a.ts', 'Owner'), line: 20, presentation: { purpose: '合并结果。' } },
    { ...def('first'), line: 2 },
  ], facts: [] });
  const catalogue = model.fileCatalogue('a.ts');
  assert.deepEqual(catalogue.map((d: { key: string }) => d.key), ['first', 'later']);
  assert.equal(catalogue[0].purpose, '功能解释待补齐；可查看声明和源码。');
  assert.equal(catalogue[1].purpose, '合并结果。');
  assert.equal(catalogue[1].group, 'Parser');
  assert.equal(catalogue[0].group, '文件级函数');
  assert.deepEqual(model.fileCatalogue('missing.ts'), []);
});

test('key logic orders statements by control edges, removes empty straight-line endpoints, and preserves source evidence', () => {
  const cfg = { fact_id: 'cfg', kind: 'control_flow', subject: { definition_key: 'run' }, value: {
    entry: 0, exit: 1,
    blocks: [{ id: 0, kind: 'entry' }, { id: 1, kind: 'exit' },
      { id: 2, kind: 'statement', source_excerpt: 'ctx.issues.push(issue);', evidence_id: 'write' },
      { id: 3, kind: 'statement', source_excerpt: 'const issue = makeIssue(input);', evidence_id: 'make' }],
    edges: [{ from: 0, to: 3, kind: 'next' }, { from: 3, to: 2, kind: 'next' }, { from: 2, to: 1, kind: 'next' }], unknowns: ['implicit_exceptions_not_modeled'],
  } };
  const model = createReaderGraphModel({ definitions: [{ ...def('run'), presentation: { steps: [{ match: 'const issue = makeIssue(input);', title: '生成错误对象' }] } }], facts: [cfg] });
  const logic = model.logicGraph('run');
  assert.equal(logic.compact, true);
  assert.deepEqual(logic.nodes.map((n: { block: { id: number } }) => n.block.id), [3, 2]);
  assert.equal(logic.nodes[0].title, '生成错误对象');
  assert.equal(logic.nodes[0].inferred, true);
  assert.equal(logic.nodes[1].block.evidence_id, 'write');
  assert.equal(logic.edges.length, 1);
  assert.deepEqual(logic.unknowns, ['implicit_exceptions_not_modeled']);
});

test('function call view includes only direct callers and callees with separate unresolved sites and recursion', () => {
  const model = createReaderGraphModel({ definitions: [def('caller'), def('focus'), def('callee'), def('indirect')], facts: [
    call('caller', 'focus', '1'), call('caller', 'focus', '2'), call('focus', 'callee', '3'), call('callee', 'indirect', '4'), call('focus', 'focus', '5'), call('focus', null, '6'), call('focus', null, '7'),
  ] });
  const graph = model.functionCalls('focus');
  assert.equal(graph.nodes.some((n: { id: string }) => n.id === 'indirect'), false);
  assert.equal(graph.nodes.filter((n: { kind: string }) => n.kind === 'unknown').length, 2);
  assert.equal(graph.edges.find((e: { from: string; to: string }) => e.from === 'caller' && e.to === 'focus').facts.length, 2);
  assert.equal(graph.edges.find((e: { from: string; to: string }) => e.from === 'focus' && e.to === 'focus').label, '递归调用');
  assert.equal(graph.nodes.find((n: { id: string }) => n.id === 'focus').column, 1);
});

test('flow overview keeps trigger, input, output and source-bound stages without claiming execution', () => {
  const data = { snapshot: 's1', definitions: [def('run')], facts: [], mainlines: [{ id: 'flow', title: '新增用户', snapshot: 's1', available: true,
    input: '用户资料', output: '用户标识', stages: [{ id: 'save', keys: ['run'], refs: [{ snapshot: 's1', definition_key: 'run' }] }], edges: [] }] };
  const overview = createReaderGraphModel(data).flowOverview('flow');
  assert.equal(overview.trigger, '调用 run');
  assert.equal(overview.input, '用户资料');
  assert.equal(overview.output, '用户标识');
  assert.equal(overview.executionStatus, 'static_possible');
  assert.deepEqual(overview.definitionKeys, ['run']);
  const stale = createReaderGraphModel({ ...data, snapshot: 's2' }).flowOverview('flow');
  assert.equal(stale.available, false);
  assert.deepEqual(stale.stages, []);
});

test('key data view traces parameter-derived local values and keeps writes and unknown propagation separate', () => {
  const flow = { kind: 'data_flow', subject: { definition_key: 'run' }, basis: { kind: 'static_possible' }, evidence_ids: ['param','use','write'], value: {
    converged: true, unknowns: ['heap_not_modeled'], accesses: [
      { id: 0, name: 'input', kind: 'definition', block: 0, inputs: [], evidence_id: 'param' },
      { id: 1, name: 'input', kind: 'use', block: 1, inputs: [], evidence_id: 'use' },
      { id: 2, name: 'result', kind: 'definition', block: 1, inputs: [1], evidence_id: 'write' },
    ], links: [{ definition: 0, use: 1 }], parameter_returns: [],
  } };
  const effect = { kind: 'effect', subject: { definition_key: 'run' }, value: { effect_kind: 'state', operation: 'ctx.result' }, evidence_ids: ['write'] };
  const result = createReaderGraphModel({ definitions: [def('run')], facts: [flow, effect] }).dataFlow('run');
  assert.deepEqual(result.parameters.map((p: { name: string }) => p.name), ['input']);
  assert.equal(result.routes.some((r: { from: string; to: string }) => r.from === 'input' && r.to === 'result'), true);
  assert.equal(result.writes[0].value.operation, 'ctx.result');
  assert.ok(result.unknowns.includes('heap_not_modeled'));
  const unavailable = createReaderGraphModel({ definitions: [def('run')], facts: [] }).dataFlow('run');
  assert.equal(unavailable.status, 'unknown');
});

test('flow boundaries retain asynchronous, failure and state evidence and withhold recovery guesses', () => {
  const data = { snapshot: 's1', definitions: [def('run')], facts: [], mainlines: [{ id: 'flow', snapshot: 's1', available: true, stages: [
    { id: 'wait', keys: ['run'], boundary: 'async', refs: [{ snapshot: 's1', definition_key: 'run', excerpt: 'await request;' }] },
    { id: 'write', keys: ['run'], boundary: 'state', outcome: 'success', refs: [{ snapshot: 's1', definition_key: 'run', excerpt: 'state.value = result;' }] },
    { id: 'fail', keys: ['run'], outcome: 'failure', refs: [{ snapshot: 's1', definition_key: 'run', excerpt: 'await request;' }] },
  ], edges: [{ from: 'wait', to: 'write' }, { from: 'wait', to: 'fail' }] }] };
  const model = createReaderGraphModel(data);
  const boundaries = model.flowBoundaries('flow');
  assert.equal(boundaries.async.length, 1);
  assert.equal(boundaries.failures.length, 1);
  assert.equal(boundaries.state.length, 1);
  assert.ok(boundaries.unknowns.includes('retry_transaction_compensation_not_proven'));
  assert.deepEqual(model.flowRoute('flow', 'failure'), ['wait', 'fail']);
});

test('runtime comparison exposes function observations without claiming inner stages ran', () => {
  const data = { repository: 'r', snapshot: 's1', overlayHash: 'h', definitions: [def('run')], facts: [], runtimeBinding: { valid: true }, runtime: {
    repository_id: 'r', snapshot_id: 's1', semantic_overlay_hash: 'h', execution_id: 'exec', coverage: { status: 'partial', reason_codes: ['trace_source_binding_unverified'] },
    observations: [{ observation_id: 'o', execution_id: 'exec', definition_key: 'run' }, { observation_id: 'u', execution_id: 'exec', definition_key: null }],
  }, mainlines: [{ id: 'flow', snapshot: 's1', available: true, stages: [{ id: 'save', keys: ['run'], refs: [{ snapshot: 's1' }] }], edges: [] }] };
  const result = createReaderGraphModel(data).flowObservations('flow', 'exec');
  assert.equal(result.stages[0].status, 'function_observed_stage_unknown');
  assert.equal(result.stages[0].observations[0].observation_id, 'o');
  assert.equal(result.unmapped.length, 1);
  assert.equal(result.coverage.status, 'partial');
  assert.equal(createReaderGraphModel(data).flowObservations('flow', 'other').status, 'unavailable');
  assert.equal(createReaderGraphModel({ ...data, snapshot: 'new' }).flowObservations('flow', 'exec').status, 'unavailable');
  assert.equal(createReaderGraphModel({ ...data, runtimeBinding: { valid: false } }).flowObservations('flow', 'exec').status, 'unavailable');
});
