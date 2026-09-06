import assert from "node:assert/strict";
import { test } from "node:test";

import { RepositoryIndexer, TypeScriptSemanticEnricher, TypeScriptTreeSitterAdapter, sha256Bytes, type RepositorySource } from "../../src/index.js";
import { repositoryManifestSummary } from "../../src/repository/source.js";

function input(target = "a"): RepositorySource {
  const bytes = (relative_path: string, text: string) => {
    const source_bytes = new TextEncoder().encode(text);
    return { relative_path, source_bytes, source_digest: sha256Bytes(source_bytes) };
  };
  return {
    repository_id: "configured-project",
    files: [
      ["src/main.ts", 'import { chosen } from "@chosen"; export function main() { return chosen(); }'],
      ["src/a.ts", 'export function chosen() { return "A"; }'],
      ["src/b.ts", 'export function chosen() { return "B"; }'],
    ].map(([name, text]) => ({ ...bytes(name!, text!), language: "typescript" })),
    configuration_files: [
      bytes("tsconfig.json", '// project configuration with JSONC\n{ "extends": "./tsconfig.base.json", "include": ["src/**/*.ts"] }'),
      bytes("tsconfig.base.json", JSON.stringify({ compilerOptions: { module: "ESNext", moduleResolution: "Bundler", paths: { "@chosen": [`./src/${target}.ts`] } } })),
    ],
  };
}

test("frozen JSONC extends and paths select the source-expected callee, not its same-named sibling", () => {
  const indexer = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] });
  const enricher = new TypeScriptSemanticEnricher();
  const a = input("a");
  const first = indexer.buildFull(a).state;
  const b = input("b");
  const second = indexer.buildIncremental(first, b);
  assert.notEqual(first.snapshot_id, second.state.snapshot_id);
  assert.equal(second.receipt.extracted_files.length, 0);
  assert.equal(second.receipt.reused_files.length, 3);
  assert.equal(second.state.snapshot_id, indexer.buildFull(b).state.snapshot_id);
  assert.equal(repositoryManifestSummary(b).digest, second.state.source_manifest_digest);
  for (const [source, state, expectedPath] of [[a, first, "src/a.ts"], [b, second.state, "src/b.ts"]] as const) {
    const overlay = enricher.enrich({ source, state });
    const target = state.graph.definitions.find((item) => item.name === "chosen" && item.file_path === expectedPath)!;
    assert.ok(target);
    const calls = overlay.facts.filter((fact) => fact.kind === "call_target" && fact.basis.kind === "compiler_exact");
    assert.equal(calls.length, 1);
    assert.equal((calls[0]!.value as { target_definition_key: string }).target_definition_key, target.definition_key);
  }
  assert.throws(() => enricher.enrich({ source: b, state: first }), /no longer matches Ready Snapshot/);
});

test("missing frozen extends is an explicit error instead of silent default configuration", () => {
  const source = input();
  source.configuration_files!.pop();
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  assert.throws(() => new TypeScriptSemanticEnricher().enrich({ source, state }), /frozen configuration is invalid/);
});

test("configuration bytes and repository-relative paths are validated before indexing", () => {
  const indexer = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] });
  const source = input();
  source.configuration_files![0]!.source_digest = "forged";
  assert.throws(() => indexer.buildFull(source), /digest mismatch/);
  const escaped = input();
  escaped.configuration_files![0]!.relative_path = "../tsconfig.json";
  assert.throws(() => indexer.buildFull(escaped), /Invalid configuration path/);
});

test("files excluded by the configured program count as skipped, not analyzed", () => {
  const source = input();
  const source_bytes = new TextEncoder().encode('{ "files": ["src/a.ts"] }');
  source.configuration_files = [{ relative_path: "tsconfig.json", source_bytes, source_digest: sha256Bytes(source_bytes) }];
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ source, state });
  assert.equal(overlay.coverage.analyzed_files, 1);
  assert.equal(overlay.coverage.skipped_files, 2);
  assert.equal(overlay.coverage.status, "partial");
  assert.ok(overlay.coverage.reason_codes.includes("typescript_files_outside_configured_program"));
});

test("solution references open child projects and resolve a cross-project call", () => {
  const bytes = (relative_path: string, text: string) => {
    const source_bytes = new TextEncoder().encode(text);
    return { relative_path, source_bytes, source_digest: sha256Bytes(source_bytes) };
  };
  const source: RepositorySource = {
    repository_id: "solution",
    files: [
      { ...bytes("a/index.ts", "export function helper() { return 42; }"), language: "typescript" },
      { ...bytes("b/index.ts", 'import { helper } from "../a/index"; export function main() { return helper(); }'), language: "typescript" },
    ],
    configuration_files: [
      bytes("tsconfig.json", '{"files": [], "references": [{"path":"./a"}, {"path":"./b"}],}'),
      bytes("a/tsconfig.json", '{"compilerOptions":{"composite":true}, "files":["index.ts"]}'),
      bytes("b/tsconfig.json", '{"compilerOptions":{"composite":true}, "files":["index.ts"], "references":[{"path":"../a"}]}'),
    ],
  };
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ source, state });
  const helper = state.graph.definitions.find((item) => item.name === "helper")!;
  assert.equal(overlay.coverage.analyzed_files, 2);
  assert.ok(overlay.facts.some((fact) => fact.kind === "call_target" && (fact.value as {target_definition_key?: string}).target_definition_key === helper.definition_key));
});
