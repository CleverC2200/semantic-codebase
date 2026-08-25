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
      `| ${escapeCell(definition.kind)} | ${escapeCell(definition.qualified_name)} | ${escapeCell(definition.file_path)} | ${definition.definition_span.start_byte}-${definition.definition_span.end_byte} |`,
    );
  const relationRows = graph.relations.slice(0, 20).map((relation) =>
    `| ${escapeCell(relation.kind)} | ${escapeCell(endpointLabel(relation.source, definitionsByKey))} | ${escapeCell(endpointLabel(relation.target, definitionsByKey))} | ${escapeCell(relation.origin)} |`,
  );

  return `# Zod v3 Semantic Codebase Smoke\n\n` +
    `Generated: ${receipt.generated_at}\n\n` +
    `## Corpus\n\n` +
    `- Upstream: ${receipt.corpus.upstream}\n` +
    `- Revision: \`${receipt.corpus.revision}\`\n` +
    `- Source root: \`${receipt.corpus.root}\`\n` +
    `- Files: ${receipt.corpus.files}\n` +
    `- Bytes: ${receipt.corpus.bytes}\n` +
    `- Manifest digest: \`${receipt.corpus.manifest_digest}\`\n\n` +
    `## Result\n\n` +
    `- Coverage: **${graph.coverage.status}**\n` +
    `- Snapshot ID: \`${graph.snapshot_id}\`\n` +
    `- Graph hash: \`${graph.graph_hash}\`\n` +
    `- Snapshot SHA-256: \`${receipt.artifacts.snapshot_sha256}\`\n` +
    `- Definitions: ${graph.definitions.length} (${formatCounts(definitionsByKind)})\n` +
    `- Relations: ${graph.relations.length} (${formatCounts(relationsByKind)})\n` +
    `- Unresolved candidates: ${graph.unresolved_candidates.length}\n` +
    `- Evidence: ${graph.evidence.length}\n` +
    `- Diagnostics: ${graph.diagnostics.length} (${formatCounts(diagnosticsBySeverity)}; ${formatCounts(diagnosticsByCode)})\n` +
    `- Elapsed: ${receipt.runtime.elapsed_ms} ms\n\n` +
    `## Definition sample\n\n` +
    `| Kind | Qualified name | File | Byte span |\n` +
    `| --- | --- | --- | --- |\n` +
    `${definitionRows.join("\n")}\n\n` +
    `## Relation sample\n\n` +
    `| Kind | Source | Target | Origin |\n` +
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

function formatCounts(counts) {
  return counts.map(([name, count]) => `${name}=${count}`).join(", ");
}

function endpointLabel(endpoint, definitionsByKey) {
  if (endpoint.kind === "source_file") return endpoint.file_path;
  const definition = definitionsByKey.get(endpoint.definition_key);
  return definition ? `${definition.qualified_name} (${definition.file_path})` : endpoint.definition_key;
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
