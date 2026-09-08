import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

// Temporary compatibility patch on upstream PR #364, pinned in package-lock.json.
// Preserve contextual identifiers and quoted NUL bytes; never rewrite input code.
const require = createRequire(import.meta.url);
const root = dirname(require.resolve("tree-sitter-typescript/package.json"));
const filename = resolve(root, "common/define-grammar.js");
const before = "        field('name', $._type_identifier),\n        field('constraint', optional($.constraint)),";
const after = "        field('name', choice($._type_identifier, alias('out', $.type_identifier), alias('in', $.type_identifier))),\n        field('constraint', optional($.constraint)),";
// Explicit NUL alternatives distinguish a source byte from the lexer EOF sentinel.
const stringFragments = String.raw`      unescaped_double_string_fragment: _ => token.immediate(prec(1, repeat1(choice(/[^"\\\r\n]+/, '\0')))),
      unescaped_single_string_fragment: _ => token.immediate(prec(1, repeat1(choice(/[^'\\\r\n]+/, '\0')))),

`;
const primaryMarker = '      primary_expression: ($, previous) => choice(';
const patches = [
  [before, after],
  ["      _reserved_identifier: (_, previous) => choice(\n", "      _reserved_identifier: (_, previous) => choice(\n        'unique',\n"],
  [primaryMarker, stringFragments + primaryMarker],
];
let original = readFileSync(filename, "utf8");
for (const [before, after] of [...patches].reverse()) original = original.replace(after, before);
assert.equal(createHash("sha256").update(original).digest("hex"), "0588c30299aa52b879ab1d5a702d4938dd1eb3aaef5120fec3249faf5123c2d5", "Unexpected upstream grammar; review patch before upgrading");
let source = original;
for (const [before, after] of patches) { assert.ok(source.includes(before)); source = source.replace(before, after); }
writeFileSync(filename, source);
const cli = require.resolve("tree-sitter-cli/cli.js");
for (const dialect of ["typescript", "tsx"]) {
  execFileSync(process.execPath, [cli, "generate", "--abi", "14"], { cwd: resolve(root, dialect), stdio: "inherit" });
}
execFileSync(process.execPath, [require.resolve("node-gyp/bin/node-gyp.js"), "rebuild"], { cwd: root, stdio: "inherit" });
const Parser = require("tree-sitter");
const grammar = require("tree-sitter-typescript");
for (const dialect of ["typescript", "tsx"]) {
  const parser = new Parser();
  parser.setLanguage(grammar[dialect]);
  for (const parameters of ["out T", "in T", "in out T", "out", "in"]) {
    assert.equal(parser.parse(`interface Box<${parameters}> {}`).rootNode.hasError, false, `${dialect}: ${parameters}`);
  }
  const comparison = parser.parse('function scan(unique: string[]) { for(let i=0;i<unique.length;i++) {} }');
  assert.equal(comparison.rootNode.hasError, false, `${dialect}: contextual unique`);
  assert.equal(comparison.rootNode.descendantsOfType('binary_expression')[0]?.childForFieldName('operator')?.text, '<');
  for (const source of ["declare const marker: unique symbol;", "function first() { return 'before\0after'; } function second() {}", 'const value = "\0\0";']) {
    assert.equal(parser.parse(source).rootNode.hasError, false, `${dialect}: ${JSON.stringify(source)}`);
  }
  for (const source of ['const x = "unterminated\0', 'const x = \0;']) {
    assert.equal(parser.parse(source).rootNode.hasError, true, `${dialect}: rejects ${JSON.stringify(source)}`);
  }
}
console.log("TypeScript/TSX compatibility grammar prepared and verified (ABI 14)");
