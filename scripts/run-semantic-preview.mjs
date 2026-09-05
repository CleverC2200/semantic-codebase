import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const outputRoot = path.join(projectRoot, ".workspace/acceptance/semantic-preview");
const storePath = path.join(outputRoot, "preview.sqlite");
const excludedDirectories = new Set(["tests", "__tests__", "benchmarks", "fixtures"]);
const focusFile = "packages/zod/src/v3/helpers/parseUtil.ts";
const tracePath = path.join(projectRoot, "benchmark/corpus/runtime/zod-parse.otlp.json");
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
if (canonicalJson(observedGold) !== canonicalJson(expectedGold)) {
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
    trace: "benchmark/corpus/runtime/zod-parse.otlp.json",
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
writeFileSync(path.join(outputRoot, "acceptance.html"), renderHtml({
  receipt,
  overlay,
  pythonOverlay,
  runtime,
  evidenceAnswer: renderedAnswer,
  focusFacts,
  definitionsByKey,
  evidenceById,
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

function renderHtml({ receipt, overlay, pythonOverlay, runtime, evidenceAnswer, focusFacts, definitionsByKey, evidenceById }) {
  const kindLabels = {
    application_flow: "应用主线",
    call_target: "调用目标",
    control_step: "控制步骤",
    effect: "副作用",
    entrypoint: "入口",
    symbol_type: "符号类型",
    import_target: "导入目标",
    reference_target: "引用目标",
  };
  const basisLabels = {
    compiler_exact: "编译器精确",
    framework_heuristic: "规则推断",
    static_possible: "静态可能",
  };
  const cards = [
    ["源码文件", receipt.corpus.file_count],
    ["结构定义", receipt.counts.definitions],
    ["语义事实", receipt.counts.semantic_facts],
    ["源码证据", receipt.counts.semantic_evidence],
  ].map(([label, value]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");
  const kindRows = Object.entries(receipt.counts.facts_by_kind)
    .map(([kind, count]) => `<tr><td>${escapeHtml(kindLabels[kind] ?? kind)}</td><td>${count}</td></tr>`)
    .join("");
  const basisRows = Object.entries(receipt.counts.facts_by_basis)
    .map(([basis, count]) => `<tr><td><span class="basis ${basis}">${escapeHtml(basisLabels[basis] ?? basis)}</span></td><td>${count}</td></tr>`)
    .join("");
  const factRows = focusFacts.slice(0, 160).map((fact) => {
    const subject = fact.subject.kind === "definition"
      ? definitionsByKey.get(fact.subject.definition_key)?.qualified_name ?? fact.subject.definition_key
      : fact.subject.file_path;
    const firstEvidence = evidenceById.get(fact.evidence_ids[0]);
    const location = firstEvidence
      ? `${firstEvidence.file_path}:${firstEvidence.span.start_byte}-${firstEvidence.span.end_byte}`
      : "无";
    return `<tr><td>${escapeHtml(kindLabels[fact.kind] ?? fact.kind)}</td><td>${escapeHtml(subject)}</td><td><span class="basis ${fact.basis.kind}">${escapeHtml(basisLabels[fact.basis.kind] ?? fact.basis.kind)}</span></td><td><code>${escapeHtml(compactValue(fact.value))}</code></td><td><code>${escapeHtml(location)}</code></td></tr>`;
  }).join("");
  const unknown = overlay.coverage.status === "partial"
    ? `存在 ${overlay.diagnostics.length} 条 TypeScript 诊断，因此局部事实可用，但不能据此作仓库级穷举结论。`
    : "当前分析范围完整；动态调用仍按单条事实的 static-possible 状态解释。";
  const pythonRows = Object.entries(receipt.python.facts_by_kind)
    .map(([kind, count]) => `<tr><td>${escapeHtml(kindLabels[kind] ?? kind)}</td><td>${count}</td></tr>`)
    .join("");
  const capabilityRows = runtime.capability_candidates.map((candidate) => `<tr><td>${escapeHtml(candidate.title)}</td><td>Candidate</td><td>${candidate.observed_definition_keys.length}</td><td>${candidate.static_flow_fact_ids.length}</td></tr>`).join("");
  const answerRows = evidenceAnswer.findings.map((finding) => `<li>${escapeHtml(finding.text)} <span class="muted">(${finding.fact_ids.length} facts / ${finding.evidence_ids.length} evidence / ${escapeHtml(finding.basis_kinds.join(", "))})</span></li>`).join("");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Semantic Codebase V0 预览</title>
<style>
:root{font-family:Inter,"PingFang SC",system-ui,sans-serif;color:#172033;background:#f3f6fb}body{margin:0}.wrap{max-width:1280px;margin:auto;padding:40px 28px 72px}h1{font-size:30px;margin:0 0 8px}h2{margin-top:38px}.muted{color:#687386}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:26px 0}.cards article,.panel{background:white;border:1px solid #dfe5ef;border-radius:14px;box-shadow:0 8px 24px #1720330a}.cards article{padding:20px}.cards span{display:block;color:#687386}.cards strong{display:block;font-size:30px;margin-top:8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.panel{padding:20px;overflow:auto}.notice{border-left:4px solid #d98b19;background:#fff8e8;padding:14px 18px;border-radius:8px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #edf0f5}th{color:#596579;background:#f8fafc;position:sticky;top:0}.basis{display:inline-block;border-radius:999px;padding:3px 8px;font-size:12px;white-space:nowrap}.compiler_exact{background:#e6f6ee;color:#137548}.static_possible{background:#fff2cc;color:#8a6100}.framework_heuristic{background:#eeeaff;color:#5d42a8}code{font-family:"SFMono-Regular",Consolas,monospace;white-space:pre-wrap;word-break:break-word}.facts{max-height:620px;overflow:auto}@media(max-width:850px){.cards,.grid{grid-template-columns:1fr 1fr}}@media(max-width:560px){.cards,.grid{grid-template-columns:1fr}.wrap{padding:24px 14px}}
</style></head><body><main class="wrap">
<p class="muted">Semantic Codebase · TypeScript Compiler Preview</p><h1>Zod v3 语义理解预览</h1>
<p class="muted">Snapshot <code>${escapeHtml(receipt.snapshot.snapshot_id.slice(0, 16))}…</code> · Overlay <code>${escapeHtml(receipt.snapshot.overlay_hash.slice(0, 16))}…</code> · ${receipt.runtime.elapsed_ms} ms</p>
<section class="cards">${cards}</section>
<p class="notice"><strong>如何理解 unknown：</strong>${escapeHtml(unknown)}</p>
<section class="grid"><div class="panel"><h2>生成了什么</h2><table><thead><tr><th>语义类型</th><th>数量</th></tr></thead><tbody>${kindRows}</tbody></table></div>
<div class="panel"><h2>证据地位</h2><table><thead><tr><th>来源</th><th>数量</th></tr></thead><tbody>${basisRows}</tbody></table></div></section>
<h2>Python / Pyright 纵切片</h2><p class="muted">${receipt.python.file_count} 个文件 · ${receipt.python.semantic_facts} 条语义事实 · Pyright ${escapeHtml(receipt.python.pyright)} · Coverage ${escapeHtml(receipt.python.coverage.status)} · ${receipt.python.elapsed_ms} ms</p>
<div class="panel"><table><thead><tr><th>语义类型</th><th>数量</th></tr></thead><tbody>${pythonRows}</tbody></table></div>
<h2>运行时观测与能力候选</h2><p class="muted">仅导入冻结 OTLP JSON；${receipt.runtime.observations} 个 span 中匹配 ${receipt.runtime.matched_observations} 个。Candidate 不会自动升级为正式能力。</p>
<div class="panel"><table><thead><tr><th>名称</th><th>状态</th><th>观测到的定义</th><th>关联静态主线</th></tr></thead><tbody>${capabilityRows}</tbody></table></div>
<h2>中文 Evidence Answer</h2><div class="panel"><p><strong>${escapeHtml(evidenceAnswer.summary)}</strong></p><ul>${answerRows}</ul><p class="muted">状态：${escapeHtml(evidenceAnswer.status)}。回答只能引用 Context Package 内已有的 fact 与 evidence。</p></div>
<h2>文件明细：parseUtil.ts</h2><p class="muted">展示该文件前 160 条语义事实。每行都包含主体、证据地位、内容和 UTF-8 字节范围。</p>
<div class="panel facts"><table><thead><tr><th>类型</th><th>主体</th><th>地位</th><th>内容</th><th>Evidence</th></tr></thead><tbody>${factRows}</tbody></table></div>
</main></body></html>`;
}

function compactValue(value) {
  const text = JSON.stringify(value);
  return text.length <= 260 ? text : `${text.slice(0, 259)}…`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
