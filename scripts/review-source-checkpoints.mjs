import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { canonicalHash } from "../dist/index.js";

// Selected source-derived checkpoints, never an independent Gold or recall score.
const directory = fileURLToPath(new URL("../.workspace/acceptance/release-review/", import.meta.url));
const packet = JSON.parse(readFileSync(path.join(directory, "review-packet.json"), "utf8"));
const real = [
  ["filter", "slice", "reverse", "map"], ["issueData.message !== undefined", "fullPath", "errorMessage"],
  ["getErrorMap", "makeIssue", "ctx.common.issues.push"], ["ctx.common.issues.push", "overrideMap"],
  ["status.dirty", "arrayValue.push"], ["aborted", "dirty", "arrayValue"],
  ["ParseStatus.mergeObjectSync"], ["await pair.key", "await pair.value", "syncPairs"],
  ["status.dirty"], ["__proto__", "alwaysSet", "aborted", "finalObject"],
  ["self.env.execute", "script_path.exists"], ["isinstance(script, dict)", "script_path.exists", "self.env.execute"],
  ["Factory.validate", "self._validate_classifiers"], ["strict", "is_locked", "is_fresh", "return_code"],
  ["self._do_refresh", "self._do_install"], ["self._update", "self.is_dry_run", "self._do_refresh"],
  ["Config.create", "Poetry", "plugin_manager.load_plugins"], ["disable_plugins", "local_config_file.exists", "return poetry"],
  ["self.build_venv", "self.get_system_env"], ["not force", "supported_python.allows", "create_venv", "raise"],
  ["validateAndSortSource", "this.buildIdentity"], ["profileUnchanged", "priorFile", "reused_files"],
  ["sourceManifestDigest", "sha256Bytes"], ["INVALID_SNAPSHOT_VIEW", "SOURCE_DIGEST_MISMATCH"],
  ["executeCommand", "importOpenTelemetryJson"], ["STALE_SNAPSHOT", "O_NOFOLLOW", "invalid_trace"],
  ["executeQueryPlan", "classifyIntent"], ["CONTEXT_SNAPSHOT_MISMATCH", "TARGET_NOT_FOUND", "CONTEXT_BUDGET_EXCEEDED"],
  ["canonicalHash", "this.list"], ["CAPABILITY_VERSION_CONFLICT", "BEGIN IMMEDIATE", "ROLLBACK"],
];
assert.equal(real.length, 30);
const rows = packet.release_cases.map((item, index) => {
  const { context, answer } = JSON.parse(readFileSync(path.join(directory, item.result_file), "utf8"));
  // Check fact payloads, not the full Evidence span of a function body: mere
  // inclusion of a source file is not proof that an operation was modeled.
  const payload = JSON.stringify(context.semantic_facts.map((fact) => fact.value));
  let checks;
  if (index < 24) {
    const n = index % 12;
    const key = (name) => context.definitions.find((definition) => definition.name === name)?.definition_key;
    const hasEdge = (from, to) => context.query_plan.edges.some((edge) => edge.source === key(from) && edge.target === key(to));
    const required = [[], [], ["normalize", "save"], [index < 12 ? "store.last" : "store['last']", "return value"], [], [], ["return value + 1"],
      [index < 12 ? "store.last" : "store['last']"], [index < 12 ? "!flag" : "not flag", "rejected"], ["state"], [], []][n];
    checks = required.map((text) => ({ expectation: text, found: payload.includes(text) }));
    if (n < 2) checks.push({ expectation: "未把入口自动确认为能力", found: !context.capabilities.length && answer.unknowns.some((text) => text.includes("没有人工确认")) });
    if (n === 4) checks.push({ expectation: "main → normalize/save", found: hasEdge("main", "normalize") && hasEdge("main", "save") });
    if (n === 5) checks.push({ expectation: "无 normalize → main 反向边", found: !hasEdge("normalize", "main") });
    if (n >= 10) checks.push({ expectation: "影响方向保持 caller → callee", found: hasEdge("main", n === 10 ? "normalize" : "save") });
  } else checks = real[index - 24].map((text) => ({ expectation: text, found: payload.includes(text) }));
  return { id: item.id, question: item.question, file: item.file, line: item.line,
    package_hash: context.package_hash, checks, selected_checkpoints: checks.every((check) => check.found) ? "covered" : "gap",
    complete_semantic_verdict: "not_established", independent_gold: false,
    boundary: "仅核对列明的关键点；不证明全部调用、条件、堆传播或业务解释正确。", unknowns: answer.unknowns };
});
assert.equal(rows.length, 54);
const receipt = { packet_hash: canonicalHash(packet), independently_verified: 0, rows };
writeFileSync(path.join(directory, "source-checkpoints.json"), JSON.stringify(receipt, null, 2));
writeFileSync(path.join(directory, "source-checkpoints.md"), ["# 54 题源码关键点核对", "",
  "实现者复核，不是独立 Gold。covered 只表示列明的关键点可在语义负载找到，不是整题正确或完整。", "",
  "| 题号 | 问题 | 关键点 | 缺失 |", "| --- | --- | --- | --- |",
  ...rows.map((row) => `| ${row.id} | ${row.question} | ${row.selected_checkpoints} | ${row.checks.filter((check) => !check.found).map((check) => check.expectation).join("、") || "列明点未缺失；完整性仍未确立"} |`), "",
].join("\n"));
console.log(JSON.stringify({ checked: rows.length, covered: rows.filter((row) => row.selected_checkpoints === "covered").length,
  gaps: rows.filter((row) => row.selected_checkpoints === "gap").map((row) => ({ id: row.id, missing: row.checks.filter((check) => !check.found) })), independent_gold: 0 }));
