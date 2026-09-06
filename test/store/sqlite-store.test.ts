import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  RepositoryIndexer,
  SnapshotStoreError,
  SqliteSnapshotStore,
  TypeScriptSemanticEnricher,
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

test("an interrupted building Snapshot can be resumed without weakening Ready immutability", () => {
  const database = store();
  const interrupted = state(1);
  database.beginBuild(interrupted.repository_id, interrupted.snapshot_id);

  assert.doesNotThrow(() => database.beginBuild(interrupted.repository_id, interrupted.snapshot_id));
  database.publishReady(interrupted);
  assert.equal(database.getCurrentReady("repo")?.snapshot_id, interrupted.snapshot_id);
  assert.throws(
    () => database.beginBuild(interrupted.repository_id, interrupted.snapshot_id),
    (error: unknown) => error instanceof SnapshotStoreError && error.code === "SNAPSHOT_IMMUTABLE",
  );
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

test("SQLite Store publishes one immutable Semantic Overlay and filters its raw facts", () => {
  const text = "export function helper() { return 1; }\nexport function main() { return helper(); }\n";
  const source_bytes = new TextEncoder().encode(text);
  const source: RepositorySource = {
    repository_id: "semantic-store-repo",
    files: [{
      relative_path: "src/main.ts",
      language: "typescript",
      source_bytes,
      source_digest: sha256Bytes(source_bytes),
    }],
  };
  const indexed = new RepositoryIndexer({
    adapters: [new TypeScriptTreeSitterAdapter()],
  }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state: indexed, source });
  const database = store();

  database.beginBuild(indexed.repository_id, indexed.snapshot_id);
  database.publishReady(indexed);
  database.publishSemanticOverlay(overlay);
  database.publishSemanticOverlay(overlay);

  assert.equal(database.getSemanticOverlay(indexed.repository_id, indexed.snapshot_id)?.overlay_hash, overlay.overlay_hash);
  assert.ok(database.readSemanticFacts(indexed.repository_id, indexed.snapshot_id, {
    file_path: "src/main.ts",
    kind: "call_target",
  }).length > 0);

  const corrupted = { ...overlay, overlay_hash: "corrupted" };
  assert.throws(
    () => database.publishSemanticOverlay(corrupted),
    (error: unknown) => error instanceof SnapshotStoreError && error.code === "STORE_INTEGRITY_ERROR",
  );
  database.close();
});

test("combined semantic publication rolls back the pointer and both layers after late failure", () => {
  const database = store();
  const observer = new SqliteSnapshotStore(database.databasePath, { read_only: true });
  const first = state(1);
  database.beginBuild(first.repository_id, first.snapshot_id);
  database.publishReady(first);
  const source_bytes = Buffer.from("export function value() { return 2; }\n");
  const source: RepositorySource = { repository_id: "repo", files: [{ relative_path: "src/value.ts", language: "typescript", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const second = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state: second, source });
  assert.throws(() => database.publishSemanticReady(second, overlay, { before_commit: () => {
    assert.equal(observer.getCurrentReady("repo")?.snapshot_id, first.snapshot_id);
    assert.equal(observer.getSemanticOverlay("repo", second.snapshot_id), null);
    throw new Error("injected late publication failure");
  } }), /injected late/);
  assert.equal(database.getCurrentReady("repo")?.snapshot_id, first.snapshot_id);
  assert.equal(database.getSemanticOverlay("repo", second.snapshot_id), null);
  assert.equal(database.getSnapshotSummary("repo", second.snapshot_id), null);
  database.publishSemanticReady(second, overlay);
  assert.equal(observer.getCurrentReady("repo")?.snapshot_id, second.snapshot_id);
  assert.equal(observer.getSemanticOverlay("repo", second.snapshot_id)?.overlay_hash, overlay.overlay_hash);
  database.publishSemanticReady(second, overlay);
  observer.close(); database.close();
});
