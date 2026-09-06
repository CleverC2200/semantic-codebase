import assert from "node:assert/strict";
import { test } from "node:test";
import { RepositoryIndexer, TypeScriptTreeSitterAdapter, PythonTreeSitterAdapter, TypeScriptSemanticEnricher, PythonPyrightEnricher, sha256Bytes } from "../../src/index.js";

for (const language of ["typescript", "python"] as const) test(`${language}: direct-return chains propagate only proven parameter dependencies`, () => {
  const source_bytes = Buffer.from(language === "typescript" ? `
function leaf(x: number) { return x + 1; }
function middle(y: number) { return leaf(y); }
function outer(z: number) { return middle(z); }
function fixed(x: number) { return 1; }
function discard(y: number) { return fixed(y); }
export function main(a: number) { const result = outer(a); return result; }
export function negative(a: number) { return discard(a); }
` : `def leaf(x: int):
    return x + 1
def middle(y: int):
    return leaf(y)
def outer(z: int):
    return middle(z)
def fixed(x: int):
    return 1
def discard(y: int):
    return fixed(y)
def main(a: int):
    result = outer(a)
    return result
def negative(a: int):
    return discard(a)
`);
  const source = { repository_id: "bounded-chain", files: [{ relative_path: language === "typescript" ? "main.ts" : "main.py", language, source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [language === "typescript" ? new TypeScriptTreeSitterAdapter() : new PythonTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = (language === "typescript" ? new TypeScriptSemanticEnricher() : new PythonPyrightEnricher()).enrich({ state, source });
  const key = (name: string) => state.graph.definitions.find((item) => item.name === name)!.definition_key;
  const value = (name: string) => overlay.facts.find((fact) => fact.kind === "call_data_flow" && fact.subject.kind === "definition" && fact.subject.definition_key === key(name))!.value as unknown as { mappings: { argument_expression: string; parameter_name: string }[]; depth: number };
  assert.ok(value("main").depth >= 3 && value("main").depth <= 4);
  assert.equal(value("main").mappings[0]?.argument_expression, "a");
  assert.equal(value("main").mappings[0]?.parameter_name, "z");
  assert.equal(value("negative").mappings.length, 0);
});
