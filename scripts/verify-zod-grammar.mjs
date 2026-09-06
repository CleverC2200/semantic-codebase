import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TypeScriptTreeSitterAdapter, RepositoryIndexer, sha256Bytes, canonicalHash } from "../dist/index.js";

const root = fileURLToPath(new URL("../references/zod/packages/zod/src/", import.meta.url));
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(name) : entry.isFile() && name.endsWith(".ts") ? [name] : [];
  });
}
const files = walk(root).sort().map((name) => {
  const source_bytes = readFileSync(name);
  return { relative_path: path.relative(root, name).split(path.sep).join("/"), language: "typescript", source_bytes, source_digest: sha256Bytes(source_bytes) };
});
assert.ok(files.length > 0, "Frozen Zod reference corpus is required");
const adapter = new TypeScriptTreeSitterAdapter();
const indexer = new RepositoryIndexer({ adapters: [adapter] });
const source = { repository_id: "zod-variance-parity", files };
const original = indexer.buildFull(source).state;
const source_bytes = Buffer.concat([files[0].source_bytes, Buffer.from("\n")]);
const changed = { ...source, files: [{ ...files[0], source_bytes, source_digest: sha256Bytes(source_bytes) }, ...files.slice(1)] };
const incremental = indexer.buildIncremental(original, changed).state;
const full = indexer.buildFull(changed).state;
assert.equal(incremental.graph.graph_hash, full.graph.graph_hash);
assert.equal(original.graph.diagnostics.filter((item) => item.severity === "error").length, 0);
for (const file of files) assert.equal(sha256Bytes(readFileSync(path.join(root, file.relative_path))), file.source_digest, "Source changed during verification");
const manifest = files.map(({ relative_path, source_digest, source_bytes }) => ({ relative_path, source_digest, bytes: source_bytes.length }));
const receipt = { passed: true, adapter_manifest: adapter.manifest, manifest, manifest_digest: canonicalHash(manifest),
  coverage: original.graph.coverage, evidence_count: original.graph.evidence.length,
  original_graph_hash: original.graph.graph_hash, incremental_graph_hash: incremental.graph.graph_hash,
  full_graph_hash: full.graph.graph_hash, full_incremental_parity: true, error_count: 0,
  source_delta: "In-memory newline appended to first sorted file; disk source unchanged",
  scope: "Structural parsing and full/incremental parity only; unresolved candidates are not exact relations" };
const directory = fileURLToPath(new URL("../.workspace/acceptance/grammar-compatibility/", import.meta.url));
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, "zod-src.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ receipt: path.join(directory, "zod-src.json"), passed: true, files: files.length, coverage: receipt.coverage }));
