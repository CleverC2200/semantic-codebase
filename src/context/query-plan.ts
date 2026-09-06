import type { SemanticFact } from "../semantic/types.js";
import type { QuestionIntent } from "./types.js";

export function executeQueryPlan(intent: QuestionIntent, seeds: readonly string[], facts: readonly SemanticFact[]) {
  const direction = intent === "impact_scope" ? "incoming" : "outgoing";
  const flowCallIds = new Set<string>();
  if (intent === "entry_flow") for (const fact of facts) {
    if (fact.kind !== "application_flow" || fact.subject.kind !== "definition" || !seeds.includes(fact.subject.definition_key)) continue;
    const flow = fact.value as { calls?: { call_fact_id?: string }[] };
    for (const call of flow.calls ?? []) if (call.call_fact_id) flowCallIds.add(call.call_fact_id);
  }
  const links = facts.flatMap((fact) => {
    if (fact.kind !== (intent === "data_flow" ? "call_data_flow" : "call_target") || fact.subject.kind !== "definition") return [];
    if (intent === "entry_flow" && !flowCallIds.has(fact.fact_id)) return [];
    const value = fact.value as { target_definition_key?: unknown; mappings?: unknown[] } | null;
    if (!value || typeof value.target_definition_key !== "string") return [];
    if (intent === "data_flow" && !value.mappings?.length) return [];
    return [{ source: fact.subject.definition_key, target: value.target_definition_key, fact_id: fact.fact_id }];
  }).sort((a, b) => a.fact_id.localeCompare(b.fact_id));
  const visited = new Set(seeds.slice(0, 80));
  const queue = [...visited].sort().map((key) => ({ key, depth: 0 }));
  const edges: typeof links = [];
  let truncated = seeds.length > 80;
  const depthBudget = intent === "behavior" ? 2 : 4;
  while (queue.length && !["file_role", "capability"].includes(intent)) {
    const { key, depth } = queue.shift()!;
    const adjacent = links.filter((link) => (direction === "incoming" ? link.target : link.source) === key);
    for (const link of adjacent) {
      if (depth >= depthBudget || edges.length >= 150) { truncated = true; break; }
      const next = direction === "incoming" ? link.source : link.target;
      if (!visited.has(next) && visited.size >= 80) { truncated = true; continue; }
      if (!edges.some((edge) => edge.fact_id === link.fact_id)) edges.push(link);
      if (!visited.has(next)) { visited.add(next); queue.push({ key: next, depth: depth + 1 }); }
    }
  }
  const kinds = intent === "entry_flow" ? ["application_flow", "entrypoint"] : intent === "data_flow" ? ["data_flow", "call_data_flow"] : intent === "behavior" ? ["control_flow", "effect"] : [];
  const selectedFactIds = facts.filter((fact) => fact.subject.kind === "definition" && visited.has(fact.subject.definition_key) && kinds.includes(fact.kind)).map((fact) => fact.fact_id);
  const scope = intent === "entry_flow" ? "reachable_application_flow" : intent === "data_flow" ? "local_and_bounded_return_dependencies" : intent === "behavior" ? "bounded_call_control_and_effects" : intent === "capability" ? "confirmed_capabilities" : "static_call_dependencies";
  const paths: { definition_keys: string[]; fact_ids: string[]; termination: string }[] = [];
  if (intent === "call_path" || intent === "impact_scope") {
    const pending = seeds.slice(0, 80).map((key) => ({ keys: [key], ids: [] as string[] }));
    while (pending.length && paths.length < 32) {
      const path = pending.shift()!;
      const adjacent = edges.filter((edge) => (direction === "incoming" ? edge.target : edge.source) === path.keys.at(-1));
      if (!adjacent.length || path.ids.length >= 4) { paths.push({ definition_keys: path.keys, fact_ids: path.ids, termination: adjacent.length ? "depth_budget" : "no_retained_edge" }); continue; }
      for (const edge of adjacent) {
        const next = direction === "incoming" ? edge.source : edge.target;
        if (path.keys.includes(next)) { truncated = true; continue; }
        if (pending.length >= 150) { truncated = true; break; }
        pending.push({ keys: [...path.keys, next], ids: [...path.ids, edge.fact_id] });
      }
    }
    if (pending.length) truncated = true;
  }
  return { intent, direction, scope, seeds: seeds.slice(0, 80), definition_keys: [...visited].sort(), edges, paths, selected_fact_ids: selectedFactIds, truncated, budget: { depth: depthBudget, nodes: 80, edges: 150, paths: 32 } };
}
