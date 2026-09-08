// Search is a presentation projection, not a new source of facts or confirmed entries.
export function readerSearchIndex(data) {
  const files = new Map((data.files ?? []).map(f => [f.path, f]));
  const currentPresentation = (p, file, d) => Boolean(p && file?.verified &&
    p.snapshot === data.snapshot && p.source_digest === file.source_digest &&
    (!d || (p.definition_key === d.definition_key && p.content_hash === d.content_hash && d.snapshot_id === data.snapshot)));
  const entries = [
    ...(data.files ?? []).map(f => ({ type: 'file', key: f.path, title: f.path.split('/').pop(), subtitle: f.path,
      searchName: f.path, purpose: currentPresentation(f.presentation, f) ? [f.presentation.purpose, f.presentation.role].filter(Boolean).join('；') : '' })),
    (data.definitions ?? []).filter(d => ['function', 'method'].includes(d.kind)).map(d => {
      const p = currentPresentation(d.presentation, files.get(d.file_path), d) ? d.presentation : null;
      return { type: 'fn', key: d.definition_key, title: d.qualified_name, subtitle: d.file_path,
        searchName: d.qualified_name + ' ' + d.file_path, purpose: p?.purpose ?? '', details: p ? [p.logic, p.output, ...(p.steps ?? []).map(s => s.description)].filter(Boolean).join('；') : '' };
    }),
    (data.mainlines ?? []).filter(m => m.available && m.snapshot === data.snapshot).map(m => ({
      type: 'mainline', key: m.id, title: m.title, subtitle: m.purpose, searchName: m.title, purpose: m.purpose ?? '', details: [m.trigger, m.input, m.output, m.boundary, ...(m.stages ?? []).flatMap(s => [s.title, s.description])].filter(Boolean).join('；'),
      relatedKeys: [...new Set((m.stages ?? []).flatMap(s => s.keys ?? []))],
      relatedFiles: [...new Set((m.stages ?? []).flatMap(s => s.refs ?? []).filter(r => files.get(r.file)?.verified && files.get(r.file).source_digest === r.source_digest).map(r => r.file))] })),
  ].flat();
  for (const entry of entries) {
    entry.aliases = (data.searchAliases ?? []).filter(a => a.type === entry.type && a.key === entry.key &&
      a.snapshot === data.snapshot && typeof a.text === 'string' && a.review?.actor?.trim() && a.review?.reason?.trim() &&
      Object.keys(a.source_digests ?? {}).length > 0 && Object.entries(a.source_digests).every(([path, digest]) => files.get(path)?.verified && files.get(path).source_digest === digest))
      .map(a => a.text);
  }
  const frequencies = new Map();
  for (const item of entries) for (const term of readerSearchTerms([item.title, item.purpose, item.details, ...item.aliases].join(' '))) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  Object.defineProperty(entries, 'termWeights', { value: new Map([...frequencies].map(([term, count]) => [term, Math.log(1 + entries.length / count)])) });
  return entries;
}

function readerSearchTerms(text) {
  return [...new Set((text.toLowerCase().match(/[\p{Script=Han}]{2,}/gu) ?? []).flatMap(chunk =>
    Array.from({ length: chunk.length - 1 }, (_, i) => chunk.slice(i, i + 2))))]
    .filter(s => !['如何', '怎么', '怎样', '为何', '哪里', '是否', '什么', '哪个', '时候', '以后', '以前', '一次', '可以', '进行'].includes(s));
}

export function searchReaderObjects(data, text, index = readerSearchIndex(data)) {
  const q = text.trim().toLowerCase().slice(0, 256);
  if (!q) return [];
  const fragments = readerSearchTerms(q);
  const ranked = index.flatMap(item => {
    const name = item.searchName.toLowerCase(), purpose = item.purpose.toLowerCase(), details = (item.details ?? '').toLowerCase();
    const alias = item.aliases.filter(a => q.includes(a.toLowerCase())).sort((a, b) => b.length - a.length)[0];
    const title = item.title.toLowerCase();
    const overlap = fragments.filter(t => title.includes(t) || purpose.includes(t) || details.includes(t));
    const lexical = overlap.length >= 2 ? overlap.reduce((sum, t) => sum + (index.termWeights?.get(t) ?? 1) *
      (title.includes(t) ? 3 : purpose.includes(t) ? 2 : 1), 0) : 0;
    const score = name === q ? 1000 : title === q ? 900 : alias ? 700 + Math.min(100, alias.length * 4) : name.includes(q) ? 600 :
      purpose.includes(q) ? 500 : Math.min(400, lexical);
    const detailMatch = fragments.filter(t => details.includes(t)).length > fragments.filter(t => purpose.includes(t)).length;
    return score ? [{ ...item, score, snapshot: data.snapshot, entryStatus: 'related_implementation',
      basis: name.includes(q) ? 'identifier' : alias ? 'reviewed_alias' : 'llm_inferred',
      matchReason: name.includes(q) ? '名称或路径匹配' : alias ? '经核对别名：' + alias :
        (detailMatch ? '处理逻辑或主线条件匹配：' + overlap.join('、') : item.purpose) }] : [];
  }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
  // A readable mainline is also a route to its actual source locations. Keep those locations visible
  // even when their generated one-line purpose uses different words from the reader's question.
  const routes = ranked.slice(0, 5).filter(o => o.type === 'mainline');
  const byKey = new Map(ranked.map(o => [o.type + ':' + o.key, o]));
  for (const item of index) {
    const route = routes.find(r => item.type === 'fn' ? r.relatedKeys.includes(item.key) : item.type === 'file' && r.relatedFiles.includes(item.key));
    if (!route) continue;
    const id = item.type + ':' + item.key, previous = byKey.get(id), boost = Math.min(40, route.score * 0.6);
    byKey.set(id, { ...item, ...previous, score: (previous?.score ?? 0) + boost, snapshot: data.snapshot,
      entryStatus: 'related_implementation', basis: previous?.basis ?? 'llm_inferred',
      matchReason: (previous?.matchReason ? previous.matchReason + '；' : '') + '匹配主线的源码位置：' + route.title });
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}

// Controlled answers remain projections of existing, version-bound objects.
export function queryReader(data, question, { capabilities, risk, selectedKey, searchIndex } = {}) {
  const text = question.trim().replace(/[？?。]+$/, '');
  const entry = text.match(/^(.+?)(?:功能)?从哪里进入$/), impact = text.match(/^(.+?)(?:函数)?可能影响哪里$/);
  const result = { snapshot: data.snapshot, scope: 'local_frozen_snapshot', objects: [], evidence: [], unknowns: ['partial_coverage'] };
  if (!entry && !impact) {
    if (/[？?]|哪里|为何|为什么/.test(question)) return { ...result, status: 'unsupported', intent: null,
      objects: searchReaderObjects(data, text, searchIndex), fallback: 'related_objects_only' };
    const objects = searchReaderObjects(data, text, searchIndex);
    return { ...result, objects, status: objects.length ? 'answered' : 'no_match', intent: 'search' };
  }
  const name = (entry ?? impact)[1].trim().replace(/^[“「]|[”」]$/g, '').toLowerCase();
  const intent = entry ? 'entry' : 'impact';
  const candidates = entry ? [
    ...(capabilities?.list() ?? []).filter(c => c.available && c.title.toLowerCase() === name).map(c => ({ type: 'capability', key: c.id, title: c.title, definitionKeys: capabilities.members(c.id) })),
    ...(data.mainlines ?? []).filter(m => m.available && m.snapshot === data.snapshot && m.title.toLowerCase() === name).map(m => ({ type: 'mainline', key: m.id, title: m.title, definitionKeys: m.stages[0]?.keys ?? [], evidence: m.stages[0]?.refs ?? [] })),
  ] : data.definitions.filter(d => ['function', 'method', undefined].includes(d.kind) && d.qualified_name.toLowerCase() === name).map(d => ({ type: 'fn', key: d.definition_key, title: d.qualified_name, subtitle: d.file_path }));
  const chosen = selectedKey ? candidates.filter(c => c.key === selectedKey) : candidates;
  if (!chosen.length) return { ...result, intent, status: 'no_match', name,
    objects: searchReaderObjects(data, name, searchIndex), fallback: 'related_objects_only' };
  if (chosen.length > 1) return { ...result, intent, status: 'ambiguous', name, objects: chosen };
  const object = chosen[0];
  return { ...result, intent, status: 'answered', name, objects: chosen, evidence: object.evidence ?? [],
    ...(impact ? { impact: risk.impact(object.key) } : { unknowns: [...result.unknowns, object.type === 'capability' ? 'capability_members_are_candidate_entries' : 'mainline_entry_is_inferred'] }) };
}
