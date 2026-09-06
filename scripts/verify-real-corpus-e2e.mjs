import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli, callMcpTool, SqliteSnapshotStore, buildContextPackage, answerContextPackage, canonicalHash } from "../dist/index.js";
import { renderAnswerMarkdown } from "../dist/context/markdown.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".workspace/acceptance/real-corpus-e2e");
mkdirSync(output, { recursive: true });
const packet = JSON.parse(readFileSync(path.join(root, ".workspace/acceptance/release-review/review-packet.json"), "utf8"));
const results = [];
for (const [id, prefix, symbol] of [["zod-review", "references/zod", "addIssueToContext"], ["poetry-review", "references/poetry", "run_script"], ["self-review", "", "buildIncremental"]]) {
  const corpus = packet.corpora.find((item) => item.id === id);
  const directory = mkdtempSync(path.join(output, `${id}-`));
  const repo = path.join(directory, "source"), storePath = path.join(directory, "graph.sqlite");
  for (const file of corpus.files) {
    const target = path.join(repo, file.relative_path);
    mkdirSync(path.dirname(target), { recursive: true });
    const bytes = readFileSync(path.join(root, prefix, file.relative_path));
    writeFileSync(target, bytes);
  }
  async function cli(args) {
    let stdout = "", stderr = "";
    const code = await runCli([...args, "--repo", repo, "--store", storePath], { stdout: { write: (value) => { stdout += value; } }, stderr: { write: (value) => { stderr += value; } } });
    assert.equal(code, 0, stdout || stderr);
    return args.includes("markdown") ? stdout : JSON.parse(stdout);
  }
  const indexed = await cli(["index", "--profile", "semantic-v0"]);
  const database = new SqliteSnapshotStore(storePath, { read_only: true });
  const state = database.getCurrentReady(indexed.repository_id);
  assert.ok(state);
  const overlay = database.getSemanticOverlay(state.repository_id, state.snapshot_id);
  assert.ok(overlay);
  const definition = state.graph.definitions.find((item) => item.name === symbol);
  assert.ok(definition);
  const question = `${symbol} 的功能如何实现`;
  const args = ["ask", "--question", question, "--definition-key", definition.definition_key];
  const response = await cli(args);
  const answer = response.answer;
  const actual = await callMcpTool("semantic_codebase_ask", { repo, store: storePath, question, definition_key: definition.definition_key });
  assert.equal(actual.isError, undefined);
  assert.equal(canonicalHash(actual.structuredContent), canonicalHash(response), "CLI/MCP parity");
  const context = buildContextPackage({ state, overlay, question, definition_key: definition.definition_key, source_freshness: "fresh" });
  assert.equal(canonicalHash(answerContextPackage(context)), canonicalHash(answer), "SQLite-derived answer parity");
  const markdown = await cli([...args, "--format", "markdown"]);
  assert.equal(markdown, renderAnswerMarkdown(context, answer));
  writeFileSync(path.join(directory, "answer.md"), markdown);
  writeFileSync(path.join(directory, "answer.json"), JSON.stringify({ context, answer }, null, 2));
  const target = path.join(repo, corpus.files[0].relative_path);
  writeFileSync(target, Buffer.concat([readFileSync(target), Buffer.from("\n")]));
  assert.equal((await cli(["status"])).freshness.status, "stale");
  const stale = await cli(args);
  assert.ok(stale.answer.unknowns.some((item) => item.includes("源码已变化")));
  const synced = await cli(["sync"]);
  assert.notEqual(synced.snapshot_id, state.snapshot_id);
  assert.equal((await cli(["status"])).freshness.status, "fresh");
  assert.ok(database.getSemanticOverlay(state.repository_id, synced.snapshot_id));
  database.close();
  results.push({ corpus: id, source_files: corpus.files.length, directory, snapshot_id: state.snapshot_id, synced_snapshot_id: synced.snapshot_id,
    cli_sqlite_mcp_markdown_parity: true, source_change_stale_sync: true, scope: "frozen selected files, not whole project or application runtime" });
  console.log(`${id}：CLI/SQLite/MCP/Markdown 与源码变更检查通过`);
}
writeFileSync(path.join(output, "receipt.json"), JSON.stringify({ packet_hash: canonicalHash(packet), results, application_executed: false, model_invoked: false }, null, 2));
