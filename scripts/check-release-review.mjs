import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonicalHash, validateEvidenceAnswer } from "../dist/index.js";
import { renderAnswerMarkdown } from "../dist/context/markdown.js";

// Developer-authored consistency checks, deliberately not independent Gold.
const directory = fileURLToPath(new URL("../.workspace/acceptance/release-review/", import.meta.url));
const read = (name) => JSON.parse(readFileSync(path.join(directory, name), "utf8"));
const packet = read("review-packet.json");
assert.equal(packet.release_cases.length, 54);
assert.equal(packet.comparison_cases.length, 6);
const results = [...packet.release_cases, ...packet.comparison_cases].map((item) => {
  const failures = [];
  try {
    assert.equal(item.status, "executed_pending_review");
    const { context, answer } = read(item.result_file);
    const { package_hash, ...content } = context;
    assert.equal(canonicalHash(content), package_hash);
    validateEvidenceAnswer(context, answer);
    const answerText = answer.findings.map((finding) => finding.text).join("\n");
    if (["release-07", "release-19"].includes(item.id)) assert.ok(answerText.includes("return value + 1"));
    if (item.id === "release-08") assert.ok(answerText.includes("store.last"));
    if (item.id === "release-20") assert.ok(answerText.includes("store['last']"));
    if (item.id === "release-09") assert.ok(answerText.includes("!flag") && answerText.includes("rejected"));
    if (item.id === "release-21") assert.ok(answerText.includes("not flag") && answerText.includes("rejected"));
    if (item.id === "release-28") assert.ok(context.semantic_facts.some((fact) =>
      fact.kind === "effect" && fact.value.operation === "ctx.common.issues.push" &&
      fact.value.mutation_kind === "array" && fact.basis.kind === "static_possible"));
    assert.ok(context.target.definition_key);
    assert.ok(context.structural_relations.every((relation) => [relation.source, relation.target].some(
      (endpoint) => endpoint.kind === "definition" && context.query_plan.definition_keys.includes(endpoint.definition_key),
    )), "Unrelated file-level relation leaked into definition query");
    if (["release-35", "release-36"].includes(item.id)) {
      assert.ok(context.semantic_facts.some((fact) => fact.kind === "call_target" && fact.value.call === "self.env.execute"));
      assert.ok(!context.semantic_facts.some((fact) => fact.kind === "effect" &&
        fact.value.operation === "self.env.execute" && fact.value.effect_kind === "database"), "Command execution mislabeled as database");
    }
    if (["release-07", "release-09", "release-28"].includes(item.id)) {
      writeFileSync(path.join(directory, `${item.id}.md`), renderAnswerMarkdown(context, answer));
    }
  } catch (error) { failures.push(error.message); }
  return { id: item.id, question: item.question, consistency: failures.length ? "failed" : "passed",
    semantic_completeness: "not_graded", independent_gold: false, failures };
});
const receipt = { schema_version: 1, packet_hash: canonicalHash(packet), created_at: new Date().toISOString(),
  scope: "Package identity, Evidence Answer validation, definition relation scope; selected order answer excerpts, Zod Array mutation and Poetry execute negative regression",
  author: "implementation-agent", independently_verified: 0, results };
writeFileSync(path.join(directory, "consistency-checks.json"), JSON.stringify(receipt, null, 2));
const failed = results.filter((item) => item.consistency === "failed");
console.log(JSON.stringify({ checked: results.length, passed: results.length - failed.length, failed, independently_verified: 0 }));
if (failed.length) process.exitCode = 1;
