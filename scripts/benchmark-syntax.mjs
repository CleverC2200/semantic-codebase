import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
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

if (process.env.SCB_BENCHMARK_WORKER === "1") {
  runWorker();
} else {
  runCoordinator();
}

function runCoordinator() {
  const scriptPath = fileURLToPath(import.meta.url);
  const workers = [];
  for (let iteration = 0; iteration < WARMUPS + ITERATIONS; iteration += 1) {
    const child = spawnSync(process.execPath, ["--expose-gc", scriptPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, SCB_BENCHMARK_WORKER: "1" },
      maxBuffer: 4 * 1024 * 1024,
    });
    if (child.status !== 0) {
      throw new Error(`Benchmark worker failed: ${child.stderr || child.stdout}`);
    }
    if (iteration >= WARMUPS) workers.push(JSON.parse(child.stdout));
  }
  const first = workers[0];
  const output = {
    schema_version: 1,
    corpus: first.corpus,
    iterations: ITERATIONS,
    process_model: "one isolated worker process per measured build",
    metrics_ms: summarizeSamples(workers.map((worker) => worker.sample)),
    max_rss_kib: Math.max(...workers.map((worker) => worker.max_rss_kib)),
    final_rss_kib: Math.max(...workers.map((worker) => worker.final_rss_kib)),
    facts: first.facts,
    note: "postprocess_normalize_estimate is syntax_extract minus isolated parse and Query execution; it is clamped at zero. Long-lived daemon memory soak is outside this gate.",
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function runWorker() {
  const adapters = [new TypeScriptTreeSitterAdapter(), new PythonTreeSitterAdapter()];
  const adapterByLanguage = new Map(adapters.map((adapter) => [adapter.manifest.language, adapter]));
  const files = loadCorpus();
  const source = { repository_id: "semantic-codebase-benchmark", files };
  const indexer = new RepositoryIndexer({ adapters });
  const baseline = indexer.buildFull(source).state;
  const modified = withSingleFileChange(source);
  const profileQueries = loadQueries();
  const sample = profileOnce({
    adapters,
    adapterByLanguage,
    files,
    source,
    indexer,
    baseline,
    modified,
    profileQueries,
  });
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
    return { file, tree: parser.parse(new TextDecoder().decode(file.source_bytes)) };
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
  const fullStart = performance.now();
  context.indexer.buildFull(context.source);
  const fullMs = performance.now() - fullStart;
  const incrementalStart = performance.now();
  context.indexer.buildIncremental(context.baseline, context.modified);
  const incrementalMs = performance.now() - incrementalStart;
  return {
    parse_only: parseMs,
    query_only: queryMs,
    postprocess_normalize_estimate: Math.max(0, syntaxMs - parseMs - queryMs),
    syntax_extract: syntaxMs,
    resolver: resolverMs,
    canonicalizer: canonicalizerMs,
    full_pipeline: fullMs,
    single_file_incremental: incrementalMs,
  };
}

function loadCorpus() {
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

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.posix.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}
