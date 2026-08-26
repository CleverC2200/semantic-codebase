import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  MCP_TOOLS,
  callMcpTool,
  canonicalJson,
  handleMcpRequest,
  runCli,
} from "../../src/index.js";

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "semantic-codebase-mcp-"));
  roots.push(root);
  mkdirSync(path.join(root, "src"));
  writeFileSync(
    path.join(root, "src", "main.ts"),
    "export function targetNode() {}\nexport function originNode() { targetNode(); }\n",
  );
  return { root, store: path.join(root, "store.sqlite") };
}

async function cli(arguments_: string[]) {
  let stdout = "";
  const code = await runCli(arguments_, {
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: () => undefined },
  });
  assert.equal(code, 0, stdout);
  return JSON.parse(stdout) as any;
}

async function mcp(name: string, arguments_: Record<string, unknown>) {
  const result = await callMcpTool(name, arguments_);
  assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0]!.text, canonicalJson(result.structuredContent));
  return result.structuredContent as any;
}

test("MCP exposes six read-only tools with closed input schemas", async () => {
  const initialized = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  });
  assert.equal((initialized?.result as any).serverInfo.name, "semantic-codebase");
  assert.equal((initialized?.result as any).protocolVersion, "2025-11-25");
  const listed = await handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(((listed?.result as any).tools as unknown[]).length, 6);
  assert.deepEqual(
    MCP_TOOLS.map((tool) => tool.name),
    [
      "semantic_codebase_status",
      "semantic_codebase_find_definitions",
      "semantic_codebase_get_definition",
      "semantic_codebase_get_evidence",
      "semantic_codebase_traverse",
      "semantic_codebase_find_paths",
    ],
  );
  assert.ok(MCP_TOOLS.every((tool) => tool.inputSchema.additionalProperties === false));
  assert.ok(MCP_TOOLS.every((tool) => tool.annotations.readOnlyHint === true));
  assert.ok(MCP_TOOLS.every((tool) => !/index|sync/.test(tool.name)));
});

test("MCP structuredContent matches CLI Query Module results without modifying the Store", async () => {
  const { root, store } = fixture();
  await cli(["index", "--repo", root, "--store", store]);
  const common = { repo: root, store };
  const cliStatus = await cli(["status", "--repo", root, "--store", store]);
  assert.deepEqual(await mcp("semantic_codebase_status", common), cliStatus);

  const cliFound = await cli([
    "definitions", "find", "--repo", root, "--store", store, "--query", "originNode",
  ]);
  const mcpFound = await mcp("semantic_codebase_find_definitions", { ...common, query: "originNode" });
  assert.deepEqual(mcpFound, cliFound);
  const origin = cliFound.data.definitions[0];
  const target = (await cli([
    "definitions", "find", "--repo", root, "--store", store, "--query", "targetNode",
  ])).data.definitions[0];

  const cliDefinition = await cli([
    "definition", "get", "--repo", root, "--store", store,
    "--definition-key", origin.definition_key,
  ]);
  assert.deepEqual(
    await mcp("semantic_codebase_get_definition", { ...common, definition_key: origin.definition_key }),
    cliDefinition,
  );
  const cliEvidence = await cli([
    "evidence", "get", "--repo", root, "--store", store,
    "--evidence-id", origin.evidence_ids[0],
  ]);
  assert.deepEqual(
    await mcp("semantic_codebase_get_evidence", { ...common, evidence_id: origin.evidence_ids[0] }),
    cliEvidence,
  );

  const cliTraverse = await cli([
    "graph", "traverse", "--repo", root, "--store", store,
    "--start-definition-key", origin.definition_key, "--relation-kinds", "CALLS",
  ]);
  const mcpTraverse = await mcp("semantic_codebase_traverse", {
    ...common,
    start_definition_key: origin.definition_key,
    relation_kinds: ["CALLS"],
  });
  assert.deepEqual(withoutElapsedBudget(mcpTraverse), withoutElapsedBudget(cliTraverse));

  const cliPaths = await cli([
    "graph", "paths", "--repo", root, "--store", store,
    "--start-definition-key", origin.definition_key,
    "--end-definition-key", target.definition_key,
    "--relation-kinds", "CALLS",
  ]);
  const mcpPaths = await mcp("semantic_codebase_find_paths", {
    ...common,
    start_definition_key: origin.definition_key,
    end_definition_key: target.definition_key,
    relation_kinds: ["CALLS"],
  });
  assert.deepEqual(withoutElapsedBudget(mcpPaths), withoutElapsedBudget(cliPaths));

  const before = statSync(store);
  await mcp("semantic_codebase_status", common);
  await mcp("semantic_codebase_find_definitions", { ...common, query: "targetNode" });
  const after = statSync(store);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test("MCP rejects additional arguments as a tool error", async () => {
  const result = await callMcpTool("semantic_codebase_status", { repo: "/tmp", unexpected: true });
  assert.equal(result.isError, true);
  assert.equal((result.structuredContent as any).error.code, "INVALID_ARGUMENT");
  assert.equal(result.content[0]!.text, canonicalJson(result.structuredContent));
});

test("MCP preserves stable repository errors instead of reporting an internal failure", async () => {
  const { root } = fixture();
  const missing = path.join(root, "missing-repository");
  const result = await callMcpTool("semantic_codebase_status", { repo: missing });
  assert.equal(result.isError, true);
  assert.equal((result.structuredContent as any).error.code, "REPOSITORY_NOT_FOUND");
  assert.equal(
    (result.structuredContent as any).error.message,
    "Repository path does not exist",
  );
});

function withoutElapsedBudget(value: any): any {
  const cloned = structuredClone(value);
  if (cloned.completeness?.budget_used) delete cloned.completeness.budget_used.timeout_ms;
  return cloned;
}
