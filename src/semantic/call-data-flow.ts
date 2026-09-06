import type { CanonicalValue, SemanticFact } from "./types.js";

type Value = { readonly [key: string]: CanonicalValue };
const object = (value: CanonicalValue): Value => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Value : {};

/** Bounded direct-return summaries. Never assume arbitrary callees pass arguments through. */
export function deriveCallDataFlows(facts: readonly SemanticFact[]) {
  const summaries = new Map(facts.filter((fact) => fact.kind === "data_flow" && fact.subject.kind === "definition")
    .map((fact) => [fact.subject.kind === "definition" ? fact.subject.definition_key : "", fact]));
  // Propagate only identifier arguments with local def-use evidence through a
  // directly returned call. Heap, spread, bound-method and keyword cases remain
  // outside this composition; no name-only joins and no unbounded recursion.
  for (let depth = 1; depth <= 3; depth++) {
    const previous = new Map(summaries);
    for (const call of facts.filter((fact) => fact.kind === "call_target" && fact.subject.kind === "definition")) {
      const value = object(call.value);
      const caller = previous.get(call.subject.kind === "definition" ? call.subject.definition_key : "");
      const callee = typeof value.target_definition_key === "string" ? previous.get(value.target_definition_key) : undefined;
      if (!caller || !callee || value.returned_directly !== true || value.has_spread_arguments !== false ||
          Array.isArray(value.argument_names) && value.argument_names.some((name) => name !== null)) continue;
      const local = object(caller.value), target = object(callee.value);
      if (local.converged !== true || target.converged !== true ||
          [local, target].some((summary) => Array.isArray(summary.unknowns) && summary.unknowns.includes("parameter_return_summary_withheld"))) continue;
      const accesses = Array.isArray(local.accesses) ? local.accesses.map(object) : [];
      const targetAccesses = Array.isArray(target.accesses) ? target.accesses.map(object) : [];
      const parameters = targetAccesses.filter((access) => access.kind === "definition" && access.block === 0);
      if (parameters.some((parameter) => ["self", "cls"].includes(String(parameter.name)))) continue;
      const args = Array.isArray(value.argument_evidence_ids) ? value.argument_evidence_ids : [];
      const returns = Array.isArray(target.parameter_returns) ? target.parameter_returns.map(object) : [];
      const links = Array.isArray(local.links) ? local.links.map(object) : [];
      const additions: Value[] = [];
      for (const returned of returns) {
        const index = parameters.findIndex((parameter) => parameter.id === returned.parameter);
        const use = accesses.find((access) => access.kind === "use" && access.evidence_id === args[index]);
        if (!use) continue;
        const pending = [use.id], visited = new Set<CanonicalValue | undefined>();
        while (pending.length) {
          const id = pending.pop();
          if (visited.has(id)) continue;
          visited.add(id);
          const access = accesses.find((item) => item.id === id);
          if (!access) continue;
          if (access.kind === "definition" && access.block === 0) additions.push({ parameter: access.id!, return_use: use.id! });
          if (Array.isArray(access.inputs)) pending.push(...access.inputs);
          pending.push(...links.filter((link) => link.use === id).map((link) => link.definition));
        }
      }
      if (!additions.length) continue;
      const current = summaries.get(call.subject.kind === "definition" ? call.subject.definition_key : "")!;
      const currentValue = object(current.value);
      const old = Array.isArray(currentValue.parameter_returns) ? currentValue.parameter_returns : [];
      const combined = [...old, ...additions].filter((item, index, items) => items.findIndex((other) => JSON.stringify(other) === JSON.stringify(item)) === index);
      summaries.set(call.subject.kind === "definition" ? call.subject.definition_key : "", { ...current,
        value: { ...currentValue, parameter_returns: combined, summary_depth: depth },
        evidence_ids: [...new Set([...current.evidence_ids, ...callee.evidence_ids, ...call.evidence_ids])] });
    }
  }
  return facts.filter((fact) => fact.kind === "call_target").map((call) => {
    const value = object(call.value);
    const target = typeof value.target_definition_key === "string" ? summaries.get(value.target_definition_key) : undefined;
    const summary = target ? object(target.value) : {};
    const accesses = Array.isArray(summary.accesses) ? summary.accesses.map(object) : [];
    const parameters = accesses.filter((item) => item.kind === "definition" && item.block === 0);
    const arguments_ = Array.isArray(value.argument_evidence_ids) ? value.argument_evidence_ids : [];
    const names = Array.isArray(value.argument_names) ? value.argument_names : [];
    const unknowns = Array.isArray(summary.unknowns) ? summary.unknowns : [];
    const safe = target && summary.converged === true && !unknowns.includes("parameter_return_summary_withheld") && value.has_spread_arguments === false;
    const returns = safe && Array.isArray(summary.parameter_returns) ? summary.parameter_returns.map(object) : [];
    const defaults = Array.isArray(summary.parameter_defaults) ? summary.parameter_defaults.map(object) : [];
    const expressions = Array.isArray(value.argument_expressions) ? value.argument_expressions : [];
    const bindings = target && value.has_spread_arguments === false && !parameters.some((parameter) => ["self", "cls"].includes(String(parameter.name)))
      ? parameters.flatMap((parameter, position) => {
        const named = names.findIndex((name) => name === parameter.name);
        const index = named >= 0 ? named : position;
        if (named >= 0 && (names.filter((name) => name === parameter.name).length > 1 || names[position] === null)) return [];
        if (named < 0 && typeof names[index] === "string" || typeof arguments_[index] !== "string") return [];
        return [{ parameter_name: parameter.name ?? null, parameter_evidence_id: parameter.evidence_id ?? null,
          argument_evidence_id: arguments_[index]!, argument_expression: expressions[index] ?? null }];
      }) : [];
    const mappings = returns.flatMap((item) => {
      const position = parameters.findIndex((parameter) => parameter.id === item.parameter);
      const parameter = parameters[position];
      const named = parameter ? names.findIndex((name) => typeof name === "string" && name === parameter.name) : -1;
      const index = named >= 0 ? named : position;
      // Duplicate assignments are not a valid Python call; don't publish a mapping.
      if (named >= 0 && (names.filter((name) => name === parameter?.name).length > 1 || (position < names.length && names[position] === null))) return [];
      const argument = named < 0 && typeof names[index] === "string" ? undefined : arguments_[index];
      const returned = accesses.find((access) => access.id === item.return_use);
      if (!parameter || !returned) return [];
      const fallback = defaults.find((item) => item.name === parameter.name)?.evidence_id;
      if (typeof argument !== "string" && typeof fallback !== "string") return [];
      return [{ argument_index: typeof argument === "string" ? index : null, parameter_index: position,
        parameter_name: parameter.name ?? null, argument_expression: expressions[index] ?? null,
        result_binding: value.result_binding ?? null,
        argument_evidence_id: argument ?? null, default_evidence_id: typeof argument === "string" && names.length ? null : fallback ?? null,
        default_applicability: typeof fallback !== "string" || (typeof argument === "string" && names.length) ? null : typeof argument === "string" ? "possible_if_undefined" : "omitted_argument",
        parameter_evidence_id: parameter.evidence_id,
        return_use_evidence_id: returned.evidence_id, caller_result_binding_evidence_id: value.result_binding_evidence_id ?? null }];
    });
    return {
      subject: call.subject,
      value: { call_fact_id: call.fact_id, target_definition_key: value.target_definition_key ?? null, bindings, mappings,
        depth: 1 + (typeof summary.summary_depth === "number" ? summary.summary_depth : 0), status: safe ? "partial" : "unknown" },
      evidence_ids: [...new Set([...call.evidence_ids, ...(target?.evidence_ids ?? [])])],
      reason_codes: safe ? [typeof summary.summary_depth === "number" ? "bounded_direct_return_value_dependence" : "one_hop_static_value_dependence", ...unknowns.filter((code): code is string => typeof code === "string")] : ["callee_summary_or_argument_mapping_unavailable"],
    };
  });
}
