import type { CanonicalValue, SemanticEvidence, SemanticFact } from "./types.js";
type Value = { readonly [key: string]: CanonicalValue };
const object = (value: CanonicalValue): Value => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Value : {};

export function composeApplicationFlows(facts: readonly SemanticFact[], evidence: ReadonlyMap<string, SemanticEvidence>) {
  const byDefinition = new Map<string, SemanticFact[]>();
  for (const fact of facts) if (fact.subject.kind === "definition") {
    const key = fact.subject.definition_key;
    byDefinition.set(key, [...(byDefinition.get(key) ?? []), fact]);
  }
  return facts.filter((fact) => fact.kind === "entrypoint").map((entry) => {
    const root = entry.subject.kind === "definition" ? entry.subject.definition_key : "";
    const pending = [{ key: root, depth: 0 }];
    const seen = new Set<string>();
    const included = new Map<string, SemanticFact>([[entry.fact_id, entry]]);
    const functions: Value[] = [];
    const calls: Value[] = [];
    const unknowns = new Set<string>();
    let blockCount = 0;
    let truncated = false;
    while (pending.length) {
      const { key, depth } = pending.shift()!;
      if (seen.has(key)) continue;
      if (depth > 3 || seen.size >= 20) { truncated = true; continue; }
      seen.add(key);
      const local = byDefinition.get(key) ?? [];
      const cfg = local.find((fact) => fact.kind === "control_flow");
      if (!cfg) { unknowns.add("callee_cfg_unavailable"); continue; }
      const graph = object(cfg.value);
      const blocks = Array.isArray(graph.blocks) ? graph.blocks.map(object) : [];
      if (blockCount + blocks.length > 500) { truncated = true; continue; }
      blockCount += blocks.length;
      included.set(cfg.fact_id, cfg);
      for (const code of Array.isArray(graph.unknowns) ? graph.unknowns : []) if (typeof code === "string") unknowns.add(code);
      const steps: (Value & { fact_ids: string[] })[] = blocks.map((block) => {
        const span = typeof block.evidence_id === "string" ? evidence.get(block.evidence_id) : undefined;
        const matches = local.filter((fact) => ["call_target", "effect"].includes(fact.kind) && fact.evidence_ids.some((id) => {
          const item = evidence.get(id);
          return span && item && item.file_path === span.file_path && item.span.start_byte >= span.span.start_byte && item.span.end_byte <= span.span.end_byte;
        }));
        // Entry/exit Evidence spans the body, but does not execute every nested step.
        const executable = !["entry", "exit", "declaration", "unknown", "always", "exception_dispatch", "context_exit", "await_suspend", "await_resume"].includes(String(block.kind));
        for (const fact of executable ? matches : []) {
          included.set(fact.fact_id, fact);
          if (fact.kind !== "call_target") continue;
          const target = object(fact.value).target_definition_key;
          calls.push({ source_definition_key: key, source_block: block.id ?? null, call_fact_id: fact.fact_id, target_definition_key: target ?? null });
          if (typeof target === "string") pending.push({ key: target, depth: depth + 1 });
          else unknowns.add("unresolved_call_target");
        }
        return { ...block, fact_ids: executable ? matches.map((fact) => fact.fact_id) : [] };
      });
      const data = local.filter((fact) => ["data_flow", "call_data_flow"].includes(fact.kind));
      for (const fact of data) included.set(fact.fact_id, fact);
      const edges = Array.isArray(graph.edges) ? graph.edges.map(object) : [];
      const localData = object(data.find((fact) => fact.kind === "data_flow")?.value ?? null);
      const accesses = Array.isArray(localData.accesses) ? localData.accesses.map(object) : [];
      const defUses = Array.isArray(localData.links) ? localData.links.map(object) : [];
      const resultSlices = steps.flatMap((step) => {
        const effects = step.fact_ids.filter((id) => local.some((fact) => fact.fact_id === id && fact.kind === "effect"));
        if (!effects.length && !["return", "throw"].includes(String(step.kind))) return [];
        const ancestors = new Set<CanonicalValue>([step.id ?? null]);
        for (let changed = true; changed;) {
          changed = false;
          for (const edge of edges) if (ancestors.has(edge.to ?? null) && !ancestors.has(edge.from ?? null)) { ancestors.add(edge.from ?? null); changed = true; }
        }
        const accessIds = new Set<CanonicalValue>(accesses.filter((access) => access.block === step.id).map((access) => access.id ?? null));
        for (let changed = true; changed;) {
          changed = false;
          const add = (id: CanonicalValue) => { if (!accessIds.has(id)) { accessIds.add(id); changed = true; } };
          for (const link of defUses) if (accessIds.has(link.use ?? null)) add(link.definition ?? null);
          for (const access of accesses) if (accessIds.has(access.id ?? null) && Array.isArray(access.inputs)) for (const id of access.inputs) add(id);
        }
        const sources = accesses.filter((access) => accessIds.has(access.id ?? null));
        return [{ sink_block: step.id ?? null, effect_fact_ids: effects,
          condition_blocks: steps.filter((item) => item.kind === "condition" && ancestors.has(item.id ?? null)).map((item) => item.id ?? null),
          data_access_ids: [...accessIds], data_evidence_ids: sources.map((item) => item.evidence_id ?? null),
          basis: "static_possible", limitation: "conditions_are_predecessors_not_proven_path_constraints" }];
      });
      functions.push({ definition_key: key, entry: graph.entry ?? null, exit: graph.exit ?? null, blocks: steps, edges, data_fact_ids: data.map((fact) => fact.fact_id), result_slices: resultSlices });
    }
    if (truncated) unknowns.add("application_flow_budget_exceeded");
    return {
      subject: entry.subject,
      value: { entry_definition_key: root, functions, calls, truncated, budget: { depth: 3, functions: 20, blocks: 500 }, unknowns: [...unknowns].sort() },
      evidence_ids: [...new Set([...included.values()].flatMap((fact) => fact.evidence_ids))],
      reason_codes: [...new Set(["static_cfg_composition", "call_order_within_block_not_expanded", "business_relevance_requires_confirmation", ...unknowns])].sort(),
    };
  });
}
