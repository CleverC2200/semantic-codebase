import type { ControlFlowGraph } from "./control-flow.js";

export interface Access {
  id: number;
  symbol: string;
  name: string;
  kind: "definition" | "use";
  evidence_id: string;
  block: number;
  inputs: number[];
}

export function solveDataFlow(graph: ControlFlowGraph, accesses: Access[], events: Map<number, Access[]>, unknowns: Set<string>, opaqueCallReads = new Set<number>()) {
  type State = Map<string, Set<number>>;
  const outputs = new Map<number, State>();
  const predecessors = new Map<number, number[]>();
  for (const edge of graph.edges) predecessors.set(edge.to, [...(predecessors.get(edge.to) ?? []), edge.from]);
  const inputFor = (block: number): State => {
    const result: State = new Map();
    for (const predecessor of predecessors.get(block) ?? []) {
      for (const [symbol, definitions] of outputs.get(predecessor) ?? []) {
        result.set(symbol, new Set([...(result.get(symbol) ?? []), ...definitions]));
      }
    }
    return result;
  };
  const key = (state: State) => JSON.stringify([...state].sort(([a], [b]) => a.localeCompare(b)).map(([symbol, ids]) => [symbol, [...ids].sort((a, b) => a - b)]));
  let converged = false;
  let iterations = 0;
  for (; iterations < 128; iterations++) {
    let changed = false;
    for (const block of graph.blocks) {
      const state = inputFor(block.id);
      for (const event of events.get(block.id) ?? []) if (event.kind === "definition") state.set(event.symbol, new Set([event.id]));
      if (key(state) !== key(outputs.get(block.id) ?? new Map())) changed = true;
      outputs.set(block.id, state);
    }
    if (!changed) { converged = true; break; }
  }
  const links: { definition: number; use: number }[] = [];
  if (!converged) unknowns.add("data_flow_iteration_budget_exceeded");
  if (converged) for (const block of graph.blocks) {
    const state = inputFor(block.id);
    for (const event of events.get(block.id) ?? []) {
      if (event.kind === "definition") state.set(event.symbol, new Set([event.id]));
      else {
        const reaching = state.get(event.symbol);
        if (!reaching?.size) unknowns.add("use_without_reaching_definition");
        for (const definition of reaching ?? []) links.push({ definition, use: event.id });
      }
    }
  }
  // Explicit value dependencies only: condition-only parameters are not value origins.
  const dependencies = new Map<number, number[]>();
  for (const item of accesses) dependencies.set(item.id, [...item.inputs]);
  for (const link of links) dependencies.set(link.use, [...(dependencies.get(link.use) ?? []), link.definition]);
  const returnBlocks = new Set(graph.blocks.filter((item) => item.kind === "return").map((item) => item.id));
  const parameterReturns: { parameter: number; return_use: number }[] = [];
  const summarySafe = [...unknowns].every((code) => ["python_dynamic_dispatch", "implicit_exceptions_not_modeled", "expression_internal_flow_not_modeled", "heap_read_not_modeled", "nonlocal_or_unresolved_symbol", "call_side_effects_not_modeled", "nested_callable_not_expanded", "switch_case_expression_effects_not_modeled"].includes(code));
  if (!summarySafe) unknowns.add("parameter_return_summary_withheld");
  if (converged && summarySafe) for (const read of accesses.filter((item) => item.kind === "use" && returnBlocks.has(item.block) && !opaqueCallReads.has(item.id))) {
    const visited = new Set<number>();
    const pending = [read.id];
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const access = accesses[id]!;
      if (access.kind === "definition" && access.block === graph.entry) parameterReturns.push({ parameter: id, return_use: read.id });
      pending.push(...(dependencies.get(id) ?? []));
    }
  }
  return { accesses, links: links.sort((a, b) => a.use - b.use || a.definition - b.definition), parameter_returns: parameterReturns.sort((a, b) => a.parameter - b.parameter || a.return_use - b.return_use), converged, iterations: iterations + (converged ? 1 : 0), unknowns: [...unknowns].sort() };
}
