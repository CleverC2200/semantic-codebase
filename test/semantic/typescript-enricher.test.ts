import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RepositoryIndexer,
  SemanticEnrichmentError,
  TypeScriptSemanticEnricher,
  TypeScriptTreeSitterAdapter,
  canonicalHash,
  canonicalJson,
  sha256Bytes,
  type RepositorySource,
  finalizeSemanticOverlay,
} from "../../src/index.js";

function fixtureSource(text: string): RepositorySource {
  const source_bytes = new TextEncoder().encode(text);
  return {
    repository_id: "semantic-fixture",
    files: [{
      relative_path: "src/main.ts",
      language: "typescript",
      source_bytes,
      source_digest: sha256Bytes(source_bytes),
    }],
  };
}

const fixture = [
  "// 中文🙂 keeps UTF-8 byte mapping honest",
  "export function helper(value: number): number {",
  "  return value + 1;",
  "}",
  "export function main(flag: boolean): number {",
  "  if (flag) {",
  "    console.log('running');",
  "    return helper(1);",
  "  }",
  "  throw new Error('stopped');",
  "}",
  "",
].join("\n");

test("TypeScript Compiler enriches a Ready Snapshot with evidence-backed semantic facts", () => {
  const source = fixtureSource(fixture);
  const state = new RepositoryIndexer({
    adapters: [new TypeScriptTreeSitterAdapter()],
  }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state, source });
  const { overlay_hash, ...withoutHash } = overlay;
  assert.equal(overlay_hash, canonicalHash(withoutHash));
  const definitionsByKey = new Map(
    state.graph.definitions.map((definition) => [definition.definition_key, definition]),
  );
  const exactCalls = overlay.facts.filter((fact) =>
    fact.kind === "call_target" && fact.basis.kind === "compiler_exact",
  );

  assert.ok(overlay.facts.some((fact) => fact.kind === "symbol_type"));
  assert.ok(exactCalls.some((fact) => {
    if (typeof fact.value !== "object" || fact.value === null || Array.isArray(fact.value)) return false;
    const target = fact.value.target_definition_key;
    return typeof target === "string" && definitionsByKey.get(target)?.qualified_name === "helper";
  }));
  assert.ok(overlay.facts.some((fact) => fact.kind === "entrypoint"));
  assert.ok(overlay.facts.some((fact) => fact.kind === "control_step"));
  assert.ok(overlay.facts.some((fact) => fact.kind === "effect"));
  assert.ok(overlay.facts.some((fact) => fact.kind === "application_flow"));
  assert.ok(overlay.evidence.every((item) => item.span.end_byte > item.span.start_byte));
});

test("semantic overlay is deterministic and rejects source drift", () => {
  const source = fixtureSource(fixture);
  const state = new RepositoryIndexer({
    adapters: [new TypeScriptTreeSitterAdapter()],
  }).buildFull(source).state;
  const enricher = new TypeScriptSemanticEnricher();
  const first = enricher.enrich({ state, source });
  const second = enricher.enrich({ state, source });

  assert.equal(first.overlay_hash, second.overlay_hash);
  assert.equal(canonicalJson(first), canonicalJson(second));

  const changed = fixtureSource(`${fixture}\nexport const drift = true;\n`);
  changed.repository_id = source.repository_id;
  assert.throws(
    () => enricher.enrich({ state, source: changed }),
    (error: unknown) => error instanceof SemanticEnrichmentError && error.code === "SOURCE_DIGEST_MISMATCH",
  );
});

test("diagnostic truncation selects a stable prefix across compiler processes", () => {
  const files = Array.from({ length: 12 }, (_, file) => {
    const source_bytes = Buffer.from(`export {};\n${Array.from({ length: 25 }, (_, name) => `missing_${file}_${name}();`).join("\n")}`);
    return { relative_path: `src/file-${String(file).padStart(2, "0")}.ts`, language: "typescript" as const, source_bytes, source_digest: sha256Bytes(source_bytes) };
  });
  const source = { repository_id: "diagnostic-order", files };
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlays = Array.from({ length: 4 }, () => new TypeScriptSemanticEnricher().enrich({ state, source }));
  assert.equal(overlays[0]!.diagnostics.length, 201);
  assert.equal(new Set(overlays.map((overlay) => canonicalJson(overlay.diagnostics))).size, 1);
  assert.ok(overlays[0]!.diagnostics.filter((item) => item.file_path).every((item) => item.file_path <= "src/file-07.ts"));
});

test("semantic payload cannot conceal an undeclared Evidence reference", () => {
  const source = fixtureSource(fixture);
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state, source });
  assert.throws(() => finalizeSemanticOverlay(state, source, { ...overlay,
    facts: [{ ...overlay.facts[0]!, value: { nested: { default_evidence_id: "missing" } } }] }), /undeclared Evidence/);
  const forged = fixtureSource(fixture.replace("value + 1", "value + 2"));
  forged.files[0]!.source_digest = source.files[0]!.source_digest;
  assert.throws(() => new TypeScriptSemanticEnricher().enrich({ state, source: forged }), /Source no longer matches/);
});

test("application flow includes reachable callee CFGs and excludes calls after return", () => {
  const source = fixtureSource("function helper() { return 1; } function dead() { return 2; } export function main(flag: boolean) { if (flag) return helper(); throw 1; dead(); }");
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state, source });
  const key = (name: string) => state.graph.definitions.find((item) => item.name === name)!.definition_key;
  const flow = overlay.facts.find((item) => item.kind === "application_flow" && item.subject.kind === "definition" && item.subject.definition_key === key("main"))!;
  const value = flow.value as { functions: { definition_key: string }[]; calls: { target_definition_key: string }[]; truncated: boolean };
  assert.ok(value.functions.some((item) => item.definition_key === key("helper")));
  assert.ok(!value.calls.some((item) => item.target_definition_key === key("dead")));
  assert.equal(value.truncated, false);
  assert.ok(flow.evidence_ids.every((id) => overlay.evidence.some((item) => item.evidence_id === id)));
});

test("nested functions do not inherit the outer export as their own entrypoint", () => {
  const source = fixtureSource("export function main() { function hidden() { return 1; } return hidden(); }");
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state, source });
  const hidden = state.graph.definitions.find((item) => item.name === "hidden")!;
  assert.ok(!overlay.facts.some((item) => item.kind === "entrypoint" && item.subject.kind === "definition" && item.subject.definition_key === hidden.definition_key));
});

test("interface method signatures never turn the containing interface into a call target", () => {
  const source = fixtureSource(`interface Loader { contractInfo(): string; }
export function inspect(loader: Loader) { return loader.contractInfo(); }`);
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state, source });
  const loader = state.graph.definitions.find((item) => item.name === "Loader")!;
  const call = overlay.facts.find((item) => item.kind === "call_target" &&
    typeof item.value === "object" && item.value !== null && !Array.isArray(item.value) && item.value.call === "loader.contractInfo")!;
  assert.ok(call);
  assert.equal((call.value as { target_definition_key: string | null }).target_definition_key, null);
  assert.ok(!overlay.facts.some((item) => item.kind === "call_target" &&
    typeof item.value === "object" && item.value !== null && !Array.isArray(item.value) && item.value.target_definition_key === loader.definition_key));
});
