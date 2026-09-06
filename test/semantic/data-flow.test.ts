import assert from "node:assert/strict";
import { test } from "node:test";
import { RepositoryIndexer, TypeScriptSemanticEnricher, TypeScriptTreeSitterAdapter, sha256Bytes } from "../../src/index.js";
import type { buildDataFlow } from "../../src/semantic/data-flow.js";

function analyze(body: string) {
  const text = `export function main(flag: boolean, input: number) { ${body} }`;
  const source_bytes = new TextEncoder().encode(text);
  const source = { repository_id: "data-test", files: [{ relative_path: "main.ts", language: "typescript" as const, source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state, source });
  const target = state.graph.definitions.find((item) => item.name === "main")!;
  const fact = overlay.facts.find((item) => item.kind === "data_flow" && item.subject.kind === "definition" && item.subject.definition_key === target.definition_key)!;
  assert.ok(fact);
  const data = fact.value as unknown as ReturnType<typeof buildDataFlow>;
  assert.equal(data.converged, true);
  return { data, overlay, sources: (use: number) => data.links.filter((link) => link.use === use).map((link) => data.accesses[link.definition]!) };
}

test("def-use includes parameter reads and kills overwritten definitions", () => {
  const { data, sources, overlay } = analyze("let x = input; x = 2; return x;");
  const reads = data.accesses.filter((item) => item.kind === "use");
  assert.equal(sources(reads.find((item) => item.name === "input")!.id)[0]!.name, "input");
  const x = reads.find((item) => item.name === "x")!;
  assert.equal(sources(x.id).length, 1);
  const position = (id: string) => overlay.evidence.find((item) => item.evidence_id === id)!.span.start_byte;
  assert.equal(position(sources(x.id)[0]!.evidence_id), Math.max(...data.accesses.filter((item) => item.name === "x" && item.kind === "definition").map((item) => position(item.evidence_id))));
});

test("def-use joins both branches without retaining killed initial assignment", () => {
  const { data, sources } = analyze("let x = 0; if (flag) x = 1; else x = 2; return x;");
  const read = data.accesses.find((item) => item.kind === "use" && item.name === "x")!;
  assert.equal(sources(read.id).length, 2);
});

test("def-use reaches a fixed point through loops", () => {
  const { data, sources } = analyze("let x = input; while (flag) { x = x + 1; } return x;");
  for (const read of data.accesses.filter((item) => item.kind === "use" && item.name === "x")) assert.equal(sources(read.id).length, 2);
  assert.ok(data.iterations > 1);
});

test("def-use isolates shadowed locals and skips nested callable bodies", () => {
  const { data, sources } = analyze("let x = input; if (flag) { let x = 5; x++; } function nested() { x = 9; } return x;");
  const reads = data.accesses.filter((item) => item.kind === "use" && item.name === "x");
  assert.equal(new Set(reads.map((item) => item.symbol)).size, 2);
  for (const read of reads) assert.ok(sources(read.id).every((item) => item.symbol === read.symbol));
  assert.equal(data.accesses.filter((item) => item.kind === "definition" && item.name === "x").length, 3);
});

test("def-use preserves sequential compound updates and exposes unsupported paths", () => {
  const { data, sources } = analyze("let x = input; x += input; flag && (x = 4); return x;");
  const updates = data.accesses.filter((item) => item.name === "x" && item.kind === "definition");
  assert.equal(updates.length, 2);
  assert.ok(data.unknowns.includes("conditional_expression_data_flow_unknown"));
  assert.ok(data.accesses.filter((item) => item.kind === "use").every((item) => sources(item.id).length > 0));
  assert.equal(analyze("let x = input; x += input; flag && (x = 4); return x;").overlay.overlay_hash,
    analyze("let x = input; x += input; flag && (x = 4); return x;").overlay.overlay_hash);
});

test("local return summary follows explicit values but excludes condition-only parameters", () => {
  const { data } = analyze("let x = input + 1; if (flag) x = x + 2; return x;");
  assert.ok(data.parameter_returns.length > 0);
  assert.deepEqual([...new Set(data.parameter_returns.map((item) => data.accesses[item.parameter]!.name))], ["input"]);
  const killed = analyze("let x = input; x = 1; return x;").data;
  assert.equal(killed.parameter_returns.length, 0);
  const call = analyze("function fixed(x: number) { return 1; } return fixed(input);").data;
  assert.equal(call.parameter_returns.length, 0);
  assert.ok(call.unknowns.includes("call_side_effects_not_modeled"));
});

test("one-hop call summaries map argument positions and do not invent constant-return propagation", () => {
  const { overlay } = analyze("function pick(a: number, b: number) { return b; } function fixed(a: number) { return 1; } const x = pick(1, input); const y = pick(input, 2); return fixed(x);");
  const flows = overlay.facts.filter((item) => item.kind === "call_data_flow");
  const values = flows.map((item) => item.value as { status: string; mappings: { argument_index: number }[] });
  assert.equal(values.length, 3);
  assert.equal(values.filter((item) => item.mappings.length === 1).length, 2);
  assert.ok(values.flatMap((item) => item.mappings).every((item) => item.argument_index === 1));
  assert.ok(values.some((item) => item.status === "partial" && item.mappings.length === 0));
});

test("for loop reaching definitions include updates and do-while executes body first", () => {
  const { data } = analyze("let x = 0; for (let i = 0; i < input; i++) { x += i; } do { x++; } while (flag); return x;");
  assert.ok(!data.unknowns.some((item) => item.startsWith("unsupported_statement_")));
  assert.ok(data.links.length > 0);
});

test("omitted literal default parameters retain their own value Evidence", () => {
  const { overlay } = analyze("function pick(value = 42) { return value; } return pick();");
  const flow = overlay.facts.find((item) => item.kind === "call_data_flow")!;
  const mappings = (flow.value as { mappings: { argument_index: number | null; default_evidence_id: string }[] }).mappings;
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0]!.argument_index, null);
  assert.ok(overlay.evidence.some((item) => item.evidence_id === mappings[0]!.default_evidence_id));
  assert.ok(flow.evidence_ids.includes(mappings[0]!.default_evidence_id));
});
