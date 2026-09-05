import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PythonTreeSitterAdapter,
  TypeScriptTreeSitterAdapter,
  canonicalHash,
  sha256Bytes,
  type Language,
  type SyntaxAdapter,
} from "../../src/index.js";

function extract(adapter: SyntaxAdapter, source: string, language: Language, path: string) {
  const source_bytes = new TextEncoder().encode(source);
  return adapter.extract({
    repository_id: "fixture",
    snapshot_id: "snapshot",
    relative_path: path,
    language,
    source_bytes,
    source_digest: sha256Bytes(source_bytes),
  });
}

test("TypeScript candidates preserve aliases, calls and heritage without target keys", () => {
  const source = [
    'import Default, { foo as local, bar } from "./dep";',
    'import * as ns from "pkg";',
    'export { local as out };',
    'export { thing as alias } from "./other";',
    "export class C extends Base implements I, ns.J {",
    "  m() { local(); ns.work(); this.run(); }",
    "}",
    "interface X extends I, J {}",
    "// fake(); import x from 'fake'",
    'const text = "ghost.call()";',
  ].join("\n");
  const slice = extract(new TypeScriptTreeSitterAdapter(), source, "typescript", "src/main.ts");
  const candidates = slice.relation_candidates.map(({ kind, target_hint }) => ({ kind, target_hint }));

  assert.deepEqual(candidates, [
    { kind: "IMPORTS", target_hint: { kind: "module", specifier: "./dep", imported_name: "default", alias: "Default" } },
    { kind: "IMPORTS", target_hint: { kind: "module", specifier: "./dep", imported_name: "foo", alias: "local" } },
    { kind: "IMPORTS", target_hint: { kind: "module", specifier: "./dep", imported_name: "bar" } },
    { kind: "IMPORTS", target_hint: { kind: "module", specifier: "pkg", imported_name: "*", alias: "ns" } },
    { kind: "EXPORTS", target_hint: { kind: "name", name: "local", alias: "out" } },
    { kind: "EXPORTS", target_hint: { kind: "module", specifier: "./other", imported_name: "thing", alias: "alias" } },
    { kind: "EXPORTS", target_hint: { kind: "name", name: "C" } },
    { kind: "INHERITS", target_hint: { kind: "name", name: "Base" } },
    { kind: "IMPLEMENTS", target_hint: { kind: "name", name: "I" } },
    { kind: "IMPLEMENTS", target_hint: { kind: "name", name: "J", qualifier: "ns" } },
    { kind: "CALLS", target_hint: { kind: "name", name: "local" } },
    { kind: "CALLS", target_hint: { kind: "member", receiver_text: "ns", member: "work" } },
    { kind: "CALLS", target_hint: { kind: "member", receiver_text: "this", member: "run" } },
    { kind: "INHERITS", target_hint: { kind: "name", name: "I" } },
    { kind: "INHERITS", target_hint: { kind: "name", name: "J" } },
  ]);
  assert.ok(slice.relation_candidates.every((candidate) => !("target_definition_key" in candidate)));
  assert.equal(slice.coverage.unresolved_candidate_count, candidates.length);
  assert.equal(slice.evidence.length, slice.definitions.length + candidates.length);
  assert.equal(new Set(Array.from({ length: 3 }, () => canonicalHash(extract(new TypeScriptTreeSitterAdapter(), source, "typescript", "src/main.ts")))).size, 1);
});

test("TypeScript export candidates preserve default, wildcard and namespace visibility", () => {
  const source = [
    "export default function main() {}",
    'export * from "./all";',
    'export * as ns from "./namespace";',
  ].join("\n");
  const slice = extract(new TypeScriptTreeSitterAdapter(), source, "typescript", "src/main.ts");

  assert.deepEqual(
    slice.relation_candidates
      .filter((candidate) => candidate.kind === "EXPORTS")
      .map((candidate) => candidate.target_hint),
    [
      { kind: "name", name: "main", alias: "default" },
      { kind: "module", specifier: "./all", imported_name: "*" },
      { kind: "module", specifier: "./namespace", imported_name: "*", alias: "ns" },
    ],
  );
});

test("Candidate identity includes its repository-relative file path", () => {
  const source = "export function same() {}\n";
  const first = extract(new TypeScriptTreeSitterAdapter(), source, "typescript", "src/first.ts");
  const second = extract(new TypeScriptTreeSitterAdapter(), source, "typescript", "src/second.ts");

  assert.notDeepEqual(
    first.relation_candidates.map((candidate) => candidate.local_id),
    second.relation_candidates.map((candidate) => candidate.local_id),
  );
});

test("Python candidates preserve relative imports, aliases, calls and bases", () => {
  const source = [
    "import pkg.mod as pm, plain",
    "from .base import A as Alias, B",
    "class C(Alias, pm.Mixin):",
    "    def m(self):",
    "        helper()",
    "        self.run()",
    "        pm.work()",
    "# fake()",
    'text = "ghost.call()"',
  ].join("\r\n");
  const slice = extract(new PythonTreeSitterAdapter(), source, "python", "pkg/main.py");

  assert.deepEqual(
    slice.relation_candidates.map(({ kind, target_hint }) => ({ kind, target_hint })),
    [
      { kind: "IMPORTS", target_hint: { kind: "module", specifier: "pkg.mod", alias: "pm" } },
      { kind: "IMPORTS", target_hint: { kind: "module", specifier: "plain" } },
      { kind: "IMPORTS", target_hint: { kind: "module", specifier: ".base", imported_name: "A", alias: "Alias" } },
      { kind: "IMPORTS", target_hint: { kind: "module", specifier: ".base", imported_name: "B" } },
      { kind: "INHERITS", target_hint: { kind: "name", name: "Alias" } },
      { kind: "INHERITS", target_hint: { kind: "name", name: "Mixin", qualifier: "pm" } },
      { kind: "CALLS", target_hint: { kind: "name", name: "helper" } },
      { kind: "CALLS", target_hint: { kind: "member", receiver_text: "self", member: "run" } },
      { kind: "CALLS", target_hint: { kind: "member", receiver_text: "pm", member: "work" } },
    ],
  );
  const bytes = new TextEncoder().encode(source);
  for (const candidate of slice.relation_candidates) {
    const evidence = slice.evidence.find((item) => candidate.evidence_local_ids.includes(item.local_id));
    assert.ok(evidence);
    assert.ok(new TextDecoder().decode(bytes.slice(evidence.span.start_byte, evidence.span.end_byte)).length > 0);
  }
});
