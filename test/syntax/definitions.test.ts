import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AdapterUnavailableError,
  PythonTreeSitterAdapter,
  TypeScriptTreeSitterAdapter,
  canonicalHash,
  canonicalJson,
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

function assertDefinitionSpans(source: string, slice: ReturnType<typeof extract>): void {
  const bytes = new TextEncoder().encode(source);
  for (const definition of slice.definitions) {
    assert.equal(
      new TextDecoder().decode(bytes.slice(definition.name_span.start_byte, definition.name_span.end_byte)),
      definition.name,
    );
    const declaration = new TextDecoder().decode(
      bytes.slice(definition.definition_span.start_byte, definition.definition_span.end_byte),
    );
    assert.ok(declaration.includes(definition.name), definition.qualified_name);
    assert.ok(definition.evidence_local_ids.length > 0);
  }
}

test("TypeScript extracts named definitions, containers and UTF-8 byte spans", () => {
  const source = [
    "// class Fake {} 中文🙂",
    "export namespace 空间 {",
    "  export interface Runner extends Base {}",
    "  export class Worker {",
    "    get value() { return 'class Ghost {}🙂'; }",
    "    field = () => 1;",
    "    run() { const cb = function namedInside() {}; return cb(); }",
    "  }",
    "  export function top() { function nested() {} }",
    "  export const arrow = async () => 1;",
    "}",
    "",
  ].join("\r\n");
  const adapter = new TypeScriptTreeSitterAdapter();
  const slice = extract(adapter, source, "typescript", "src/sample.ts");
  const summary = slice.definitions.map(({ kind, qualified_name }) => [kind, qualified_name]);

  assert.deepEqual(summary, [
    ["module", "空间"],
    ["interface", "空间.Runner"],
    ["class", "空间.Worker"],
    ["method", "空间.Worker.value"],
    ["method", "空间.Worker.field"],
    ["method", "空间.Worker.run"],
    ["function", "空间.Worker.run.cb"],
    ["function", "空间.top"],
    ["function", "空间.top.nested"],
    ["function", "空间.arrow"],
  ]);
  assert.equal(slice.coverage.status, "complete");
  assert.equal(slice.exact_relations.length, slice.definitions.length);
  assertDefinitionSpans(source, slice);
  const hashes = Array.from({ length: 3 }, () => canonicalHash(extract(adapter, source, "typescript", "src/sample.ts")));
  assert.equal(new Set(hashes).size, 1);
});

test("Python extracts decorated/async methods and keeps nested functions as functions", () => {
  const source = [
    "# class Fake: pass 中文🙂",
    "@decorate",
    "class 服务(Base):",
    "    \"\"\"def ghost(): pass🙂\"\"\"",
    "    @classmethod",
    "    async def build(cls):",
    "        def nested():",
    "            pass",
    "        return nested()",
    "",
    "    @staticmethod",
    "    def helper():",
    "        pass",
    "",
    "def top():",
    "    pass",
    "",
  ].join("\r\n");
  const adapter = new PythonTreeSitterAdapter();
  const slice = extract(adapter, source, "python", "pkg/sample.py");

  assert.deepEqual(
    slice.definitions.map(({ kind, qualified_name }) => [kind, qualified_name]),
    [
      ["class", "服务"],
      ["method", "服务.build"],
      ["function", "服务.build.nested"],
      ["method", "服务.helper"],
      ["function", "top"],
    ],
  );
  assertDefinitionSpans(source, slice);
  assert.equal(new Set(Array.from({ length: 3 }, () => canonicalJson(extract(adapter, source, "python", "pkg/sample.py")))).size, 1);
});

test("syntax recovery is partial but retains unaffected definitions", () => {
  const source = "function intact() { return 1; }\nfunction broken( {\n";
  const slice = extract(new TypeScriptTreeSitterAdapter(), source, "typescript", "broken.ts");
  assert.ok(slice.definitions.some((definition) => definition.name === "intact"));
  assert.equal(slice.coverage.status, "partial");
  assert.ok(slice.diagnostics.some((diagnostic) => ["syntax_error", "missing_syntax"].includes(diagnostic.code)));
});

test("empty/comment-only sources are complete and invalid inputs fail visibly", () => {
  for (const [adapter, language, path, source] of [
    [new TypeScriptTreeSitterAdapter(), "typescript", "empty.ts", "// only a comment\n"],
    [new PythonTreeSitterAdapter(), "python", "empty.py", "# only a comment\n"],
  ] as const) {
    const slice = extract(adapter, source, language, path);
    assert.equal(slice.coverage.status, "complete");
    assert.deepEqual(slice.definitions, []);
  }
  const limited = new TypeScriptTreeSitterAdapter({ maxSourceBytes: 2 });
  assert.equal(extract(limited, "abc", "typescript", "large.ts").diagnostics[0]?.code, "resource_limit_exceeded");
  assert.throws(
    () => new TypeScriptTreeSitterAdapter({ definitionsQuerySource: "(not_a_real_node) @x" }),
    AdapterUnavailableError,
  );
});
