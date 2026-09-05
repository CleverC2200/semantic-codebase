import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  RepositoryIndexer,
  TypeScriptTreeSitterAdapter,
  canonicalHash,
  sha256Bytes,
  sha256Text,
} from "../dist/index.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const referenceRoot = path.join(projectRoot, "references/zod");
const corpusRoot = path.join(referenceRoot, "packages/zod/src/v3");
const outputRoot = path.join(projectRoot, ".workspace/benchmark/zod");
const excludedDirectories = new Set(["tests", "__tests__", "benchmarks", "fixtures"]);
const definitionKindLabels = {
  class: "类",
  function: "函数",
  interface: "接口",
  method: "方法",
  module: "模块",
};
const relationKindLabels = {
  CALLS: "调用",
  CONTAINS: "包含",
  EXPORTS: "导出",
  IMPLEMENTS: "实现",
  IMPORTS: "导入",
  INHERITS: "继承",
  REFERENCES: "引用",
};
const diagnosticSeverityLabels = { error: "错误", info: "信息", warning: "警告" };
const diagnosticCodeLabels = {
  unresolved_relation_candidate: "未解析关系候选",
  unsupported_anonymous_definition: "不支持的匿名定义",
};
const relationOriginLabels = { resolver: "解析器", syntax_exact: "语法精确关系" };

const corpusContract = {
  repository_id: "zod-v3-smoke-at-frozen-v4.4.3",
  upstream: "https://github.com/colinhacks/zod.git",
  revision: "1fb56a5c18c27102dbc92260a4007c7732a0ccca",
  tree: "1eb96a1ab94c57a0abcbea3563f9b7ab8a0fe017",
  root: "packages/zod/src/v3",
  files: 13,
  bytes: 191_408,
  manifest_digest: "f2b2153341662fb9c05f484ec2d449bc449926a62cea450562f661bdc90e476e",
};

const files = walk(corpusRoot)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file))
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

const manifest = files.map((file) => ({
  relative_path: file.relative_path,
  language: file.language,
  source_digest: file.source_digest,
  byte_length: file.source_bytes.byteLength,
}));
const corpusBytes = manifest.reduce((total, file) => total + file.byte_length, 0);
const manifestDigest = canonicalHash(manifest);

if (
  files.length !== corpusContract.files ||
  corpusBytes !== corpusContract.bytes ||
  manifestDigest !== corpusContract.manifest_digest
) {
  throw new Error(
    `Zod corpus drifted: files=${files.length}, bytes=${corpusBytes}, manifest=${manifestDigest}`,
  );
}

const startedAt = new Date();
const started = performance.now();
const result = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull({
  repository_id: corpusContract.repository_id,
  files,
});
const elapsedMs = Math.round((performance.now() - started) * 1000) / 1000;

const snapshotJson = `${JSON.stringify(result.state, null, 2)}\n`;
const snapshotSha256 = sha256Text(snapshotJson);
const diagnosticCounts = {
  error: 0,
  info: 0,
  warning: 0,
  ...Object.fromEntries(countBy(result.state.graph.diagnostics, (diagnostic) => diagnostic.severity)),
};
const diagnosticCodes = Object.fromEntries(
  countBy(result.state.graph.diagnostics, (diagnostic) => diagnostic.code),
);
const receipt = {
  schema_version: 1,
  generated_at: startedAt.toISOString(),
  corpus: {
    ...corpusContract,
    manifest,
  },
  runtime: {
    node: process.version,
    elapsed_ms: elapsedMs,
  },
  result: {
    ...result.receipt,
    coverage: result.state.graph.coverage,
    evidence_count: result.state.graph.evidence.length,
    diagnostic_count: result.state.graph.diagnostics.length,
    diagnostic_counts: diagnosticCounts,
    diagnostic_codes: diagnosticCodes,
  },
  artifacts: {
    summary: ".workspace/benchmark/zod/summary.md",
    receipt: ".workspace/benchmark/zod/receipt.json",
    snapshot: ".workspace/benchmark/zod/snapshot.json",
    snapshot_sha256: snapshotSha256,
  },
};

mkdirSync(outputRoot, { recursive: true });
writeFileSync(path.join(outputRoot, "snapshot.json"), snapshotJson);
writeFileSync(path.join(outputRoot, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
writeFileSync(path.join(outputRoot, "summary.md"), renderSummary(result.state.graph, receipt));

process.stdout.write(`${JSON.stringify({
  output: path.relative(projectRoot, outputRoot),
  snapshot_id: result.state.snapshot_id,
  graph_hash: result.state.graph.graph_hash,
  snapshot_sha256: snapshotSha256,
  coverage: result.state.graph.coverage,
  elapsed_ms: elapsedMs,
}, null, 2)}\n`);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return excludedDirectories.has(entry.name) ? [] : walk(target);
    return [target];
  });
}

function renderSummary(graph, receipt) {
  const definitionsByKind = countBy(graph.definitions, (definition) => definition.kind);
  const relationsByKind = countBy(graph.relations, (relation) => relation.kind);
  const diagnosticsBySeverity = Object.entries(receipt.result.diagnostic_counts);
  const diagnosticsByCode = countBy(graph.diagnostics, (diagnostic) => diagnostic.code);
  const definitionsByKey = new Map(
    graph.definitions.map((definition) => [definition.definition_key, definition]),
  );
  const definitionRows = [...graph.definitions]
    .sort((left, right) =>
      left.file_path.localeCompare(right.file_path) ||
      left.definition_span.start_byte - right.definition_span.start_byte,
    )
    .slice(0, 20)
    .map((definition) =>
      `| ${escapeCell(label(definition.kind, definitionKindLabels))} | ${escapeCell(definition.qualified_name)} | ${escapeCell(definition.file_path)} | ${definition.definition_span.start_byte}-${definition.definition_span.end_byte} |`,
    );
  const relationRows = graph.relations.slice(0, 20).map((relation) =>
    `| ${escapeCell(label(relation.kind, relationKindLabels))} | ${escapeCell(endpointLabel(relation.source, definitionsByKey))} | ${escapeCell(endpointLabel(relation.target, definitionsByKey))} | ${escapeCell(label(relation.origin, relationOriginLabels))} |`,
  );

  return `# Zod v3 Semantic Codebase 冒烟测试摘要\n\n` +
    `生成时间：${receipt.generated_at}\n\n` +
    `## 语料\n\n` +
    `- 上游仓库：${receipt.corpus.upstream}\n` +
    `- 固定提交：\`${receipt.corpus.revision}\`\n` +
    `- 源码根目录：\`${receipt.corpus.root}\`\n` +
    `- 文件数：${receipt.corpus.files}\n` +
    `- 源码字节数：${receipt.corpus.bytes}\n` +
    `- 清单摘要：\`${receipt.corpus.manifest_digest}\`\n\n` +
    `## 结果\n\n` +
    `- 覆盖状态：**就绪（${graph.coverage.status}）**\n` +
    `- 快照 ID：\`${graph.snapshot_id}\`\n` +
    `- 图哈希：\`${graph.graph_hash}\`\n` +
    `- 快照 SHA-256：\`${receipt.artifacts.snapshot_sha256}\`\n` +
    `- 定义：${graph.definitions.length} 个（${formatCounts(definitionsByKind, definitionKindLabels)}）\n` +
    `- 关系：${graph.relations.length} 条（${formatCounts(relationsByKind, relationKindLabels)}）\n` +
    `- 未解析候选：${graph.unresolved_candidates.length} 个\n` +
    `- 证据：${graph.evidence.length} 条\n` +
    `- 诊断：${graph.diagnostics.length} 条（${formatCounts(diagnosticsBySeverity, diagnosticSeverityLabels)}；${formatCounts(diagnosticsByCode, diagnosticCodeLabels)}）\n` +
    `- 耗时：${receipt.runtime.elapsed_ms} 毫秒\n\n` +
    `## 定义样例\n\n` +
    `| 类型 | 限定名称 | 文件 | 字节范围 |\n` +
    `| --- | --- | --- | --- |\n` +
    `${definitionRows.join("\n")}\n\n` +
    `## 关系样例\n\n` +
    `| 类型 | 来源 | 目标 | 产生方式 |\n` +
    `| --- | --- | --- | --- |\n` +
    `${relationRows.join("\n")}\n`;
}

function countBy(items, selector) {
  const counts = new Map();
  for (const item of items) {
    const key = selector(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function formatCounts(counts, labels = {}) {
  return counts.map(([name, count]) => `${label(name, labels)}=${count}`).join("，");
}

function label(value, labels) {
  return labels[value] ?? value;
}

function endpointLabel(endpoint, definitionsByKey) {
  if (endpoint.kind === "source_file") return endpoint.file_path;
  const definition = definitionsByKey.get(endpoint.definition_key);
  return definition ? `${definition.qualified_name} (${definition.file_path})` : endpoint.definition_key;
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
