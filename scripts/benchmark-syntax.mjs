import { releaseEngineDigest } from "./release-engine-identity.mjs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "tree-sitter";
import PythonGrammar from "tree-sitter-python";
import TypeScriptGrammar from "tree-sitter-typescript";

import {
  DeterministicResolver,
  PythonTreeSitterAdapter,
  RepositoryIndexer,
  SnapshotCanonicalizer,
  TypeScriptTreeSitterAdapter,
  canonicalHash,
  sha256Bytes,
} from "../dist/index.js";

const ITERATIONS = Number.parseInt(process.env.BENCHMARK_ITERATIONS ?? "9", 10);
const WARMUPS = Number.parseInt(process.env.BENCHMARK_WARMUPS ?? "2", 10);
const OPTIMIZATION_TARGET = { full_ms: 150, incremental_ms: 75, peak_rss_kib: 196608 };
const TEMPORARY_RELEASE_BUDGET = { full_ms: 300, incremental_ms: 150, peak_rss_kib: 196608 };

const workerMode = process.env.SCB_BENCHMARK_WORKER;
if (["profile", "full", "incremental"].includes(workerMode)) {
  runWorker(workerMode);
} else {
  runCoordinator();
}

function runCoordinator() {
  const scriptPath = fileURLToPath(import.meta.url);
  const workers = { profile: [], full: [], incremental: [] };
  for (let iteration = 0; iteration < WARMUPS + ITERATIONS; iteration += 1) {
    for (const mode of Object.keys(workers)) {
      const child = spawnSync(process.execPath, ["--expose-gc", scriptPath], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, SCB_BENCHMARK_WORKER: mode },
        maxBuffer: 4 * 1024 * 1024,
      });
      if (child.status !== 0) {
        throw new Error(`Benchmark ${mode} worker failed: ${child.stderr || child.stdout}`);
      }
      if (iteration >= WARMUPS) workers[mode].push(JSON.parse(child.stdout));
    }
  }
  const allWorkers = Object.values(workers).flat();
  const first = allWorkers[0];
  assert.equal(new Set(allWorkers.map((worker) => worker.corpus.manifest_digest)).size, 1, "Benchmark source changed across samples");
  assert.equal(new Set(allWorkers.map((worker) => worker.facts.graph_hash)).size, 1, "Benchmark graph changed across samples");
  const samples = workers.profile.map((worker, index) => ({
    ...worker.sample,
    ...workers.full[index].sample,
    ...workers.incremental[index].sample,
  }));
  const productWorkers = [...workers.full, ...workers.incremental];
  const output = {
    schema_version: 1,
    engine_digest: releaseEngineDigest(fileURLToPath(new URL("../", import.meta.url))),
    corpus: first.corpus,
    iterations: ITERATIONS,
    process_model: "separate isolated workers for profiling, one full build and one Ready-State single-file incremental build",
    metrics_ms: summarizeSamples(samples),
    max_rss_kib: Math.max(...productWorkers.map((worker) => worker.max_rss_kib)),
    final_rss_kib: Math.max(...productWorkers.map((worker) => worker.final_rss_kib)),
    profile_max_rss_kib: Math.max(...workers.profile.map((worker) => worker.max_rss_kib)),
    facts: first.facts,
    note: "The full worker performs exactly one product full build. The incremental worker first creates the required Ready State, then measures one single-file change after GC. max_rss_kib covers those isolated product workers; profile_max_rss_kib separately reports diagnostic stages that retain intermediate trees and slices. postprocess_normalize_estimate is syntax_extract minus isolated parse and Query execution; it is clamped at zero. Long-lived daemon memory soak is outside this gate.",
  };
  output.optimization_target = {
    ...OPTIMIZATION_TARGET,
    passed: passesBudget(output, OPTIMIZATION_TARGET),
  };
  output.gate = {
    policy: "temporary_v0_2_exception_2026_09_05",
    ...TEMPORARY_RELEASE_BUDGET,
    passed: passesBudget(output, TEMPORARY_RELEASE_BUDGET),
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (process.argv.includes("--receipt")) {
    const directory = fileURLToPath(new URL("../.workspace/acceptance/release-readiness/", import.meta.url));
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "syntax-performance.json"), JSON.stringify(output, null, 2));
  }
  if (process.argv.includes("--check-budget") && !output.gate.passed) process.exitCode = 1;
}

function runWorker(mode) {
  const adapters = [new TypeScriptTreeSitterAdapter(), new PythonTreeSitterAdapter()];
  const adapterByLanguage = new Map(adapters.map((adapter) => [adapter.manifest.language, adapter]));
  const files = loadCorpus();
  const source = { repository_id: "semantic-codebase-benchmark", files };
  const indexer = new RepositoryIndexer({ adapters });
  const modified = withSingleFileChange(source);
  let baseline;
  let sample;
  if (mode === "full") {
    const start = performance.now();
    baseline = indexer.buildFull(source).state;
    sample = { full_pipeline: performance.now() - start };
  } else {
    baseline = indexer.buildFull(source).state;
    globalThis.gc?.();
    if (mode === "incremental") {
      const start = performance.now();
      indexer.buildIncremental(baseline, modified);
      sample = { single_file_incremental: performance.now() - start };
    } else {
      sample = profileOnce({
        adapters,
        adapterByLanguage,
        files,
        source,
        baseline,
        profileQueries: loadQueries(),
      });
    }
  }
  globalThis.gc?.();
  process.stdout.write(`${JSON.stringify({
    corpus: {
      roots: ["src/**/*.ts", "benchmark/corpus/python/**/*.py"],
      manifest_digest: canonicalHash(
        files.map((file) => ({
          relative_path: file.relative_path,
          language: file.language,
          source_digest: file.source_digest,
          byte_length: file.source_bytes.byteLength,
        })),
      ),
      files: files.length,
      bytes: files.reduce((total, file) => total + file.source_bytes.byteLength, 0),
    },
    sample,
    max_rss_kib: process.resourceUsage().maxRSS,
    final_rss_kib: Math.round(process.memoryUsage().rss / 1024),
    facts: {
      definitions: baseline.graph.definitions.length,
      relations: baseline.graph.relations.length,
      unresolved_candidates: baseline.graph.unresolved_candidates.length,
      evidence: baseline.graph.evidence.length,
      graph_hash: baseline.graph.graph_hash,
      coverage_status: baseline.graph.coverage.status,
    },
  })}\n`);
}

function profileOnce(context) {
  const parseStart = performance.now();
  const trees = context.files.map((file) => {
    const parser = new Parser();
    parser.setLanguage(file.language === "typescript" ? TypeScriptGrammar.typescript : PythonGrammar);
    const text = new TextDecoder().decode(file.source_bytes);
    return { file, tree: parser.parse((index) => text.slice(index, index + 8192)) };
  });
  const parseMs = performance.now() - parseStart;
  const queryStart = performance.now();
  for (const { file, tree } of trees) {
    const languageQueries = context.profileQueries.get(file.language);
    languageQueries.definitions.matches(tree.rootNode);
    languageQueries.relations.captures(tree.rootNode);
  }
  const queryMs = performance.now() - queryStart;
  const syntaxStart = performance.now();
  const slices = context.files.map((file) =>
    context.adapterByLanguage.get(file.language).extract({
      repository_id: context.source.repository_id,
      snapshot_id: context.baseline.snapshot_id,
      ...file,
    }),
  );
  const syntaxMs = performance.now() - syntaxStart;
  const repository = {
    manifest: {
      repository_id: context.source.repository_id,
      snapshot_id: context.baseline.snapshot_id,
      files: context.files.map((file) => ({
        relative_path: file.relative_path,
        language: file.language,
        source_digest: file.source_digest,
        byte_length: file.source_bytes.byteLength,
      })),
    },
    slices,
    adapter_manifests: context.adapters.map((adapter) => adapter.manifest),
  };
  const resolverStart = performance.now();
  const resolution = new DeterministicResolver().resolve(repository);
  const resolverMs = performance.now() - resolverStart;
  const canonicalizerStart = performance.now();
  new SnapshotCanonicalizer().canonicalize({ repository, resolution });
  const canonicalizerMs = performance.now() - canonicalizerStart;
  return {
    parse_only: parseMs,
    query_only: queryMs,
    postprocess_normalize_estimate: Math.max(0, syntaxMs - parseMs - queryMs),
    syntax_extract: syntaxMs,
    resolver: resolverMs,
    canonicalizer: canonicalizerMs,
  };
}

function loadCorpus() {
  if (process.env.BENCHMARK_FROZEN_SOURCE) return JSON.parse(readFileSync(process.env.BENCHMARK_FROZEN_SOURCE, "utf8")).map((file) => {
    const source_bytes = Buffer.from(file.text, "utf8");
    return { relative_path: file.relative_path, language: file.language, source_bytes, source_digest: sha256Bytes(source_bytes) };
  });
  const entries = [
    ...walk("src").filter((file) => file.endsWith(".ts")).map((file) => [file, "typescript"]),
    ...walk("benchmark/corpus/python").filter((file) => file.endsWith(".py")).map((file) => [file, "python"]),
  ];
  return entries.sort(([left], [right]) => left.localeCompare(right)).map(([relative_path, language]) => {
    const source_bytes = readFileSync(relative_path);
    return { relative_path, language, source_bytes, source_digest: sha256Bytes(source_bytes) };
  });
}

function loadQueries() {
  const definitions = {
    typescript: readFileSync("dist/syntax/tree-sitter/typescript/definitions.scm", "utf8"),
    python: readFileSync("dist/syntax/tree-sitter/python/definitions.scm", "utf8"),
  };
  const relations = {
    typescript: readFileSync("dist/syntax/tree-sitter/typescript/relations.scm", "utf8"),
    python: readFileSync("dist/syntax/tree-sitter/python/relations.scm", "utf8"),
  };
  return new Map([
    ["typescript", {
      definitions: new Parser.Query(TypeScriptGrammar.typescript, definitions.typescript),
      relations: new Parser.Query(TypeScriptGrammar.typescript, relations.typescript),
    }],
    ["python", {
      definitions: new Parser.Query(PythonGrammar, definitions.python),
      relations: new Parser.Query(PythonGrammar, relations.python),
    }],
  ]);
}

function withSingleFileChange(repositorySource) {
  const changedPath = repositorySource.files.find((file) => file.language === "typescript").relative_path;
  return {
    repository_id: repositorySource.repository_id,
    files: repositorySource.files.map((file) => {
      if (file.relative_path !== changedPath) return file;
      const source_bytes = Buffer.concat([file.source_bytes, Buffer.from("\n// benchmark single-file change\n")]);
      return { ...file, source_bytes, source_digest: sha256Bytes(source_bytes) };
    }),
  };
}

function summarizeSamples(values) {
  return Object.fromEntries(
    Object.keys(values[0]).map((key) => {
      const sorted = values.map((value) => value[key]).sort((left, right) => left - right);
      return [key, {
        median: round(percentile(sorted, 0.5)),
        p95: round(percentile(sorted, 0.95)),
      }];
    }),
  );
}

function percentile(sorted, ratio) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function passesBudget(output, budget) {
  return output.metrics_ms.full_pipeline.p95 <= budget.full_ms &&
    output.metrics_ms.single_file_incremental.p95 <= budget.incremental_ms &&
    output.max_rss_kib <= budget.peak_rss_kib;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.posix.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}
