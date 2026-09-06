import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { answerContextPackageWithCodex } from "../../src/context/codex-answer.js";
import { renderAnswerMarkdown } from "../../src/context/markdown.js";

import {
  ContextPackageError,
  PythonPyrightEnricher,
  PythonTreeSitterAdapter,
  RepositoryIndexer,
  TypeScriptSemanticEnricher,
  TypeScriptTreeSitterAdapter,
  answerContextPackage,
  buildContextPackage,
  sha256Bytes,
  validateEvidenceAnswer,
  type RepositorySource,
  importOpenTelemetryJson,
} from "../../src/index.js";

function fixture(text?: string) {
  const source_bytes = new TextEncoder().encode(text ?? [
    "export function save(value: string) { console.log(value); return value; }",
    "export function main() { return save('ok'); }",
    "",
  ].join("\n"));
  const source: RepositorySource = {
    repository_id: "context-fixture",
    files: [{ relative_path: "src/main.ts", language: "typescript", source_bytes, source_digest: sha256Bytes(source_bytes) }],
  };
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state, source });
  return { state, overlay };
}

test("call budgets retain seed direct calls before downstream or member-call noise", () => {
  const { state, overlay } = fixture([
    'import { execute } from "./not-indexed";',
    'function helper() { return console.log("helper"); }',
    `export function main() { ${Array.from({ length: 20 }, (_, i) => `console.log(${i});`).join(" ")} helper(); return execute(); }`,
  ].join("\n"));
  const context = buildContextPackage({ state, overlay, question: "main 的调用路径", max_facts: 2 });
  assert.deepEqual(context.semantic_facts.map((fact) => (fact.value as { call: string }).call).sort(), ["execute", "helper"]);
  assert.ok(context.unknowns.some((item) => item.includes("截断")));
  assert.equal(context.query_plan.truncated, true);
  validateEvidenceAnswer(context, answerContextPackage(context));
});

test("call-path budgets reserve evidence for the seed function's conditions and result", () => {
  const calls = Array.from({ length: 20 }, (_, index) => `helper${index}();`).join(" ");
  const helpers = Array.from({ length: 20 }, (_, index) => `function helper${index}() { return ${index}; }`).join("\n");
  const { state, overlay } = fixture(`${helpers}\nexport function main(flag: boolean) { if (!flag) throw new Error('rejected'); ${calls} return 1; }`);
  const context = buildContextPackage({ state, overlay, question: "main 的调用路径", max_facts: 6 });
  assert.ok(context.semantic_facts.some((fact) => fact.kind === "control_flow"));
  assert.ok(context.semantic_facts.some((fact) => fact.kind === "effect" && (fact.value as { effect_kind: string }).effect_kind === "return"));
  assert.ok(context.semantic_facts.some((fact) => fact.kind === "call_target"));
});

test("call-path context retains direct caller conditions and sibling argument preparation", () => {
  const { state, overlay } = fixture([
    "function getValue() { return 1; }",
    "export function target(value: number) { return value; }",
    "export function caller(enabled: boolean) { if (!enabled) return 0; const value = getValue(); return target(value); }",
  ].join("\n"));
  const target = state.graph.definitions.find((item) => item.name === "target")!;
  const context = buildContextPackage({ state, overlay, question: "target 的调用路径", definition_key: target.definition_key });
  assert.ok(context.semantic_facts.some((fact) => fact.kind === "call_target" && (fact.value as { call?: string }).call === "getValue"));
  assert.ok(context.semantic_facts.some((fact) => fact.kind === "control_flow" && fact.subject.kind === "definition" &&
    state.graph.definitions.find((item) => item.definition_key === fact.subject.definition_key)?.name === "caller"));
});

test("call-path budgets retain calls made by a reached callee", () => {
  const noise = Array.from({ length: 20 }, (_, index) => `helper${index}();`).join(" ");
  const helpers = Array.from({ length: 20 }, (_, index) => `function helper${index}() { return ${index}; }`).join("\n");
  const { state, overlay } = fixture(`${helpers}\nfunction finalize() { externalWrite(); }\nexport function build() { ${noise} return finalize(); }`);
  const context = buildContextPackage({ state, overlay, question: "build 的调用路径", max_facts: 30 });
  assert.ok(context.semantic_facts.some((fact) => fact.kind === "call_target" && fact.subject.kind === "definition" &&
    state.graph.definitions.find((item) => item.definition_key === fact.subject.definition_key)?.name === "finalize" &&
    (fact.value as { call?: string }).call === "externalWrite"));
});

test("control-flow excerpts retain decisive conditions late in one statement", () => {
  const padding = Array.from({ length: 20 }, (_, index) => `value${index}: ${index},`).join(" ");
  const { state, overlay } = fixture(`export function build(defaultValue: object, overrideValue: object) { return consume({ ${padding} selected: overrideValue === defaultValue ? undefined : defaultValue }); }`);
  const build = state.graph.definitions.find((item) => item.name === "build")!;
  const context = buildContextPackage({ state, overlay, question: "build 的条件和副作用", definition_key: build.definition_key });
  const excerpts = context.semantic_facts.filter((fact) => fact.kind === "control_flow").flatMap((fact) =>
    ((fact.value as { blocks?: { source_excerpt?: string }[] }).blocks ?? []).map((block) => block.source_excerpt ?? ""));
  assert.ok(excerpts.some((excerpt) => excerpt.includes("overrideValue === defaultValue")));
});

test("behavior queries include bounded downstream observable effects", () => {
  const { state, overlay } = fixture([
    "function leaf(input: { value: number }) { input.value = 1; }",
    "function middle(input: { value: number }) { leaf(input); }",
    `export function top(input: { value: number }) { ${Array.from({ length: 20 }, (_, index) => `console.log(${index});`).join(" ")} middle(input); }`,
  ].join("\n"));
  const top = state.graph.definitions.find((item) => item.name === "top")!;
  const context = buildContextPackage({ state, overlay, question: "top 的条件和副作用", definition_key: top.definition_key, max_facts: 5 });
  assert.ok(context.definitions.some((item) => item.name === "leaf"));
  assert.ok(context.semantic_facts.some((fact) => fact.kind === "effect" && (fact.value as { operation?: string }).operation === "input.value"));
});

for (const language of ["typescript", "python"] as const) test(`${language}: definition queries retain proven return-to-next-call flow through a caller`, () => {
  const source_bytes = new TextEncoder().encode(language === "typescript" ? [
    "export function normalize(value: number) { return value + 1; }",
    "export function save(value: number, store: Record<string, number>) { store.last = value; return value; }",
    "export function main(value: number, store: Record<string, number>) { const normalized = normalize(value); return save(normalized, store); }",
  ].join("\n") : [
    "def normalize(value: int):",
    "    return value + 1",
    "def save(value: int, store: dict):",
    "    store['last'] = value",
    "    return value",
    "def main(value: int, store: dict):",
    "    normalized = normalize(value)",
    "    return save(normalized, store)",
  ].join("\n"));
  const source: RepositorySource = { repository_id: `context-flow-${language}`, files: [{
    relative_path: language === "typescript" ? "order.ts" : "order.py", language,
    source_bytes, source_digest: sha256Bytes(source_bytes),
  }] };
  const state = new RepositoryIndexer({ adapters: [language === "typescript" ? new TypeScriptTreeSitterAdapter() : new PythonTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = (language === "typescript" ? new TypeScriptSemanticEnricher() : new PythonPyrightEnricher()).enrich({ state, source });
  const key = (name: string) => state.graph.definitions.find((item) => item.name === name)!.definition_key;

  for (const [name, question] of [["normalize", "normalize 的调用路径"], ["normalize", "normalize 的数据流"], ["save", "save 的数据流写到哪里"]] as const) {
    const context = buildContextPackage({ state, overlay, question, definition_key: key(name) });
    const answer = answerContextPackage(context);
    assert.ok(answer.findings.some((finding) => /normalize.*normalized.*save\.value/.test(finding.text)), `${question}: ${answer.findings.map((item) => item.text).join("\n")}`);
  }
});

test("an exactly fitting fact budget does not report discarded facts", () => {
  const { state, overlay } = fixture();
  const input = { state, overlay, question: "main 的调用路径" };
  const full = buildContextPackage({ ...input, max_facts: 500 });
  const exact = buildContextPackage({ ...input, max_facts: full.semantic_facts.length });
  assert.deepEqual(exact.semantic_facts, full.semantic_facts);
  assert.ok(!exact.unknowns.some((item) => item.startsWith("语义事实已按预算截断")));
});

test("Chinese questions produce bounded local Context Packages and Evidence Answers", () => {
  const { state, overlay } = fixture();
  const context = buildContextPackage({
    state,
    overlay,
    question: "main.ts 这个文件的入口和业务主线是什么？",
    file_path: "src/main.ts",
  });
  const answer = answerContextPackage(context);

  assert.equal(context.intent, "entry_flow");
  assert.equal(context.target.file_path, "src/main.ts");
  assert.ok(context.semantic_facts.length > 0);
  assert.ok(context.semantic_evidence.length > 0);
  assert.match(answer.summary, /src\/main\.ts/);
  assert.ok(answer.findings.some((item) => item.fact_ids.length > 0));
  assert.ok(answer.unknowns.some((item) => /运行时/.test(item)));
  const markdown = renderAnswerMarkdown(context, answer);
  assert.match(markdown, /源码证据/);
  assert.match(markdown, /static_possible/);
  assert.ok(markdown.includes(context.snapshot_id));
});

test("answer separates control transfers from external or state effects", () => {
  const { state, overlay } = fixture();
  const context = buildContextPackage({ state, overlay, question: "main 的副作用" });
  const answer = answerContextPackage(context);
  assert.ok(answer.findings.some((item) => item.text === "控制转移：return。"));
  assert.ok(!answer.findings.some((item) => item.text.startsWith("副作用：") && item.text.includes("return")));
});

test("definition behavior scope does not pull in sibling exports through the source file", () => {
  const { state, overlay } = fixture();
  const save = state.graph.definitions.find((item) => item.name === "save")!;
  const context = buildContextPackage({ state, overlay, question: "save 的副作用", definition_key: save.definition_key });
  assert.ok(context.structural_relations.every((relation) => [relation.source, relation.target].some(
    (endpoint) => endpoint.kind === "definition" && context.query_plan.definition_keys.includes(endpoint.definition_key),
  )));
  const fileContext = buildContextPackage({ state, overlay, question: "文件的副作用", file_path: "src/main.ts" });
  assert.ok(fileContext.definitions.some((item) => item.name === "main"));
});

test("unsupported questions and missing explicit targets fail instead of producing invented summaries", () => {
  const { state, overlay } = fixture();
  assert.throws(() => buildContextPackage({ state, overlay, question: "明天天气如何", file_path: "src/main.ts" }), /supported semantic query intent/);
  assert.throws(() => buildContextPackage({ state, overlay, question: "调用路径", definition_key: "missing" }), /does not exist/);
});

test("Codex invocation records success, validates schema, and degrades offline without losing evidence", () => {
  const { state, overlay } = fixture();
  const context = buildContextPackage({ state, overlay, question: "调用路径", file_path: "src/main.ts" });
  const draft = answerContextPackage(context);
  const run = (args: string[], _prompt: string) => {
    for (const feature of ["shell_tool", "unified_exec", "apps", "plugins", "multi_agent", "browser_use", "memories"]) {
      assert.ok(args.some((argument, index) => argument === "--disable" && args[index + 1] === feature));
    }
    assert.ok(args.includes('web_search="disabled"'));
    writeFileSync(args[args.indexOf("--output-last-message") + 1]!, JSON.stringify({ summary: "测试润色", finding_texts: draft.findings.map((item) => item.text) }));
    return { status: 0 };
  };
  const success = answerContextPackageWithCodex(context, { run });
  assert.equal(success.provider_invocation?.status, "succeeded");
  assert.equal(success.provider_invocation?.validation, "passed");
  assert.equal(success.provider_invocation?.package_hash, context.package_hash);
  assert.ok(success.provider_invocation?.response_hash);
  assert.deepEqual(success.findings, draft.findings);
  const failed = answerContextPackageWithCodex(context, { run: () => ({ status: 1 }) });
  assert.equal(failed.provider_invocation?.status, "unavailable");
  assert.equal(failed.presentation, undefined);
  assert.deepEqual(failed.findings, draft.findings);
  assert.ok(failed.unknowns.includes("answer_provider_unavailable"));
  const invalid = answerContextPackageWithCodex(context, { run: (args) => {
    writeFileSync(args[args.indexOf("--output-last-message") + 1]!, '{"summary":"forged","finding_texts":[]}');
    return { status: 0 };
  } });
  assert.equal(invalid.provider_invocation?.status, "invalid_response");
  assert.equal(invalid.presentation, undefined);
  validateEvidenceAnswer(context, invalid);
});

test("Codex retains safe error diagnostics separately from tools even after a successful response", () => {
  const { state, overlay } = fixture();
  const context = buildContextPackage({ state, overlay, question: "main 的调用路径" });
  const draft = answerContextPackage(context);
  const answer = answerContextPackageWithCodex(context, { run: (args) => {
    writeFileSync(args[args.indexOf("--output-last-message") + 1]!, JSON.stringify({ summary: "测试", finding_texts: draft.findings.map((item) => item.text) }));
    return { status: 0, stdout: [
      { type: "item.completed", item: { type: "error", message: "MCP startup failed /Users/private TOKEN_SECRET" } },
      { type: "item.completed", item: { type: "error", message: "unknown TOKEN_SECRET" } },
      { type: "item.completed", item: { type: "agent_message", text: "response" } },
      { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2 } },
    ].map((event) => JSON.stringify(event)).join("\n") };
  } });
  const telemetry = answer.provider_invocation?.telemetry;
  assert.ok(telemetry);
  assert.equal(telemetry?.diagnostics.length, 2);
  assert.equal(telemetry.tool_events, 0);
  assert.equal(telemetry.diagnostics[0].category, "mcp_startup");
  assert.equal(telemetry.assessment, "needs_review");
  assert.equal(answer.provider_invocation?.status, "succeeded");
  assert.deepEqual(answer.findings, draft.findings);
  assert.ok(!JSON.stringify(telemetry).includes("TOKEN_SECRET"));
  assert.ok(!JSON.stringify(telemetry).includes("/Users/private"));
});

test("answer validation rejects Evidence invented outside the package", () => {
  const { state, overlay } = fixture();
  const context = buildContextPackage({ state, overlay, question: "改 save 会影响什么？" });
  const answer = answerContextPackage(context);
  const forged = {
    ...answer,
    findings: [{ text: "伪造", fact_ids: ["missing"], evidence_ids: ["missing"], basis_kinds: ["compiler_exact"] }],
  };
  assert.throws(
    () => validateEvidenceAnswer(context, forged),
    (error: unknown) => error instanceof ContextPackageError && error.code === "ANSWER_INVENTED_EVIDENCE",
  );
  const cited = answer.findings.find((item) => item.fact_ids.length > 0)!;
  assert.throws(
    () => validateEvidenceAnswer(context, {
      ...answer,
      findings: [{ ...cited, basis_kinds: ["compiler_exact", "llm_inferred"] }],
    }),
    (error: unknown) => error instanceof ContextPackageError && error.code === "ANSWER_AUTHORITY_ESCALATION",
  );
});

test("the planner recognizes all four supported question intents", () => {
  const { state, overlay } = fixture();
  const intent = (question: string) => buildContextPackage({ state, overlay, question }).intent;
  assert.equal(intent("main.ts 文件做什么"), "file_role");
  assert.equal(intent("main 的调用路径"), "call_path");
  assert.equal(intent("main 的入口主线"), "entry_flow");
  assert.equal(intent("修改 save 的影响范围"), "impact_scope");
  assert.equal(intent("项目提供什么能力"), "capability");
  assert.equal(intent("save 的数据从哪里来写到哪里"), "data_flow");
  assert.equal(intent("save 有哪些条件异常副作用"), "behavior");
});

test("definition-scoped queries do not silently seed sibling functions", () => {
  const { state, overlay } = fixture();
  const definition = state.graph.definitions.find((item) => item.name === "save")!;
  const context = buildContextPackage({ state, overlay, question: "save 的调用路径", definition_key: definition.definition_key });
  assert.deepEqual(context.query_plan.seeds, [definition.definition_key]);
});

test("confirmed capability decisions reach the answer without becoming compiler facts", () => {
  const { state, overlay } = fixture();
  const capability = { capability_id: "human-1", repository_id: state.repository_id, snapshot_id: state.snapshot_id,
    title: "保存样例", basis: "human_confirmed" as const, members: [], definition_keys: state.graph.definitions.filter((item) => item.kind === "function").map((item) => item.definition_key) };
  const context = buildContextPackage({ state, overlay, question: "项目提供什么能力", capabilities: [capability] });
  assert.ok(answerContextPackage(context).findings.some((item) => item.capability_ids?.includes("human-1") && item.basis_kinds.includes("human_confirmed")));
  const stale = buildContextPackage({ state, overlay, question: "项目提供什么能力", capabilities: [{ ...capability, snapshot_id: "old" }] });
  assert.equal(stale.capabilities.length, 0);
});

test("valid Evidence IDs cannot authorize fabricated business prose", () => {
  const { state, overlay } = fixture();
  const context = buildContextPackage({ state, overlay, question: "main.ts 做什么" });
  const answer = answerContextPackage(context);
  assert.throws(() => validateEvidenceAnswer(context, { ...answer,
    findings: answer.findings.map((item) => ({ ...item, text: "已经完成付款并发货" })) }),
  (error: unknown) => error instanceof ContextPackageError && error.code === "ANSWER_UNVERIFIED_CLAIM");
});

test("Context rejects runtime observations from another Snapshot", () => {
  const { state, overlay } = fixture();
  const runtime = importOpenTelemetryJson({ repository_id: state.repository_id, snapshot_id: state.snapshot_id,
    definitions: state.graph.definitions, overlay, trace: { spans: [{ traceId: "test-trace", spanId: "test-span", name: "save" }] } });
  assert.throws(() => buildContextPackage({ state, overlay, question: "save 做什么", runtime: { ...runtime, snapshot_id: "old" } }),
    (error: unknown) => error instanceof ContextPackageError && error.code === "CONTEXT_RUNTIME_MISMATCH");
});

test("answer does not invent return-to-argument propagation after the binding is overwritten", () => {
  const { state, overlay } = fixture([
    "export function normalize(value: number) { return value + 1; }",
    "export function save(value: number) { return value; }",
    "export function main(value: number) { let normalized = normalize(value); normalized = 0; return save(normalized); }",
  ].join("\n"));
  const context = buildContextPackage({ state, overlay, question: "main 的数据流" });
  const answer = answerContextPackage(context);
  assert.ok(!answer.findings.some((finding) => finding.text.startsWith("跨函数值传播：") && /normalize.*save/.test(finding.text)));
});

test("answer withholds a value bridge when short-circuit writes were not modeled", () => {
  const { state, overlay } = fixture([
    "export function normalize(value: number) { return value + 1; }",
    "export function save(value: number) { return value; }",
    "export function main(value: number, flag: boolean) { let normalized = normalize(value); flag && (normalized = 0); return save(normalized); }",
  ].join("\n"));
  const context = buildContextPackage({ state, overlay, question: "main 的数据流" });
  const answer = answerContextPackage(context);
  assert.ok(!answer.findings.some((finding) => finding.text.startsWith("跨函数值传播：") && /normalize.*save/.test(finding.text)));
});
