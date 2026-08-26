import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  RepositoryIndexer,
  SnapshotStoreError,
  SqliteSnapshotStore,
  TypeScriptTreeSitterAdapter,
  canonicalHash,
  canonicalJson,
  sha256Bytes,
  type IndexState,
  type RepositorySource,
} from "../../src/index.js";

const temporaryRoots: string[] = [];
after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function state(version: number): IndexState {
  const text = `export function value() { return ${version}; }\n`;
  const source_bytes = new TextEncoder().encode(text);
  const source: RepositorySource = {
    repository_id: "repo",
    files: [{
      relative_path: "src/value.ts",
      language: "typescript",
      source_bytes,
      source_digest: sha256Bytes(source_bytes),
    }],
  };
  return new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
}

function store(): SqliteSnapshotStore {
  const root = mkdtempSync(path.join(os.tmpdir(), "semantic-codebase-store-"));
  temporaryRoots.push(root);
  return new SqliteSnapshotStore(path.join(root, "snapshots.sqlite"));
}

test("SQLite Store round-trips immutable Ready Snapshots and atomically advances the pointer", () => {
  const database = store();
  const first = state(1);
  database.beginBuild(first.repository_id, first.snapshot_id);
  database.publishReady(first);

  assert.equal(canonicalJson(database.getCurrentReady("repo")), canonicalJson(first));
  assert.equal(canonicalJson(database.getSnapshot("repo", first.snapshot_id)), canonicalJson(first));
  assert.equal(database.getSnapshotSummary("repo", first.snapshot_id)?.status, "ready");

  const second = state(2);
  database.beginBuild(second.repository_id, second.snapshot_id);
  database.publishReady(second);

  assert.equal(database.getCurrentReady("repo")?.snapshot_id, second.snapshot_id);
  assert.equal(database.getSnapshotSummary("repo", first.snapshot_id)?.status, "superseded");
  assert.equal(database.getSnapshot("repo", first.snapshot_id)?.graph.graph_hash, first.graph.graph_hash);
  assert.throws(
    () => database.beginBuild(first.repository_id, first.snapshot_id),
    (error: unknown) => error instanceof SnapshotStoreError && error.code === "SNAPSHOT_IMMUTABLE",
  );
  database.close();
});

test("failed publication rolls back all new facts and preserves the old Ready pointer", () => {
  const database = store();
  const first = state(1);
  database.beginBuild(first.repository_id, first.snapshot_id);
  database.publishReady(first);
  const corrupted = structuredClone(state(2));
  const duplicate = corrupted.graph.definitions[0];
  assert.ok(duplicate);
  corrupted.graph.definitions.push(structuredClone(duplicate));
  corrupted.graph.coverage.definition_count = corrupted.graph.definitions.length;
  const { graph_hash: _oldHash, ...graphWithoutHash } = corrupted.graph;
  corrupted.graph.graph_hash = canonicalHash(graphWithoutHash);
  database.beginBuild(corrupted.repository_id, corrupted.snapshot_id);

  assert.throws(() => database.publishReady(corrupted));
  database.markFailed(corrupted.repository_id, corrupted.snapshot_id, "duplicate definition fixture");

  assert.equal(database.getCurrentReady("repo")?.snapshot_id, first.snapshot_id);
  assert.equal(database.getSnapshotSummary("repo", corrupted.snapshot_id)?.status, "failed");
  assert.equal(database.getSnapshot("repo", corrupted.snapshot_id), null);
  database.close();
});

test("publication guard runs after integrity checks but before the Ready pointer switch", () => {
  const database = store();
  const first = state(1);
  database.beginBuild(first.repository_id, first.snapshot_id);
  database.publishReady(first);
  const second = state(2);
  database.beginBuild(second.repository_id, second.snapshot_id);

  assert.throws(() => database.publishReady(second, {
    before_pointer: () => { throw new Error("observed manifest changed"); },
  }));
  database.markFailed(second.repository_id, second.snapshot_id, "observed manifest changed");

  assert.equal(database.getCurrentReady("repo")?.snapshot_id, first.snapshot_id);
  assert.equal(database.getSnapshotSummary("repo", second.snapshot_id)?.status, "failed");
  database.close();
});
