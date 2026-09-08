import { readerCanonicalJson } from './semantic-reader-comparison.mjs';

export function createReaderAssetLoader(data, fetchText = async path => {
  const response = await fetch(path);
  if (!response.ok) throw new Error('READER_RESOURCE_FETCH: ' + response.status);
  return response.text();
}) {
  const manifest = data.assetManifest, files = new Map(data.files.map(f => [f.path, f]));
  const pending = new Map(), sources = new Set(), loadedDefinitions = new Set(), facts = new Map();
  const definitions = new Map(data.definitions.map(d => [d.definition_key, d]));
  let callsLoaded = !manifest || manifest.counts.calls === 0;
  let manifestCheck, allPending, batchDepth = 0;
  const publishFacts = () => { data.facts = [...facts].sort(([a], [b]) => a - b).map(([, fact]) => fact); };
  async function digest(text) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function checkManifest() {
    if (!manifest) return;
    if (manifest.schema !== 'reader-assets-v1' || manifest.repository !== data.repository || manifest.snapshot !== data.snapshot ||
      manifest.overlayHash !== (data.overlayHash ?? null) || await digest(readerCanonicalJson(manifest)) !== data.assetManifestHash) throw new Error('READER_MANIFEST_INTEGRITY');
  }
  async function get(descriptor) {
    if (!manifest) throw new Error('READER_RESOURCE_UNAVAILABLE');
    manifestCheck ??= checkManifest(); await manifestCheck;
    if (!descriptor || !/^reader-assets\/[a-f0-9]{64}\.json$/.test(descriptor.path) || descriptor.path !== 'reader-assets/' + descriptor.sha256 + '.json' ||
      !Number.isInteger(descriptor.bytes) || descriptor.bytes < 1 || descriptor.bytes > 200 * 1024 * 1024) throw new Error('READER_RESOURCE_DESCRIPTOR');
    if (!pending.has(descriptor.path)) {
      const task = (async () => {
        const text = await fetchText(descriptor.path);
        if (new TextEncoder().encode(text).length !== descriptor.bytes || await digest(text) !== descriptor.sha256) throw new Error('READER_RESOURCE_INTEGRITY');
        const value = JSON.parse(text);
        if (value.schema !== 'reader-resource-v1' || value.repository !== data.repository || value.snapshot !== data.snapshot || value.overlayHash !== (data.overlayHash ?? null) || value.kind !== descriptor.kind) throw new Error('READER_RESOURCE_SCOPE');
        return value;
      })();
      pending.set(descriptor.path, task);
      task.catch(() => pending.delete(descriptor.path));
    }
    return pending.get(descriptor.path);
  }
  async function source(path) {
    const file = files.get(path);
    if (!file?.verified) throw new Error('READER_SOURCE_UNAVAILABLE');
    if (typeof file.source === 'string') return file;
    const value = await get(manifest?.sources?.[path]);
    if (value.file_path !== path || typeof value.payload !== 'string' || value.source_digest !== file.source_digest || await digest(value.payload) !== file.source_digest) throw new Error('READER_SOURCE_INTEGRITY');
    file.source = value.payload; file.sourceStatus = 'loaded'; sources.add(path);
    return file;
  }
  function checkEvidence(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('READER_EVIDENCE_INVALID');
    for (const [id, e] of Object.entries(payload)) {
      const file = files.get(e?.file_path), span = e?.span;
      const length = file?.sourceByteLength ?? (typeof file?.source === 'string' ? new TextEncoder().encode(file.source).length : 0);
      if (!e || e.evidence_id !== id || !file || file.source_digest !== e.source_digest || (e.snapshot_id !== undefined && e.snapshot_id !== data.snapshot) ||
        !Number.isInteger(span?.start_byte) || !Number.isInteger(span?.end_byte) || span.start_byte < 0 || span.end_byte < span.start_byte || span.end_byte > length) throw new Error('READER_EVIDENCE_INVALID');
    }
  }
  async function evidence(ids, { allowMissing = false } = {}) {
    const absent = [...new Set(ids)].filter(id => !Object.hasOwn(data.evidence, id));
    const result = {};
    for (const bucket of new Set(absent.map(id => id.slice(0, 3)))) {
      if (allowMissing && !manifest?.evidence?.[bucket]) continue;
      const value = await get(manifest?.evidence?.[bucket]);
      if (value.bucket !== bucket) throw new Error('READER_EVIDENCE_BUCKET');
      checkEvidence(value.payload);
      for (const [id, e] of Object.entries(value.payload)) Object.defineProperty(result, id, { value: e, enumerable: true, configurable: true });
    }
    if (!allowMissing && absent.some(id => !Object.hasOwn(result, id))) throw new Error('READER_EVIDENCE_MISSING');
    for (const [id, e] of Object.entries(result)) Object.defineProperty(data.evidence, id, { value: e, enumerable: true, configurable: true, writable: true });
    return ids.map(id => data.evidence[id]);
  }
  function installFacts(payload, callsOnly = false) {
    if (!payload || !Array.isArray(payload.items)) throw new Error('READER_FACT_INVALID');
    checkEvidence(payload.evidence);
    const hasEvidence = id => Object.hasOwn(payload.evidence, id) || Object.hasOwn(data.evidence, id);
    for (const { ordinal, fact } of payload.items) {
      if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= manifest.counts.facts || !fact ||
        (fact.snapshot_id !== undefined && fact.snapshot_id !== data.snapshot) || !['compiler_exact', 'static_possible', 'framework_heuristic'].includes(fact.basis?.kind) ||
        !fact.subject || (fact.subject.kind === 'definition' && !definitions.has(fact.subject.definition_key)) || !Array.isArray(fact.evidence_ids) ||
        (callsOnly ? fact.kind !== 'call_target' : fact.evidence_ids.some(id => !hasEvidence(id)))) throw new Error('READER_FACT_INVALID');
      if (!callsOnly) {
        const visit = value => {
          if (!value || typeof value !== 'object') return;
          for (const [key, item] of Object.entries(value)) {
            if (key.endsWith('evidence_id') && typeof item === 'string' && !hasEvidence(item)) throw new Error('READER_FACT_EVIDENCE_MISSING');
            if (key.endsWith('evidence_ids') && (!Array.isArray(item) || item.some(id => !hasEvidence(id)))) throw new Error('READER_FACT_EVIDENCE_MISSING');
            if (item && typeof item === 'object') visit(item);
          }
        };
        visit(fact.value);
      }
      if (facts.has(ordinal) && JSON.stringify(facts.get(ordinal)) !== JSON.stringify(fact)) throw new Error('READER_FACT_CONFLICT');
    }
    for (const { ordinal, fact } of payload.items) facts.set(ordinal, fact);
    if (!batchDepth) publishFacts();
    for (const [id, e] of Object.entries(payload.evidence)) Object.defineProperty(data.evidence, id, { value: e, enumerable: true, configurable: true, writable: true });
  }
  async function definition(key) {
    if (!manifest || loadedDefinitions.has(key)) return;
    const d = definitions.get(key);
    if (!d) throw new Error('READER_DEFINITION_MISSING');
    await source(d.file_path);
    const descriptor = manifest.definitions[key];
    if (descriptor) {
      const value = await get(descriptor);
      if (value.definition_key !== key || value.payload.items.some(i => i.fact.subject?.definition_key !== key)) throw new Error('READER_FACT_SCOPE');
      installFacts(value.payload);
    }
    loadedDefinitions.add(key);
  }
  async function calls() {
    if (callsLoaded) return;
    const value = await get(manifest.calls);
    installFacts(value.payload, true); callsLoaded = true;
  }
  async function parallel(items, action) {
    let cursor = 0;
    const settled = await Promise.allSettled(Array.from({ length: Math.min(8, items.length) }, async () => {
      while (cursor < items.length) await action(items[cursor++]);
    }));
    const failed = settled.find(r => r.status === 'rejected');
    if (failed) throw failed.reason;
  }
  async function hydrateAll() {
    batchDepth++;
    try {
      await parallel(Object.keys(manifest.sources), source);
      await parallel(Object.keys(manifest.definitions), definition);
      if (manifest.globals) installFacts((await get(manifest.globals)).payload);
      await parallel(Object.entries(manifest.evidence), async ([bucket, descriptor]) => {
        const value = await get(descriptor);
        if (value.bucket !== bucket) throw new Error('READER_EVIDENCE_BUCKET');
        checkEvidence(value.payload);
        for (const [id, e] of Object.entries(value.payload)) Object.defineProperty(data.evidence, id, { value: e, enumerable: true, configurable: true, writable: true });
      });
      await calls();
    } finally { batchDepth--; publishFacts(); }
    if (data.facts.length !== manifest.counts.facts || Object.keys(data.evidence).length !== manifest.counts.evidence) throw new Error('READER_PACKAGE_INCOMPLETE');
  }
  async function all() {
    if (!manifest) return;
    allPending ??= hydrateAll().catch(error => { allPending = null; throw error; });
    await allPending;
  }
  return { source, evidence, definition, calls, all,
    hasDefinition: key => !manifest || loadedDefinitions.has(key), hasCalls: () => callsLoaded,
    status: () => ({ sources: sources.size, evidence: Object.keys(data.evidence).length, facts: data.facts.length, definitions: loadedDefinitions.size, callsLoaded }) };
}
