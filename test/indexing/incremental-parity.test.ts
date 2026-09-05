import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IndexBuildError,
  PythonTreeSitterAdapter,
  RepositoryIndexer,
  TypeScriptTreeSitterAdapter,
  canonicalJson,
  sha256Bytes,
  type Language,
  type RepositorySource,
  type SyntaxAdapter,
} from "../../src/index.js";

type FixtureFile = [string, Language, string];

function source(files: FixtureFile[]): RepositorySource {
  return {
    repository_id: "repo",
    files: files.map(([relative_path, language, text]) => {
      const source_bytes = new TextEncoder().encode(text);
      return {
        relative_path,
        language,
        source_bytes,
        source_digest: sha256Bytes(source_bytes),
      };
    }),
  };
}

function indexer(options?: { tsQuerySuffix?: string }) {
  const ts = new TypeScriptTreeSitterAdapter(
    options?.tsQuerySuffix
      ? {
          definitionsQuerySource: [
            "(class_declaration name: (type_identifier) @class.name) @class.definition",
            "(function_declaration name: (identifier) @function.name) @function.definition",
            options.tsQuerySuffix,
          ].join("\n"),
        }
      : {},
  );
  return new RepositoryIndexer({ adapters: [ts, new PythonTreeSitterAdapter()] });
}

function indexerWithProfile(
  profile: { grammarDigest?: string; indexConfig?: unknown },
): RepositoryIndexer {
  const typescript = adapterWithGrammarDigest(
    new TypeScriptTreeSitterAdapter(),
    profile.grammarDigest,
  );
  return new RepositoryIndexer({
    adapters: [typescript, new PythonTreeSitterAdapter()],
    ...(profile.indexConfig !== undefined ? { index_config: profile.indexConfig } : {}),
  });
}

function adapterWithGrammarDigest(adapter: SyntaxAdapter, grammarDigest?: string): SyntaxAdapter {
  if (!grammarDigest) return adapter;
  const manifest = {
    ...adapter.manifest,
    grammar: { ...adapter.manifest.grammar, digest: grammarDigest },
  };
  return {
    manifest,
    extract(input) {
      const slice = adapter.extract(input);
      return {
        ...slice,
        evidence: slice.evidence.map((item) => ({ ...item, grammar_digest: grammarDigest })),
      };
    },
  };
}

const baseFiles: FixtureFile[] = [
  ["src/dep.ts", "typescript", "export class Base { work() {} }\n"],
  ["src/main.ts", "typescript", 'import { Base } from "./dep"; export class Child extends Base { run() { this.run(); } }\n'],
  ["pkg/helpers.py", "python", "def helper():\n    pass\n"],
  ["pkg/main.py", "python", "from .helpers import helper\ndef run():\n    helper()\n"],
];

function assertParity(previousFiles: FixtureFile[], nextFiles: FixtureFile[], nextIndexer = indexer()) {
  const previous = indexer().buildFull(source(previousFiles)).state;
  const incremental = nextIndexer.buildIncremental(previous, source(nextFiles));
  const full = nextIndexer.buildFull(source(nextFiles));
  assert.equal(incremental.state.graph.graph_hash, full.state.graph.graph_hash);
  assert.equal(canonicalJson(incremental.state.graph), canonicalJson(full.state.graph));
  return incremental;
}

test("unchanged files reuse slices while changed files are fully re-extracted", () => {
  const changed = baseFiles.map((file) => [...file] as FixtureFile);
  changed[1] = ["src/main.ts", "typescript", 'import { Base } from "./dep"; export class Child extends Base { changed() {} }\n'];
  const result = assertParity(baseFiles, changed);

  assert.deepEqual(result.receipt.extracted_files, ["src/main.ts"]);
  assert.deepEqual(result.receipt.reused_files, ["pkg/helpers.py", "pkg/main.py", "src/dep.ts"]);
});

test("add, delete and rename are semantically identical to full rebuild", () => {
  const added = [...baseFiles, ["src/new.ts", "typescript", "export function fresh() {}\n"] as FixtureFile];
  assert.deepEqual(assertParity(baseFiles, added).receipt.extracted_files, ["src/new.ts"]);

  const deleted = baseFiles.filter(([filePath]) => filePath !== "src/dep.ts");
  const deletion = assertParity(baseFiles, deleted);
  assert.deepEqual(deletion.receipt.removed_files, ["src/dep.ts"]);
  assert.ok(!canonicalJson(deletion.state.graph).includes("src/dep.ts"));

  const renamed = baseFiles.map((file) =>
    file[0] === "pkg/helpers.py"
      ? ["pkg/tools.py", file[1], file[2]] as FixtureFile
      : file,
  );
  const rename = assertParity(baseFiles, renamed);
  assert.deepEqual(rename.receipt.removed_files, ["pkg/helpers.py"]);
  assert.deepEqual(rename.receipt.extracted_files, ["pkg/tools.py"]);
});

test("Adapter query/config change invalidates reusable slices", () => {
  const changedIndexer = indexer({ tsQuerySuffix: "; profile-v2" });
  const result = assertParity(baseFiles, baseFiles, changedIndexer);

  assert.deepEqual(result.receipt.extracted_files, ["src/dep.ts", "src/main.ts"]);
  assert.deepEqual(result.receipt.reused_files, ["pkg/helpers.py", "pkg/main.py"]);
});

test("grammar profile changes invalidate language slices and preserve full-build parity", () => {
  const previous = indexerWithProfile({}).buildFull(source(baseFiles)).state;
  const changed = indexerWithProfile({ grammarDigest: "test-grammar-v2" });
  const incremental = changed.buildIncremental(previous, source(baseFiles));
  const full = changed.buildFull(source(baseFiles));

  assert.equal(canonicalJson(incremental.state.graph), canonicalJson(full.state.graph));
  assert.deepEqual(incremental.receipt.extracted_files, ["src/dep.ts", "src/main.ts"]);
  assert.deepEqual(incremental.receipt.reused_files, ["pkg/helpers.py", "pkg/main.py"]);
});

test("index config changes preserve incremental and full graph parity with a new Snapshot identity", () => {
  const previous = indexerWithProfile({}).buildFull(source(baseFiles)).state;
  const changed = indexerWithProfile({ indexConfig: { exclusions: ["generated"] } });
  const incremental = changed.buildIncremental(previous, source(baseFiles));
  const full = changed.buildFull(source(baseFiles));

  assert.notEqual(incremental.state.snapshot_id, previous.snapshot_id);
  assert.equal(canonicalJson(incremental.state.graph), canonicalJson(full.state.graph));
});

test("Canonical IR and index config participate in Snapshot identity", () => {
  const baseline = indexer().buildFull(source(baseFiles)).state;
  const adapter = new TypeScriptTreeSitterAdapter();
  const irChanged = new RepositoryIndexer({
    adapters: [adapter, new PythonTreeSitterAdapter()],
    canonical_ir_version: "2",
  }).buildFull(source(baseFiles)).state;
  const configChanged = new RepositoryIndexer({
    adapters: [new TypeScriptTreeSitterAdapter(), new PythonTreeSitterAdapter()],
    index_config: { exclusions: ["generated"] },
  }).buildFull(source(baseFiles)).state;

  assert.notEqual(irChanged.snapshot_id, baseline.snapshot_id);
  assert.notEqual(configChanged.snapshot_id, baseline.snapshot_id);
  assert.equal(irChanged.source_manifest_digest, baseline.source_manifest_digest);
});

test("failed incremental build never publishes a partial Ready state", () => {
  const first = indexer().buildFull(source(baseFiles)).state;
  const broken = source(baseFiles);
  broken.files[0] = { ...broken.files[0]!, source_digest: "stale" };

  assert.throws(
    () => indexer().buildIncremental(first, broken),
    (error: unknown) => error instanceof IndexBuildError && error.code === "syntax_extraction_failed",
  );
  assert.equal(first.graph.coverage.status, "ready");
});
