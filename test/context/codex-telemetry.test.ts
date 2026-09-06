import assert from "node:assert/strict";
import { test } from "node:test";
import { readCodexTelemetry } from "../../src/context/codex-telemetry.js";

const stream = (...events: unknown[]) => events.map((event) => JSON.stringify(event)).join("\n");
const completed = { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2, private_metadata: "SECRET" } };
const hostNotice = "Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.";

test("only exact reviewed startup notices under the text-only policy are nonblocking", () => {
  const event = { type: "item.completed", item: { type: "error", message: hostNotice } };
  const policy = { expectedPolicy: "text_only_feature_overrides_v1" as const };
  assert.equal(readCodexTelemetry(stream(event, completed), policy).assessment, "completed_with_warnings");
  assert.equal(readCodexTelemetry(stream(event, completed)).assessment, "needs_review");
  assert.equal(readCodexTelemetry(stream({ ...event, item: { type: "error", message: hostNotice + " Additional failure" } }, completed), policy).assessment, "needs_review");
  assert.equal(readCodexTelemetry(stream({ type: "error", message: hostNotice }, completed), policy).assessment, "needs_review");
  assert.equal(readCodexTelemetry(stream(event, { type: "turn.failed", error: { message: hostNotice } }), policy).assessment, "incomplete");
  assert.equal(readCodexTelemetry(stream(event, { type: "item.completed", item: { type: "mcp_tool_call" } }, completed), policy).assessment, "tool_activity");
  const limited = readCodexTelemetry(stream(...Array(20).fill(event), { type: "error", message: "hidden failure" }, completed), policy);
  assert.equal(limited.assessment, "needs_review");
  assert.equal(limited.diagnostic_count, 21);
});

test("Codex telemetry separates clean completion, diagnostics, tools and incomplete streams", () => {
  assert.equal(readCodexTelemetry(stream(completed)).assessment, "clean");
  for (const event of [
    { type: "error", message: "timeout SECRET" },
    { type: "item.completed", item: { type: "error", message: "unknown feature: SECRET" } },
  ]) {
    const result = readCodexTelemetry(stream(event, completed));
    assert.equal(result.assessment, "needs_review");
    assert.equal(result.tool_events, 0);
    assert.equal(result.diagnostic_count, 1);
    assert.ok(!JSON.stringify(result).includes("SECRET"));
  }
  for (const type of ["command_execution", "mcp_tool_call", "web_search", "file_change"]) {
    assert.equal(readCodexTelemetry(stream({ type: "item.started", item: { type, command: "SECRET" } }, completed)).assessment, "tool_activity");
  }
  assert.equal(readCodexTelemetry("").assessment, "incomplete");
  assert.equal(readCodexTelemetry(stream(completed, { type: "turn.failed", error: { message: "SECRET" } })).assessment, "incomplete");
  assert.equal(readCodexTelemetry(stream(completed, { type: "SECRET" })).assessment, "needs_review");
  assert.equal(readCodexTelemetry(stream(completed) + "\nnot json").assessment, "needs_review");
});

test("Codex telemetry never retains arbitrary keys, diagnostic bodies or reasoning", () => {
  const result = readCodexTelemetry(stream(
    { type: "item.completed", item: { type: "reasoning", text: "SECRET" } },
    ...Array.from({ length: 30 }, () => ({ type: "item.completed", item: { type: "error", message: "SECRET" } })),
    completed,
  ));
  assert.equal(result.diagnostic_count, 30);
  assert.equal(result.diagnostics.length, 20);
  assert.deepEqual(result.usage, { input_tokens: 10, output_tokens: 2 });
  assert.ok(!JSON.stringify(result).includes("SECRET"));
});
