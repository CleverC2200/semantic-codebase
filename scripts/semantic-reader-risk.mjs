// Read-only risk projections. Missing evidence is never interpreted as safety.
export function createReaderRiskModel(data, { capabilities } = {}) {
  const definitions = new Map(data.definitions.map(d => [d.definition_key, d]));
  const calls = data.facts.filter(f => f.kind === 'call_target');
  const categoryLabels = { funds: '资金敏感', permissions: '权限敏感', privacy: '隐私敏感', deletion: '删除敏感' };
  function importance(key) {
    const d = definitions.get(key);
    if (!d) return { sensitivity: [], effects: [], reversibility: 'unknown', unknowns: ['定义不存在于当前 Snapshot'] };
    const annotations = (data.importanceAnnotations ?? []).filter(a => a.definition_key === key && a.snapshot === data.snapshot &&
      a.evidence_ids?.length && a.evidence_ids.every(id => data.evidence?.[id]?.file_path === d.file_path));
    const sensitivity = annotations.filter(a => categoryLabels[a.category]).map(a => ({ ...a, label: categoryLabels[a.category],
      status: a.status === 'confirmed' && a.actor?.trim() && a.reason?.trim() ? 'confirmed' : 'candidate' }));
    const hints = [['funds', /pay|refund|charge|settle|支付|退款/i], ['permissions', /authorize|permission|accessControl|权限/i],
      ['privacy', /password|secret|credential|privacy|隐私/i], ['deletion', /delete|destroy|removeUser|删除/i]];
    for (const [category, pattern] of hints) if (pattern.test(d.qualified_name) && !sensitivity.some(s => s.category === category)) {
      sensitivity.push({ category, label: categoryLabels[category], status: 'candidate', basis: 'name_hint', reason: '仅名称线索，业务含义待核实', evidence_ids: [] });
    }
    const effects = data.facts.filter(f => f.kind === 'effect' && f.subject.definition_key === key && !['return', 'throw', 'await', 'yield'].includes(f.value.effect_kind));
    const explicit = annotations.find(a => a.status === 'confirmed' && a.actor?.trim() && a.reason?.trim() && ['irreversible', 'reversible', 'read_only'].includes(a.reversibility));
    const reversibility = explicit?.reversibility ?? (effects.some(f => f.value.effect_kind === 'state') ? 'state_write' : effects.length ? 'external_unknown' : 'unknown');
    return { sensitivity, effects, reversibility, unknowns: ['未提取写入不代表只读；外部调用与恢复能力可能未覆盖。'], snapshot: data.snapshot };
  }
  function impact(key, options = {}) {
    const bounded = (value, fallback, maximum) => Number.isInteger(value) && value >= 0 ? Math.min(value, maximum) : fallback;
    const budget = { maxDepth: bounded(options.maxDepth, 3, 12), maxNodes: Math.max(1, bounded(options.maxNodes, 100, 1000)), maxEdges: bounded(options.maxEdges, 500, 5000) };
    const incoming = new Map(), unknowns = new Set(['non_call_dependencies_not_covered']);
    const unique = new Map();
    calls.forEach((f, i) => unique.set(f.subject.definition_key + ':' + (f.value.call_site_evidence_id ?? f.fact_id ?? i), f));
    for (const f of unique.values()) {
      const target = f.value.target_definition_key;
      if (!definitions.has(target)) { unknowns.add('unresolved_call_targets'); continue; }
      if (!incoming.has(target)) incoming.set(target, []);
      incoming.get(target).push(f);
    }
    const direct = (incoming.get(key) ?? []).filter(f => f.subject.definition_key !== key);
    const directCallers = [...new Set(direct.map(f => f.subject.definition_key))].sort();
    const visited = new Set([key]), queue = [{ key, depth: 0, keys: [key], facts: [] }], paths = [], reasons = new Set();
    let scanned = 0;
    while (queue.length) {
      const current = queue.shift();
      for (const fact of incoming.get(current.key) ?? []) {
        if (scanned >= budget.maxEdges) { reasons.add('edge_budget'); break; }
        scanned++;
        const from = fact.subject.definition_key;
        if (visited.has(from)) continue;
        if (!definitions.has(from)) { unknowns.add('caller_definition_missing'); continue; }
        if (current.depth >= budget.maxDepth) { reasons.add('depth_budget'); continue; }
        if (visited.size >= budget.maxNodes) { reasons.add('node_budget'); continue; }
        visited.add(from);
        const next = { key: from, depth: current.depth + 1, keys: [from, ...current.keys], facts: [fact, ...current.facts] };
        queue.push(next); paths.push(next);
      }
      if (reasons.has('edge_budget')) break;
    }
    const mapped = typeof capabilities === 'function' ? capabilities() : capabilities;
    const features = mapped?.list().filter(c => c.kind === 'feature' && c.available && mapped.members(c.id).some(k => visited.has(k))) ?? null;
    return { root: key, snapshot: data.snapshot, scope: 'known_incoming_calls', directCallSites: direct.length, directCallers,
      selfCallSites: (incoming.get(key) ?? []).filter(f => f.subject.definition_key === key).length,
      reached: [...visited].filter(k => k !== key).sort(), paths, featureMappings: features?.map(c => ({ id: c.id, title: c.title, status: c.status })) ?? null,
      budget, scannedEdges: scanned, completeness: { status: reasons.size ? 'truncated' : 'complete', reasons: [...reasons] },
      coverage: data.coverage ?? { status: 'unknown' }, unknowns: [...unknowns] };
  }
  function contractImpact(key, { maxDepth = 3, maxNodes = 100, maxEdges = 500 } = {}) {
    const depth = Number.isInteger(maxDepth) ? Math.max(0, Math.min(12, maxDepth)) : 3;
    const limit = Number.isInteger(maxNodes) ? Math.max(1, Math.min(1000, maxNodes)) : 100;
    const edgeLimit = Number.isInteger(maxEdges) ? Math.max(0, Math.min(5000, maxEdges)) : 500;
    const unknowns = new Set(['database_config_event_dependencies_not_covered']), reasons = new Set();
    const relations = (data.relations ?? []).filter(r => {
      if (r.kind !== 'INHERITS') return false;
      const valid = r.snapshot_id === data.snapshot && definitions.has(r.source.definition_key) && definitions.has(r.target.definition_key) && r.evidence_ids?.length && r.evidence_ids.every(id => data.evidence?.[id]);
      if (!valid) unknowns.add('inheritance_evidence_or_version_missing');
      return valid;
    });
    const visited = new Set([key]), queue = [{ key, keys: [key], relations: [], depth: 0 }], paths = [];
    let scanned = 0;
    while (queue.length) {
      const current = queue.shift();
      for (const relation of relations.filter(r => r.target.definition_key === current.key)) {
        if (scanned++ >= edgeLimit) { reasons.add('edge_budget'); break; }
        const from = relation.source.definition_key;
        if (visited.has(from)) continue;
        if (current.depth >= depth) { reasons.add('depth_budget'); continue; }
        if (visited.size >= limit) { reasons.add('node_budget'); continue; }
        visited.add(from);
        const next = { key: from, keys: [from, ...current.keys], relations: [relation, ...current.relations], depth: current.depth + 1 };
        paths.push(next); queue.push(next);
      }
      if (reasons.has('edge_budget')) break;
    }
    return { root: key, snapshot: data.snapshot, relationKind: 'INHERITS', reached: [...visited].filter(k => k !== key).sort(), paths,
      completeness: { status: reasons.size ? 'truncated' : 'complete', reasons: [...reasons] },
      coverage: data.relationCoverage ?? { status: 'unknown' }, unknowns: [...unknowns] };
  }
  return { importance, impact, contractImpact };
}
