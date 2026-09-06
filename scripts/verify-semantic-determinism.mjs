import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RepositoryIndexer, TypeScriptTreeSitterAdapter, TypeScriptSemanticEnricher, sha256Bytes } from "../dist/index.js";

const root = fileURLToPath(new URL("../references/zod/", import.meta.url));
if (process.argv.includes("--worker")) {
  const files = walk(path.join(root, "packages/zod/src/v3")).filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file)).sort().map((file) => {
    const source_bytes = readFileSync(file);
    return { relative_path: path.relative(root, file).split(path.sep).join("/"), language: "typescript", source_bytes, source_digest: sha256Bytes(source_bytes) };
  });
  const source = { repository_id: "zod-v3-semantic-preview", files };
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  process.stdout.write(new TypeScriptSemanticEnricher().enrich({ state, source }).overlay_hash);
} else {
  const hashes = [];
  for (let sample = 0; sample < 12; sample++) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--worker"], { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    hashes.push(result.stdout);
  }
  assert.equal(new Set(hashes).size, 1, "Identical frozen source must produce identical overlays across compiler processes");
  console.log(JSON.stringify({ samples: hashes.length, overlay_hash: hashes[0], deterministic: true }));
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isSymbolicLink() ? [] : entry.isDirectory()
    ? ["tests", "__tests__", "benchmarks", "fixtures"].includes(entry.name) ? [] : walk(path.join(directory, entry.name))
    : [path.join(directory, entry.name)]);
}
