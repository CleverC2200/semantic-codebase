import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { execFileSync } from "node:child_process";

import { runCli } from "../../src/index.js";

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "semantic-codebase-cli-"));
  roots.push(root);
  mkdirSync(path.join(root, "src"));
  mkdirSync(path.join(root, "references"));
  mkdirSync(path.join(root, "ignored"));
  writeFileSync(path.join(root, "src", "main.ts"), "export function hello() { return '你好'; }\n");
  writeFileSync(path.join(root, "references", "ignored.ts"), "export function ignored() {}\n");
  writeFileSync(path.join(root, "ignored", "generated.ts"), "export function generated() {}\n");
  writeFileSync(path.join(root, ".gitignore"), "ignored/\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  return { root, store: path.join(root, "outside-store.sqlite") };
}

async function invoke(arguments_: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await runCli(arguments_, {
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
  });
  const lines = stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  return { code, output: JSON.parse(lines[0]!), stderr };
}

test("CLI indexes a repository and queries Definition and Evidence as one JSON object", async () => {
  const { root, store } = fixture();
  const indexed = await invoke(["index", "--repo", root, "--store", store]);
  assert.equal(indexed.code, 0);
  assert.equal(indexed.output.coverage.status, "ready");
  assert.equal(indexed.output.coverage.file_count, 1);

  const found = await invoke([
    "definitions", "find", "--repo", root, "--store", store, "--query", "hello",
  ]);
  assert.equal(found.code, 0);
  assert.equal(found.output.data.definitions.length, 1);
  assert.equal(found.output.data.definitions[0].qualified_name, "hello");
  assert.equal(found.output.snapshot.snapshot_id, indexed.output.snapshot_id);
  const definition = found.output.data.definitions[0];

  const fetched = await invoke([
    "definition", "get", "--repo", root, "--store", store,
    "--definition-key", definition.definition_key,
  ]);
  assert.deepEqual(fetched.output.data.definition, definition);

  const evidence = await invoke([
    "evidence", "get", "--repo", root, "--store", store,
    "--evidence-id", definition.evidence_ids[0],
  ]);
  assert.equal(evidence.code, 0);
  assert.equal(evidence.output.data.source.available, true);
  assert.match(evidence.output.data.source.text, /function hello/);
  assert.deepEqual(evidence.output.evidence_refs, [definition.evidence_ids[0]]);
});

test("CLI uses stable argument errors and exit code 2", async () => {
  const result = await invoke(["definitions", "find"]);
  assert.equal(result.code, 2);
  assert.equal(result.output.error.code, "INVALID_ARGUMENT");
});

test("status, require_fresh and sync expose Manifest freshness without hiding stale data", async () => {
  const { root, store } = fixture();
  const first = await invoke(["index", "--repo", root, "--store", store]);
  let status = await invoke(["status", "--repo", root, "--store", store]);
  assert.equal(status.output.freshness.status, "fresh");

  writeFileSync(path.join(root, "src", "main.ts"), "export function changed() { return 2; }\n");
  status = await invoke(["status", "--repo", root, "--store", store]);
  assert.equal(status.output.freshness.status, "stale");
  assert.notEqual(
    status.output.freshness.observed_manifest.digest,
    status.output.freshness.indexed_manifest.digest,
  );

  const staleQuery = await invoke([
    "definitions", "find", "--repo", root, "--store", store, "--query", "hello",
  ]);
  assert.equal(staleQuery.code, 0);
  assert.equal(staleQuery.output.snapshot.freshness, "stale");
  const rejected = await invoke([
    "definitions", "find", "--repo", root, "--store", store,
    "--query", "hello", "--require-fresh",
  ]);
  assert.equal(rejected.code, 3);
  assert.equal(rejected.output.error.code, "STALE_SNAPSHOT");

  const synced = await invoke(["sync", "--repo", root, "--store", store]);
  assert.equal(synced.code, 0);
  assert.notEqual(synced.output.snapshot_id, first.output.snapshot_id);
  assert.deepEqual(synced.output.receipt.extracted_files, ["src/main.ts"]);
  status = await invoke(["status", "--repo", root, "--store", store]);
  assert.equal(status.output.freshness.status, "fresh");

  const freshQuery = await invoke([
    "definitions", "find", "--repo", root, "--store", store,
    "--query", "changed", "--require-fresh",
  ]);
  assert.equal(freshQuery.code, 0);
  assert.equal(freshQuery.output.snapshot.freshness, "fresh");
});

test("graph traverse performs deterministic budgeted BFS over Definition relations", async () => {
  const { root, store } = fixture();
  writeFileSync(
    path.join(root, "src", "main.ts"),
    "export function leaf() {}\nexport function root() { leaf(); }\n",
  );
  await invoke(["index", "--repo", root, "--store", store]);
  const found = await invoke([
    "definitions", "find", "--repo", root, "--store", store, "--query", "root",
  ]);
  assert.equal(found.code, 0, JSON.stringify(found.output));
  const rootDefinition = found.output.data.definitions[0];
  assert.ok(rootDefinition);

  const arguments_ = [
    "graph", "traverse", "--repo", root, "--store", store,
    "--start-definition-key", rootDefinition.definition_key,
    "--relation-kinds", "CALLS", "--direction", "outgoing",
  ];
  const first = await invoke(arguments_);
  const second = await invoke(arguments_);
  assert.equal(first.code, 0);
  assert.deepEqual(first.output.data, second.output.data);
  assert.deepEqual(first.output.data.nodes.map((node: any) => [node.definition.name, node.depth]), [
    ["root", 0],
    ["leaf", 1],
  ]);
  assert.equal(first.output.data.relations.length, 1);
  assert.equal(first.output.data.relations[0].kind, "CALLS");
  assert.equal(first.output.completeness.complete, true);

  const truncated = await invoke([...arguments_, "--max-depth", "0"]);
  assert.equal(truncated.output.completeness.truncated, true);
  assert.equal(truncated.output.completeness.reason, "max_depth");
  assert.equal(truncated.output.data.nodes.length, 1);

  const nodeLimited = await invoke([...arguments_, "--max-nodes", "1"]);
  assert.equal(nodeLimited.output.completeness.truncated, true);
  assert.equal(nodeLimited.output.completeness.reason, "max_nodes");
  assert.equal(nodeLimited.output.data.nodes.length, 1);
});
