import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { z, ZodType } from "../references/zod/packages/zod/src/v3/index.ts";
import { importOpenTelemetryJson, sha256Bytes } from "../dist/index.js";

// Only this explicit command instruments the public fixture, never the indexed user's program.
const database = new DatabaseSync(new URL("../.workspace/acceptance/semantic-preview/preview.sqlite", import.meta.url), { readOnly: true });
const overlay = JSON.parse(readFileSync(new URL("../.workspace/acceptance/semantic-preview/semantic-overlay.json", import.meta.url), "utf8"));
const row = database.prepare("SELECT state_json FROM snapshots WHERE repository_id = ? AND snapshot_id = ?").get(overlay.repository_id, overlay.snapshot_id);
const state = JSON.parse(row.state_json);
database.close();
for (const file of state.manifest.files) {
  const bytes = readFileSync(new URL(`../references/zod/${file.relative_path}`, import.meta.url));
  assert.equal(sha256Bytes(bytes), file.source_digest, "Runtime source must match indexed Snapshot");
}
const spans = [];
const stack = [];
let traceId;
const originals = new Map();
for (const method of ["parse", "safeParse"]) {
  const original = ZodType.prototype[method]; originals.set(method, original);
  ZodType.prototype[method] = function (...args) {
    const spanId = randomBytes(8).toString("hex");
    const span = { traceId, spanId, ...(stack.length ? { parentSpanId: stack.at(-1) } : {}), name: `ZodType.${method}`,
      startTimeUnixNano: (BigInt(Date.now()) * 1000000n).toString(), attributes: [
        { key: "code.file.path", value: { stringValue: "packages/zod/src/v3/types.ts" } },
        { key: "code.function.name", value: { stringValue: method } },
        { key: "scb.capture", value: { stringValue: "actual_instrumented_execution" } },
        { key: "scb.snapshot_id", value: { stringValue: state.snapshot_id } },
      ] };
    stack.push(spanId);
    try { return original.apply(this, args); }
    finally { stack.pop(); span.endTimeUnixNano = (BigInt(Date.now()) * 1000000n).toString(); spans.push(span); }
  };
}
try {
  traceId = randomBytes(16).toString("hex");
  assert.equal(z.string().parse("sample"), "sample");
  traceId = randomBytes(16).toString("hex");
  assert.throws(() => z.string().parse(123));
} finally { for (const [method, original] of originals) ZodType.prototype[method] = original; }
const trace = { resourceSpans: [{ scopeSpans: [{ spans }] }] };
const observations = importOpenTelemetryJson({ repository_id: state.repository_id, snapshot_id: state.snapshot_id, definitions: state.graph.definitions, overlay, trace });
assert.equal(observations.coverage.unmatched_span_count, 0);
assert.equal(observations.observations.length, 4);
const output = new URL("../.workspace/acceptance/semantic-runtime/", import.meta.url);
mkdirSync(output, { recursive: true });
writeFileSync(new URL("trace.otlp.json", output), JSON.stringify(trace, null, 2));
writeFileSync(new URL("observations.json", output), JSON.stringify(observations, null, 2));
writeFileSync(new URL("receipt.json", output), JSON.stringify({ snapshot_id: state.snapshot_id, source_manifest_verified: true, capture: "actual_instrumented_execution", cases: ["string_success", "number_failure"], observed_spans: spans.length, scope: "parse/safeParse only; not full execution coverage" }, null, 2));
console.log(JSON.stringify({ observed_spans: spans.length, matched: observations.coverage.matched_span_count, output: output.pathname }));
