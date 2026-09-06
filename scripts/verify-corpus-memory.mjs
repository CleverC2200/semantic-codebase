import { releaseEngineDigest } from "./release-engine-identity.mjs";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setImmediate } from "node:timers/promises";
import { RepositoryIndexer, TypeScriptTreeSitterAdapter, PythonTreeSitterAdapter, SemanticRepositoryEnricher, DeterministicResolver, SnapshotCanonicalizer, canonicalHash, sha256Bytes } from "../dist/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const corpus = process.argv[2];
if (!["zod-v3", "zod-src", "poetry"].includes(corpus)) throw new Error("Choose zod-v3, zod-src or poetry");
const lowMemory = process.execArgv.includes("--max-semi-space-size=8");
const roundCount = Number(process.env.CORPUS_ROUNDS ?? 4);
assert.ok(Number.isInteger(roundCount) && roundCount >= 4 && roundCount <= 24, "CORPUS_ROUNDS must be 4..24");
const mode = process.env.CORPUS_MODE ?? "semantic";
assert.ok(["semantic", "syntax"].includes(mode), "CORPUS_MODE must be semantic or syntax");
const gcMode = process.env.CORPUS_GC ?? "forced";
assert.ok(["forced", "natural"].includes(gcMode), "CORPUS_GC must be forced or natural");
const label = process.env.CORPUS_LABEL ?? "";
assert.ok(!label || /^[a-z0-9-]{1,40}$/.test(label), "Invalid CORPUS_LABEL");
const directory = path.join(root, ".workspace/acceptance/corpus-memory");
mkdirSync(directory, { recursive: true });
const receiptPath = path.join(directory, `${corpus}-${lowMemory ? "semi8" : "default"}${mode === "syntax" ? "-syntax" : ""}${roundCount === 4 ? "" : `-${roundCount}rounds`}${gcMode === "natural" ? "-natural-gc" : ""}${label ? `-${label}` : ""}.json`);
const adapterManifests = [new TypeScriptTreeSitterAdapter().manifest, new PythonTreeSitterAdapter().manifest];
const engineDigest = releaseEngineDigest(root);

if (!process.argv.includes("--worker")) {
  // Measure descendants too: Python's compiler work occurs outside the host.
  const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), corpus, "--worker"], {
    cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let pending = "", final, failure, peakTreeRss = 0, peakHostRss = 0, measurementErrors = 0, timedOut = false, peakDescendants = 0;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (value) => {
    pending += value;
    let end;
    while ((end = pending.indexOf("\n")) >= 0) {
      const row = JSON.parse(pending.slice(0, end)); pending = pending.slice(end + 1);
      if (row.type === "result") final = row;
      else { if (row.type === "failure") failure = row; console.log(JSON.stringify(row)); }
    }
  });
  // Do not retain arbitrary compiler output in the acceptance receipt.
  child.stderr.resume();
  function sample() {
    try {
      const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss="], { encoding: "utf8", timeout: 2000 }).trim().split("\n")
        .map((line) => line.trim().split(/\s+/).map(Number));
      const owned = new Set([child.pid]);
      let changed = true;
      while (changed) { changed = false; for (const [pid, ppid] of rows) if (owned.has(ppid) && !owned.has(pid)) { owned.add(pid); changed = true; } }
      peakDescendants = Math.max(peakDescendants, rows.filter(([pid]) => pid !== child.pid && owned.has(pid)).length);
      peakTreeRss = Math.max(peakTreeRss, rows.reduce((sum, [pid, , rss]) => sum + (owned.has(pid) ? rss * 1024 : 0), 0));
      peakHostRss = Math.max(peakHostRss, (rows.find(([pid]) => pid === child.pid)?.[2] ?? 0) * 1024);
    } catch { measurementErrors++; }
  }
  const timer = setInterval(sample, 250);
  const deadline = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGTERM"); } catch {} }, 240000);
  const code = await new Promise((resolve) => { child.on("error", () => resolve(-1)); child.on("close", resolve); });
  clearInterval(timer); clearTimeout(deadline);
  const passed = code === 0 && !!final && !timedOut && measurementErrors === 0 && peakTreeRss > 0 && peakTreeRss <= 2 * 1024 ** 3;
  const receipt = { corpus, engine_digest: engineDigest, adapter_manifests: adapterManifests, exec_args: process.execArgv, runtime: { node: process.version, v8: process.versions.v8 },
    exit_code: code, timed_out: timedOut, measurement_errors: measurementErrors, sampling_interval_ms: 250,
    mode, gc_mode: gcMode, requested_rounds: roundCount, sampled_peak_descendants: peakDescendants,
    sampled_peak_process_tree_rss_bytes: peakTreeRss, sampled_peak_host_rss_bytes: peakHostRss,
    resource_budget_bytes: 2 * 1024 ** 3, passed, result: final ?? null, failure: failure ?? null,
    scope: "repeated selected-source analyses; sampled RSS is not an exact peak, resource pass is not semantic correctness or long-duration stability",
    application_executed: false, model_invoked: false };
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ receipt: receiptPath, passed, peakTreeRss, peakHostRss, timedOut }));
  if (!passed) process.exitCode = 1;
} else {
  if (gcMode === "forced" && !global.gc) throw new Error("Use --expose-gc");
  const relativeRoot = corpus === "poetry" ? "references/poetry/src" : corpus === "zod-src" ? "references/zod/packages/zod/src" : "references/zod/packages/zod/src/v3";
  const language = corpus === "poetry" ? "python" : "typescript";
  function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isSymbolicLink() ? [] :
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]); }
  const sourceRoot = path.join(root, relativeRoot);
  const files = walk(sourceRoot).filter((name) => name.endsWith(language === "python" ? ".py" : ".ts")).sort().map((name) => {
    const source_bytes = readFileSync(name);
    return { relative_path: path.relative(sourceRoot, name).split(path.sep).join("/"), language, source_bytes, source_digest: sha256Bytes(source_bytes) };
  });
  const manifest = files.map(({ relative_path, source_digest, source_bytes }) => ({ relative_path, source_digest, bytes: source_bytes.length }));
  console.log(JSON.stringify({ type: "started", corpus, files: files.length, bytes: manifest.reduce((sum, f) => sum + f.bytes, 0) }));
  const adapter = language === "python" ? new PythonTreeSitterAdapter() : new TypeScriptTreeSitterAdapter();
  const indexer = new RepositoryIndexer({ adapters: [adapter] });
  const enricher = new SemanticRepositoryEnricher(), hashes = new Map(), rounds = [];
  let state;
  for (let round = 0; round < roundCount; round++) {
    const variant = round % 2;
    const bytes = Buffer.concat([files[0].source_bytes, Buffer.from(variant ? "\n" : "")]);
    const source = { repository_id: `memory-${corpus}`, files: [{ ...files[0], source_bytes: bytes, source_digest: sha256Bytes(bytes) }, ...files.slice(1)] };
    const start = performance.now();
    try {
      state = state ? indexer.buildIncremental(state, source).state : indexer.buildFull(source).state;
    } catch (error) {
      const slices = source.files.map((file) => adapter.extract({ ...file, repository_id: source.repository_id, snapshot_id: "diagnostic-only" }));
      const repository = { manifest: { repository_id: source.repository_id, snapshot_id: "diagnostic-only", files: source.files.map(({ source_bytes, ...file }) => ({ ...file, byte_length: source_bytes.length })) }, slices, adapter_manifests: [adapter.manifest] };
      const graph = new SnapshotCanonicalizer().canonicalize({ repository, resolution: new DeterministicResolver().resolve(repository) });
      const diagnostics = graph.diagnostics.filter((item) => item.severity === "error").map(({ code, file_path, span, message }) => ({ code, file_path, span, message }));
      console.log(JSON.stringify({ type: "failure", code: error.code ?? "index_error", diagnostics: diagnostics.slice(0, 40), diagnostic_count: diagnostics.length }));
      throw error;
    }
    const overlay = mode === "semantic" ? enricher.enrich({ state, source }) : { overlay_hash: state.graph.graph_hash, facts: [], coverage: state.graph.coverage };
    if (hashes.has(variant)) assert.equal(overlay.overlay_hash, hashes.get(variant), "Repeated input overlay changed");
    hashes.set(variant, overlay.overlay_hash);
    await setImmediate(); await setImmediate();
    if (gcMode === "forced") global.gc();
    const sample = { round: round + 1, ms: performance.now() - start, snapshot: state.snapshot_id, overlay_hash: overlay.overlay_hash,
      facts: overlay.facts.length, coverage: overlay.coverage, memory: process.memoryUsage(), active_resources: process.getActiveResourcesInfo() };
    rounds.push(sample);
    console.log(JSON.stringify({ type: "round", corpus, round: sample.round, ms: sample.ms, facts: sample.facts, memory: sample.memory, resources: sample.active_resources, coverage: sample.coverage.status }));
  }
  for (let i = 0; i < files.length; i++) assert.equal(sha256Bytes(readFileSync(path.join(sourceRoot, files[i].relative_path))), files[i].source_digest, "Source changed during measurement");
  console.log(JSON.stringify({ type: "result", manifest, manifest_digest: canonicalHash(manifest), rounds,
    max_host_rss_kib: process.resourceUsage().maxRSS, scope: relativeRoot, configurations_included: false, semantic_completeness_claimed: false }));
}
