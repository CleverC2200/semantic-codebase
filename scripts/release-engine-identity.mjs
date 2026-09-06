import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// Bind receipts to the whole executable engine, not a hand-maintained subset.
export function releaseEngineDigest(root) {
  const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isSymbolicLink() ? [] : entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
  const files = [...walk(path.join(root, "dist")).filter((file) => /\.(?:js|scm)$/.test(file)),
    ...["package.json", "package-lock.json", "scripts/pyright-semantic-worker.mjs"].map((file) => path.join(root, file))];
  const require = createRequire(path.join(root, "package.json"));
  const dependencies = ["typescript", "pyright", "tree-sitter", "tree-sitter-python", "tree-sitter-typescript"]
    .map((name) => ({ name, version: JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8")).version }));
  const identity = {
    schema_version: 1,
    runtime: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch },
    dependencies,
    files: files.sort().map((file) => ({ file: path.relative(root, file).split(path.sep).join("/"),
      sha256: createHash("sha256").update(readFileSync(file)).digest("hex") })),
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
