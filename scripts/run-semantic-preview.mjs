import { renderSemanticPreview } from "./semantic-preview-explorer.mjs";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  RepositoryIndexer,
  PythonPyrightEnricher,
  PythonTreeSitterAdapter,
  answerContextPackage,
  answerContextPackageWithCodex,
  buildContextPackage,
  SqliteSnapshotStore,
  TypeScriptSemanticEnricher,
  TypeScriptTreeSitterAdapter,
  canonicalHash,
  canonicalJson,
  importOpenTelemetryJson,
  sha256Bytes,
} from "../dist/index.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const referenceRoot = path.join(projectRoot, "references/zod");
const corpusRoot = path.join(referenceRoot, "packages/zod/src/v3");
const pythonCorpusRoot = path.join(projectRoot, "benchmark/corpus/python");
const suppliedOutput = process.argv.find(item => item.startsWith("--output="))?.slice("--output=".length);
const outputRoot = suppliedOutput ? path.resolve(suppliedOutput) : path.join(projectRoot, ".workspace/acceptance/semantic-preview");
const storePath = path.join(outputRoot, "preview.sqlite");
const excludedDirectories = new Set(["tests", "__tests__", "benchmarks", "fixtures"]);
const focusFile = "packages/zod/src/v3/helpers/parseUtil.ts";
const suppliedTrace = process.argv.find((item) => item.startsWith("--trace="))?.slice("--trace=".length);
const tracePath = suppliedTrace ? path.resolve(suppliedTrace) : path.join(projectRoot, "benchmark/corpus/runtime/zod-parse.otlp.json");
const goldPath = path.join(projectRoot, "benchmark/gold/semantic-preview-v0.json");
const useCodex = process.argv.includes("--codex");

const files = walk(corpusRoot)
  .filter((file) => /\.(?:ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file))
  .sort()
  .map((file) => {
    const source_bytes = readFileSync(file);
    return {
      relative_path: path.relative(referenceRoot, file).split(path.sep).join("/"),
      language: "typescript",
      source_bytes,
      source_digest: sha256Bytes(source_bytes),
    };
  });

const source = {
  repository_id: "zod-v3-semantic-preview",
  files,
};
const started = performance.now();
const state = new RepositoryIndexer({
  adapters: [new TypeScriptTreeSitterAdapter()],
}).buildFull(source).state;
const overlay = new TypeScriptSemanticEnricher().enrich({ state, source });
const elapsedMs = Math.round((performance.now() - started) * 1000) / 1000;

const pythonFiles = walk(pythonCorpusRoot)
  .filter((file) => file.endsWith(".py"))
  .sort()
  .map((file) => {
    const source_bytes = readFileSync(file);
    return {
      relative_path: path.relative(pythonCorpusRoot, file).split(path.sep).join("/"),
      language: "python",
      source_bytes,
      source_digest: sha256Bytes(source_bytes),
    };
  });
const pythonSource = { repository_id: "python-semantic-preview", files: pythonFiles };
const pythonStarted = performance.now();
const pythonState = new RepositoryIndexer({
  adapters: [new PythonTreeSitterAdapter()],
}).buildFull(pythonSource).state;
const pythonOverlay = new PythonPyrightEnricher().enrich({ state: pythonState, source: pythonSource });
const pythonElapsedMs = Math.round((performance.now() - pythonStarted) * 1000) / 1000;

const factsByKind = countBy(overlay.facts, (fact) => fact.kind);
const factsByBasis = countBy(overlay.facts, (fact) => fact.basis.kind);
const evidenceById = new Map(overlay.evidence.map((item) => [item.evidence_id, item]));
const definitionsByKey = new Map(state.graph.definitions.map((item) => [item.definition_key, item]));
const focusFacts = overlay.facts.filter((fact) =>
  fact.evidence_ids.some((id) => evidenceById.get(id)?.file_path === focusFile),
);
const focusDefinitions = state.graph.definitions.filter((definition) => definition.file_path === focusFile);
const runtime = importOpenTelemetryJson({
  repository_id: state.repository_id,
  snapshot_id: state.snapshot_id,
  definitions: state.graph.definitions,
  overlay,
  trace: JSON.parse(readFileSync(tracePath, "utf8")),
});
const contextPackage = buildContextPackage({
  state,
  overlay,
  question: "parseUtil.ts 文件的入口、调用路径和主要作用是什么？",
  file_path: focusFile,
  runtime,
  max_facts: 300,
});
const evidenceAnswer = answerContextPackage(contextPackage);
const renderedAnswer = useCodex ? answerContextPackageWithCodex(contextPackage) : evidenceAnswer;
const observedGold = {
  zod: {
    snapshot_id: state.snapshot_id,
    overlay_hash: overlay.overlay_hash,
    semantic_facts: overlay.facts.length,
    facts_by_kind: factsByKind,
  },
  python: {
    snapshot_id: pythonState.snapshot_id,
    overlay_hash: pythonOverlay.overlay_hash,
    semantic_facts: pythonOverlay.facts.length,
    facts_by_kind: countBy(pythonOverlay.facts, (fact) => fact.kind),
  },
  runtime: {
    observation_set_hash: runtime.observation_set_hash,
    observations: runtime.observations.length,
    candidates: runtime.capability_candidates.length,
  },
  context: { intent: contextPackage.intent, facts: contextPackage.semantic_facts.length },
};
const expectedGold = JSON.parse(readFileSync(goldPath, "utf8"));
if (process.argv.includes("--print-regression-gold")) { console.log(JSON.stringify(observedGold, null, 2)); process.exit(0); }
const comparableGold = suppliedTrace ? { ...observedGold, runtime: expectedGold.runtime } : observedGold;
if (canonicalJson(comparableGold) !== canonicalJson(expectedGold)) {
  throw new Error(`Semantic preview does not match benchmark/gold/semantic-preview-v0.json: ${canonicalJson(observedGold)}`);
}
if (elapsedMs + pythonElapsedMs > 10000) {
  throw new Error("Semantic preview exceeded the 10 second analysis budget");
}
const receipt = {
  schema_version: 1,
  corpus: {
    project: "Zod",
    root: "packages/zod/src/v3",
    file_count: files.length,
    source_bytes: files.reduce((total, file) => total + file.source_bytes.byteLength, 0),
    manifest_hash: canonicalHash(files.map((file) => ({
      relative_path: file.relative_path,
      source_digest: file.source_digest,
    }))),
  },
  runtime: {
    node: process.version,
    typescript: overlay.profile.compiler_version,
    elapsed_ms: elapsedMs,
  },
  context_answer: {
    intent: contextPackage.intent,
    status: evidenceAnswer.status,
    mode: useCodex ? "codex" : "local_template",
    facts: contextPackage.semantic_facts.length,
    evidence: contextPackage.semantic_evidence.length,
    unknowns: evidenceAnswer.unknowns.length,
    package_hash: contextPackage.package_hash,
  },
  gate: {
    gold: "benchmark/gold/semantic-preview-v0.json",
    gold_status: "passed",
    max_analysis_ms: 10000,
    analysis_ms: elapsedMs + pythonElapsedMs,
    error_contracts: [
      "SOURCE_DIGEST_MISMATCH",
      "STALE_SNAPSHOT",
      "INVALID_OTEL_JSON",
      "ANSWER_INVENTED_EVIDENCE",
      "ANSWER_AUTHORITY_ESCALATION"
    ],
  },
  snapshot: {
    snapshot_id: state.snapshot_id,
    graph_hash: state.graph.graph_hash,
    overlay_hash: overlay.overlay_hash,
    structural_coverage: state.graph.coverage,
    semantic_coverage: overlay.coverage,
  },
  counts: {
    definitions: state.graph.definitions.length,
    structural_relations: state.graph.relations.length,
    semantic_facts: overlay.facts.length,
    semantic_evidence: overlay.evidence.length,
    diagnostics: overlay.diagnostics.length,
    facts_by_kind: factsByKind,
    facts_by_basis: factsByBasis,
  },
  focus: {
    file: focusFile,
    definitions: focusDefinitions.length,
    semantic_facts: focusFacts.length,
  },
  python: {
    file_count: pythonFiles.length,
    definitions: pythonState.graph.definitions.length,
    structural_relations: pythonState.graph.relations.length,
    semantic_facts: pythonOverlay.facts.length,
    semantic_evidence: pythonOverlay.evidence.length,
    diagnostics: pythonOverlay.diagnostics.length,
    facts_by_kind: countBy(pythonOverlay.facts, (fact) => fact.kind),
    facts_by_basis: countBy(pythonOverlay.facts, (fact) => fact.basis.kind),
    coverage: pythonOverlay.coverage,
    pyright: pythonOverlay.profile.compiler_version,
    elapsed_ms: pythonElapsedMs,
  },
  runtime: {
    trace: path.relative(projectRoot, tracePath),
    validation: suppliedTrace ? "external_trace_import_not_frozen_runtime_regression" : "frozen_sample_regression",
    observations: runtime.observations.length,
    matched_observations: runtime.coverage.matched_span_count,
    capability_candidates: runtime.capability_candidates.length,
    coverage: runtime.coverage,
    observation_set_hash: runtime.observation_set_hash,
  },
  commands: {
    preview: "npm run preview:semantic",
    output: ".workspace/acceptance/semantic-preview",
    sqlite: ".workspace/acceptance/semantic-preview/preview.sqlite",
  },
};

rmSync(outputRoot, { recursive: true, force: true });
if (suppliedOutput && existsSync(outputRoot)) throw new Error("Explicit output must be a new directory; existing frozen preview is preserved");
mkdirSync(outputRoot, { recursive: true });
const store = new SqliteSnapshotStore(storePath);
try {
  store.beginBuild(state.repository_id, state.snapshot_id);
  store.publishReady(state);
  store.publishSemanticOverlay(overlay);
  store.beginBuild(pythonState.repository_id, pythonState.snapshot_id);
  store.publishReady(pythonState);
  store.publishSemanticOverlay(pythonOverlay);
} finally {
  store.close();
}
writeFileSync(path.join(outputRoot, "semantic-overlay.json"), `${JSON.stringify(overlay, null, 2)}\n`);
writeFileSync(path.join(outputRoot, "python-semantic-overlay.json"), `${JSON.stringify(pythonOverlay, null, 2)}\n`);
writeFileSync(path.join(outputRoot, "runtime-observations.json"), `${JSON.stringify(runtime, null, 2)}\n`);
writeFileSync(path.join(outputRoot, "context-package.json"), `${JSON.stringify(contextPackage, null, 2)}\n`);
writeFileSync(path.join(outputRoot, "evidence-answer.json"), `${JSON.stringify(evidenceAnswer, null, 2)}\n`);
if (useCodex) {
  writeFileSync(path.join(outputRoot, "codex-evidence-answer.json"), `${JSON.stringify(renderedAnswer, null, 2)}\n`);
}
writeFileSync(path.join(outputRoot, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
writeFileSync(path.join(outputRoot, "inspect-semantic.sql"), `-- 先看每类语义事实的数量\nSELECT kind, basis_kind, COUNT(*) AS fact_count\nFROM semantic_facts\nGROUP BY kind, basis_kind\nORDER BY kind, basis_kind;\n\n-- 再看 parseUtil.ts 的可读事实与源码证据范围\nSELECT\n  f.kind,\n  f.basis_kind,\n  json_extract(f.fact_json, '$.value') AS value,\n  e.file_path,\n  e.start_byte,\n  e.end_byte\nFROM semantic_facts AS f\nJOIN json_each(f.fact_json, '$.evidence_ids') AS ids\nJOIN semantic_evidence AS e\n  ON e.repository_id = f.repository_id\n AND e.snapshot_id = f.snapshot_id\n AND e.evidence_id = ids.value\nWHERE f.file_path = 'packages/zod/src/v3/helpers/parseUtil.ts'\nORDER BY e.start_byte, f.kind\nLIMIT 200;\n`);
writeFileSync(path.join(outputRoot, "acceptance.html"), renderSemanticPreview({
  receipt,
  overlay,
  pythonOverlay,
  runtime,
  evidenceAnswer: renderedAnswer,
  focusFacts,
  definitionsByKey,
  evidenceById,
  sourceFiles: files,
  manifest: state.manifest, structuralGraph: state.graph,
}));

process.stdout.write(`${JSON.stringify({
  output: path.relative(projectRoot, outputRoot),
  store: path.relative(projectRoot, storePath),
  snapshot_id: state.snapshot_id,
  overlay_hash: overlay.overlay_hash,
  semantic_facts: overlay.facts.length,
  python_semantic_facts: pythonOverlay.facts.length,
  runtime_observations: runtime.observations.length,
  capability_candidates: runtime.capability_candidates.length,
  answer_status: renderedAnswer.status,
  answer_mode: useCodex ? "codex" : "local_template",
  facts_by_kind: factsByKind,
  facts_by_basis: factsByBasis,
  coverage: overlay.coverage,
  elapsed_ms: elapsedMs,
}, null, 2)}\n`);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return excludedDirectories.has(entry.name) ? [] : walk(target);
    return [target];
  });
}

function countBy(items, selector) {
  const result = {};
  for (const item of items) {
    const key = selector(item);
    result[key] = (result[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}
