import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RepositoryIndexer,
  SemanticEnrichmentError,
  TypeScriptSemanticEnricher,
  TypeScriptTreeSitterAdapter,
  canonicalJson,
  sha256Bytes,
  type RepositorySource,
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
