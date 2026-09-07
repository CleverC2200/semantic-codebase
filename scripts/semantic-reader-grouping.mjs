import { createHash } from 'node:crypto';
import { readerCanonicalJson } from './semantic-reader-comparison.mjs';

const STRATEGY = 'reader-groups-v1';
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : readerCanonicalJson(value)).digest('hex');
const sorted = values => [...new Set(values)].sort();
const neutralWords = new Set('src lib app apps core util utils helper helpers index main init get set add remove create update delete read write save load build make run handle process parse validate normalize to from with for is has on of in by a an the ts js py function method class default'.split(' '));
const supportWords = new Set('cache config configuration log logger logging auth authentication serialize serialization lock mutex pool thread process telemetry metric metrics test testing cli sql database connection transport retry'.split(' '));
const words = text => sorted(String(text).replace(/([a-z\d])([A-Z])/g,'$1 $2').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>2&&!neutralWords.has(w)));

// Pure projection of frozen reading facts. This never loads or executes source modules.
export function groupReaderData(data, options = {}) {
  if (data?.schema !== 'reader-snapshot-v1' || !data.repository || !data.snapshot || !data.overlayHash) throw new Error('GROUPING_INVALID_INPUT');
  if (!['files','definitions','facts'].every(k=>Array.isArray(data[k])) || !data.evidence || typeof data.evidence !== 'object' || Array.isArray(data.evidence) || data.files.some(f=>!f || typeof f.path!=='string') || data.definitions.some(d=>!d || typeof d.definition_key!=='string' || typeof d.file_path!=='string') || data.facts.some(f=>!f || typeof f.kind!=='string')) throw new Error('GROUPING_INVALID_INPUT');
  if (new Set(data.files.map(f=>f.path)).size!==data.files.length || new Set(data.definitions.map(d=>d.definition_key)).size!==data.definitions.length) throw new Error('GROUPING_DUPLICATE_IDENTITY');
  const limits = { maxDefinitions:10000, maxLinks:50000, maxProposals:200, ...options };
  if (Object.keys(options).some(k=>!['maxDefinitions','maxLinks','maxProposals'].includes(k)) || Object.values(limits).some(v=>!Number.isSafeInteger(v)||v<0)) throw new Error('GROUPING_INVALID_LIMIT');
  const files = new Map(data.files.map(f => [f.path, f]));
  const verifiedFiles = new Set(data.files.filter(f => f.verified && typeof f.source === 'string' && hash(f.source) === f.source_digest).map(f => f.path));
  const validSpan = (span, file) => span && Number.isInteger(span.start_byte) && Number.isInteger(span.end_byte) && span.start_byte >= 0 && span.end_byte >= span.start_byte && span.end_byte <= Buffer.byteLength(file.source, 'utf8');
  const validEvidence = eid => {
    const e = data.evidence[eid], file = files.get(e?.file_path);
    return Boolean(e && e.evidence_id === eid && verifiedFiles.has(e.file_path) && e.source_digest === file.source_digest && (e.snapshot_id === undefined || e.snapshot_id === data.snapshot) && validSpan(e.span, file));
  };
  const id = (kind, value) => 'auto:' + kind + ':' + hash([data.repository, value]).slice(0, 24);
  const unassigned = [], modules = new Map();
  let examined = 0;
  for (const d of [...data.definitions].sort((a,b)=>a.definition_key.localeCompare(b.definition_key))) {
    if (examined++ >= limits.maxDefinitions) { unassigned.push({definition_key:d.definition_key,file_path:d.file_path,reason:'definition_budget_exceeded'}); continue; }
    const file = files.get(d.file_path);
    if (!verifiedFiles.has(d.file_path)) {
      unassigned.push({ definition_key: d.definition_key, file_path: d.file_path, reason: 'source_unavailable_or_changed' }); continue;
    }
    if (d.snapshot_id !== data.snapshot) {
      unassigned.push({ definition_key: d.definition_key, file_path: d.file_path, reason: 'definition_version_mismatch' }); continue;
    }
    if (!validSpan(d.definition_span, file) || !d.evidence_ids?.length || !d.evidence_ids.every(validEvidence) || !d.evidence_ids.some(eid => data.evidence[eid].file_path === d.file_path && data.evidence[eid].span.start_byte >= d.definition_span.start_byte && data.evidence[eid].span.end_byte <= d.definition_span.end_byte)) {
      unassigned.push({ definition_key: d.definition_key, file_path: d.file_path, reason: 'definition_evidence_unavailable' }); continue;
    }
    let module = modules.get(d.file_path);
    if (!module) {
      module = { id: id('file', d.file_path), kind: 'module', category: 'structural_module', parent: id('root', 'modules'), title: d.file_path,
        description: '按冻结文件与声明归属组织的结构模块；业务职责待核验。', file_path: d.file_path,
        source_digests: { [d.file_path]: file.source_digest }, definitions: [], uses: [], mainlines: [],
        origin: 'automatic', basis: 'framework_heuristic', strategy: STRATEGY, snapshot: data.snapshot, overlay_hash: data.overlayHash,
        reasons: [{ rule: 'source_file_ownership', description: '声明属于此冻结文件；辅助与孤立定义同样保留。', evidence_ids: [] }], verified: false };
      modules.set(d.file_path, module);
    }
    module.definitions.push(d.definition_key);
    module.reasons[0].evidence_ids.push(...(d.evidence_ids ?? []));
  }
  const groups = [...modules.values()].sort((a,b)=>a.file_path.localeCompare(b.file_path));
  for (const c of groups) c.reasons[0].evidence_ids = sorted(c.reasons[0].evidence_ids);
  const definitions = new Map(data.definitions.map(d=>[d.definition_key,d]));
  const owner = new Map(groups.flatMap(c=>c.definitions.map(key=>[key,c])));
  const links = [], unknownLinks = [];
  const callInputs = data.facts.filter(f=>f.kind==='call_target').sort((a,b)=>String(a.fact_id ?? hash(a)).localeCompare(String(b.fact_id ?? hash(b))));
  const importInputs = [...(data.groupingRelations ?? data.relations ?? [])].filter(r=>r.kind==='IMPORTS').sort((a,b)=>String(a.relation_id ?? hash(a)).localeCompare(String(b.relation_id ?? hash(b))));
  const truncatedLinks = Math.max(0,callInputs.length+importInputs.length-limits.maxLinks);
  for (const fact of callInputs.slice(0,limits.maxLinks)) {
    const source = definitions.get(fact.subject?.definition_key), target = definitions.get(fact.value?.target_definition_key);
    const from = owner.get(source?.definition_key), to = owner.get(target?.definition_key);
    const site = data.evidence[fact.value?.call_site_evidence_id];
    let reason = null;
    if (!target) reason = 'unresolved_call_target';
    else if (!from || !to) reason = 'call_owner_unavailable';
    else if ((fact.snapshot_id !== undefined && fact.snapshot_id !== data.snapshot) || !['compiler_exact','static_possible','framework_heuristic'].includes(fact.basis?.kind) || !fact.evidence_ids?.length || !fact.evidence_ids.every(validEvidence) || !validEvidence(fact.value?.call_site_evidence_id) || site.file_path !== source.file_path || site.span.start_byte < source.definition_span.start_byte || site.span.end_byte > source.definition_span.end_byte) reason = 'call_evidence_unavailable';
    if (reason) { unknownLinks.push({ fact_id: fact.fact_id, definition_key: source?.definition_key ?? null, reason }); continue; }
    const evidence_ids = sorted([...fact.evidence_ids, ...target.evidence_ids]);
    links.push({ from: from.id, to: to.id, source_definition_key: source.definition_key, target_definition_key: target.definition_key, kind: 'call', basis: fact.basis.kind, evidence_ids });
    if (from !== to) {
      from.uses = sorted([...from.uses, to.id]);
      from.reasons.push({ rule: 'resolved_call_use', description: `已解析调用目标位于 ${target.file_path}；这是使用关联，不自动合并归属。`, evidence_ids });
    }
  }
  for (const relation of importInputs.slice(0,Math.max(0,limits.maxLinks-callInputs.length))) {
    const from = relation.source?.kind === 'definition' ? owner.get(relation.source.definition_key) : modules.get(relation.source?.file_path);
    const to = relation.target?.kind === 'definition' ? owner.get(relation.target.definition_key) : modules.get(relation.target?.file_path);
    if (!from || !to || relation.snapshot_id !== data.snapshot || !relation.evidence_ids?.length || !relation.evidence_ids.every(validEvidence) || !relation.evidence_ids.some(eid=>data.evidence[eid].file_path===from.file_path)) {
      unknownLinks.push({ relation_id: relation.relation_id, reason: 'import_evidence_or_owner_unavailable' }); continue;
    }
    const evidence_ids = sorted(relation.evidence_ids);
    links.push({ from: from.id, to: to.id, kind: 'import', basis: 'compiler_exact', evidence_ids });
    if (from !== to) {
      from.uses = sorted([...from.uses, to.id]);
      from.reasons.push({ rule: 'resolved_import_use', description: `冻结导入指向 ${to.file_path}；不据此合并职责。`, evidence_ids });
    }
  }
  // A repeated name is only a naming signal. Require a resolved connection and a path signal too.
  const topics = new Map();
  for (const link of links.filter(l=>l.kind==='call'&&l.source_definition_key!==l.target_definition_key)) {
    const a = definitions.get(link.source_definition_key), b = definitions.get(link.target_definition_key);
    if (![a,b].every(d=>['function','method'].includes(d.kind))) continue;
    const bWords = new Set(words(b.qualified_name)), pathWords = new Set([...words(a.file_path), ...words(b.file_path)]);
    for (const token of words(a.qualified_name).filter(w=>bWords.has(w)&&pathWords.has(w))) {
      if (!topics.has(token)) topics.set(token, []);
      topics.get(token).push(link);
    }
  }
  const proposals = []; let truncatedProposals = 0;
  for (const [token, topicLinks] of [...topics].sort(([a],[b])=>a.localeCompare(b))) {
    const clusters = [];
    for (const link of topicLinks) {
      const matches = clusters.filter(c=>c.keys.has(link.source_definition_key)||c.keys.has(link.target_definition_key));
      const cluster = { keys: new Set([link.source_definition_key,link.target_definition_key]), links: [link] };
      for (const c of matches) { for (const key of c.keys) cluster.keys.add(key); cluster.links.push(...c.links); clusters.splice(clusters.indexOf(c),1); }
      clusters.push(cluster);
    }
    for (const cluster of clusters) {
      if (proposals.length >= limits.maxProposals) { truncatedProposals++; continue; }
      const keys = sorted(cluster.keys), members = keys.map(k=>definitions.get(k)), evidence_ids = sorted(cluster.links.flatMap(l=>l.evidence_ids));
      proposals.push({ id:id('topic',[token,members.map(d=>[d.file_path,d.qualified_name,d.definition_span,d.definition_key])]), parent:id('root','proposals'), kind:'feature',
        category:supportWords.has(token)?'support_candidate':'business_candidate', title:(supportWords.has(token)?'支撑实现：':'职责建议：')+token,
        description:`多个相连声明与源码路径共同出现“${token}”；这是职责命名建议，具体业务含义未确认。`,
        source_digests:Object.fromEntries(sorted(evidence_ids.map(eid=>data.evidence[eid].file_path)).map(p=>[p,files.get(p).source_digest])),
        definitions:[], suggested_definitions:keys, uses:sorted(keys.map(k=>owner.get(k).id)), mainlines:[],
        origin:'automatic', basis:'framework_heuristic', strategy:STRATEGY, snapshot:data.snapshot, overlay_hash:data.overlayHash, verified:false,
        reasons:[{rule:'name_path_and_connected_definitions',description:`声明命名、路径词元与已解析调用共同支持“${token}”候选；使用模块不等于合并模块归属。`,evidence_ids}],
      });
    }
  }
  const mainlines = (data.mainlines ?? []).map(m => {
    const valid = m.available && m.snapshot === data.snapshot && m.stages?.length && m.stages.every(s=>s.refs?.length && Array.isArray(s.keys) && readerCanonicalJson(sorted(s.keys)) === readerCanonicalJson(sorted(s.refs.map(r=>r.definition_key))) && s.refs.every(ref=>{
      const d = definitions.get(ref.definition_key), file = files.get(ref.file);
      if (!d || !owner.has(d.definition_key) || d.file_path !== ref.file || ref.snapshot !== data.snapshot || ref.source_digest !== file?.source_digest || m.source_digests?.[ref.file] !== file?.source_digest || !ref.excerpt) return false;
      const bytes = Buffer.from(file.source), line = bytes.subarray(0,d.definition_span.start_byte).toString('utf8').split('\n').length;
      const endLine = bytes.subarray(0,d.definition_span.end_byte).toString('utf8').split('\n').length;
      return Number.isInteger(ref.startLine) && Number.isInteger(ref.endLine) && ref.startLine >= line && ref.endLine <= endLine && file.source.split('\n').slice(ref.startLine-1,ref.endLine).join('\n').includes(ref.excerpt);
    }));
    return valid ? m : { ...m, available:false, unavailable:'主线来源版本或函数片段无法核对。', stages:[], edges:[] };
  });
  for (const c of [...groups,...proposals]) {
    const keys = new Set(c.suggested_definitions ?? c.definitions);
    c.mainlines = mainlines.filter(m=>m.available&&m.stages.some(s=>s.refs.some(ref=>keys.has(ref.definition_key)))).map(m=>m.id).sort();
  }
  const root = { id: id('root', 'modules'), kind: 'system', category: 'structural_root', parent: null, title: '结构模块',
    description: '自动生成的源码组织，不代表已理解全部业务。', source_digests: Object.assign({}, ...groups.map(c=>c.source_digests)),
    definitions: [], origin: 'automatic', basis: 'framework_heuristic', strategy: STRATEGY, snapshot: data.snapshot, overlay_hash: data.overlayHash };
  const directories = new Map();
  for (const c of groups) {
    const parts = c.file_path.split('/'); c.title = parts.pop();
    let parent = root.id;
    for (let i = 0; i < parts.length; i++) {
      const directory = parts.slice(0, i + 1).join('/');
      if (!directories.has(directory)) directories.set(directory, { ...root, id: id('directory', directory), kind: 'module', category: 'structural_directory', parent, title: parts[i], description: '源码目录组织；此层级不代表业务能力。', source_digests: {} });
      const group = directories.get(directory); Object.assign(group.source_digests, c.source_digests); parent = group.id;
    }
    c.parent = parent;
  }
  const proposalRoot = { ...root, id:id('root','proposals'), category:'proposal_root', title:'职责建议', description:'多信号支持的业务或支撑实现建议；仍需人工核验。', source_digests:Object.assign({},...proposals.map(c=>c.source_digests)) };
  const manualMappings = data.manualMappings ?? (data.capabilityCandidates ?? []).filter(c=>c.origin!=='automatic').map(c=>({...c,origin:'manual_configuration',verified:false}));
  const candidates = groups.length ? [root, ...directories.values(), ...groups, ...(proposals.length?[proposalRoot,...proposals]:[])] : [];
  for (const c of candidates) c.generation_limits = limits;
  return { ...data, mainlines, manualMappings, capabilityCandidates: candidates, grouping: {
    schema: 'reader-grouping-v1', strategy: STRATEGY, snapshot: data.snapshot, overlay_hash: data.overlayHash, origin: 'automatic', manual_mapping_count:manualMappings.length,
    limits, truncated_links:truncatedLinks, truncated_proposals:truncatedProposals, status:unassigned.length||unknownLinks.length||truncatedLinks||truncatedProposals||data.coverage?.status!=='complete'?'partial':'complete',
    unassigned, links, unknown_links: unknownLinks, coverage: { structural: { total: data.definitions.length, mapped: data.definitions.length - unassigned.length, status: unassigned.length ? 'partial' : 'complete' }, business: { status: proposals.length?'partial':'unknown', candidate_count:proposals.length, reason: 'module_ownership_is_not_business_understanding' } },
  } };
}
