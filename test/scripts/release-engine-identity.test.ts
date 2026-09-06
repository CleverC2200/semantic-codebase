import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { releaseEngineDigest } from "../../scripts/release-engine-identity.mjs";

test("release evidence expires on helper, query, Python worker and dependency changes", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "scb-engine-identity-"));
  const write = (file: string, value: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), value);
  };
  try {
    write("package.json", '{"type":"module"}');
    write("package-lock.json", '{}');
    write("scripts/pyright-semantic-worker.mjs", '// worker');
    write("dist/semantic/data-flow.js", '// data flow');
    write("dist/syntax/definitions.scm", '(function)');
    for (const name of ["typescript", "pyright", "tree-sitter", "tree-sitter-python", "tree-sitter-typescript"]) {
      write(`node_modules/${name}/package.json`, '{"version":"1.0.0"}');
    }
    let digest = releaseEngineDigest(root);
    assert.equal(releaseEngineDigest(root), digest);
    for (const [file, content] of [
      ["dist/semantic/data-flow.js", '// changed helper outside old nine-file list'],
      ["dist/semantic/new-helper.js", '// newly introduced module'],
      ["dist/syntax/definitions.scm", '(class)'],
      ["scripts/pyright-semantic-worker.mjs", '// changed protocol'],
      ["package-lock.json", '{"lockfileVersion":3}'],
      ["node_modules/pyright/package.json", '{"version":"2.0.0"}'],
    ]) {
      write(file!, content!);
      const next = releaseEngineDigest(root);
      assert.notEqual(next, digest, file);
      digest = next;
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
