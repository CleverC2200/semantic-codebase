import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const assets = [
  "src/syntax/tree-sitter/typescript/definitions.scm",
  "src/syntax/tree-sitter/typescript/relations.scm",
  "src/syntax/tree-sitter/python/definitions.scm",
  "src/syntax/tree-sitter/python/relations.scm",
];

for (const source of assets) {
  if (!existsSync(source)) continue;
  const target = source.replace(/^src\//, "dist/");
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
}
