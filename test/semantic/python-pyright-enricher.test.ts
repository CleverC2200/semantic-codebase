import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PythonPyrightEnricher,
  PythonTreeSitterAdapter,
  RepositoryIndexer,
  canonicalJson,
  sha256Bytes,
  type RepositorySource,
} from "../../src/index.js";

function source(): RepositorySource {
  const inputs = {
    "models.py": [
      "class Item:",
      "    def label(self) -> str:",
      "        return 'item'",
      "",
    ].join("\n"),
    "services.py": [
      "from .models import Item",
      "",
      "def build() -> Item:",
      "    return Item()",
      "",
    ].join("\n"),
  };
  return {
    repository_id: "python-semantic-fixture",
    files: Object.entries(inputs).map(([relative_path, text]) => {
      const source_bytes = new TextEncoder().encode(text);
      return { relative_path, language: "python" as const, source_bytes, source_digest: sha256Bytes(source_bytes) };
    }),
  };
}

test("Pyright enriches frozen Python sources with typed and possible-target facts", () => {
  const input = source();
  const state = new RepositoryIndexer({ adapters: [new PythonTreeSitterAdapter()] }).buildFull(input).state;
  const enricher = new PythonPyrightEnricher();
  const first = enricher.enrich({ state, source: input });
  const second = enricher.enrich({ state, source: input });

  assert.equal(first.profile.id, "python-pyright-preview");
  assert.equal(first.profile.compiler_version, "1.1.413");
  assert.equal(first.coverage.status, "complete", JSON.stringify(first.diagnostics));
  assert.ok(first.facts.some((fact) => fact.kind === "symbol_type" && fact.basis.kind === "compiler_exact"));
  assert.ok(first.facts.some((fact) => fact.kind === "import_target"));
  assert.ok(first.facts.some((fact) => fact.kind === "call_target" && fact.basis.kind === "static_possible"));
  assert.ok(first.facts.some((fact) => fact.kind === "application_flow"));
  assert.equal(first.overlay_hash, second.overlay_hash);
  assert.equal(canonicalJson(first), canonicalJson(second));
});
