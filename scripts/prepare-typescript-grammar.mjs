import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

// Temporary compatibility patch on upstream PR #364, pinned in package-lock.json.
// Keep contextual `out` available as a parameter name; never rewrite input code.
const require = createRequire(import.meta.url);
const root = dirname(require.resolve("tree-sitter-typescript/package.json"));
const filename = resolve(root, "common/define-grammar.js");
const before = "        field('name', $._type_identifier),\n        field('constraint', optional($.constraint)),";
const after = "        field('name', choice($._type_identifier, alias('out', $.type_identifier), alias('in', $.type_identifier))),\n        field('constraint', optional($.constraint)),";
let source = readFileSync(filename, "utf8");
const original = source.replace(after, before);
assert.equal(createHash("sha256").update(original).digest("hex"), "0588c30299aa52b879ab1d5a702d4938dd1eb3aaef5120fec3249faf5123c2d5", "Unexpected upstream grammar; review patch before upgrading");
source = original.replace(before, after);
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
}
console.log("TypeScript/TSX variance grammar prepared and verified (ABI 14)");
