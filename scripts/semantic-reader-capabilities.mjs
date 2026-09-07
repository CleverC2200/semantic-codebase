// Capability candidates are presentation mappings; they never resolve structural relations.
export function createReaderCapabilityModel(data, { storage } = {}) {
  const storageKey = 'semantic-reader:capabilities:v1:' + data.repository;
  function readEvents() {
    const raw = storage?.getItem(storageKey);
    if (!raw) return [];
    const value = JSON.parse(raw);
    if (value.schema !== 1 || value.repository !== data.repository || !Array.isArray(value.events)) throw new Error('CAPABILITY_INVALID_STORAGE');
    const versions = new Map();
    for (const event of value.events) {
      if (!event || typeof event.id !== 'string' || !['confirm', 'revoke'].includes(event.action) || typeof event.actor !== 'string' || !event.actor.trim() || typeof event.reason !== 'string' || !event.reason.trim() || event.repository !== data.repository || typeof event.snapshot !== 'string' || typeof event.binding !== 'string' || !Number.isInteger(event.version) || event.version !== (versions.get(event.id) ?? 0) + 1 || (event.parent !== null && typeof event.parent !== 'string')) throw new Error('CAPABILITY_INVALID_STORAGE');
      versions.set(event.id, event.version);
    }
    return value.events;
  }
  const events = readEvents();
  const history = id => events.filter(e => e.id === id);
  const binding = entry => JSON.stringify({ sources: Object.entries(entry.source_digests ?? {}).sort(([a], [b]) => a.localeCompare(b)), title: entry.title, kind: entry.kind, mainlines: entry.mainlines ?? [], definitions: entry.definitions ?? [], uses: entry.uses ?? [] });
  const definitions = new Set(data.definitions.map(d => d.definition_key));
  const lines = new Map((data.mainlines ?? []).filter(m => m.available).map(m => [m.id, m]));
  const entries = new Map();
  for (const raw of data.capabilityCandidates ?? []) {
    if (entries.has(raw.id)) throw new Error('CAPABILITY_DUPLICATE_ID');
    const bindings = Object.entries(raw.source_digests ?? {});
    const available = bindings.length > 0 && bindings.every(([path, digest]) => data.files.some(f => f.path === path && f.verified && f.source_digest === digest));
    entries.set(raw.id, { ...raw, available, status: 'candidate', basis: 'llm_inferred', verified: false,
      mainlines: (raw.mainlines ?? []).filter(id => lines.has(id)), uses: raw.uses ?? [],
      definitions: (raw.definitions ?? []).filter(key => definitions.has(key)), snapshot: data.snapshot });
  }
  for (const entry of entries.values()) {
    const decision = history(entry.id).at(-1);
    if (!decision) continue;
    entry.decision = decision;
    if (decision.action === 'revoke') continue;
    if (decision.snapshot !== data.snapshot || decision.binding !== binding(entry) || !entry.available) { entry.status = 'needs_review'; continue; }
    entry.parent = decision.parent; entry.status = 'confirmed';
  }
  for (const entry of entries.values()) {
    const seen = new Set([entry.id]); let parent = entry.parent;
    while (parent) {
      if (seen.has(parent) || !entries.has(parent)) throw new Error('CAPABILITY_INVALID_HIERARCHY');
      seen.add(parent); parent = entries.get(parent).parent;
    }
    entry.uses = entry.uses.filter(id => entries.has(id) && id !== entry.id);
  }
  const get = id => entries.get(id);
  const children = id => [...entries.values()].filter(e => (e.parent ?? null) === (id ?? null));
  function ancestors(id) {
    const result = []; let parent = get(id)?.parent;
    while (parent) { result.unshift(get(parent)); parent = get(parent).parent; }
    return result;
  }
  function members(id) {
    const entry = get(id); if (!entry?.available) return [];
    return [...new Set([...entry.definitions, ...entry.mainlines.flatMap(line => lines.get(line).stages.flatMap(s => s.keys)), ...children(id).flatMap(e => members(e.id))])].sort();
  }
  function unassigned() {
    const mapped = new Set(children(null).flatMap(e => members(e.id)));
    return [...definitions].filter(key => !mapped.has(key));
  }
  function decide(input) {
    if (!storage) throw new Error('CAPABILITY_STORAGE_UNAVAILABLE');
    const currentEvents = readEvents(), previous = currentEvents.filter(e => e.id === input.id).at(-1);
    const current = createReaderCapabilityModel(data, { storage });
    const candidate = current.get(input.id);
    if (!candidate || !['confirm', 'revoke'].includes(input.action) || !input.actor?.trim() || !input.reason?.trim()) throw new Error('CAPABILITY_INVALID_DECISION');
    if ((previous?.version ?? 0) !== input.expected_version) throw new Error('CAPABILITY_VERSION_CONFLICT');
    const parent = input.parent ?? null;
    if (input.action === 'confirm') {
      if (!candidate.available) throw new Error('CAPABILITY_SOURCE_UNAVAILABLE');
      if (parent === input.id || (parent !== null && !current.get(parent)) || (parent && current.ancestors(parent).some(p => p.id === input.id))) throw new Error('CAPABILITY_INVALID_HIERARCHY');
    }
    const event = { id: input.id, action: input.action, parent, actor: input.actor.trim(), reason: input.reason.trim(),
      repository: data.repository, snapshot: data.snapshot, binding: binding(candidate), version: input.expected_version + 1 };
    storage.setItem(storageKey, JSON.stringify({ schema: 1, repository: data.repository, events: [...currentEvents, event] }));
    return event;
  }
  return { get, children, ancestors, members, unassigned, history, decide, list: () => [...entries.values()] };
}
