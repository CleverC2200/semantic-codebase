import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { renderSemanticPreview } from "./semantic-preview-explorer.mjs";

// Re-render saved evidence without running indexers, applications, or providers.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".workspace/acceptance/semantic-preview");
const read = (name) => JSON.parse(readFileSync(path.join(output, name), "utf8"));
const overlay = read("semantic-overlay.json");
const receipt = read("receipt.json");
if (receipt.snapshot.snapshot_id !== overlay.snapshot_id || receipt.snapshot.overlay_hash !== overlay.overlay_hash) {
  throw new Error("Preview receipt and semantic overlay do not match");
}
const db = new DatabaseSync(path.join(output, "preview.sqlite"), { readOnly: true });
let state;
try {
  const row = db.prepare("SELECT state_json FROM snapshots WHERE repository_id=? AND snapshot_id=?")
    .get(overlay.repository_id, overlay.snapshot_id);
  if (!row) throw new Error("Preview snapshot is missing");
  state = JSON.parse(row.state_json);
} finally { db.close(); }
const evidenceById = new Map(overlay.evidence.map((e) => [e.evidence_id, e]));
const sourceRoot = path.join(root, "references/zod");
const sourceFiles = [...new Set(state.manifest.files.map((f) => f.relative_path))].flatMap((relative_path) => {
  const file = path.resolve(sourceRoot, relative_path);
  if (!file.startsWith(sourceRoot + path.sep) || !existsSync(file)) return [];
  return [{ relative_path, source_bytes: readFileSync(file) }];
});
writeFileSync(path.join(output, "acceptance.html"), renderSemanticPreview({
  receipt, overlay, pythonOverlay: read("python-semantic-overlay.json"),
  runtime: read("runtime-observations.json"), evidenceAnswer: read("evidence-answer.json"),
  definitionsByKey: new Map(state.graph.definitions.map((d) => [d.definition_key, d])), evidenceById,
  focusFacts: overlay.facts.filter((f) => f.evidence_ids.some((id) => evidenceById.get(id)?.file_path === "packages/zod/src/v3/helpers/parseUtil.ts")),
  sourceFiles, manifest: state.manifest, structuralGraph: state.graph,
}));
console.log("Updated acceptance.html from existing snapshot; receipts unchanged.");
