import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureLocalCodexDiagnostics } from "../../src/context/local-codex-diagnostics.js";
import { readCodexTelemetry } from "../../src/context/codex-telemetry.js";

test("local diagnostic capture retains unknown errors privately without leaking them to telemetry", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "scb-private-errors-test-"));
  try {
    const stream = [
      { type: "item.completed", item: { type: "error", message: "fixture private detail SECRET" } },
      { type: "item.completed", item: { type: "reasoning", text: "EXCLUDED_REASONING" } },
      { type: "item.completed", item: { type: "command_execution", command: "EXCLUDED_COMMAND" } },
      { type: "turn.completed" },
    ].map((event) => JSON.stringify(event)).join("\n");
    const captured = captureLocalCodexDiagnostics(stream, root)!;
    const raw = readFileSync(captured.path, "utf8");
    assert.ok(raw.includes("fixture private detail SECRET"));
    assert.ok(!raw.includes("EXCLUDED_"));
    assert.ok(!JSON.stringify(readCodexTelemetry(stream)).includes("SECRET"));
    assert.equal(JSON.parse(raw).messages[0].message_hash, readCodexTelemetry(stream).diagnostics[0]!.message_hash);
    if (process.platform !== "win32") {
      assert.equal(statSync(captured.path).mode & 0o777, 0o600);
      assert.equal(statSync(path.dirname(captured.path)).mode & 0o777, 0o700);
    }
    assert.notEqual(captureLocalCodexDiagnostics(stream, root)!.path, captured.path);
    assert.equal(captureLocalCodexDiagnostics('{"type":"turn.completed"}', root), null);
    const huge = captureLocalCodexDiagnostics(JSON.stringify({ type: "error", message: "x".repeat(100000) }), root)!;
    const item = JSON.parse(readFileSync(huge.path, "utf8")).messages[0];
    assert.equal(item.truncated, true);
    assert.equal(item.message.length, 65536);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
