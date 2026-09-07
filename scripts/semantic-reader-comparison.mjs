// Canonical JSON compatible with the contract serializer; used only to check imported observation integrity.
export function readerCanonicalJson(value) {
  const normalize = v => {
    if (typeof v === 'string') return v.normalize('NFC');
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k.normalize('NFC'), normalize(v[k])]));
    return v;
  };
  return JSON.stringify(normalize(value));
}
// Snapshot bundles are local reading artifacts, not a replacement for Enrichment Admission.
export async function validateReaderBundle(input) {
  if (input?.schema !== 'reader-snapshot-v1' || typeof input.repository !== 'string' || !input.repository || typeof input.snapshot !== 'string' || !input.snapshot ||
    !Array.isArray(input.files) || !Array.isArray(input.definitions) || !Array.isArray(input.facts) || !input.evidence || typeof input.evidence !== 'object') throw new Error('READER_INVALID_BUNDLE');
  if (input.files.length > 5000 || input.definitions.length > 50000 || input.facts.length > 100000) throw new Error('READER_BUNDLE_BUDGET');
  const files = new Map();
  for (const file of input.files) {
    if (typeof file.path !== 'string' || files.has(file.path) || typeof file.source_digest !== 'string') throw new Error('READER_INVALID_SOURCE');
    if (file.verified) {
      if (typeof file.source !== 'string') throw new Error('READER_SOURCE_UNAVAILABLE');
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(file.source)))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== file.source_digest) throw new Error('READER_SOURCE_DIGEST_MISMATCH');
    } else if (file.source !== null) throw new Error('READER_UNVERIFIED_SOURCE_CONTENT');
    files.set(file.path, file);
  }
  const keys = new Set();
  for (const d of input.definitions) {
    if (typeof d.definition_key !== 'string' || keys.has(d.definition_key) || typeof d.qualified_name !== 'string' || !files.has(d.file_path)) throw new Error('READER_INVALID_DEFINITION');
    keys.add(d.definition_key);
    const file = files.get(d.file_path), span = d.definition_span;
    if (!span || !Number.isInteger(span.start_byte) || !Number.isInteger(span.end_byte) || span.start_byte < 0 || span.end_byte < span.start_byte) throw new Error('READER_INVALID_SPAN');
    if (file.verified && span.end_byte > new TextEncoder().encode(file.source).length) throw new Error('READER_INVALID_SPAN');
  }
  for (const [id, e] of Object.entries(input.evidence)) {
    const file = files.get(e.file_path);
    if (e.evidence_id !== id || !file || e.source_digest !== file.source_digest || !e.span || e.span.start_byte < 0 || e.span.end_byte < e.span.start_byte || (file.verified && e.span.end_byte > new TextEncoder().encode(file.source).length)) throw new Error('READER_INVALID_EVIDENCE');
  }
  for (const f of input.facts) {
    if (!f.subject || (f.subject.kind === 'definition' && !keys.has(f.subject.definition_key)) || !f.value || !Array.isArray(f.evidence_ids) || f.evidence_ids.some(id => !input.evidence[id])) throw new Error('READER_EVIDENCE_NOT_CLOSED');
  }
  let runtimeBinding = { valid: false, reason: 'runtime_unavailable' };
  if (input.runtime) {
    const { observation_set_hash, ...body } = input.runtime;
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(readerCanonicalJson(body))))].map(b => b.toString(16).padStart(2, '0')).join('');
    const valid = digest === observation_set_hash && body.repository_id === input.repository && body.snapshot_id === input.snapshot && body.semantic_overlay_hash === input.overlayHash && Array.isArray(body.observations) && body.observations.every(o => o.execution_id === body.execution_id);
    runtimeBinding = { valid, reason: valid ? null : 'runtime_hash_or_version_mismatch' };
  }
  return { ...input, runtimeBinding };
}

export function compareReaderSnapshots(base, target, { correspondences = [] } = {}) {
  if (!base?.snapshot || !target?.snapshot || base.repository !== target.repository) throw new Error('READER_COMPARISON_SCOPE_MISMATCH');
  const before = new Map(base.definitions.map(d => [d.definition_key, d])), after = new Map(target.definitions.map(d => [d.definition_key, d]));
  const oldFiles = new Map(base.files.map(f => [f.path, f])), newFiles = new Map(target.files.map(f => [f.path, f]));
  const matchedOld = new Set(), matchedNew = new Set(), changes = [];
  function source(file, d) {
    if (!file?.verified || typeof file.source !== 'string' || !d?.definition_span) return null;
    const span = d.definition_span, bytes = new TextEncoder().encode(file.source);
    if (span.start_byte < 0 || span.end_byte > bytes.length || span.end_byte < span.start_byte) return null;
    return new TextDecoder().decode(bytes.subarray(span.start_byte, span.end_byte));
  }
  function pair(a, b, matching) {
    const left = a ? source(oldFiles.get(a.file_path), a) : null, right = b ? source(newFiles.get(b.file_path), b) : null;
    const kind = a && b ? left === null || right === null ? 'source_unavailable' : left === right ? 'unchanged' : 'modified' : a ? 'removed' : 'added';
    changes.push({ id: 'change:' + changes.length, kind, before: a ?? null, after: b ?? null, beforeSource: left, afterSource: right, matching });
    if (a) matchedOld.add(a.definition_key); if (b) matchedNew.add(b.definition_key);
  }
  for (const mapping of correspondences) {
    if (mapping.baseSnapshot !== base.snapshot || mapping.targetSnapshot !== target.snapshot || !mapping.actor?.trim() || !mapping.reason?.trim() ||
      !before.has(mapping.baseKey) || !after.has(mapping.targetKey) || matchedOld.has(mapping.baseKey) || matchedNew.has(mapping.targetKey)) throw new Error('READER_INVALID_CORRESPONDENCE');
    pair(before.get(mapping.baseKey), after.get(mapping.targetKey), { kind: 'human_correspondence', actor: mapping.actor, reason: mapping.reason });
  }
  for (const d of before.values()) {
    if (matchedOld.has(d.definition_key)) continue;
    const file = oldFiles.get(d.file_path), updated = newFiles.get(d.file_path);
    if (!file?.verified || !updated?.verified || file.source_digest !== updated.source_digest) continue;
    const candidates = target.definitions.filter(n => !matchedNew.has(n.definition_key) && n.file_path === d.file_path && n.kind === d.kind &&
      n.definition_span?.start_byte === d.definition_span?.start_byte && n.definition_span?.end_byte === d.definition_span?.end_byte);
    if (candidates.length === 1) pair(d, candidates[0], { kind: 'unchanged_file_span' });
  }
  for (const d of before.values()) if (!matchedOld.has(d.definition_key)) pair(d, null, { kind: 'unconfirmed' });
  for (const d of after.values()) if (!matchedNew.has(d.definition_key)) pair(null, d, { kind: 'unconfirmed' });
  const paths = [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort();
  const files = paths.map(path => ({ path, before: oldFiles.get(path) ?? null, after: newFiles.get(path) ?? null,
    kind: !oldFiles.has(path) ? 'added' : !newFiles.has(path) ? 'removed' : oldFiles.get(path).source_digest === newFiles.get(path).source_digest ? 'unchanged' : 'modified' }));
  return { baseSnapshot: base.snapshot, targetSnapshot: target.snapshot, repository: base.repository, changes, files,
    coverage: { base: base.coverage, target: target.coverage }, unknowns: changes.some(c => c.matching.kind === 'unconfirmed') ? ['definition_correspondence_unconfirmed'] : [] };
}

// Conservative token comparison: retain line breaks (ASI), strings and operator boundaries.
// Template and regular-expression literals are withheld rather than guessed.
function readerCodeTokens(source) {
  if (typeof source !== 'string') return null;
  const tokens = []; let i = 0;
  while (i < source.length) {
    const c = source[i], next = source[i + 1];
    if (c === '\n' || c === '\r') { tokens.push('\n'); i += c === '\r' && next === '\n' ? 2 : 1; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '`') return null;
    if (c === '/' && next === '/') { i += 2; while (i < source.length && !/[\r\n]/.test(source[i])) i++; continue; }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2); if (end < 0) return null;
      const comment = source.slice(i + 2, end); for (const ignored of comment.match(/\r\n|\r|\n/g) ?? []) tokens.push('\n');
      i = end + 2; continue;
    }
    if (c === '/') return null;
    if (c === '"' || c === "'") {
      const start = i++, quote = c; let closed = false;
      while (i < source.length) { if (source[i] === '\\') { i += 2; continue; } if (source[i++] === quote) { closed = true; break; } }
      if (!closed) return null; tokens.push(source.slice(start, i)); continue;
    }
    const match = source.slice(i).match(/^(?:[$\p{ID_Start}][$\p{ID_Continue}]*|\d+(?:\.\d+)?|===|!==|=>|==|!=|>=|<=|\+\+|--|&&|\|\||\?\?|\?\.|\*\*|<<|>>|\+=|-=|\*=|&=|\|=)/u);
    if (match) { tokens.push(match[0]); i += match[0].length; } else { tokens.push(c); i++; }
  }
  return JSON.stringify(tokens);
}

export function describeReaderChange(change, base, target) {
  if (!change.before || !change.after || change.beforeSource === null || change.afterSource === null) return { classification: 'unknown', items: [], checks: ['先核对定义对应与双侧源码，不能据此确认行为变化。'] };
  const left = readerCodeTokens(change.beforeSource), right = readerCodeTokens(change.afterSource);
  const own = (data, d) => data.facts.filter(f => f.subject.definition_key === d.definition_key);
  const beforeFacts = own(base, change.before), afterFacts = own(target, change.after);
  const items = [];
  function compare(kind, before, after, oldFacts = [], newFacts = []) {
    if (JSON.stringify(before) !== JSON.stringify(after)) items.push({ kind, before, after, status: 'static_possible', beforeFacts: oldFacts, afterFacts: newFacts });
  }
  compare('contract', change.before.rawType ?? change.before.signature ?? null, change.after.rawType ?? change.after.signature ?? null,
    beforeFacts.filter(f => f.kind === 'symbol_type'), afterFacts.filter(f => f.kind === 'symbol_type'));
  for (const [kind, blockKinds] of [['conditions', ['branch', 'loop']], ['returns', ['return', 'throw']]]) {
    const a = beforeFacts.filter(f => f.kind === 'control_flow'), b = afterFacts.filter(f => f.kind === 'control_flow');
    const project = facts => facts.flatMap(f => f.value.blocks.filter(block => blockKinds.includes(block.kind)).map(block => block.source_excerpt ?? block.kind)).sort();
    compare(kind, project(a), project(b), a, b);
  }
  const effects = facts => facts.filter(f => f.kind === 'effect' && !['return', 'throw', 'await'].includes(f.value.effect_kind));
  const operations = facts => effects(facts).map(f => ({ kind: f.value.effect_kind, operation: f.value.operation ?? null })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  compare('writes', operations(beforeFacts), operations(afterFacts), effects(beforeFacts), effects(afterFacts));
  const classification = change.kind === 'unchanged' && !items.length ? 'unchanged' : left !== null && left === right && !items.length ? 'comments_or_spacing_only' : items.length ? 'supported_fact_changes' : 'behavior_unknown';
  const directions = { contract: '核对调用方参数和返回值兼容性。', conditions: '验证条件边界、默认值和失败分支。', returns: '核对提前返回与异常处理。', writes: '核对状态一致性、重复执行和恢复边界。' };
  return { classification, items, checks: items.length ? [...new Set(items.map(i => directions[i.kind]))] : classification === 'comments_or_spacing_only' ? ['支持的词法范围内仅注释或空白变化；长期业务重要性仍保留。'] : ['未识别到支持种类的行为差异；不等于行为不变。'] };
}

export function reviewReaderChange(change, base, target, { impact = null, verificationRecords = [] } = {}) {
  const behavior = describeReaderChange(change, base, target), key = change.after?.definition_key ?? change.before?.definition_key;
  const keys = [change.before?.definition_key, change.after?.definition_key].filter(Boolean);
  const verification = verificationRecords.filter(r => r.repository === target.repository && r.baseSnapshot === base.snapshot && r.targetSnapshot === target.snapshot &&
    r.id && typeof r.artifact === 'string' && r.artifact && ['static_check', 'local_test', 'mock_test', 'runtime_observed'].includes(r.kind) &&
    ['passed', 'failed', 'unknown'].includes(r.status) && r.definitionKeys?.some(k => keys.includes(k)));
  const observation = target.runtime;
  const runtimeObserved = Boolean(target.runtimeBinding?.valid && observation?.snapshot_id === target.snapshot && observation?.repository_id === target.repository &&
    verification.some(r => r.kind === 'runtime_observed' && r.executionId === observation.execution_id && observation.observations?.some(o => o.definition_key === key)));
  const acceptedImpact = impact?.snapshot === (change.after ? target.snapshot : base.snapshot) && impact?.root === key ? impact : null;
  const checked = new Set(verification.filter(r => r.status === 'passed').flatMap(r => r.checks ?? []));
  const gaps = behavior.items.filter(i => !checked.has(i.kind)).map(i => 'verification_missing:' + i.kind);
  if (!runtimeObserved) gaps.push('real_execution_not_proven');
  if (!verification.length) gaps.push('no_applicable_verification_record');
  if (!acceptedImpact) gaps.push('impact_scope_unavailable');
  return { behavior, impact: acceptedImpact, verification, runtimeObserved, gaps, status: 'review_required' };
}
