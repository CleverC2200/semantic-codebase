import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DeterministicResolver,
  PythonTreeSitterAdapter,
  TypeScriptTreeSitterAdapter,
  canonicalHash,
  sha256Bytes,
  type FrozenRepositoryView,
  type SyntaxAdapter,
  type SyntaxSlice,
} from "../../src/index.js";

const adapter = new TypeScriptTreeSitterAdapter();

function slice(path: string, source: string): SyntaxSlice {
  const source_bytes = new TextEncoder().encode(source);
  return adapter.extract({
    repository_id: "repo",
    snapshot_id: "snapshot",
    relative_path: path,
    language: "typescript",
    source_bytes,
    source_digest: sha256Bytes(source_bytes),
  });
}

function view(files: Array<[string, string]>): FrozenRepositoryView {
  const slices = files.map(([path, source]) => slice(path, source));
  return {
    manifest: {
      repository_id: "repo",
      snapshot_id: "snapshot",
      files: slices.map((item) => ({ ...item.file })),
    },
    slices,
    adapter_manifests: [adapter.manifest],
  };
}

test("resolver promotes only unique same-file and explicit import targets", () => {
  const repository = view([
    ["src/dep.ts", "export class Base { work() {} }\nexport function helper() {}\n"],
    [
      "src/main.ts",
      [
        'import { Base as Parent, helper as run } from "./dep";',
        "export class Child extends Parent {",
        "  work() { run(); this.work(); }",
        "}",
      ].join("\n"),
    ],
  ]);
  const result = new DeterministicResolver().resolve(repository);
  const resolved = result.resolved_relations.map((relation) => relation.kind);

  assert.equal(result.coverage.status, "complete");
  assert.deepEqual(resolved.sort(), ["CALLS", "CALLS", "EXPORTS", "EXPORTS", "EXPORTS", "IMPORTS", "IMPORTS", "INHERITS"].sort());
  assert.ok(result.resolved_relations.every((relation) => relation.evidence_local_ids.length > 0));
  assert.equal(new Set(Array.from({ length: 3 }, () => canonicalHash(new DeterministicResolver().resolve(repository)))).size, 1);
});

test("alias, namespace and circular imports resolve without recursive guessing", () => {
  const repository = view([
    ["src/a.ts", 'import { B } from "./b"; export class A { use() { B.make(); } }\n'],
    ["src/b.ts", 'import { A } from "./a"; export class B { static make() {} use() { A; } }\n'],
  ]);
  const result = new DeterministicResolver().resolve(repository);

  assert.equal(result.coverage.candidate_count, 5);
  assert.ok(result.resolved_relations.some((relation) => relation.kind === "CALLS"));
  assert.ok(result.resolved_relations.filter((relation) => relation.kind === "IMPORTS").length === 2);
});

test("zero targets, duplicate names and ambiguous module paths remain unresolved", () => {
  const repository = view([
    ["src/amb.ts", "export function dup() {}\nexport class Box { dup() {} }\n"],
    ["src/missing-user.ts", 'import { nope } from "./missing"; function run() { nope(); }\n'],
    ["src/amb-user.ts", "function use() { dup(); }\nfunction dup() {}\nclass C { dup() {} }\n"],
    ["src/mod.ts", "export const x = () => 1;\n"],
    ["src/mod/index.ts", "export const x = () => 2;\n"],
    ["src/module-user.ts", 'import { x } from "./mod"; x();\n'],
  ]);
  const result = new DeterministicResolver().resolve(repository);

  assert.ok(result.unresolved_candidates.length > 0);
  assert.ok(result.diagnostics.every((diagnostic) => diagnostic.code === "unresolved_relation_candidate"));
  assert.ok(!result.resolved_relations.some((relation) => relation.target.file_path.includes("missing")));
});

test("deleted manifest file invalidates a stale frozen view", () => {
  const repository = view([["src/a.ts", "export function a() {}\n"]]);
  repository.manifest.files = [];
  const result = new DeterministicResolver().resolve(repository);
  assert.equal(result.coverage.status, "failed");
  assert.deepEqual(result.resolved_relations, []);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "repository_view_mismatch"));
});

test("Python relative imports and aliases resolve against the frozen manifest", () => {
  const python = new PythonTreeSitterAdapter();
  const sources: Array<[string, string]> = [
    ["pkg/base.py", "class Base:\n    pass\n\ndef helper():\n    pass\n"],
    ["pkg/main.py", "from .base import Base as Parent, helper\nclass Child(Parent):\n    def run(self):\n        helper()\n"],
  ];
  const slices = sources.map(([relative_path, source]) => {
    const source_bytes = new TextEncoder().encode(source);
    return python.extract({
      repository_id: "repo",
      snapshot_id: "python-snapshot",
      relative_path,
      language: "python",
      source_bytes,
      source_digest: sha256Bytes(source_bytes),
    });
  });
  const result = new DeterministicResolver().resolve({
    manifest: {
      repository_id: "repo",
      snapshot_id: "python-snapshot",
      files: slices.map((item) => ({ ...item.file })),
    },
    slices,
    adapter_manifests: [python.manifest],
  });

  assert.deepEqual(
    result.resolved_relations.map((relation) => relation.kind).sort(),
    ["CALLS", "IMPORTS", "IMPORTS", "INHERITS"].sort(),
  );
});
