import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ContextPackageError,
  RepositoryIndexer,
  TypeScriptSemanticEnricher,
  TypeScriptTreeSitterAdapter,
  answerContextPackage,
  buildContextPackage,
  sha256Bytes,
  validateEvidenceAnswer,
  type RepositorySource,
} from "../../src/index.js";

function fixture() {
  const source_bytes = new TextEncoder().encode([
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
});
