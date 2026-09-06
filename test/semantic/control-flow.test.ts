import assert from "node:assert/strict";
import { test } from "node:test";
import { RepositoryIndexer, TypeScriptSemanticEnricher, TypeScriptTreeSitterAdapter, sha256Bytes } from "../../src/index.js";
import type { ControlFlowGraph } from "../../src/semantic/control-flow.js";

function analyze(text: string) {
  const source_bytes = new TextEncoder().encode(text);
  const source = { repository_id: "cfg-test", files: [{ relative_path: "main.ts", language: "typescript" as const, source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state, source });
  const definition = state.graph.definitions.find((item) => item.name === "main")!;
  const fact = overlay.facts.find((item) => item.kind === "control_flow" && item.subject.kind === "definition" && item.subject.definition_key === definition.definition_key)!;
  assert.ok(fact);
  const graph = fact.value as unknown as ControlFlowGraph;
  const snippet = (id: number) => {
    const block = graph.blocks.find((item) => item.id === id)!;
    const evidence = overlay.evidence.find((item) => item.evidence_id === block.evidence_id)!;
    assert.ok(fact.evidence_ids.includes(evidence.evidence_id));
    return Buffer.from(source_bytes).subarray(evidence.span.start_byte, evidence.span.end_byte).toString();
  };
  return { graph, snippet, overlay };
}

test("CFG branches independently and never connects return to following statements", () => {
  const { graph, snippet } = analyze("// 中文🙂\nexport function main(flag: boolean) { if (flag) return 1; else return 2; console.log('dead'); }");
  const branch = graph.blocks.find((item) => item.kind === "condition")!;
  assert.equal(snippet(branch.id), "flag");
  const choices = graph.edges.filter((item) => item.from === branch.id);
  assert.deepEqual(choices.map((item) => item.kind), ["true", "false"]);
  assert.deepEqual(choices.map((item) => snippet(item.to)), ["return 1;", "return 2;"]);
  assert.equal(graph.blocks.filter((item) => item.kind === "statement").length, 0);
  for (const item of graph.blocks.filter((item) => item.kind === "return")) {
    assert.deepEqual(graph.edges.filter((edge) => edge.from === item.id), [{ from: item.id, to: graph.exit, kind: "return" }]);
  }
});

test("CFG while backedges, continue and break have distinct targets", () => {
  const { graph, snippet } = analyze("export function main(n: number) { while (n > 0) { n--; if (n === 2) continue; if (n === 1) break; } return n; }");
  const condition = graph.blocks.find((item) => item.kind === "condition" && snippet(item.id) === "n > 0")!;
  const returned = graph.blocks.find((item) => item.kind === "return")!;
  assert.ok(graph.edges.some((item) => item.kind === "continue" && item.to === condition.id));
  assert.ok(graph.edges.some((item) => item.kind === "break" && item.to === returned.id));
  assert.ok(graph.edges.some((item) => item.kind === "false" && item.to === condition.id));
});

test("CFG does not execute nested function bodies and preserves joins", () => {
  const { graph, snippet } = analyze("export function main(flag: boolean) { function nested() { throw 1; } if (flag) flag = false; return flag; }");
  assert.equal(graph.blocks.filter((item) => item.kind === "throw").length, 0);
  const returned = graph.blocks.find((item) => item.kind === "return")!;
  const assigned = graph.blocks.find((item) => item.kind === "statement")!;
  assert.equal(snippet(assigned.id), "flag = false;");
  assert.ok(graph.edges.some((item) => item.from === assigned.id && item.to === returned.id));
  assert.ok(graph.edges.some((item) => item.kind === "false" && item.to === returned.id));
});

test("CFG return passes through finally before exit", () => {
  const text = "export function main() { try { return 1; } finally { console.log('cleanup'); } }";
  const first = analyze(text);
  const returned = first.graph.blocks.find((item) => item.kind === "return")!;
  const after = first.graph.edges.find((item) => item.from === returned.id)!;
  assert.notEqual(after.to, first.graph.exit);
  assert.match(first.snippet(after.to), /cleanup/);
  assert.ok(first.graph.edges.some((item) => item.from === after.to && item.to === first.graph.exit));
  assert.equal(first.overlay.overlay_hash, analyze(text).overlay.overlay_hash);
});

test("CFG explicit throw enters catch and switch fallthrough reaches shared return", () => {
  const { graph, snippet } = analyze("export function main(n: number) { try { throw 1; } catch { n = 2; } switch (n) { case 1: n++; case 2: return n; default: return 0; } }");
  const thrown = graph.blocks.find((item) => item.kind === "throw")!;
  assert.equal(snippet(graph.edges.find((item) => item.from === thrown.id)!.to), "n = 2;");
  const dispatch = graph.blocks.find((item) => item.kind === "condition")!;
  assert.equal(graph.edges.filter((item) => item.from === dispatch.id).length, 3);
});

test("CFG supports expression-bodied named arrows", () => {
  const { graph, snippet } = analyze("export const main = (n: number) => n + 1;");
  const returned = graph.blocks.find((item) => item.kind === "return")!;
  assert.equal(snippet(returned.id), "n + 1");
});

test("await resumes normal flow and rejection enters catch rather than bypassing it", () => {
  const { graph, snippet } = analyze("export async function main() { try { await work(); return 1; } catch { return 2; } }");
  const suspend = graph.blocks.find((item) => item.kind === "await_suspend")!;
  assert.ok(suspend);
  const resume = graph.edges.find((item) => item.from === suspend.id && item.kind === "resume")!;
  assert.equal(graph.blocks.find((item) => item.id === resume.to)!.kind, "await_resume");
  const rejection = graph.edges.find((item) => item.from === suspend.id && item.kind === "reject")!;
  assert.equal(snippet(rejection.to), "return 2;");
});
