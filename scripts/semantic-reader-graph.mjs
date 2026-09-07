// Read-only presentation models. No graph here changes the snapshot or resolves unknown targets.
export function createReaderGraphModel(data) {
  const definitions = new Map(data.definitions.map(d => [d.definition_key, d]));
  const functions = data.definitions.filter(d => ['function', 'method'].includes(d.kind)).sort((a, b) => a.file_path.localeCompare(b.file_path) || (a.definition_span?.start_byte ?? a.line ?? 0) - (b.definition_span?.start_byte ?? b.line ?? 0));
  const calls = data.facts.filter(f => f.kind === 'call_target');
  const controls = data.facts.filter(f => f.kind === 'control_flow');
  const short = text => String(text ?? '').replace(/\s+/g, ' ').slice(0, 76);
  const purpose = d => d.presentation?.purpose ?? '功能解释待补齐；可查看声明和源码。';
  const functionNode = (d, external = false) => ({
    id: d.definition_key, kind: external ? 'external' : 'function', title: d.qualified_name,
    description: short(purpose(d)), inferred: Boolean(d.presentation), file: d.file_path,
    line: d.line, keys: [d.definition_key], facts: [],
  });
  function fileCatalogue(file, order = 'source') {
    const rows = functions.filter(d => d.file_path === file).map(d => ({
      key: d.definition_key, name: d.qualified_name, purpose: purpose(d),
      group: definitions.get(d.container_definition_key)?.qualified_name ?? '文件级函数',
      line: d.line, inferred: Boolean(d.presentation),
    }));
    return order === 'group' ? rows.sort((a, b) => a.group.localeCompare(b.group) || (a.line ?? 0) - (b.line ?? 0)) : rows;
  }
  function groups(file) {
    const result = new Map();
    for (const d of functions.filter(d => d.file_path === file)) {
      const owner = definitions.get(d.container_definition_key);
      const id = 'group:' + (owner?.definition_key ?? file);
      if (!result.has(id)) result.set(id, { id, title: owner?.qualified_name ?? '文件级函数', keys: [], kind: owner?.kind ?? 'file' });
      result.get(id).keys.push(d.definition_key);
    }
    return [...result.values()];
  }
  function fileGraph(file, expanded = []) {
    const local = functions.filter(d => d.file_path === file);
    const grouped = local.length > 12;
    const nodes = new Map(), mapped = new Map();
    for (const group of groups(file)) {
      if (grouped && !expanded.includes(group.id)) {
        nodes.set(group.id, { ...group, kind: 'group', file, description: `${group.keys.length} 个函数 · 按源码所属定义分组`, facts: [] });
        group.keys.forEach(key => mapped.set(key, group.id));
      } else {
        for (const key of group.keys) { nodes.set(key, functionNode(definitions.get(key))); mapped.set(key, key); }
      }
    }
    const localKeys = new Set(local.map(d => d.definition_key));
    const edges = new Map();
    for (const fact of calls.filter(f => localKeys.has(f.subject.definition_key))) {
      const from = mapped.get(fact.subject.definition_key), target = definitions.get(fact.value.target_definition_key);
      let to;
      if (target && mapped.has(target.definition_key)) to = mapped.get(target.definition_key);
      else if (target && target.file_path === file) {
        to = target.definition_key;
        if (!nodes.has(to)) nodes.set(to, { ...functionNode(target), kind: 'definition', description: `本文件的 ${target.kind} 定义；调用解析目标` });
      } else if (target) {
        to = grouped ? 'external:' + target.file_path : target.definition_key;
        if (!nodes.has(to)) nodes.set(to, grouped ? {
          id: to, kind: 'external-group', title: target.file_path.split('/').pop(), description: '跨文件调用出口',
          file: target.file_path, keys: [], facts: [],
        } : { ...functionNode(target, true), kind: ['function', 'method'].includes(target.kind) ? 'external' : 'external-definition' });
        if (!nodes.get(to).keys.includes(target.definition_key)) nodes.get(to).keys.push(target.definition_key);
      } else {
        // Unknown sites are never merged by a guessed function name.
        to = grouped ? 'unknown:' + from : 'unknown:' + fact.value.call_site_evidence_id;
        if (!nodes.has(to)) nodes.set(to, {
          id: to, kind: 'unknown', title: grouped ? '未解析调用' : short(fact.value.call).length > 65 ? '复杂调用表达式' : short(fact.value.call),
          description: '目标无法定位；不推测下游', file, keys: [], facts: [],
        });
      }
      const id = from + '>' + to;
      if (!edges.has(id)) edges.set(id, { id, from, to, kind: target ? 'call' : 'unresolved', label: target ? '调用' : '未解析', facts: [] });
      edges.get(id).facts.push(fact);
      nodes.get(from).facts.push(fact);
      if (from !== to) nodes.get(to).facts.push(fact);
    }
    for (const edge of edges.values()) if (edge.from === edge.to) edge.label = nodes.get(edge.from).kind === 'group' ? '组内调用' : '递归调用';
    return { type: 'file', file, nodes: [...nodes.values()], edges: [...edges.values()], grouped, functionCount: local.length };
  }
  function functionCalls(key) {
    const root = definitions.get(key);
    if (!root) return { type: 'file', scope: 'function-calls', nodes: [], edges: [], functionCount: 0 };
    const nodes = new Map([[key, { ...functionNode(root), column: 1 }]]), edges = new Map();
    const direct = calls.filter(f => f.subject.definition_key === key || f.value.target_definition_key === key);
    direct.forEach((f, index) => {
      const from = f.subject.definition_key;
      if (!definitions.has(from)) return;
      const target = definitions.get(f.value.target_definition_key);
      const to = target?.definition_key ?? 'unknown:' + (f.value.call_site_evidence_id ?? f.fact_id ?? index);
      if (!nodes.has(from)) nodes.set(from, { ...functionNode(definitions.get(from)), column: 0 });
      if (!nodes.has(to)) nodes.set(to, target ? { ...functionNode(target, target.file_path !== root.file_path), column: 2 } :
        { id: to, kind: 'unknown', title: short(f.value.call), description: '此调用目标未解析', keys: [], facts: [], column: 2 });
      const id = from + '>' + to;
      if (!edges.has(id)) edges.set(id, { id, from, to, kind: target ? 'call' : 'unresolved', label: from === to ? '递归调用' : target ? '调用' : '未解析', facts: [] });
      edges.get(id).facts.push(f);
    });
    return { type: 'file', scope: 'function-calls', root: key, nodes: [...nodes.values()], edges: [...edges.values()], functionCount: nodes.size, grouped: false };
  }
  const kinds = { entry: '进入函数', exit: '结束函数', branch: '条件判断', loop: '循环', return: '返回', throw: '抛出异常', statement: '处理语句' };
  const edgeKinds = { next: '继续', true: '条件成立', false: '条件不成立', back: '继续循环', return: '返回', throw: '抛出异常', exception: '异常路径' };
  function controlGraph(key) {
    const cfg = controls.find(f => f.subject.definition_key === key);
    if (!cfg) return { type: 'control', root: key, nodes: [], edges: [], unknowns: ['未提取此函数的内部控制流。'] };
    return { type: 'control', root: key, cfg, nodes: cfg.value.blocks.map(b => ({
      id: 'block:' + b.id, kind: b.kind === 'branch' ? 'condition' : 'block', title: kinds[b.kind] ?? b.kind,
      description: short(b.source_excerpt ?? '无独立执行语句'), block: b, keys: [key], facts: [cfg],
    })), edges: cfg.value.edges.map((e, i) => ({
      id: 'control:' + i, from: 'block:' + e.from, to: 'block:' + e.to, kind: 'control', label: edgeKinds[e.kind] ?? e.kind, facts: [cfg], raw: e,
    })), unknowns: cfg.value.unknowns ?? [] };
  }
  function logicGraph(key) {
    const base = controlGraph(key);
    if (!base.cfg) return base;
    const cfg = base.cfg.value, byId = new Map(base.nodes.map(n => [n.block.id, n]));
    const ordered = [], seen = new Set();
    function visit(id) {
      if (seen.has(id) || !byId.has(id)) return;
      seen.add(id); ordered.push(byId.get(id));
      cfg.edges.filter(e => e.from === id).forEach(e => visit(e.to));
    }
    visit(cfg.entry); base.nodes.forEach(n => visit(n.block.id));
    const compact = cfg.edges.every(e => ['next', 'return'].includes(e.kind)) &&
      cfg.blocks.filter(b => !['entry', 'exit'].includes(b.kind)).length <= 6;
    const steps = definitions.get(key)?.presentation?.steps ?? [];
    const nodes = ordered.filter(n => !compact || !['entry', 'exit'].includes(n.block.kind)).map(n => {
      const source = n.block.source_excerpt ?? '';
      const explanation = steps.find(s => s.match === source);
      const statement = source.replace(/\s+/g, ' ').trim();
      const prefix = { branch: '判断', loop: '循环', return: '返回', throw: '抛出异常', await: '等待', statement: '源码步骤' }[n.block.kind];
      return { ...n, title: explanation?.title ?? (prefix && statement ? `${prefix}：${short(statement)}` : n.title),
        description: explanation?.description ?? (source ? '展开核对语句与来源。' : n.description), inferred: Boolean(explanation) };
    });
    const ids = new Set(nodes.map(n => n.id));
    return { ...base, compact, nodes, edges: base.edges.filter(e => ids.has(e.from) && ids.has(e.to)) };
  }
  function dataFlow(key, { maxItems = 40 } = {}) {
    const limit = Number.isInteger(maxItems) ? Math.max(1, Math.min(200, maxItems)) : 40;
    const own = data.facts.filter(f => f.subject.definition_key === key), local = own.find(f => f.kind === 'data_flow');
    const v = local?.value, accesses = v?.accesses ?? [], byId = new Map(accesses.map(a => [a.id, a]));
    const parameters = accesses.filter(a => a.kind === 'definition' && a.block === 0);
    const writes = own.filter(f => f.kind === 'effect' && ['state', 'database', 'filesystem', 'network', 'event'].includes(f.value.effect_kind));
    const unknowns = new Set(v?.unknowns ?? []), routes = [], reached = new Set(parameters.map(p => p.id));
    const edges = [...(v?.links ?? []).map(l => ({ from: l.definition, to: l.use, kind: 'use' })),
      ...accesses.flatMap(a => (a.inputs ?? []).map(id => ({ from: id, to: a.id, kind: 'value_dependency' })))];
    if (v?.converged) {
      const queue = [...reached];
      while (queue.length && routes.length < limit) {
        const id = queue.shift();
        for (const edge of edges.filter(e => e.from === id)) {
          const from = byId.get(edge.from), to = byId.get(edge.to); if (!from || !to) { unknowns.add('access_mapping_missing'); continue; }
          if (routes.length >= limit) break;
          routes.push({ from: from.name, to: to.name, kind: edge.kind, evidence_ids: [from.evidence_id, to.evidence_id].filter(Boolean) });
          if (!reached.has(to.id)) { reached.add(to.id); queue.push(to.id); }
        }
      }
      if (routes.length >= limit) unknowns.add('reader_data_budget');
    } else unknowns.add('local_data_flow_unavailable_or_not_converged');
    const interprocedural = own.filter(f => f.kind === 'call_data_flow');
    if (!interprocedural.length) unknowns.add('cross_function_value_mapping_unavailable');
    const returns = v?.converged ? (v.parameter_returns ?? []).map(r => ({ parameter: byId.get(r.parameter)?.name ?? '未知参数', evidence_ids: [byId.get(r.parameter)?.evidence_id, byId.get(r.return_use)?.evidence_id].filter(Boolean) })) : [];
    return { status: v?.converged ? 'partial' : 'unknown', parameters, routes, returns, writes,
      calls: interprocedural.slice(0, limit), local, unknowns: [...unknowns], truncated: interprocedural.length > limit || unknowns.has('reader_data_budget') };
  }
  function flowOverview(id) {
    const flow = data.mainlines?.find(m => m.id === id);
    if (!flow) return null;
    const available = flow.available && flow.snapshot === data.snapshot && flow.stages.every(s => s.refs.every(r => r.snapshot === data.snapshot));
    const definitionKeys = available ? [...new Set(flow.stages.flatMap(s => s.keys))] : [];
    const entry = definitions.get(flow.stages[0]?.keys[0]);
    return { ...flow, available, stages: available ? flow.stages : [], edges: available ? flow.edges : [],
      unavailable: available ? '' : flow.unavailable || '主线来源版本不匹配。',
      trigger: flow.trigger ?? (entry ? '调用 ' + entry.qualified_name : '入口未确认'),
      definitionKeys, executionStatus: 'static_possible' };
  }
  function flowObservations(id, executionId) {
    const flow = flowOverview(id), runtime = data.runtime;
    if (!flow?.available || !data.runtimeBinding?.valid || !runtime || runtime.repository_id !== data.repository || runtime.snapshot_id !== data.snapshot || runtime.semantic_overlay_hash !== data.overlayHash || runtime.execution_id !== executionId) {
      return { status: 'unavailable', reason: data.runtimeBinding?.reason ?? 'execution_or_version_unavailable', stages: [], unmapped: [] };
    }
    const observations = runtime.observations.filter(o => o.execution_id === executionId);
    const keys = new Set(flow.definitionKeys);
    return { status: 'partial', executionId, coverage: runtime.coverage, stages: flow.stages.map(stage => {
      const matched = observations.filter(o => stage.keys.includes(o.definition_key));
      return { id: stage.id, status: matched.length ? 'function_observed_stage_unknown' : 'static_possible', observations: matched };
    }), unmapped: observations.filter(o => !keys.has(o.definition_key)), traceDigest: runtime.trace_digest };
  }
  function flowBoundaries(id) {
    const flow = flowOverview(id), stages = flow?.available ? flow.stages : [];
    return { async: stages.filter(s => s.boundary === 'async'), state: stages.filter(s => s.boundary === 'state'),
      failures: stages.filter(s => s.outcome === 'failure'), unknowns: ['retry_transaction_compensation_not_proven'], basis: 'llm_inferred', verified: false };
  }
  function flowRoute(id, outcome = 'all') {
    const flow = flowOverview(id); if (!flow?.available) return [];
    if (outcome === 'all') return flow.stages.map(s => s.id);
    const reached = new Set(flow.stages.filter(s => s.outcome === outcome).map(s => s.id)), queue = [...reached];
    while (queue.length) {
      const target = queue.shift();
      for (const edge of flow.edges.filter(e => e.to === target)) if (!reached.has(edge.from)) { reached.add(edge.from); queue.push(edge.from); }
    }
    return flow.stages.filter(s => reached.has(s.id)).map(s => s.id);
  }
  function neighbors(graph, nodeId) {
    const nodes = new Set([nodeId]), edges = new Set();
    for (const edge of graph.edges) if (edge.from === nodeId || edge.to === nodeId) {
      nodes.add(edge.from); nodes.add(edge.to); edges.add(edge.id);
    }
    return { nodes, edges };
  }
  return { definitions, functions, calls, controls, fileCatalogue, groups, fileGraph, functionCalls, controlGraph, logicGraph, flowOverview, dataFlow, flowBoundaries, flowRoute, flowObservations, neighbors };
}

// Collapse cycles before assigning columns. Position depends on data, not selection or panel width.
export function layoutReaderGraph(graph) {
  const adjacency = new Map(graph.nodes.map(n => [n.id, []]));
  graph.edges.forEach(e => { if (adjacency.has(e.from) && adjacency.has(e.to)) adjacency.get(e.from).push(e.to); });
  let index = 0;
  const indices = new Map(), low = new Map(), stack = [], inStack = new Set(), components = [];
  function visit(id) {
    indices.set(id, index); low.set(id, index++); stack.push(id); inStack.add(id);
    for (const next of adjacency.get(id)) {
      if (!indices.has(next)) { visit(next); low.set(id, Math.min(low.get(id), low.get(next))); }
      else if (inStack.has(next)) low.set(id, Math.min(low.get(id), indices.get(next)));
    }
    if (low.get(id) === indices.get(id)) {
      const component = []; let next;
      do { next = stack.pop(); inStack.delete(next); component.push(next); } while (next !== id);
      components.push(component);
    }
  }
  graph.nodes.forEach(n => { if (!indices.has(n.id)) visit(n.id); });
  const componentOf = new Map(); components.forEach((c, i) => c.forEach(id => componentOf.set(id, i)));
  const incoming = components.map(() => new Set());
  graph.edges.forEach(e => { const from = componentOf.get(e.from), to = componentOf.get(e.to); if (from !== to && from !== undefined && to !== undefined) incoming[to].add(from); });
  const levels = new Map();
  function level(id) { if (!levels.has(id)) levels.set(id, incoming[id].size ? Math.max(...[...incoming[id]].map(level)) + 1 : 0); return levels.get(id); }
  const rows = new Map();
  const nodes = graph.nodes.map(n => {
    const column = n.column ?? level(componentOf.get(n.id));
    const row = n.row ?? rows.get(column) ?? 0; rows.set(column, row + 1);
    return { ...n, x: 36 + column * 340, y: 44 + row * 184, width: 246, height: 132 };
  });
  return { ...graph, nodes, width: Math.max(680, ...nodes.map(n => n.x + 430)), height: Math.max(340, ...nodes.map(n => n.y + 184)) };
}
