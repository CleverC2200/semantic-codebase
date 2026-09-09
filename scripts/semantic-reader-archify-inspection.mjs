import { readerCanonicalJson } from './semantic-reader-comparison.mjs';
import { readerArchifyDigest, readerArchifyEvidenceIds } from './semantic-reader-archify.mjs';

export function readerArchifyFocus(projection, { stage = null, path = 'all' } = {}) {
  const { stages, stage_edges: edges } = projection.exploration;
  const selected = stage ? new Set(stages.filter(s => s.id === stage).map(s => s.id))
    : new Set(stages.filter(s => path === 'all' || s.outcome === path).map(s => s.id));
  if (!stage && path !== 'all') {
    const queue = [...selected];
    while (queue.length) {
      const target = queue.shift();
      for (const edge of edges) if (edge.to === target && !selected.has(edge.from)) { selected.add(edge.from); queue.push(edge.from); }
    }
  }
  const nodeIds = [...new Set(stages.filter(s => selected.has(s.id)).flatMap(s => s.node_ids))];
  return { stage_ids: [...selected], node_ids: nodeIds,
    edge_ids: projection.edges.filter(e => nodeIds.includes(e.from) && nodeIds.includes(e.to)).map(e => e.id),
    basis: 'llm_inferred', verified: false, execution: 'unknown' };
}

// Only selection opens source/Behavior Fact resources. A failed request returns no replacement detail.
export async function inspectReaderArchify(data, projection, selection, loader) {
  const fail = () => { throw new Error('来源版本或摘要不匹配，已停止加载并保留原阅读位置。'); };
  const binding = projection.binding;
  if (binding.snapshot !== data.snapshot || binding.repository !== data.repository || binding.revision !== data.revision || binding.overlay_hash !== (data.overlayHash ?? null)) fail();
  const node = selection.kind === 'node' ? projection.nodes.find(n => n.id === selection.id) : null;
  const edge = selection.kind === 'edge' ? projection.edges.find(e => e.id === selection.id) : null;
  if (!node && !edge) fail();
  const nodes = node ? [node] : projection.nodes.filter(n => n.id === edge.from || n.id === edge.to);
  for (const n of nodes) await loader.definition(n.definition_key);
  const behaviorKinds = new Set(['control_step', 'control_flow', 'data_flow', 'call_data_flow', 'effect', 'entrypoint', 'application_flow']);
  const facts = edge ? edge.fact_ids.map(id => data.facts.find(f => f.fact_id === id))
    : data.facts.filter(f => f.subject?.definition_key === node.definition_key && behaviorKinds.has(f.kind));
  if (facts.some(f => !f || (f.snapshot_id !== undefined && f.snapshot_id !== data.snapshot))) fail();
  if (edge && facts.some(f => f.kind !== 'call_target' || f.basis?.kind !== edge.basis ||
    f.subject.definition_key !== nodes.find(n => n.id === edge.from)?.definition_key || f.value.target_definition_key !== nodes.find(n => n.id === edge.to)?.definition_key ||
    readerCanonicalJson(f) !== readerCanonicalJson(projection.facts[f.fact_id]))) fail();
  const sourceCache = new Map();
  const source = async path => {
    if (sourceCache.has(path)) return sourceCache.get(path);
    await loader.source(path);
    const file = data.files.find(f => f.path === path);
    if (!file?.verified || typeof file.source !== 'string' || await readerArchifyDigest(file.source) !== file.source_digest) fail();
    const frozen = projection.sourceFiles.find(f => f.path === path);
    if (frozen && file.source_digest !== frozen.source_digest) fail();
    const bytes = new TextEncoder().encode(file.source); sourceCache.set(path, { file, bytes }); return { file, bytes };
  };
  const validSpan = (span, bytes) => Number.isSafeInteger(span?.start_byte) && Number.isSafeInteger(span?.end_byte) && span.start_byte >= 0 && span.end_byte > span.start_byte && span.end_byte <= bytes.length;
  for (const n of nodes) {
    const d = data.definitions.find(d => d.definition_key === n.definition_key), { file, bytes } = await source(n.file_path);
    if (!d || d.snapshot_id !== data.snapshot || d.file_path !== n.file_path || file.source_digest !== n.source_digest ||
      readerCanonicalJson(d.definition_span) !== readerCanonicalJson(n.definition_span) || !validSpan(d.definition_span, bytes)) fail();
  }
  const ids = [...new Set([...(edge?.evidence_ids ?? node.evidence_ids), ...facts.flatMap(readerArchifyEvidenceIds)])];
  await loader.evidence(ids);
  const evidence = [];
  for (const id of ids) {
    const e = data.evidence[id]; if (!e || e.evidence_id !== id || (e.snapshot_id !== undefined && e.snapshot_id !== data.snapshot)) fail();
    const { file, bytes } = await source(e.file_path);
    if (e.source_digest !== file.source_digest || !validSpan(e.span, bytes)) fail();
    if (projection.evidence[id] && readerCanonicalJson(e) !== readerCanonicalJson(projection.evidence[id])) fail();
    const decode = span => new TextDecoder().decode(span);
    const line = decode(bytes.slice(0, e.span.start_byte)).split('\n').length, end_line = decode(bytes.slice(0, e.span.end_byte)).split('\n').length;
    evidence.push({ ...e, line, end_line, excerpt: decode(bytes.slice(e.span.start_byte, e.span.end_byte)),
      definition_key: nodes.find(n => n.file_path === e.file_path && e.span.start_byte >= n.definition_span.start_byte && e.span.end_byte <= n.definition_span.end_byte)?.definition_key ?? null });
  }
  return { selection, node, edge, nodes, binding, evidence, behavior: node ? facts.map(f => ({ ...f, presentation_verified: false })) : [], coverage: projection.coverage };
}

export function readerArchifyBoundaryText(item) {
  const labels = {
    unresolved_call: '调用目标尚未解析', unverified_basis: '来源未经静态准入，未生成确定连线',
    ambiguous_call_site: '同一调用点存在冲突目标，未生成确定连线', target_outside_mainline: '调用目标在此主线范围之外',
    relation_candidates_not_projected: 'Relation Candidate 为候选关系，未作为确定连线', relation_candidates_unavailable: '未提供候选关系列表，数量未知',
    partial_coverage: '分析覆盖为 partial，未发现不代表不存在', runtime_unavailable: '没有可用运行观测',
    runtime_hash_or_version_mismatch: '运行观测的 Execution、版本或摘要不匹配，已停止展示',
    trace_source_binding_unverified: 'Trace 与源码的绑定未经核对，已停止展示', runtime_definition_mismatch: '运行观测的定义与源码文件不匹配，已停止展示',
  };
  return labels[item.reason] ?? item.reason;
}
