import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  PythonTreeSitterAdapter,
  RepositoryIndexer,
  SqliteSnapshotStore,
  TypeScriptTreeSitterAdapter,
  callMcpTool,
  canonicalJson,
  discoverRepository,
  repositoryManifestSummary,
  runCli,
  sha256Text,
} from "../dist/index.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const zodRoot = path.join(projectRoot, "references/zod/packages/zod/src/v3");
const outputRoot = path.join(projectRoot, ".workspace/acceptance/zod-prototype");
const storePath = path.join(outputRoot, "prototype.sqlite");
const expectedCorpus = {
  files: 83,
  bytes: 489_551,
  manifest_digest: "4c7c8f212b91149f6a20516ab2caa8be0d4bef5e2d91486ee60dff3e4dc50f4f",
};

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

const discovered = discoverRepository(zodRoot, storePath);
const manifest = repositoryManifestSummary(discovered.source);
assert(manifest.file_count === expectedCorpus.files, "Zod v3 file count drifted");
assert(manifest.byte_length === expectedCorpus.bytes, "Zod v3 byte count drifted");
assert(manifest.digest === expectedCorpus.manifest_digest, "Zod v3 Manifest digest drifted");

const timings = {};
const indexed = await timed("index", () => cli(["index", "--repo", zodRoot, "--store", storePath]));
const indexPhaseMaxRssKib = process.resourceUsage().maxRSS;
const status = await timed("status", () => cli(["status", "--repo", zodRoot, "--store", storePath]));
assert(status.freshness.status === "fresh", "Indexed Zod Snapshot is not fresh");
assert(indexed.coverage.status === "ready", "Zod Snapshot is not Ready");

const getValid = await timed("definition_find", () => cli([
  "definitions", "find", "--repo", zodRoot, "--store", storePath,
  "--query", "getValidEnumValues", "--require-fresh",
]));
const objectValues = await cli([
  "definitions", "find", "--repo", zodRoot, "--store", storePath,
  "--query", "objectValues", "--require-fresh",
]);
const sourceDefinition = uniqueDefinition(getValid, "util.getValidEnumValues");
const targetDefinition = uniqueDefinition(objectValues, "util.objectValues");

const callees = await timed("callees", () => cli([
  "graph", "traverse", "--repo", zodRoot, "--store", storePath,
  "--start-definition-key", sourceDefinition.definition_key,
  "--direction", "outgoing", "--relation-kinds", "CALLS", "--require-fresh",
]));
const callers = await timed("callers", () => cli([
  "graph", "traverse", "--repo", zodRoot, "--store", storePath,
  "--start-definition-key", targetDefinition.definition_key,
  "--direction", "incoming", "--relation-kinds", "CALLS", "--require-fresh",
]));
assert(callees.data.nodes.some((node) => node.definition.definition_key === targetDefinition.definition_key),
  "Expected callee was not found");
assert(callers.data.nodes.some((node) => node.definition.definition_key === sourceDefinition.definition_key),
  "Expected caller was not found");

const paths = await timed("paths", () => cli([
  "graph", "paths", "--repo", zodRoot, "--store", storePath,
  "--start-definition-key", sourceDefinition.definition_key,
  "--end-definition-key", targetDefinition.definition_key,
  "--relation-kinds", "CALLS", "--require-fresh",
]));
assert(paths.data.paths.length >= 1, "Expected Zod call path was not found");

const evidence = await timed("evidence", () => cli([
  "evidence", "get", "--repo", zodRoot, "--store", storePath,
  "--evidence-id", sourceDefinition.evidence_ids[0], "--require-fresh",
]));
assert(evidence.data.source.available === true, "Evidence source is unavailable");

const absent = await cli([
  "definitions", "find", "--repo", zodRoot, "--store", storePath,
  "--query", "definitelyRuntimeOnlyDynamicSymbol", "--require-fresh",
]);
const staticRefusal = {
  query_result_count: absent.data.definitions.length,
  unresolved_candidate_count: absent.coverage.unresolved_candidate_count,
  decision: "insufficient_static_evidence",
  statement: "空结果只表示 Ready Snapshot 内未找到，不能据此断言运行时绝对不存在。",
};
assert(staticRefusal.query_result_count === 0, "Negative-control query unexpectedly matched");
assert(staticRefusal.unresolved_candidate_count > 0, "Negative-control lacks visible uncertainty");

const mcpFind = await callMcpTool("semantic_codebase_find_definitions", {
  repo: zodRoot,
  store: storePath,
  query: "getValidEnumValues",
  require_fresh: true,
});
assert(!mcpFind.isError, "MCP Definition query failed");
assert(canonicalJson(mcpFind.structuredContent) === canonicalJson(getValid), "CLI/MCP parity failed");
assert(mcpFind.content[0]?.text === canonicalJson(mcpFind.structuredContent), "MCP text parity failed");

const synced = await cli(["sync", "--repo", zodRoot, "--store", storePath]);
assert(synced.snapshot_id === indexed.snapshot_id, "No-op sync changed Snapshot identity");
assert(synced.receipt.extracted_files.length === 0, "No-op sync unexpectedly extracted files");
assert(synced.receipt.reused_files.length === expectedCorpus.files, "No-op sync did not reuse all files");

const store = new SqliteSnapshotStore(storePath, { read_only: true });
const state = store.getCurrentReady(discovered.source.repository_id);
store.close();
assert(state, "Ready Snapshot did not round-trip from Store");
assert(state.graph.graph_hash === indexed.graph_hash, "Store round-trip graph hash mismatch");
const definitionsByKey = new Map(state.graph.definitions.map((definition) => [definition.definition_key, definition]));
const forbiddenSelfEdges = state.graph.relations.filter((relation) =>
  !["CALLS", "REFERENCES"].includes(relation.kind) && canonicalJson(relation.source) === canonicalJson(relation.target),
);
const invalidExportSources = state.graph.relations.filter((relation) => {
  if (relation.kind !== "EXPORTS" || relation.source.kind === "source_file") return false;
  return definitionsByKey.get(relation.source.definition_key)?.kind !== "module";
});
const relationGoldExpected = [{
  kind: "CALLS",
  source: "util.getValidEnumValues",
  target: "util.objectValues",
  evidence_count: 1,
}];
const relationGoldActual = state.graph.relations
  .filter((relation) =>
    relation.kind === "CALLS" &&
    relation.source.kind === "definition" &&
    relation.source.definition_key === sourceDefinition.definition_key,
  )
  .map((relation) => ({
    kind: relation.kind,
    source: definitionsByKey.get(relation.source.definition_key)?.qualified_name ?? null,
    target: relation.target.kind === "definition"
      ? definitionsByKey.get(relation.target.definition_key)?.qualified_name ?? null
      : null,
    evidence_count: relation.evidence_ids.length,
  }))
  .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
assert(canonicalJson(relationGoldActual) === canonicalJson(relationGoldExpected), "Zod Relation Gold drifted");
assert(forbiddenSelfEdges.length === 0, "Zod contains forbidden self-edges");
assert(invalidExportSources.length === 0, "Zod contains invalid EXPORTS sources");

const graphHashes = [];
for (let run = 0; run < 10; run += 1) {
  const deterministic = new RepositoryIndexer({
    adapters: [new TypeScriptTreeSitterAdapter(), new PythonTreeSitterAdapter()],
    index_config: { excluded_directories: "v1-defaults" },
  }).buildFull(discovered.source);
  graphHashes.push(deterministic.state.graph.graph_hash);
}
assert(new Set(graphHashes).size === 1, "Ten-run graph hash determinism failed");
assert(graphHashes[0] === indexed.graph_hash, "CLI and direct Index Module graph hashes differ");
assert(queryTimingsUnderTwoSeconds(), "A default Zod query exceeded 2 seconds");

const receipt = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  corpus: {
    upstream: "https://github.com/colinhacks/zod.git",
    revision: "1fb56a5c18c27102dbc92260a4007c7732a0ccca",
    root: "packages/zod/src/v3",
    files: expectedCorpus.files,
    bytes: expectedCorpus.bytes,
    manifest_digest: manifest.digest,
  },
  commands: {
    gate: "npm run prototype:zod",
    cli: [
      "scb index --repo references/zod/packages/zod/src/v3 --store .workspace/acceptance/zod-prototype/prototype.sqlite",
      "scb status --repo references/zod/packages/zod/src/v3 --store .workspace/acceptance/zod-prototype/prototype.sqlite",
      "scb definitions find --repo references/zod/packages/zod/src/v3 --store .workspace/acceptance/zod-prototype/prototype.sqlite --query getValidEnumValues --require-fresh",
      "scb graph traverse --repo references/zod/packages/zod/src/v3 --store .workspace/acceptance/zod-prototype/prototype.sqlite --start-definition-key <definition_key> --relation-kinds CALLS --require-fresh",
      "scb graph paths --repo references/zod/packages/zod/src/v3 --store .workspace/acceptance/zod-prototype/prototype.sqlite --start-definition-key <definition_key> --end-definition-key <definition_key> --relation-kinds CALLS --require-fresh",
      "scb evidence get --repo references/zod/packages/zod/src/v3 --store .workspace/acceptance/zod-prototype/prototype.sqlite --evidence-id <evidence_id> --require-fresh",
    ],
    mcp_tool: "semantic_codebase_find_definitions",
  },
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    index_phase_max_rss_kib: indexPhaseMaxRssKib,
    gate_process_max_rss_kib: process.resourceUsage().maxRSS,
  },
  snapshot: {
    snapshot_id: indexed.snapshot_id,
    graph_hash: indexed.graph_hash,
    coverage: indexed.coverage,
    freshness: status.freshness.status,
    profile: {
      canonical_ir_version: state.canonical_ir_version,
      index_config_digest: state.index_config_digest,
      adapter_profile_digest: state.adapter_profile_digest,
      adapters: state.adapter_manifests,
    },
  },
  store: {
    path: ".workspace/acceptance/zod-prototype/prototype.sqlite",
    bytes: statSync(storePath).size,
  },
  demonstrations: {
    definition: summarizeDefinition(sourceDefinition),
    callee: summarizeDefinition(targetDefinition),
    callers_found: callers.data.nodes.length,
    callees_found: callees.data.nodes.length,
    paths_found: paths.data.paths.length,
    path_relation_keys: paths.data.paths[0].relations.map((relation) => relation.relation_key),
    evidence: {
      evidence_id: evidence.data.evidence.evidence_id,
      file_path: evidence.data.evidence.file_path,
      source_available: evidence.data.source.available,
      source_truncated: evidence.data.source.truncated,
    },
    static_refusal: staticRefusal,
    relation_gold: {
      expected: relationGoldExpected,
      actual: relationGoldActual,
    },
  },
  gates: {
    ready: indexed.coverage.status === "ready",
    fresh: status.freshness.status === "fresh",
    forbidden_self_edges: forbiddenSelfEdges.length,
    invalid_export_sources: invalidExportSources.length,
    relation_gold: canonicalJson(relationGoldActual) === canonicalJson(relationGoldExpected),
    store_round_trip: state.graph.graph_hash === indexed.graph_hash,
    incremental_noop_parity: synced.snapshot_id === indexed.snapshot_id,
    ten_run_determinism: new Set(graphHashes).size === 1,
    cli_mcp_parity: canonicalJson(mcpFind.structuredContent) === canonicalJson(getValid),
    default_queries_under_2s: queryTimingsUnderTwoSeconds(),
  },
  timings_ms: timings,
  known_limits: [
    "动态调用、反射和不支持语法不会被提升为权威 Relation。",
    "unresolved Candidate 保持可见；空结果不等于运行时绝对不存在。",
  ],
};
const receiptJson = `${JSON.stringify(receipt, null, 2)}\n`;
const receiptSha256 = sha256Text(receiptJson);
writeFileSync(path.join(outputRoot, "receipt.json"), receiptJson);
writeFileSync(path.join(outputRoot, "summary.md"), renderMarkdown(receipt, receiptSha256));
writeFileSync(path.join(outputRoot, "acceptance.html"), renderHtml(receipt, receiptSha256, evidence.data.source.text));

process.stdout.write(`${JSON.stringify({
  output: path.relative(projectRoot, outputRoot),
  receipt_sha256: receiptSha256,
  snapshot_id: receipt.snapshot.snapshot_id,
  graph_hash: receipt.snapshot.graph_hash,
  gates: receipt.gates,
  timings_ms: receipt.timings_ms,
}, null, 2)}\n`);

async function cli(arguments_) {
  let stdout = "";
  const code = await runCli(arguments_, {
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: () => undefined },
  });
  const output = JSON.parse(stdout);
  if (code !== 0) throw new Error(`CLI failed: ${canonicalJson(output)}`);
  return output;
}

async function timed(name, operation) {
  const started = performance.now();
  const result = await operation();
  timings[name] = Math.round((performance.now() - started) * 1000) / 1000;
  return result;
}

function uniqueDefinition(result, qualifiedName) {
  const matches = result.data.definitions.filter((definition) => definition.qualified_name === qualifiedName);
  assert(matches.length === 1, `Expected one Definition for ${qualifiedName}, found ${matches.length}`);
  return matches[0];
}

function summarizeDefinition(definition) {
  return {
    definition_key: definition.definition_key,
    qualified_name: definition.qualified_name,
    kind: definition.kind,
    file_path: definition.file_path,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function queryTimingsUnderTwoSeconds() {
  return Object.entries(timings)
    .filter(([name]) => name !== "index")
    .every(([, milliseconds]) => milliseconds < 2_000);
}

function renderMarkdown(value, hash) {
  return `# Zod v3 Prototype Gate\n\n` +
    `- 结果：通过\n` +
    `- Snapshot：\`${value.snapshot.snapshot_id}\`\n` +
    `- Graph hash：\`${value.snapshot.graph_hash}\`\n` +
    `- Receipt SHA-256：\`${hash}\`\n` +
    `- Definitions：${value.snapshot.coverage.definition_count}\n` +
    `- Relations：${value.snapshot.coverage.relation_count}\n` +
    `- Unresolved Candidates：${value.snapshot.coverage.unresolved_candidate_count}\n` +
    `- 禁止自环：${value.gates.forbidden_self_edges}\n` +
    `- CLI/MCP parity：${value.gates.cli_mcp_parity ? "通过" : "失败"}\n` +
    `- 10 次确定性：${value.gates.ten_run_determinism ? "通过" : "失败"}\n\n` +
    `空结果结论：${value.demonstrations.static_refusal.statement}\n`;
}

function renderHtml(value, hash, sourceText) {
  const escapedReceipt = escapeHtml(JSON.stringify(value, null, 2));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Zod Prototype Gate</title>` +
    `<style>body{font:15px/1.6 system-ui;max-width:1100px;margin:40px auto;padding:0 24px;color:#172033}` +
    `h1{font-size:30px}.ok{color:#087f5b;font-weight:700}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}` +
    `.card{border:1px solid #dbe2ea;border-radius:12px;padding:16px;background:#f8fafc}pre{overflow:auto;background:#101827;color:#e5edf7;padding:16px;border-radius:10px}` +
    `code{font-family:ui-monospace,SFMono-Regular,monospace}@media(max-width:760px){.grid{grid-template-columns:1fr}}</style></head>` +
    `<body><h1>Zod v3 Semantic Codebase Prototype Gate</h1><p class="ok">全部门禁通过</p>` +
    `<div class="grid"><div class="card">Definitions<br><strong>${value.snapshot.coverage.definition_count}</strong></div>` +
    `<div class="card">Relations<br><strong>${value.snapshot.coverage.relation_count}</strong></div>` +
    `<div class="card">Unresolved<br><strong>${value.snapshot.coverage.unresolved_candidate_count}</strong></div></div>` +
    `<h2>真实链路</h2><p><code>${escapeHtml(value.demonstrations.definition.qualified_name)}</code> → ` +
    `<code>${escapeHtml(value.demonstrations.callee.qualified_name)}</code>，路径 ${value.demonstrations.paths_found} 条。</p>` +
    `<h2>Evidence</h2><pre>${escapeHtml(sourceText ?? "Evidence source unavailable")}</pre>` +
    `<h2>静态边界</h2><p>${escapeHtml(value.demonstrations.static_refusal.statement)}</p>` +
    `<h2>Receipt</h2><p>SHA-256：<code>${hash}</code></p><pre>${escapedReceipt}</pre></body></html>`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
