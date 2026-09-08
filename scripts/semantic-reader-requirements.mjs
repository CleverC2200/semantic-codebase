import { readerCanonicalJson } from './semantic-reader-comparison.mjs';

export async function readerRequirementDigest(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : readerCanonicalJson(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}

function requirementSetValid(set) {
  if (!set || ![set.id, set.version, set.title, set.source].every(x => typeof x === 'string' && x.trim()) ||
    !Array.isArray(set.clauses) || set.clauses.length > 200 || new Set(set.clauses.map(c => c?.id)).size !== set.clauses.length ||
    set.clauses.some(c => !c || ![c.id, c.text, c.source].every(x => typeof x === 'string' && x.trim()))) throw new Error('REQUIREMENT_INVALID_SET');
}

export async function createReaderRequirementReview(data, set, input) {
  requirementSetValid(set);
  if (!set.clauses.some(c => c.id === input.clauseId) || !['supported', 'violated', 'unknown'].includes(input.decision) ||
    ![input.id, input.actor, input.rationale, input.condition].every(x => typeof x === 'string' && x.trim()) ||
    !Array.isArray(input.definitionKeys) || !Array.isArray(input.evidenceIds)) throw new Error('REQUIREMENT_INVALID_REVIEW');
  const definitions = input.definitionKeys.map(key => data.definitions.find(d => d.definition_key === key));
  if (definitions.some(d => !d)) throw new Error('REQUIREMENT_DEFINITION_MISSING');
  const paths = [...new Set([...definitions.map(d => d.file_path), ...input.evidenceIds.map(id => data.evidence[id]?.file_path)])];
  const files = paths.map(path => data.files.find(f => f.path === path));
  if (files.some(f => !f)) throw new Error('REQUIREMENT_SOURCE_MISSING');
  return { id: input.id, clauseId: input.clauseId, decision: input.decision, rationale: input.rationale, condition: input.condition, actor: input.actor,
    setId: set.id, setVersion: set.version, setDigest: await readerRequirementDigest(set), repository: data.repository,
    snapshot: data.snapshot, overlayHash: data.overlayHash ?? null,
    definitionKeys: [...input.definitionKeys], evidenceIds: [...input.evidenceIds],
    sourceDigests: Object.fromEntries(files.map(f => [f.path, f.source_digest])),
    definitionHashes: Object.fromEntries(definitions.map(d => [d.definition_key, d.content_hash])),
    mainlineId: input.mainlineId ?? null, stageId: input.stageId ?? null,
    origin: input.origin === 'llm_inferred' ? 'llm_inferred' : 'local_reader_record', verified: false,
    verification: [], recordedAt: new Date().toISOString() };
}

// Validate references and display a supplied judgement. Valid evidence never creates a judgement by itself.
export async function reviewReaderRequirements(data, document) {
  if (document?.schema !== 'reader-requirements-v1' || !Array.isArray(document.reviews) || document.reviews.length > 1000 ||
    new TextEncoder().encode(JSON.stringify(document)).length > 4 * 1024 * 1024) throw new Error('REQUIREMENT_INVALID_DOCUMENT');
  requirementSetValid(document.set);
  if (new Set(document.reviews.map(r => r?.id)).size !== document.reviews.length || document.reviews.some(r => !r || typeof r.id !== 'string')) throw new Error('REQUIREMENT_DUPLICATE_REVIEW');
  const setDigest = await readerRequirementDigest(document.set);
  const definitions = new Map(data.definitions.map(d => [d.definition_key, d]));
  const files = new Map(data.files.map(f => [f.path, f]));
  const fileHashes = new Map();
  const { observation_set_hash, ...runtime } = data.runtime ?? {};
  const runtimeBound = Boolean(observation_set_hash && await readerRequirementDigest(runtime) === observation_set_hash &&
    runtime.repository_id === data.repository && runtime.snapshot_id === data.snapshot && runtime.semantic_overlay_hash === data.overlayHash &&
    !runtime.coverage?.reason_codes?.includes('trace_source_binding_unverified') && Array.isArray(runtime.observations) &&
    runtime.observations.every(o => o.execution_id === runtime.execution_id));
  async function sourceValid(path, expected) {
    const f = files.get(path);
    if (!f?.verified || typeof f.source !== 'string' || f.source_digest !== expected) return false;
    if (!fileHashes.has(path)) fileHashes.set(path, await readerRequirementDigest(f.source));
    return fileHashes.get(path) === expected;
  }
  const checked = [];
  for (const review of document.reviews) {
    const gaps = [];
    if ((review.definitionKeys !== undefined && (!Array.isArray(review.definitionKeys) || review.definitionKeys.some(k => typeof k !== 'string'))) ||
      (review.evidenceIds !== undefined && (!Array.isArray(review.evidenceIds) || review.evidenceIds.some(k => typeof k !== 'string'))) ||
      (review.verification !== undefined && !Array.isArray(review.verification))) throw new Error('REQUIREMENT_INVALID_REVIEW');
    if (review.repository !== data.repository) gaps.push('repository_mismatch');
    if (review.snapshot !== data.snapshot || (review.overlayHash ?? null) !== (data.overlayHash ?? null)) gaps.push('snapshot_or_overlay_mismatch');
    if (review.setId !== document.set.id || review.setVersion !== document.set.version || review.setDigest !== setDigest) gaps.push('requirement_version_mismatch');
    if (!['supported', 'violated', 'unknown'].includes(review.decision) || typeof review.rationale !== 'string' || !review.rationale.trim() || typeof review.condition !== 'string' || !review.condition.trim()) gaps.push('judgement_incomplete');
    if (!Array.isArray(review.definitionKeys) || !review.definitionKeys.length) gaps.push('definition_missing');
    for (const key of review.definitionKeys ?? []) {
      const d = definitions.get(key), f = files.get(d?.file_path), span = d?.definition_span;
      const bytes = f?.source ? new TextEncoder().encode(f.source) : null;
      if (!d || d.snapshot_id !== data.snapshot || !await sourceValid(d.file_path, review.sourceDigests?.[d.file_path]) ||
        !bytes || !Number.isInteger(span?.start_byte) || !Number.isInteger(span?.end_byte) || span.start_byte < 0 || span.end_byte > bytes.length || span.end_byte <= span.start_byte ||
        review.definitionHashes?.[key] !== d.content_hash || await readerRequirementDigest(new TextDecoder().decode(bytes.subarray(span.start_byte, span.end_byte))) !== d.content_hash) gaps.push('definition_binding_invalid');
    }
    const evidence = [];
    if (!Array.isArray(review.evidenceIds) || !review.evidenceIds.length) gaps.push('evidence_missing');
    for (const id of review.evidenceIds ?? []) {
      const e = data.evidence[id], f = files.get(e?.file_path), span = e?.span;
      const bytes = typeof f?.source === 'string' ? new TextEncoder().encode(f.source) : null;
      if (!e || e.evidence_id !== id || (e.snapshot_id !== undefined && e.snapshot_id !== data.snapshot) ||
        !await sourceValid(e.file_path, review.sourceDigests?.[e.file_path]) || e.source_digest !== f?.source_digest ||
        !bytes || !Number.isInteger(span?.start_byte) || !Number.isInteger(span?.end_byte) || span.start_byte < 0 || span.end_byte > bytes.length || span.end_byte <= span.start_byte) gaps.push('evidence_binding_invalid');
      else evidence.push(e);
    }
    if (review.mainlineId) {
      const flow = data.mainlines?.find(m => m.id === review.mainlineId && m.snapshot === data.snapshot && m.available);
      if (!flow || (review.stageId && !flow.stages.some(s => s.id === review.stageId))) gaps.push('mainline_binding_invalid');
    }
    const bindingValid = gaps.length === 0, verification = [], verificationGaps = [];
    for (const v of review.verification ?? []) {
      if (!v || !['static_check', 'local_test', 'mock_test', 'runtime_observed'].includes(v.kind) || !['passed', 'failed', 'unknown'].includes(v.status) ||
        v.repository !== data.repository || v.snapshot !== data.snapshot || (v.overlayHash ?? null) !== (data.overlayHash ?? null) || v.setDigest !== setDigest ||
        !Array.isArray(v.clauseIds) || !v.clauseIds.includes(review.clauseId) || !Array.isArray(v.definitionKeys) || !v.definitionKeys.length || v.definitionKeys.some(k => !review.definitionKeys?.includes(k)) ||
        typeof v.condition !== 'string' || !v.condition.trim()) { verificationGaps.push('verification_scope_invalid'); continue; }
      if (!v.artifact || typeof v.artifact.name !== 'string' || !v.artifact.name.trim() || typeof v.artifact.content !== 'string' || !v.artifact.content.length ||
        await readerRequirementDigest(v.artifact.content) !== v.artifact.sha256) { verificationGaps.push('verification_artifact_invalid'); continue; }
      verification.push({ ...v, reexecuted: false });
    }
    checked.push({ ...review, verified: false, valid: bindingValid, gaps: [...new Set([...gaps, ...verificationGaps])], evidence, verification });
  }
  const clauses = document.set.clauses.map(clause => {
    const reviews = checked.filter(r => r.clauseId === clause.id), valid = reviews.filter(r => r.valid);
    const supports = valid.some(r => r.decision === 'supported'), violates = valid.some(r => r.decision === 'violated');
    const verification = valid.flatMap(r => r.verification);
    const runtimeObserved = runtimeBound && verification.some(v => v.kind === 'runtime_observed' && v.status === 'passed' && v.executionId === runtime.execution_id &&
      v.definitionKeys.every(key => runtime.observations.some(o => o.definition_key === key)));
    const conflict = (supports && violates) || (supports && verification.some(v => v.status === 'failed'));
    const decision = conflict ? 'unknown' : violates ? 'violated' : supports ? 'supported' : 'unknown';
    return { ...clause, decision, state: conflict ? 'conflict' : reviews.length && !valid.length ? 'needs_review' : 'review_required',
      proofLevel: runtimeObserved ? 'runtime_observation_record' : valid.length && verification.some(v => v.status === 'passed' && ['local_test', 'mock_test'].includes(v.kind)) ? 'local_test_record' : supports || violates ? 'static_support' : 'unknown', runtimeObserved,
      reviews, evidence: [...new Map(valid.flatMap(r => r.evidence).map(e => [e.evidence_id, e])).values()],
      gaps: [...new Set([...reviews.flatMap(r => r.gaps), ...(conflict ? ['conflicting_evidence'] : []), ...(runtimeObserved ? ['imported_observation_not_reexecuted'] : ['real_execution_not_proven'])])] };
  });
  return { set: document.set, setDigest, repository: data.repository, snapshot: data.snapshot, clauses,
    history: checked.filter(r => !document.set.clauses.some(c => c.id === r.clauseId)), verified: false };
}

// Small local library. Existing records are immutable; conflicting IDs cannot overwrite a reader's judgement.
export function mergeReaderRequirementReviews(existing, incoming) {
  const records = new Map(existing.map(r => [r.id, r]));
  for (const r of incoming) {
    if (records.has(r.id) && readerCanonicalJson(records.get(r.id)) !== readerCanonicalJson(r)) throw new Error('REQUIREMENT_RECORD_CONFLICT');
    records.set(r.id, r);
  }
  return [...records.values()];
}

export function createReaderRequirementStore(data, storage) {
  const storageKey = 'semantic-reader:requirements:v1:' + data.repository;
  function documents() {
    const text = storage?.getItem(storageKey);
    if (!text) return [];
    if (new TextEncoder().encode(text).length > 4 * 1024 * 1024) throw new Error('REQUIREMENT_STORAGE_BUDGET');
    const value = JSON.parse(text);
    if (value.schema !== 'reader-requirement-library-v1' || value.repository !== data.repository || !Array.isArray(value.documents) || value.documents.length > 20) throw new Error('REQUIREMENT_INVALID_STORAGE');
    return value.documents;
  }
  async function save(document) {
    if (!storage) throw new Error('REQUIREMENT_STORAGE_UNAVAILABLE');
    const result = await reviewReaderRequirements(data, document);
    if (document.reviews.some(r => r.repository !== data.repository)) throw new Error('REQUIREMENT_REPOSITORY_MISMATCH');
    const entries = documents();
    let index = -1;
    for (let i = 0; i < entries.length; i++) if (await readerRequirementDigest(entries[i].set) === result.setDigest) index = i;
    const incoming = structuredClone(document);
    if (index >= 0) {
      incoming.reviews = mergeReaderRequirementReviews(entries[index].reviews, incoming.reviews);
      entries[index] = incoming;
    } else entries.push(incoming);
    const text = JSON.stringify({ schema: 'reader-requirement-library-v1', repository: data.repository, documents: entries });
    if (entries.length > 20 || new TextEncoder().encode(text).length > 4 * 1024 * 1024) throw new Error('REQUIREMENT_STORAGE_BUDGET');
    storage.setItem(storageKey, text);
    return incoming;
  }
  return { documents, save };
}
