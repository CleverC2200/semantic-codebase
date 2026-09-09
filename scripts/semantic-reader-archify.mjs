import { readerCanonicalJson } from './semantic-reader-comparison.mjs';

export const ARCHIFY_PROJECTOR_VERSION = 'reader-archify-v2';
export async function readerArchifyDigest(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : readerCanonicalJson(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Only the selected, fully hydrated mainline is inspected. Never fetch or mutate frozen input here.
export async function createArchifyProjection(data, mainlineId) {
  const fail = reason => { throw new Error('Archify 无法交付：' + reason); };
  if (!/^[a-f0-9]{40}$/i.test(data.revision ?? '')) fail('缺少真实 Git revision。');
  const repositoryUrl = data.repositoryUrl ?? data.repository;
  if (!/^(?:https?:\/\/|git@|ssh:\/\/)/i.test(repositoryUrl ?? '')) fail('缺少可核对的仓库 origin。');
  const mainline = (data.mainlines ?? []).find(m => m.id === mainlineId);
  if (!mainline?.available || mainline.snapshot !== data.snapshot) fail('主线版本或可用性不匹配。');
  const definitions = new Map((data.definitions ?? []).map(d => [d.definition_key, d]));
  const files = new Map((data.files ?? []).map(f => [f.path, f]));
  if (definitions.size !== data.definitions?.length || files.size !== data.files?.length) fail('重复的定义或文件身份。');
  const keys = [...new Set((mainline.stages ?? []).flatMap(s => s.keys ?? []))];
  if (!keys.length) fail('主线没有绑定定义。');
  if (keys.length > 12) fail('主线超过 12 个节点展示预算；请提供更小的来源绑定主线，未截断或补画。');
  for (const stage of mainline.stages) {
    const declared = [...new Set(stage.keys ?? [])].sort(), referenced = [...new Set((stage.refs ?? []).map(r => r.definition_key))].sort();
    if (readerCanonicalJson(declared) !== readerCanonicalJson(referenced)) fail('阶段引用与声明成员不一致。');
  }
  const verified = new Map(), usedEvidence = new Set();
  const source = async path => {
    if (verified.has(path)) return verified.get(path);
    const f = files.get(path);
    if (!f?.verified || typeof f.source !== 'string' || await readerArchifyDigest(f.source) !== f.source_digest) fail('源码未加载或摘要失配：' + path);
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..')) fail('非法源码路径。');
    const bytes = new TextEncoder().encode(f.source); verified.set(path, { file: f, bytes }); return verified.get(path);
  };
  const spanValid = (span, bytes) => span && Number.isSafeInteger(span.start_byte) && Number.isSafeInteger(span.end_byte) && span.start_byte >= 0 && span.end_byte > span.start_byte && span.end_byte <= bytes.length;
  const lineRange = (bytes, span) => ({ line: new TextDecoder().decode(bytes.slice(0, span.start_byte)).split('\n').length,
    end_line: new TextDecoder().decode(bytes.slice(0, span.end_byte)).split('\n').length });
  const evidence = async id => {
    const e = Object.hasOwn(data.evidence ?? {}, id) ? data.evidence[id] : null;
    if (!e || e.evidence_id !== id || (e.snapshot_id !== undefined && e.snapshot_id !== data.snapshot)) fail('Evidence 缺失或版本失配：' + id);
    const { file, bytes } = await source(e.file_path);
    if (e.source_digest !== file.source_digest || !spanValid(e.span, bytes)) fail('Evidence 摘要或范围失配：' + id);
    usedEvidence.add(id); return e;
  };
  const closeEvidence = async value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key.endsWith('evidence_id') && item !== null) { if (typeof item !== 'string') fail('Evidence 引用格式不正确。'); await evidence(item); }
      if (key.endsWith('evidence_ids')) {
        if (!Array.isArray(item)) fail('Evidence 列表格式不正确。');
        for (const id of item) await evidence(id);
      }
      if (item && typeof item === 'object') await closeEvidence(item);
    }
  };
  const nodes = [];
  for (const key of keys) {
    const d = definitions.get(key);
    if (!d || d.snapshot_id !== data.snapshot) fail('Definition 缺失或版本失配：' + key);
    const { bytes } = await source(d.file_path);
    if (!spanValid(d.definition_span, bytes) || !d.evidence_ids?.length) fail('Definition 声明或 Evidence 缺失：' + key);
    if (d.content_hash && await readerArchifyDigest(new TextDecoder().decode(bytes.slice(d.definition_span.start_byte, d.definition_span.end_byte))) !== d.content_hash) fail('Definition 内容摘要失配：' + key);
    await closeEvidence(d);
    if (!d.evidence_ids.some(id => { const e = data.evidence[id]; return e.file_path === d.file_path && e.span.start_byte >= d.definition_span.start_byte && e.span.end_byte <= d.definition_span.end_byte; })) fail('声明 Evidence 不属于此 Definition：' + key);
    const stages = mainline.stages.filter(s => s.keys?.includes(key));
    for (const stage of stages) {
      const refs = (stage.refs ?? []).filter(r => r.definition_key === key);
      if (!refs.length) fail('阶段缺少源码绑定：' + key);
      for (const ref of refs) {
        const f = files.get(d.file_path), range = lineRange(bytes, d.definition_span);
        if (ref.file !== d.file_path || ref.snapshot !== data.snapshot || ref.source_digest !== f.source_digest || mainline.source_digests?.[d.file_path] !== f.source_digest ||
          !Number.isInteger(ref.startLine) || !Number.isInteger(ref.endLine) || ref.startLine < range.line || ref.endLine > range.end_line || ref.endLine < ref.startLine ||
          !ref.excerpt || !f.source.split('\n').slice(ref.startLine - 1, ref.endLine).join('\n').includes(ref.excerpt)) fail('阶段源码绑定失配：' + key);
      }
    }
    nodes.push({ id: 'fn-' + (await readerArchifyDigest(key)).slice(0, 24), definition_key: key, qualified_name: d.qualified_name,
      file_path: d.file_path, source_digest: files.get(d.file_path).source_digest, ...lineRange(bytes, d.definition_span),
      definition_span: d.definition_span, evidence_ids: [...d.evidence_ids], stages: stages.map(s => ({ id: s.id, title: s.title, basis: 'llm_inferred', verified: false })) });
  }
  const included = new Map(nodes.map(n => [n.definition_key, n])), unknowns = [], edges = [], calls = [];
  const callSite = f => { const e = data.evidence[f.value.call_site_evidence_id]; return readerCanonicalJson([f.subject.definition_key, e.file_path, e.span]); };
  for (const f of data.facts ?? []) {
    if (f.kind !== 'call_target' || !included.has(f.subject?.definition_key)) continue;
    if (f.snapshot_id !== undefined && f.snapshot_id !== data.snapshot) fail('调用 Fact 版本失配。');
    const ref = { fact_id: f.fact_id ?? null, definition_key: f.subject.definition_key };
    if (!['compiler_exact', 'static_possible'].includes(f.basis?.kind)) { unknowns.push({ ...ref, reason: 'unverified_basis', basis: f.basis?.kind ?? 'unknown' }); continue; }
    if (!f.value?.target_definition_key) { unknowns.push({ ...ref, reason: 'unresolved_call' }); continue; }
    if (!f.evidence_ids?.length || !f.value.call_site_evidence_id) fail('已解析调用缺少 Evidence。');
    await closeEvidence(f);
    const site = data.evidence[f.value.call_site_evidence_id], from = definitions.get(f.subject.definition_key);
    if (site.file_path !== from.file_path || site.span.start_byte < from.definition_span.start_byte || site.span.end_byte > from.definition_span.end_byte) fail('调用点 Evidence 不属于源 Definition。');
    calls.push(f);
  }
  const targets = new Map();
  for (const f of calls) { const site = callSite(f); if (!targets.has(site)) targets.set(site, new Set()); targets.get(site).add(f.value.target_definition_key); }
  for (const f of calls) {
    if (targets.get(callSite(f)).size !== 1) { unknowns.push({ fact_id: f.fact_id ?? null, reason: 'ambiguous_call_site' }); continue; }
    if (!included.has(f.value.target_definition_key)) { unknowns.push({ fact_id: f.fact_id ?? null, definition_key: f.subject.definition_key, reason: 'target_outside_mainline', target_definition_key: f.value.target_definition_key }); continue; }
    const from = included.get(f.subject.definition_key), to = included.get(f.value.target_definition_key);
    let edge = edges.find(e => e.from === from.id && e.to === to.id && e.basis === f.basis.kind);
    if (!edge) { edge = { id: 'call-' + edges.length, from: from.id, to: to.id, basis: f.basis.kind, fact_ids: [], evidence_ids: [] }; edges.push(edge); }
    edge.fact_ids.push(f.fact_id ?? null); edge.evidence_ids = [...new Set([...edge.evidence_ids, ...f.evidence_ids, f.value.call_site_evidence_id])];
  }
  if (data.relationCandidates?.length) unknowns.push({ reason: 'relation_candidates_not_projected', count: data.relationCandidates.length, scope: 'snapshot' });
  if (data.relationCandidates === undefined) unknowns.push({ reason: 'relation_candidates_unavailable', count: null });
  if (data.coverage?.status !== 'complete') unknowns.push({ reason: 'partial_coverage', coverage: data.coverage ?? { status: 'unknown' } });
  unknowns.push({ reason: 'runtime_not_projected' });
  const evidenceIds = [...usedEvidence].sort(), sourceFiles = [...verified].map(([path, { file }]) => ({ path, source_digest: file.source_digest })).sort((a, b) => a.path.localeCompare(b.path));
  const binding = { repository: data.repository, repository_url: repositoryUrl, snapshot: data.snapshot, overlay_hash: data.overlayHash ?? null, revision: data.revision, mainline_id: mainlineId, projector_version: ARCHIFY_PROJECTOR_VERSION };
  const columns = Math.min(nodes.length, nodes.length < 5 ? 2 : 3), rows = Math.ceil(nodes.length / columns);
  const stageViews = mainline.stages.length <= 5 ? mainline.stages.map((s, i) => ({ id: 'stage-' + i, label: s.title, focus: nodes.filter(n => n.stages.some(t => t.id === s.id)).map(n => n.id), note: '阶段为 llm_inferred、未验证；节点与连线只来自当前源码投影。' })) : [];
  const spec = { schema_version: 1, diagram_type: 'architecture', meta: { title: mainline.title + ' · 源码主线', locale: 'zh-CN', quality_profile: 'showcase', viewBox: [columns * 460 + 80, rows * 270 + 140], ...(stageViews.length ? { views: stageViews } : {}), repository: { url: repositoryUrl, revision: data.revision, link_mode: 'local-only' } },
    layout: { mode: 'grid', cols: columns, cellW: 300, cellH: 140, gapX: 160, gapY: 130, origin: [80, 80] },
    components: nodes.map((n, index) => ({ id: n.id, type: 'backend', label: n.qualified_name, sublabel: n.file_path + ' · L' + n.line,
      tag: n.stages[0].title + ' · 推断阶段', size: [300, 140], row: Math.floor(index / columns), col: index % columns,
      sources: [{ path: n.file_path, line: n.line, end_line: n.end_line, label: '源码声明' }] })),
    connections: edges.map(e => {
      const from = nodes.findIndex(n => n.id === e.from), to = nodes.findIndex(n => n.id === e.to);
      const edge = { id: e.id, from: e.from, to: e.to, label: e.basis === 'compiler_exact' ? '已解析调用' : '静态可能调用' };
      // Diagnosed skip-column edges must use the free corridor below their row.
      if (Math.floor(from / columns) === Math.floor(to / columns) && Math.abs(from - to) > 1) {
        const y = 80 + Math.floor(from / columns) * 270 + 220;
        Object.assign(edge, { fromSide: 'bottom', toSide: 'bottom', via: [[230 + (from % columns) * 460, y], [230 + (to % columns) * 460, y]] });
      }
      if (from % columns === to % columns && Math.abs(Math.floor(from / columns) - Math.floor(to / columns)) === 1) {
        edge.labelAt = [230 + (from % columns) * 460, 80 + Math.min(Math.floor(from / columns), Math.floor(to / columns)) * 270 + 205];
      }
      return edge;
    }),
    cards: [{ dot: 'slate', title: '来源与边界', items: [`Snapshot ${data.snapshot.slice(0, 12)} · ${nodes.length} 个定义 · ${edges.length} 条调用 · ${evidenceIds.length} 条 Evidence。`, `Coverage ${data.coverage?.status ?? 'unknown'} · ${unknowns.length} 项边界；阶段为 llm_inferred、未验证，连线不代表执行顺序。`] }] };
  const input = { binding, mainline, definitions: keys.map(k => definitions.get(k)), facts: (data.facts ?? []).filter(f => f.kind === 'call_target' && included.has(f.subject?.definition_key)), sourceFiles, evidence: evidenceIds.map(id => data.evidence[id]), coverage: data.coverage ?? null, relationCandidates: data.relationCandidates ?? null };
  return { schema: 'reader-archify-projection-v1', binding, input_sha256: await readerArchifyDigest(input), spec, nodes, edges, unknowns, coverage: data.coverage ?? { status: 'unknown' }, sourceFiles,
    evidence: Object.fromEntries(evidenceIds.map(id => [id, data.evidence[id]])) };
}

export async function createArchifyMainlineSpec(data, mainlineId) {
  return (await createArchifyProjection(data, mainlineId)).spec;
}
