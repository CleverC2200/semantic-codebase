import { releaseEngineDigest } from "./release-engine-identity.mjs";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { RepositoryIndexer, TypeScriptTreeSitterAdapter, PythonTreeSitterAdapter, SemanticRepositoryEnricher,
  buildContextPackage, answerContextPackage, validateEvidenceAnswer, canonicalHash, sha256Bytes, SqliteSnapshotStore, GraphQueryService } from "../dist/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".workspace/acceptance/release-readiness");
const samples = Number(process.env.SEMANTIC_RELEASE_SAMPLES ?? 5);
const rounds = Number(process.env.SEMANTIC_SOAK_ROUNDS ?? 20);
const EXPECTED_SYNTAX_GATE = {
  policy: "temporary_v0_2_exception_2026_09_05",
  full_ms: 300,
  incremental_ms: 150,
  peak_rss_kib: 196608,
};
const EXPECTED_SYNTAX_TARGET = { full_ms: 150, incremental_ms: 75, peak_rss_kib: 196608 };
if (!Number.isInteger(samples) || samples < 1 || samples > 20 || !Number.isInteger(rounds) || rounds < 1 || rounds > 200) throw new Error("Invalid measurement budget");

if (!process.argv.includes("--worker")) {
  mkdirSync(output, { recursive: true });
  const measurements = [];
  for (let iteration = 0; iteration < samples; iteration++) {
    const child = spawnSync(process.execPath, ["--expose-gc", fileURLToPath(import.meta.url), "--worker"], {
      encoding: "utf8", timeout: 180000, maxBuffer: 4 * 1024 * 1024,
    });
    if (child.status !== 0) throw new Error(`Measurement worker failed: ${child.stderr}`);
    measurements.push(JSON.parse(child.stdout));
    process.stdout.write(`已完成语义性能样本 ${iteration + 1}/${samples}\n`);
  }
  assert.equal(new Set(measurements.map((item) => item.manifest_digest)).size, 1);
  const p95 = (key) => measurements.map((item) => item.ms[key]).sort((a, b) => a - b)[Math.ceil(samples * 0.95) - 1];
  const budgets = { full: 120000, incremental: 15000, graph_query: 2000, data_query: 2000, context: 5000, answer: 30000 };
  const timings = Object.fromEntries(Object.keys(budgets).map((key) => [key, { p95: p95(key), budget: budgets[key], passed: p95(key) <= budgets[key] }]));
  const peakRss = Math.max(...measurements.map((item) => item.max_rss_kib));
  const independentGold = loadEvidence(loadIndependentGold);
  const comparisonQuestions = loadEvidence(loadComparisonQuestions);
  const longDurationSoak = loadEvidence(loadLongDurationSoak);
  const syntaxPerformance = loadEvidence(loadSyntaxPerformance);
  const measuredSemanticGatePassed = Object.values(timings).every((item) => item.passed) && peakRss <= 2 * 1024 * 1024;
  const releaseBlockers = [
    ...(!measuredSemanticGatePassed ? ["semantic_performance"] : []),
    ...(!independentGold.review_gate_passed ? ["independent_gold"] : []),
    ...(!comparisonQuestions.passed ? ["codegraph_comparison"] : []),
    ...(!longDurationSoak.passed ? ["long_duration_python_soak"] : []),
    ...(!syntaxPerformance.passed ? ["syntax_performance"] : []),
  ];
  const receipt = {
    schema_version: 1, generated_at: new Date().toISOString(), samples, corpus: measurements[0].corpus,
    manifest_digest: measurements[0].manifest_digest, measurements, timings,
    peak_rss_kib: peakRss, rss_budget_kib: 2 * 1024 * 1024,
    measured_semantic_gate_passed: measuredSemanticGatePassed,
    independent_gold: independentGold,
    comparison_questions: comparisonQuestions,
    long_duration_soak: longDurationSoak,
    syntax_performance: syntaxPerformance,
    codex_live: "not_invoked_by_this_command",
    release_blockers: releaseBlockers,
    release_ready: releaseBlockers.length === 0,
    note: "This measures the semantic V0 budgets from issue-30-resolution and ingests separately reviewed local evidence. Context-limited Gold cases are reviewed but excluded from accuracy. No indexed application or external model is executed; a local persistent Python-corpus soak is not production-daemon acceptance.",
  };
  writeFileSync(path.join(output, "performance.json"), JSON.stringify(receipt, null, 2));
  process.stdout.write(JSON.stringify({ output, measured_semantic_gate_passed: receipt.measured_semantic_gate_passed, timings, peakRss,
    independent_gold: independentGold.status, comparison_questions: comparisonQuestions.status,
    long_duration_soak: longDurationSoak.status, syntax_performance: syntaxPerformance.status,
    release_blockers: releaseBlockers, release_ready: receipt.release_ready }) + "\n");
  if (!receipt.release_ready) process.exitCode = 1;
} else {
  const paths = [...walk(path.join(root, "src")).filter((name) => name.endsWith(".ts")),
    ...walk(path.join(root, "benchmark/corpus/python")).filter((name) => name.endsWith(".py"))];
  const files = paths.sort().map((name) => {
    const source_bytes = readFileSync(name);
    return { relative_path: path.relative(root, name).split(path.sep).join("/"), language: name.endsWith(".py") ? "python" : "typescript",
      source_bytes, source_digest: sha256Bytes(source_bytes) };
  });
  assert.ok(files.length <= 250);
  const source = { repository_id: "semantic-release-local-corpus", files };
  const indexer = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter(), new PythonTreeSitterAdapter()] });
  const enricher = new SemanticRepositoryEnricher();
  const ms = {};
  const measure = (key, fn) => { const start = performance.now(); const value = fn(); ms[key] = performance.now() - start; return value; };
  const { state, overlay } = measure("full", () => { const state = indexer.buildFull(source).state; return { state, overlay: enricher.enrich({ state, source }) }; });
  const changedBytes = Buffer.concat([files[0].source_bytes, Buffer.from("\n")]);
  const changed = { ...source, files: [{ ...files[0], source_bytes: changedBytes, source_digest: sha256Bytes(changedBytes) }, ...files.slice(1)] };
  measure("incremental", () => { const next = indexer.buildIncremental(state, changed).state; return enricher.enrich({ state: next, source: changed }); });
  const store = new SqliteSnapshotStore(":memory:");
  try {
    store.beginBuild(state.repository_id, state.snapshot_id);
    store.publishReady(state);
    const start = state.graph.definitions.find((item) => item.file_path === "src/indexing/indexer.ts" && item.name === "buildFull");
    assert.ok(start);
    measure("graph_query", () => {
      const result = new GraphQueryService(store).traverse({ repository_id: state.repository_id, snapshot: state.snapshot_id,
        start_definition_key: start.definition_key, max_depth: 4, max_nodes: 200, max_results: 200 });
      assert.ok(result.data.nodes.length > 0);
    });
  } finally { store.close(); }
  measure("data_query", () => buildContextPackage({ state, overlay, question: "索引的数据流", file_path: "src/indexing/indexer.ts", max_facts: 60 }));
  const context = measure("context", () => buildContextPackage({ state, overlay, question: "索引功能调用路径", file_path: "src/indexing/indexer.ts", max_facts: 60 }));
  measure("answer", () => {
    const completeContext = buildContextPackage({ state, overlay, question: "索引功能调用路径", file_path: "src/indexing/indexer.ts", max_facts: 60 });
    const answer = answerContextPackage(completeContext); validateEvidenceAnswer(completeContext, answer); return answer;
  });
  // Keep one engine alive across repeated inputs; bound the smoke run explicitly.
  const small = { repository_id: "semantic-soak-smoke", files: [{ relative_path: "main.ts", language: "typescript", source_bytes: Buffer.from("export function main(x: number) { return x + 1; }"), source_digest: sha256Bytes(Buffer.from("export function main(x: number) { return x + 1; }")) }] };
  const hashes = new Set(), rss = [];
  for (let round = 0; round < rounds; round++) {
    const smallState = indexer.buildFull(small).state;
    hashes.add(enricher.enrich({ state: smallState, source: small }).overlay_hash);
    globalThis.gc?.(); rss.push(process.memoryUsage().rss);
  }
  assert.equal(hashes.size, 1);
  process.stdout.write(JSON.stringify({ manifest_digest: state.source_manifest_digest,
    corpus: { files: files.length, bytes: files.reduce((sum, file) => sum + file.source_bytes.length, 0), roots: ["src", "benchmark/corpus/python"] },
    ms, max_rss_kib: process.resourceUsage().maxRSS, coverage: overlay.coverage, fact_count: overlay.facts.length,
    short_soak: { rounds, deterministic: true, first_rss: rss[0], last_rss: rss.at(-1), peak_rss: Math.max(...rss) } }));
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isSymbolicLink() ? [] :
    entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}

function loadIndependentGold() {
  const pointer = loadJson(path.join(output, "independent-gold-pointer.json"));
  if (!pointer) return { required: 54, reviewed: 0, passed: 0, not_gradable: 0, review_gate_passed: false, status: "missing_receipt" };
  assert.equal(pointer.schema_version, 1);
  assert.equal(pointer.kind, "independent_gold_pointer");
  const sourcePath = resolveAcceptancePath(pointer.receipt_path);
  const bytes = readFileSync(sourcePath);
  assert.equal(sha256Bytes(bytes), pointer.receipt_sha256, "Independent Gold receipt digest changed");
  const source = JSON.parse(bytes.toString("utf8"));
  assert.equal(artifactManifestDigest("release", 54), pointer.review_artifacts_digest, "Independently reviewed answers changed");
  const requiredIds = numberedIds("release", 54);
  const passIds = source.pass_ids ?? [];
  const failIds = source.fail_ids ?? [];
  const notGradableIds = source.not_gradable_ids ?? [];
  assert.equal(source.schema_version, 1);
  assert.equal(source.phase1_expectations_frozen, true);
  assert.equal(source.isolation_observed, true);
  assert.equal(typeof source.reviewer, "string");
  assert.deepEqual([...new Set([...passIds, ...failIds, ...notGradableIds])].sort(), requiredIds);
  assert.equal(passIds.length, source.summary.pass);
  assert.equal(failIds.length, source.summary.fail);
  assert.equal(notGradableIds.length, source.summary.not_gradable);
  assert.equal(source.summary.total, 54);
  assert.equal(source.summary.gradable, passIds.length + failIds.length);
  assert.equal(source.summary.boundary_violations, 0);
  const reviewGatePassed = failIds.length === 0 && passIds.length + notGradableIds.length === 54;
  return { required: 54, reviewed: 54, gradable: source.summary.gradable, passed: passIds.length, failed: failIds.length,
    not_gradable: notGradableIds.length, not_gradable_ids: notGradableIds, boundary_violations: source.summary.boundary_violations,
    gradable_pass_rate: source.summary.gradable_pass_rate, review_gate_passed: reviewGatePassed,
    status: reviewGatePassed && notGradableIds.length > 0 ? "passed_with_context_limits" : reviewGatePassed ? "passed" : "failed",
    receipt_path: pointer.receipt_path, receipt_sha256: pointer.receipt_sha256 };
}

function loadComparisonQuestions() {
  const source = loadJson(path.join(output, "codegraph-comparison-verdicts.json"));
  if (!source) return { required: 6, verified: 0, passed: false, status: "missing_receipt" };
  const requiredIds = numberedIds("comparison", 6);
  assert.equal(source.schema_version, 1);
  assert.equal(source.reviewer_independent_of_implementation, true);
  assert.equal(source.black_box_codegraph_1_5, true);
  assert.equal(artifactManifestDigest("comparison", 6), source.review_artifacts_digest, "Reviewed comparison answers changed");
  assert.deepEqual(source.cases.map((item) => item.id).sort(), requiredIds);
  assert.equal(new Set(source.cases.map((item) => item.id)).size, 6);
  assert.ok(source.cases.every((item) => ["pass", "partial", "fail"].includes(item.result)));
  const pass = source.cases.filter((item) => item.result === "pass").length;
  const partial = source.cases.filter((item) => item.result === "partial").length;
  const fail = source.cases.filter((item) => item.result === "fail").length;
  assert.deepEqual(source.summary, { total: 6, pass, partial, fail });
  const passed = pass === 6 && partial === 0 && fail === 0;
  return { required: 6, verified: source.cases.length, passed, pass, partial, fail,
    status: passed ? "passed" : "failed", receipt_path: path.relative(root, path.join(output, "codegraph-comparison-verdicts.json")) };
}

function loadLongDurationSoak() {
  const pointer = loadJson(path.join(output, "long-duration-soak-pointer.json"));
  if (!pointer) return { passed: false, status: "missing_receipt", production_daemon: "not_tested" };
  assert.equal(pointer.schema_version, 1);
  assert.equal(pointer.kind, "long_duration_python_soak_pointer");
  const sourcePath = resolveAcceptancePath(pointer.receipt_path);
  const bytes = readFileSync(sourcePath);
  assert.equal(sha256Bytes(bytes), pointer.receipt_sha256, "Long-duration soak receipt digest changed");
  const source = JSON.parse(bytes.toString("utf8"));
  assert.equal(source.engine_digest, currentEngineDigest(), "Long-duration soak engine changed");
  const rounds = source.result?.rounds ?? [];
  const rss = rounds.map((round) => round.memory?.rss);
  assert.ok(rss.every((value) => Number.isFinite(value) && value > 0));
  const tail = rss.slice(Math.floor(rss.length / 2));
  const retainedGrowth = rss.length ? rss.at(-1) - rss[0] : Number.POSITIVE_INFINITY;
  const tailRange = tail.length ? Math.max(...tail) - Math.min(...tail) : Number.POSITIVE_INFINITY;
  const passed = source.corpus === "poetry" && source.mode === "semantic" && source.gc_mode === "forced" &&
    source.passed === true && source.exit_code === 0 && source.timed_out === false && source.measurement_errors === 0 && source.failure === null &&
    Number.isInteger(source.requested_rounds) && source.requested_rounds >= 12 && rounds.length === source.requested_rounds &&
    rounds.every((round, index) => round.round === index + 1) &&
    source.sampled_peak_process_tree_rss_bytes > 0 && source.sampled_peak_process_tree_rss_bytes <= 2 * 1024 ** 3 &&
    retainedGrowth <= 256 * 1024 ** 2 && tailRange <= 128 * 1024 ** 2;
  return { passed, status: passed ? "passed_local_persistent_python_corpus" : "failed",
    corpus: source.corpus, mode: source.mode, gc_mode: source.gc_mode, rounds: rounds.length,
    sampled_peak_process_tree_rss_bytes: source.sampled_peak_process_tree_rss_bytes,
    retained_rss_growth_bytes: retainedGrowth, second_half_rss_range_bytes: tailRange,
    coverage_status: rounds.at(-1)?.coverage?.status ?? "unknown", configurations_included: source.result?.configurations_included ?? false,
    semantic_completeness_claimed: source.result?.semantic_completeness_claimed ?? false,
    production_daemon: "not_implemented_or_tested", receipt_path: pointer.receipt_path, receipt_sha256: pointer.receipt_sha256 };
}

function loadSyntaxPerformance() {
  const source = loadJson(path.join(output, "syntax-performance.json"));
  if (!source) return { passed: false, status: "missing_receipt" };
  assert.equal(source.schema_version, 1);
  assert.equal(typeof source.gate?.passed, "boolean");
  assert.deepEqual(
    {
      policy: source.gate.policy,
      full_ms: source.gate.full_ms,
      incremental_ms: source.gate.incremental_ms,
      peak_rss_kib: source.gate.peak_rss_kib,
    },
    EXPECTED_SYNTAX_GATE,
    "Syntax release budget policy changed",
  );
  assert.deepEqual(
    {
      full_ms: source.optimization_target?.full_ms,
      incremental_ms: source.optimization_target?.incremental_ms,
      peak_rss_kib: source.optimization_target?.peak_rss_kib,
    },
    EXPECTED_SYNTAX_TARGET,
    "Syntax optimization target changed",
  );
  const currentManifestDigest = currentSyntaxCorpusManifestDigest();
  const fresh = source.corpus?.manifest_digest === currentManifestDigest && source.engine_digest === currentEngineDigest();
  const full = source.metrics_ms?.full_pipeline?.p95;
  const incremental = source.metrics_ms?.single_file_incremental?.p95;
  const rss = source.max_rss_kib;
  const validMeasurements = [full, incremental, rss].every((value) => Number.isFinite(value) && value > 0) &&
    Number.isInteger(source.iterations) && source.iterations > 0;
  const measuredPass = validMeasurements && full <= EXPECTED_SYNTAX_GATE.full_ms &&
    incremental <= EXPECTED_SYNTAX_GATE.incremental_ms && rss <= EXPECTED_SYNTAX_GATE.peak_rss_kib;
  const passed = source.gate.passed && measuredPass && fresh;
  return { passed, status: !fresh ? "stale_receipt" : passed ? "passed" : "failed",
    receipt_fresh: fresh, current_manifest_digest: currentManifestDigest,
    manifest_digest: source.corpus?.manifest_digest, full_p95_ms: source.metrics_ms?.full_pipeline?.p95,
    incremental_p95_ms: source.metrics_ms?.single_file_incremental?.p95, max_rss_kib: source.max_rss_kib,
    policy: source.gate.policy,
    budgets: { full_ms: source.gate.full_ms, incremental_ms: source.gate.incremental_ms, peak_rss_kib: source.gate.peak_rss_kib },
    optimization_target_passed: validMeasurements && full <= EXPECTED_SYNTAX_TARGET.full_ms &&
      incremental <= EXPECTED_SYNTAX_TARGET.incremental_ms && rss <= EXPECTED_SYNTAX_TARGET.peak_rss_kib,
    optimization_target: EXPECTED_SYNTAX_TARGET };
}

function loadEvidence(load) {
  try { return load(); }
  catch {
    // Invalid or stale evidence must replace any earlier successful receipt.
    // Retain only a safe status; local assertion payloads may contain paths/data.
    return { passed: false, review_gate_passed: false, status: "invalid_receipt", error_code: "RECEIPT_VALIDATION_FAILED" };
  }
}

function loadJson(filename) {
  return existsSync(filename) ? JSON.parse(readFileSync(filename, "utf8")) : null;
}

function resolveAcceptancePath(relativePath) {
  assert.equal(typeof relativePath, "string");
  const acceptanceRoot = path.join(root, ".workspace", "acceptance");
  const resolved = path.resolve(output, relativePath);
  assert.ok(resolved.startsWith(`${acceptanceRoot}${path.sep}`), "Receipt must stay inside .workspace/acceptance");
  return resolved;
}

function numberedIds(prefix, count) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`).sort();
}

function artifactManifestDigest(prefix, count) {
  return canonicalHash(numberedIds(prefix, count).map((id) => {
    const file = `${id}.json`;
    return { file, sha256: sha256Bytes(readFileSync(path.join(root, ".workspace", "acceptance", "release-review", file))) };
  }));
}

function currentSyntaxCorpusManifestDigest() {
  const paths = [
    ...walk(path.join(root, "src")).filter((name) => name.endsWith(".ts")),
    ...walk(path.join(root, "benchmark", "corpus", "python")).filter((name) => name.endsWith(".py")),
  ];
  return canonicalHash(paths.sort().map((name) => {
    const sourceBytes = readFileSync(name);
    return { relative_path: path.relative(root, name).split(path.sep).join("/"), language: name.endsWith(".py") ? "python" : "typescript",
      source_digest: sha256Bytes(sourceBytes), byte_length: sourceBytes.byteLength };
  }));
}

function currentEngineDigest() {
  return releaseEngineDigest(root);
}
