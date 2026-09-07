// Two offline intents only. Answers are projections of existing, version-bound objects.
export function queryReader(data, question, { capabilities, risk, selectedKey } = {}) {
  const text = question.trim().replace(/[？?。]+$/, '');
  const entry = text.match(/^(.+?)(?:功能)?从哪里进入$/), impact = text.match(/^(.+?)(?:函数)?可能影响哪里$/);
  const result = { snapshot: data.snapshot, scope: 'local_frozen_snapshot', objects: [], evidence: [], unknowns: ['partial_coverage'] };
  if (!entry && !impact) return { ...result, status: 'unsupported', intent: null };
  const name = (entry ?? impact)[1].trim().replace(/^[“「]|[”」]$/g, '').toLowerCase();
  const intent = entry ? 'entry' : 'impact';
  const candidates = entry ? [
    ...capabilities.list().filter(c => c.available && c.title.toLowerCase() === name).map(c => ({ type: 'capability', key: c.id, title: c.title, definitionKeys: capabilities.members(c.id) })),
    ...(data.mainlines ?? []).filter(m => m.available && m.snapshot === data.snapshot && m.title.toLowerCase() === name).map(m => ({ type: 'mainline', key: m.id, title: m.title, definitionKeys: m.stages[0]?.keys ?? [], evidence: m.stages[0]?.refs ?? [] })),
  ] : data.definitions.filter(d => ['function', 'method', undefined].includes(d.kind) && d.qualified_name.toLowerCase() === name).map(d => ({ type: 'fn', key: d.definition_key, title: d.qualified_name, subtitle: d.file_path }));
  const chosen = selectedKey ? candidates.filter(c => c.key === selectedKey) : candidates;
  if (!chosen.length) return { ...result, intent, status: 'no_match', name };
  if (chosen.length > 1) return { ...result, intent, status: 'ambiguous', name, objects: chosen };
  const object = chosen[0];
  return { ...result, intent, status: 'answered', name, objects: chosen, evidence: object.evidence ?? [],
    ...(impact ? { impact: risk.impact(object.key) } : { unknowns: [...result.unknowns, object.type === 'capability' ? 'capability_members_are_candidate_entries' : 'mainline_entry_is_inferred'] }) };
}
