import { createHash } from 'node:crypto';
import { readerCanonicalJson } from './semantic-reader-comparison.mjs';

// A folder-based offline reading package. Only content-addressed local JSON resources are emitted.
export function buildReaderAssetBundle(model) {
  const assets = [];
  const manifest = { schema: 'reader-assets-v1', repository: model.repository, snapshot: model.snapshot, overlayHash: model.overlayHash ?? null,
    sources: {}, evidence: {}, definitions: {}, counts: { sources: model.files.length, evidence: Object.keys(model.evidence).length, facts: model.facts.length, calls: model.facts.filter(f => f.kind === 'call_target').length } };
  function resource(kind, payload, binding = {}) {
    const content = JSON.stringify({ schema: 'reader-resource-v1', repository: model.repository, snapshot: model.snapshot, overlayHash: model.overlayHash ?? null, kind, ...binding, payload });
    const sha256 = createHash('sha256').update(content).digest('hex');
    const path = 'reader-assets/' + sha256 + '.json';
    assets.push({ path, content });
    return { path, sha256, bytes: Buffer.byteLength(content), kind };
  }
  const files = model.files.map(f => {
    if (f.verified && typeof f.source === 'string') {
      if (createHash('sha256').update(f.source).digest('hex') !== f.source_digest) throw new Error('READER_SOURCE_DIGEST_MISMATCH');
      manifest.sources[f.path] = resource('source', f.source, { file_path: f.path, source_digest: f.source_digest });
    }
    return { ...f, source: null, sourceByteLength: typeof f.source === 'string' ? Buffer.byteLength(f.source) : 0, sourceStatus: f.verified ? 'not_loaded' : 'unavailable' };
  });
  // Hash-prefix shards keep the manifest small without sending a full Evidence ID index on the first screen.
  const buckets = new Map();
  for (const [id, e] of Object.entries(model.evidence)) {
    const key = id.slice(0, 3);
    if (!buckets.has(key)) buckets.set(key, {});
    Object.defineProperty(buckets.get(key), id, { value: e, enumerable: true });
  }
  for (const [key, evidence] of buckets) manifest.evidence[key] = resource('evidence', evidence, { bucket: key });
  const byDefinition = new Map(), calls = [], globals = [];
  model.facts.forEach((fact, ordinal) => {
    const item = { ordinal, fact }, key = fact.subject?.definition_key;
    if (key) { if (!byDefinition.has(key)) byDefinition.set(key, []); byDefinition.get(key).push(item); }
    else globals.push(item);
    if (fact.kind === 'call_target') calls.push(item);
  });
  function factPayload(items) {
    const ids = new Set();
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (key.endsWith('evidence_id') && typeof item === 'string') ids.add(item);
        if (key.endsWith('evidence_ids') && Array.isArray(item)) item.forEach(id => ids.add(id));
        if (item && typeof item === 'object') visit(item);
      }
    };
    items.forEach(item => visit(item.fact));
    if ([...ids].some(id => !Object.hasOwn(model.evidence, id))) throw new Error('READER_FACT_EVIDENCE_MISSING');
    return { items, evidence: Object.fromEntries([...ids].map(id => [id, model.evidence[id]])) };
  }
  for (const [key, items] of byDefinition) manifest.definitions[key] = resource('definition-facts', factPayload(items), { definition_key: key });
  if (globals.length) manifest.globals = resource('global-facts', factPayload(globals));
  // Global call traversal is fetched only when the user asks for callers or bounded impact.
  if (calls.length) manifest.calls = resource('calls', { items: calls, evidence: {} });
  const manifestHash = createHash('sha256').update(readerCanonicalJson(manifest)).digest('hex');
  return { bootstrap: { ...model, files, facts: [], evidence: {}, assetManifest: manifest, assetManifestHash: manifestHash }, assets };
}
