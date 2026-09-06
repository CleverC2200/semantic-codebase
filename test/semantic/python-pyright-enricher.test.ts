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

test("Pyright binds typed receiver calls even when structural resolution has no CALLS edge", () => {
  const source_bytes = new TextEncoder().encode("class Worker:\n    def run(self):\n        return 1\ndef main(worker: Worker):\n    return worker.run()\n");
  const input: RepositorySource = { repository_id: "typed-receiver", files: [{ relative_path: "main.py", language: "python", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new PythonTreeSitterAdapter()] }).buildFull(input).state;
  const main = state.graph.definitions.find((item) => item.name === "main")!;
  const run = state.graph.definitions.find((item) => item.name === "run")!;
  assert.ok(!state.graph.relations.some((item) => item.kind === "CALLS" && item.source.kind === "definition" && item.source.definition_key === main.definition_key));
  const overlay = new PythonPyrightEnricher().enrich({ state, source: input });
  const call = overlay.facts.find((item) => item.kind === "call_target" && item.subject.kind === "definition" && item.subject.definition_key === main.definition_key)!;
  assert.equal((call.value as { target_definition_key: string }).target_definition_key, run.definition_key);
  assert.equal(call.basis.kind, "static_possible");
});

test("Pyright enriches frozen Python sources with typed and possible-target facts", () => {
  const input = source();
  const state = new RepositoryIndexer({ adapters: [new PythonTreeSitterAdapter()] }).buildFull(input).state;
  const enricher = new PythonPyrightEnricher();
  const first = enricher.enrich({ state, source: input });
  const second = enricher.enrich({ state, source: input });

  assert.equal(first.profile.id, "python-pyright-preview");
  assert.equal(first.profile.compiler_version, "1.1.413");
  assert.equal(first.coverage.status, "partial", JSON.stringify(first.diagnostics));
  assert.ok(first.coverage.reason_codes.includes("implicit_exceptions_not_modeled"));
  assert.ok(first.facts.some((fact) => fact.kind === "symbol_type" && fact.basis.kind === "compiler_exact"));
  assert.ok(first.facts.some((fact) => fact.kind === "reference_target" && fact.basis.rule_id === "pyright_language_server_definition"));
  assert.ok(first.facts.some((fact) => fact.kind === "import_target"));
  assert.ok(first.facts.some((fact) => fact.kind === "call_target" && fact.basis.kind === "static_possible"));
  assert.ok(first.facts.some((fact) => fact.kind === "application_flow"));
  assert.equal(first.overlay_hash, second.overlay_hash);
  assert.equal(canonicalJson(first), canonicalJson(second));
});

test("Python one-hop propagation follows bound positional parameters", () => {
  const source_bytes = new TextEncoder().encode("def pick(a: int, b: int) -> int:\n    return b\ndef main(value: int) -> int:\n    return pick(1, value)\n");
  const input: RepositorySource = { repository_id: "python-hop", files: [{ relative_path: "main.py", language: "python", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new PythonTreeSitterAdapter()] }).buildFull(input).state;
  const overlay = new PythonPyrightEnricher().enrich({ state, source: input });
  const facts = overlay.facts.filter((item) => item.kind === "call_data_flow");
  assert.equal(facts.length, 1);
  const value = facts[0]!.value as { mappings: { argument_index: number }[] };
  assert.equal(value.mappings[0]?.argument_index, 1);
});

test("frozen Pyright extraPaths selects the expected same-named module", () => {
  const file = (relative_path: string, text: string) => {
    const source_bytes = new TextEncoder().encode(text);
    return { relative_path, source_bytes, source_digest: sha256Bytes(source_bytes) };
  };
  const input: RepositorySource = { repository_id: "configured-python", files: [
    { ...file("main.py", "from helper import chosen\ndef main():\n    return chosen()\n"), language: "python" },
    { ...file("lib/helper.py", "def chosen():\n    return 42\n"), language: "python" },
    { ...file("other/helper.py", "def chosen():\n    return 0\n"), language: "python" },
  ], configuration_files: [file("pyrightconfig.json", '{"pythonVersion":"3.11", "extraPaths":["lib"]}')] };
  const state = new RepositoryIndexer({ adapters: [new PythonTreeSitterAdapter()] }).buildFull(input).state;
  const overlay = new PythonPyrightEnricher().enrich({ state, source: input });
  const main = state.graph.definitions.find((item) => item.name === "main")!;
  const chosen = state.graph.definitions.find((item) => item.name === "chosen" && item.file_path === "lib/helper.py")!;
  assert.ok(overlay.facts.some((item) => item.kind === "call_target" && item.subject.kind === "definition" && item.subject.definition_key === main.definition_key &&
    (item.value as { target_definition_key: string }).target_definition_key === chosen.definition_key), JSON.stringify({ diagnostics: overlay.diagnostics, calls: overlay.facts.filter((item) => item.kind === "call_target") }));
  const bad = { ...input, configuration_files: [file("pyrightconfig.json", '{"extraPaths":["../outside"]}')] };
  const badState = new RepositoryIndexer({ adapters: [new PythonTreeSitterAdapter()] }).buildFull(bad).state;
  assert.throws(() => new PythonPyrightEnricher().enrich({ state: badState, source: bad }), /escapes frozen repository/);
});

test("Python keyword arguments map by parameter name instead of call-site order", () => {
  const source_bytes = new TextEncoder().encode("def pick(a: int, b: int) -> int:\n    return b\ndef main(value: int):\n    return pick(b=value, a=0)\n");
  const input: RepositorySource = { repository_id: "python-keyword", files: [{ relative_path: "main.py", language: "python", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new PythonTreeSitterAdapter()] }).buildFull(input).state;
  const overlay = new PythonPyrightEnricher().enrich({ state, source: input });
  const fact = overlay.facts.find((item) => item.kind === "call_data_flow")!;
  const value = fact.value as { mappings: { argument_index: number; parameter_index: number }[] };
  assert.equal(value.mappings[0]?.argument_index, 0);
  assert.equal(value.mappings[0]?.parameter_index, 1);
});

test("Python literal default propagation carries closed Evidence", () => {
  const source_bytes = new TextEncoder().encode("def choose(value: int = 7):\n    return value\ndef main():\n    return choose()\n");
  const source: RepositorySource = { repository_id: "python-default", files: [{ relative_path: "main.py", language: "python", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new PythonTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new PythonPyrightEnricher().enrich({ state, source });
  const fact = overlay.facts.find((item) => item.kind === "call_data_flow")!;
  const mappings = (fact.value as { mappings: { default_evidence_id: string; argument_index: null }[] }).mappings;
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0]!.argument_index, null);
  assert.ok(fact.evidence_ids.includes(mappings[0]!.default_evidence_id));
});
