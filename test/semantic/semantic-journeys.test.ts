import assert from "node:assert/strict";
import { test } from "node:test";
import { RepositoryIndexer, TypeScriptTreeSitterAdapter, PythonTreeSitterAdapter, TypeScriptSemanticEnricher, PythonPyrightEnricher, buildContextPackage, answerContextPackage, sha256Bytes } from "../../src/index.js";

// Developer-authored semantic regression expectations, NOT independent human Gold.
const sources = {
  typescript: `export function normalize(value: number) { return value + 1; }
export function save(value: number, store: { last: number }) { store.last = value; return value; }
export function main(value: number, flag: boolean, store: { last: number }) {
  if (!flag) throw new Error('rejected');
  const normalized = normalize(value);
  return save(normalized, store);
}`,
  python: `def normalize(value: int):
    return value + 1
def save(value: int, store: dict):
    store['last'] = value
    return value
def main(value: int, flag: bool, store: dict):
    if not flag:
        raise ValueError('rejected')
    normalized = normalize(value)
    return save(normalized, store)
`,
};

for (const language of ["typescript", "python"] as const) test(`${language} semantic user journeys retain concrete source expectations`, async (t) => {
  const source_bytes = new TextEncoder().encode(sources[language]);
  const source = { repository_id: `journeys-${language}`, files: [{ relative_path: language === "python" ? "order.py" : "order.ts", language, source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [language === "python" ? new PythonTreeSitterAdapter() : new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = (language === "python" ? new PythonPyrightEnricher() : new TypeScriptSemanticEnricher()).enrich({ state, source });
  const key = (name: string) => state.graph.definitions.find((item) => item.name === name)!.definition_key;
  const ask = (question: string, name: string) => buildContextPackage({ state, overlay, question, definition_key: key(name) });
  await t.test("answers show frozen conditions, return expressions and state write targets", () => {
    const text = (question: string, name: string) => answerContextPackage(ask(question, name)).findings.map((item) => item.text).join("\n");
    assert.ok(text("normalize 的数据流", "normalize").includes("return value + 1"));
    assert.ok(text("main 的条件异常", "main").includes(language === "python" ? "not flag" : "!flag"));
    assert.ok(text("main 的条件异常", "main").includes("rejected"));
    assert.ok(text("save 的数据流", "save").includes(language === "python" ? "store['last']" : "store.last"));
    for (const fact of overlay.facts.filter((item) => item.kind === "control_flow")) {
      for (const block of (fact.value as unknown as { blocks: { source_excerpt?: string; evidence_id: string }[] }).blocks) {
        if (block.source_excerpt === undefined) continue;
        const evidence = overlay.evidence.find((item) => item.evidence_id === block.evidence_id)!;
        const original = Buffer.from(source_bytes).subarray(evidence.span.start_byte, evidence.span.end_byte).toString();
        assert.equal(block.source_excerpt, original.slice(0, 240) + (original.length > 240 ? "…" : ""));
      }
    }
  });
  await t.test("capabilities are not auto-confirmed from exports", () => {
    const answer = answerContextPackage(ask("项目提供什么能力", "main"));
    assert.equal(answer.intent, "capability"); assert.equal(answer.status, "partial");
    assert.ok(answer.unknowns.some((item) => item.includes("没有人工确认")));
  });
  await t.test("implementation flow links main to both named callees and result slices", () => {
    const context = ask("功能如何实现", "main");
    assert.equal(context.intent, "entry_flow");
    assert.ok(context.query_plan.definition_keys.includes(key("normalize")));
    assert.ok(context.query_plan.definition_keys.includes(key("save")));
    const fact = overlay.facts.find((item) => item.kind === "application_flow" && item.subject.kind === "definition" && item.subject.definition_key === key("main"))!;
    const functions = (fact.value as { functions: { result_slices: unknown[] }[] }).functions;
    assert.ok(functions.some((item) => item.result_slices.length >= 2));
  });
  await t.test("call paths preserve direction and ordered endpoints", () => {
    const context = ask("main 的调用路径", "main");
    assert.ok(context.query_plan.paths.some((item) => item.definition_keys.join() === [key("main"), key("normalize")].join()));
    assert.ok(!context.query_plan.edges.some((item) => item.source === key("normalize") && item.target === key("main")));
  });
  await t.test("one-hop value mapping contains normalize argument and return Evidence", () => {
    const context = ask("数据从哪里来如何变化", "main");
    const flow = context.semantic_facts.find((item) => item.kind === "call_data_flow" && (item.value as { target_definition_key: string }).target_definition_key === key("normalize"))!;
    const mappings = (flow.value as { mappings: { argument_evidence_id: string; return_use_evidence_id: string; caller_result_binding_evidence_id: string }[] }).mappings;
    assert.equal(mappings.length, 1);
    const answer = answerContextPackage(context).findings.map((item) => item.text).join("\n");
    assert.ok(answer.includes("形参 value"));
    assert.ok(answer.includes("接收变量 normalized"));
    const resultEvidence = overlay.evidence.find((item) => item.evidence_id === mappings[0]!.caller_result_binding_evidence_id)!;
    assert.equal(Buffer.from(source_bytes).subarray(resultEvidence.span.start_byte, resultEvidence.span.end_byte).toString(), "normalized");
    for (const id of [mappings[0]!.argument_evidence_id, mappings[0]!.return_use_evidence_id]) {
      const evidence = overlay.evidence.find((item) => item.evidence_id === id)!;
      assert.equal(Buffer.from(source_bytes).subarray(evidence.span.start_byte, evidence.span.end_byte).toString(), "value");
    }
  });
  await t.test("conditions, throws and state writes are distinct facts", () => {
    const context = ask("main 有哪些条件异常", "main");
    assert.equal(context.intent, "behavior");
    assert.ok(context.semantic_facts.some((item) => item.kind === "effect" && (item.value as { effect_kind: string }).effect_kind === "throw"));
    assert.ok(overlay.facts.some((item) => item.kind === "effect" && item.subject.kind === "definition" && item.subject.definition_key === key("save") && (item.value as { effect_kind: string }).effect_kind === "state"));
  });
  await t.test("impact of normalize finds caller main but does not infer sibling save is a caller", () => {
    const context = ask("修改 normalize 的影响范围", "normalize");
    assert.ok(context.query_plan.definition_keys.includes(key("main")));
    assert.ok(!context.query_plan.definition_keys.includes(key("save")));
  });
});
