import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { canonicalHash, sha256Bytes } from "../../src/contract/hash.js";

import { releaseEngineDigest } from "../../scripts/release-engine-identity.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

// Run the real coordinator in a disposable checkout. Only the measurement worker
// is replaced: these tests exercise receipt rejection and the actual exit status,
// without remeasuring performance or changing the original acceptance records.
function verify(syntax?: unknown, completeEvidence = false, invalidSoak = false) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "scb-release-gate-test-"));
  try {
    mkdirSync(path.join(directory, "scripts"));
    copyFileSync(path.join(root, "scripts/verify-semantic-release.mjs"), path.join(directory, "scripts/verify-semantic-release.mjs"));
    for (const name of ["dist", "src", "benchmark"]) symlinkSync(path.join(root, name), path.join(directory, name), "dir");
    for (const name of ["package.json", "package-lock.json", "scripts/pyright-semantic-worker.mjs", "scripts/release-engine-identity.mjs"]) {
      copyFileSync(path.join(root, name), path.join(directory, name));
    }
    symlinkSync(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir");
    const output = path.join(directory, ".workspace/acceptance/release-readiness");
    mkdirSync(output, { recursive: true });
    if (syntax) writeFileSync(path.join(output, "syntax-performance.json"), JSON.stringify(syntax));
    if (completeEvidence) {
      const review = path.join(directory, ".workspace/acceptance/release-review");
      mkdirSync(review, { recursive: true });
      const ids = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`);
      const artifacts = (prefix: string, count: number) => canonicalHash(ids(prefix, count).map((id) => {
        const file = `${id}.json`, bytes = Buffer.from("{}");
        writeFileSync(path.join(review, file), bytes);
        return { file, sha256: sha256Bytes(bytes) };
      }));
      const gold = JSON.stringify({ schema_version: 1, phase1_expectations_frozen: true, isolation_observed: true, reviewer: "test-fixture",
        pass_ids: ids("release", 54), fail_ids: [], not_gradable_ids: [],
        summary: { pass: 54, fail: 0, not_gradable: 0, total: 54, gradable: 54, boundary_violations: 0, gradable_pass_rate: 1 } });
      writeFileSync(path.join(output, "gold.json"), gold);
      writeFileSync(path.join(output, "independent-gold-pointer.json"), JSON.stringify({ schema_version: 1, kind: "independent_gold_pointer",
        receipt_path: "gold.json", receipt_sha256: sha256Bytes(Buffer.from(gold)), review_artifacts_digest: artifacts("release", 54) }));
      writeFileSync(path.join(output, "codegraph-comparison-verdicts.json"), JSON.stringify({ schema_version: 1, reviewer_independent_of_implementation: true,
        black_box_codegraph_1_5: true, review_artifacts_digest: artifacts("comparison", 6),
        cases: ids("comparison", 6).map((id) => ({ id, result: "pass" })), summary: { total: 6, pass: 6, partial: 0, fail: 0 } }));
      const soak = JSON.stringify({ engine_digest: releaseEngineDigest(directory), corpus: "poetry", mode: "semantic", gc_mode: "forced",
        passed: true, requested_rounds: 12, sampled_peak_process_tree_rss_bytes: 1000000,
        exit_code: invalidSoak ? 9 : 0, timed_out: false, measurement_errors: 0, failure: null,
        result: { rounds: Array.from({ length: 12 }, (_, index) => ({ round: index + 1, memory: { rss: 1000000 } })) } });
      writeFileSync(path.join(output, "soak.json"), soak);
      writeFileSync(path.join(output, "long-duration-soak-pointer.json"), JSON.stringify({ schema_version: 1, kind: "long_duration_python_soak_pointer",
        receipt_path: "soak.json", receipt_sha256: sha256Bytes(Buffer.from(soak)) }));
    }
    const preload = path.join(directory, "measurement-stub.cjs");
    writeFileSync(preload, `const cp = require('node:child_process');
      cp.spawnSync = () => ({ status: 0, stdout: JSON.stringify({ manifest_digest: 'fixture', corpus: {},
        ms: {full:1,incremental:1,graph_query:1,data_query:1,context:1,answer:1},max_rss_kib:1 }) });
      require('node:module').syncBuiltinESMExports();`);
    const child = spawnSync(process.execPath, ["--require", preload, path.join(directory, "scripts/verify-semantic-release.mjs")], {
      encoding: "utf8", timeout: 30000, env: { ...process.env, SEMANTIC_RELEASE_SAMPLES: "1" },
    });
    assert.equal(child.error, undefined);
    const receiptPath = path.join(output, "performance.json");
    return { code: child.status, receipt: JSON.parse(readFileSync(receiptPath, "utf8")) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("release command fails when required independent receipts are missing despite passing measurements", () => {
  const result = verify();
  assert.equal(result.receipt.measured_semantic_gate_passed, true);
  assert.equal(result.receipt.release_ready, false);
  assert.ok(result.receipt.release_blockers.includes("independent_gold"));
  assert.equal(result.code, 1);
});

function syntaxReceipt() {
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isSymbolicLink() ? [] : entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
  const files = [...walk(path.join(root, "src")).filter((file) => file.endsWith(".ts")),
    ...walk(path.join(root, "benchmark/corpus/python")).filter((file) => file.endsWith(".py"))];
  return { schema_version: 1, engine_digest: releaseEngineDigest(root), iterations: 9, corpus: { manifest_digest: canonicalHash(files.sort().map((file) => {
    const bytes = readFileSync(file);
    return { relative_path: path.relative(root, file).split(path.sep).join("/"), language: file.endsWith(".py") ? "python" : "typescript",
      source_digest: sha256Bytes(bytes), byte_length: bytes.byteLength };
  })) }, metrics_ms: { full_pipeline: { p95: 180 }, single_file_incremental: { p95: 90 } }, max_rss_kib: 177824,
  gate: { policy: "temporary_v0_2_exception_2026_09_05", full_ms: 300, incremental_ms: 150, peak_rss_kib: 196608, passed: true },
  optimization_target: { full_ms: 150, incremental_ms: 75, peak_rss_kib: 196608, passed: false } };
}

test("syntax gate accepts valid temporary budgets while the original target remains unmet", () => {
  const result = verify(syntaxReceipt());
  assert.equal(result.receipt.syntax_performance.passed, true);
  assert.equal(result.receipt.syntax_performance.optimization_target_passed, false);
  assert.equal(result.code, 1); // Other required receipts are still missing.
});

for (const scenario of ["full", "incremental", "rss", "null", "negative", "samples", "stale", "engine", "policy", "schema"]) test(`syntax gate rejects invalid receipt: ${scenario}`, () => {
  const source = syntaxReceipt();
  if (scenario === "full") source.metrics_ms.full_pipeline.p95 = 301;
  if (scenario === "incremental") source.metrics_ms.single_file_incremental.p95 = 151;
  if (scenario === "rss") source.max_rss_kib = 196609;
  if (scenario === "null") source.metrics_ms.full_pipeline.p95 = Number.NaN; // JSON encodes this as null.
  if (scenario === "negative") source.max_rss_kib = -1;
  if (scenario === "samples") source.iterations = 0;
  if (scenario === "policy") source.gate.full_ms = 9999;
  if (scenario === "schema") source.schema_version = 2;
  if (scenario === "engine") source.engine_digest = "old-engine";
  if (scenario === "stale") source.corpus.manifest_digest = "old-source";
  const result = verify(source);
  assert.equal(result.receipt.syntax_performance.passed, false);
  assert.ok(result.receipt.release_blockers.includes("syntax_performance"));
  assert.equal(result.code, 1);
});


test("release command returns success only when every bound gate passes", () => {
  const result = verify(syntaxReceipt(), true);
  assert.equal(result.code, 0);
  assert.equal(result.receipt.release_ready, true);
  assert.deepEqual(result.receipt.release_blockers, []);
});

test("long-duration evidence cannot claim success for a failed worker", () => {
  const result = verify(syntaxReceipt(), true, true);
  assert.equal(result.code, 1);
  assert.equal(result.receipt.long_duration_soak.passed, false);
});
