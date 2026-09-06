import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DeterministicResolver,
  PythonTreeSitterAdapter,
  TypeScriptTreeSitterAdapter,
  canonicalHash,
  RepositoryIndexer,
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
      files: slices.map((item) => ({
        ...item.file,
        byte_length: files.find(([filePath]) => filePath === item.file.relative_path)?.[1]
          ? new TextEncoder().encode(files.find(([filePath]) => filePath === item.file.relative_path)?.[1]).byteLength
          : 0,
      })),
    },
    slices,
    adapter_manifests: [adapter.manifest],
  };
}

function resolvedKinds(repository: FrozenRepositoryView): string[] {
  const candidates = new Map(
    repository.slices.flatMap((item) =>
      item.relation_candidates.map((candidate) => [candidate.local_id, candidate.kind] as const),
    ),
  );
  return new DeterministicResolver().resolve(repository).resolved_relations.map((relation) => {
    const kind = candidates.get(relation.candidate_local_id);
    assert.ok(kind);
    return kind;
  });
}

test("candidate sorting serializes each payload once rather than per comparison", () => {
  const repository = view([["main.ts", `function main() { ${Array.from({ length: 100 }, (_, i) => `missing${i}();`).join(" ")} }`]]);
  // Count reads of a serialization-only field; resolution itself does not inspect it.
  let reads = 0;
  for (const candidate of repository.slices[0]!.relation_candidates) {
    Object.defineProperty(candidate, "sorting_probe", { enumerable: true, get: () => { reads++; return "unchanged"; } });
  }
  const result = new DeterministicResolver().resolve(repository);
  assert.equal(result.coverage.unresolved_count, 100);
  assert.ok(reads <= 2 * 100, `payload serialized repeatedly: ${reads} field reads`);
});

test("Python local imports and class-body calls stay candidates under the structural contract", () => {
  const files = [["dep.py", "def helper():\n    return 1\n"], ["main.py", "from dep import helper\nclass Box:\n    value = helper()\n    def run(self):\n        from dep import helper\n        return helper()\n"]].map(([relative_path, text]) => {
    const source_bytes = Buffer.from(text!);
    return { relative_path: relative_path!, language: "python" as const, source_bytes, source_digest: sha256Bytes(source_bytes) };
  });
  const state = new RepositoryIndexer({ adapters: [new PythonTreeSitterAdapter()] }).buildFull({ repository_id: "local-imports", files }).state;
  assert.equal(state.graph.coverage.status, "ready");
  assert.ok(state.graph.unresolved_candidates.some((item) => item.kind === "IMPORTS" && item.source_local_ref.kind === "definition"));
  assert.ok(state.graph.unresolved_candidates.some((item) => item.kind === "CALLS" && item.source_local_ref.kind === "definition"));
  assert.ok(state.graph.relations.some((item) => item.kind === "IMPORTS" && item.source.kind === "source_file"));
  const run = state.graph.definitions.find((item) => item.name === "run")!;
  assert.ok(!state.graph.relations.some((item) => item.kind === "CALLS" && item.source.kind === "definition" && item.source.definition_key === run.definition_key));
  assert.ok(state.graph.diagnostics.some((item) => item.code === "unsupported_relation_source"));
});

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
  const resolved = resolvedKinds(repository);

  assert.equal(result.coverage.status, "complete");
  assert.deepEqual(resolved.sort(), ["CALLS", "CALLS", "EXPORTS", "EXPORTS", "EXPORTS", "IMPORTS", "IMPORTS", "INHERITS"].sort());
  assert.ok(result.resolved_relations.every((relation) =>
    Object.keys(relation).sort().join(",") === "candidate_local_id,derivation,target",
  ));
  assert.equal(new Set(Array.from({ length: 3 }, () => canonicalHash(new DeterministicResolver().resolve(repository)))).size, 1);
});

test("alias, namespace and circular imports resolve without recursive guessing", () => {
  const repository = view([
    ["src/a.ts", 'import { B } from "./b"; export class A { use() { B.make(); } }\n'],
    ["src/b.ts", 'import { A } from "./a"; export class B { static make() {} use() { A; } }\n'],
  ]);
  const result = new DeterministicResolver().resolve(repository);

  assert.equal(result.coverage.candidate_count, 5);
  const kinds = resolvedKinds(repository);
  assert.ok(kinds.includes("CALLS"));
  assert.equal(kinds.filter((kind) => kind === "IMPORTS").length, 2);
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

test("TypeScript imports require exported default, alias, wildcard and re-export bindings", () => {
  const repository = view([
    [
      "src/dep.ts",
      [
        "export function publicFn() {}",
        "function hidden() {}",
        "export default class DefaultThing { static make() {} }",
      ].join("\n"),
    ],
    [
      "src/barrel.ts",
      [
        'export { publicFn as renamed } from "./dep";',
        'export * from "./dep";',
        'export * as ns from "./dep";',
      ].join("\n"),
    ],
    [
      "src/main.ts",
      [
        'import DefaultThing from "./dep";',
        'import { renamed, publicFn, hidden, ns } from "./barrel";',
        "renamed(); publicFn(); hidden(); ns.publicFn(); DefaultThing.make();",
      ].join("\n"),
    ],
  ]);
  const result = new DeterministicResolver().resolve(repository);
  const resolvedIds = new Set(result.resolved_relations.map((relation) => relation.candidate_local_id));
  const candidates = repository.slices.flatMap((item) => item.relation_candidates);
  const matching = (kind: string, name: string) => candidates.filter((candidate) => {
    if (candidate.kind !== kind) return false;
    const hint = candidate.target_hint;
    return (hint.kind === "name" && hint.name === name) ||
      (hint.kind === "member" && hint.member === name) ||
      (hint.kind === "module" && (hint.alias === name || hint.imported_name === name));
  });

  for (const name of ["DefaultThing", "renamed", "publicFn", "ns"]) {
    assert.ok(matching("IMPORTS", name).every((candidate) => resolvedIds.has(candidate.local_id)));
  }
  assert.ok(matching("CALLS", "publicFn").every((candidate) => resolvedIds.has(candidate.local_id)));
  assert.ok(matching("CALLS", "make").every((candidate) => resolvedIds.has(candidate.local_id)));
  assert.ok(matching("IMPORTS", "hidden").every((candidate) => !resolvedIds.has(candidate.local_id)));
  assert.ok(matching("CALLS", "hidden").every((candidate) => !resolvedIds.has(candidate.local_id)));
});

test("circular wildcard re-exports converge to the same visible bindings", () => {
  const repository = view([
    ["src/a.ts", 'export function A() {}\nexport * from "./b";\n'],
    ["src/b.ts", 'export function B() {}\nexport * from "./a";\n'],
    ["src/use.ts", 'import { A, B } from "./b";\nA(); B();\n'],
  ]);
  const result = new DeterministicResolver().resolve(repository);
  const resolvedIds = new Set(result.resolved_relations.map((relation) => relation.candidate_local_id));
  const userCandidates = repository.slices
    .find((item) => item.file.relative_path === "src/use.ts")!
    .relation_candidates;

  assert.equal(userCandidates.length, 4);
  assert.ok(userCandidates.every((candidate) => resolvedIds.has(candidate.local_id)));
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
      files: slices.map((item) => ({
        ...item.file,
        byte_length: new TextEncoder().encode(
          sources.find(([filePath]) => filePath === item.file.relative_path)?.[1] ?? "",
        ).byteLength,
      })),
    },
    slices,
    adapter_manifests: [python.manifest],
  });

  assert.deepEqual(
    resolvedKinds({
      manifest: {
        repository_id: "repo",
        snapshot_id: "python-snapshot",
        files: slices.map((item) => ({
          ...item.file,
          byte_length: new TextEncoder().encode(
            sources.find(([filePath]) => filePath === item.file.relative_path)?.[1] ?? "",
          ).byteLength,
        })),
      },
      slices,
      adapter_manifests: [python.manifest],
    }).sort(),
    ["CALLS", "IMPORTS", "IMPORTS", "INHERITS"].sort(),
  );
});
