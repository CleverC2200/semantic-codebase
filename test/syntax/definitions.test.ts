import assert from "node:assert/strict";
import { test } from "node:test";
import type Parser from "tree-sitter";
import type { RawDefinition, Utf8OffsetMap } from "../../src/syntax/tree-sitter/base-adapter.js";
import type { SourceFileInput } from "../../src/contract/types.js";

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

test("anonymous diagnostics inspect each stable binding only once", () => {
  let reads = 0;
  class CountingAdapter extends TypeScriptTreeSitterAdapter {
    protected override collectLanguageDiagnostics(root: Parser.SyntaxNode, definitions: RawDefinition[], input: SourceFileInput, offsets: Utf8OffsetMap) {
      const counted = definitions.map((definition) => ({ ...definition, get node() { reads++; return definition.node; } }));
      return super.collectLanguageDiagnostics(root, counted, input, offsets);
    }
  }
  const source = Array.from({ length: 100 }, (_, index) => `const named${index} = () => ${index}; [1].map(x => x);`).join("\n");
  const slice = extract(new CountingAdapter(), source, "typescript", "bindings.ts");
  assert.equal(slice.definitions.length, 100);
  assert.equal(slice.diagnostics.filter((item) => item.code === "unsupported_anonymous_definition").length, 100);
  assert.ok(reads <= 200, `Read stable binding nodes ${reads} times`);
});

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

test("TypeScript variance parameters preserve original UTF-8 definitions and syntax errors", () => {
  const adapter = new TypeScriptTreeSitterAdapter();
  for (const parameters of ["out T", "in T", "in out T", "out T extends string = string", "out", "out = string", "out extends string", "in"]) {
    const source = `// 中文🙂\nexport interface Box<${parameters}> { value: unknown }`;
    const slice = extract(adapter, source, "typescript", "variance.ts");
    assert.equal(slice.coverage.status, "complete", `${parameters}: ${JSON.stringify(slice.diagnostics)}`);
    assert.deepEqual(slice.definitions.map((definition) => definition.name), ["Box"]);
    assertDefinitionSpans(source, slice);
    const span = slice.definitions[0]!.definition_span;
    assert.equal(Buffer.from(source).subarray(span.start_byte, span.end_byte).toString(), `interface Box<${parameters}> { value: unknown }`);
  }
  for (const source of ["type Getter<out T> = () => T;", "class Box<const out T> { value!: T }", "function out<out>(value: out): out { return value; }"]) {
    const slice = extract(adapter, source, "typescript", "variance.ts");
    assert.equal(slice.coverage.status, "complete", JSON.stringify(slice.diagnostics));
    assertDefinitionSpans(source, slice);
  }
  const invalid = extract(adapter, "interface Broken<in out T extends > {}", "typescript", "invalid.ts");
  assert.ok(invalid.diagnostics.some((diagnostic) => diagnostic.severity === "error"));
});

test("TypeScript parses sources larger than the tree-sitter string input limit", () => {
  const source = `// 中文🙂${"a".repeat(32_768)}\nexport function afterLargePrefix() {}\n`;
  const slice = extract(new TypeScriptTreeSitterAdapter(), source, "typescript", "src/large.ts");

  assert.equal(slice.coverage.status, "complete");
  assert.deepEqual(
    slice.definitions.map(({ kind, qualified_name }) => [kind, qualified_name]),
    [["function", "afterLargePrefix"]],
  );
  assertDefinitionSpans(source, slice);
});

test("UTF-8 definition spans preserve one through four byte character boundaries", () => {
  for (const prefix of ["ASCII", "\u007f\u0080\u07ff\u0800", "中文", "\uffff", "\u{10000}\u{10ffff}", "e\u0301🙂"]) {
    const source = `// ${prefix}\r\nexport function marker() { return '${prefix}'; }`;
    const slice = extract(new TypeScriptTreeSitterAdapter(), source, "typescript", "unicode.ts");
    assert.equal(slice.coverage.status, "complete");
    assertDefinitionSpans(source, slice);
    const definition = slice.definitions.find((item) => item.name === "marker")!;
    assert.equal(definition.name_span.start_byte, Buffer.byteLength(source.slice(0, source.indexOf("marker"))));
    assert.equal(definition.definition_span.end_byte, Buffer.byteLength(source));
  }
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

test("anonymous callables are diagnosed while stable callable bindings remain definitions", () => {
  const typescript = extract(
    new TypeScriptTreeSitterAdapter(),
    "const stable = () => 1; consume(() => 2);\n",
    "typescript",
    "anonymous.ts",
  );
  assert.ok(typescript.definitions.some((definition) => definition.name === "stable"));
  assert.equal(
    typescript.diagnostics.filter((diagnostic) => diagnostic.code === "unsupported_anonymous_definition").length,
    1,
  );

  const python = extract(
    new PythonTreeSitterAdapter(),
    "consume(lambda value: value)\n",
    "python",
    "anonymous.py",
  );
  assert.equal(
    python.diagnostics.filter((diagnostic) => diagnostic.code === "unsupported_anonymous_definition").length,
    1,
  );
});
