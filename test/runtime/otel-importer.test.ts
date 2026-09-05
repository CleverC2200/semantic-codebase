import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RepositoryIndexer,
  RuntimeImportError,
  TypeScriptSemanticEnricher,
  TypeScriptTreeSitterAdapter,
  importOpenTelemetryJson,
  sha256Bytes,
  type RepositorySource,
} from "../../src/index.js";

function fixture() {
  const source_bytes = new TextEncoder().encode([
    "export function helper() { return 1; }",
    "export function main() { return helper(); }",
    "",
  ].join("\n"));
  const source: RepositorySource = {
    repository_id: "runtime-fixture",
    files: [{ relative_path: "src/main.ts", language: "typescript", source_bytes, source_digest: sha256Bytes(source_bytes) }],
  };
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state, source });
  return { state, overlay };
}

const trace = {
  resourceSpans: [{
    scopeSpans: [{
      spans: [
        {
          traceId: "trace-1",
          spanId: "span-main",
          name: "main",
          startTimeUnixNano: "10",
          endTimeUnixNano: "30",
          attributes: [
            { key: "code.file.path", value: { stringValue: "src/main.ts" } },
            { key: "code.function.name", value: { stringValue: "main" } },
          ],
        },
        {
          traceId: "trace-1",
          spanId: "span-helper",
          parentSpanId: "span-main",
          name: "helper",
          startTimeUnixNano: "12",
          endTimeUnixNano: "20",
          attributes: [
            { key: "code.file.path", value: { stringValue: "src/main.ts" } },
            { key: "code.function.name", value: { stringValue: "helper" } },
          ],
        },
        { traceId: "trace-2", spanId: "span-unknown", name: "external-work" },
      ],
    }],
  }],
};

test("frozen OTLP JSON creates scoped observations and unconfirmed capability candidates", () => {
  const { state, overlay } = fixture();
  const input = {
    repository_id: state.repository_id,
    snapshot_id: state.snapshot_id,
    definitions: state.graph.definitions,
    overlay,
    trace,
  };
  const first = importOpenTelemetryJson(input);
  const second = importOpenTelemetryJson(input);

  assert.equal(first.observation_set_hash, second.observation_set_hash);
  assert.equal(first.observations.length, 3);
  assert.equal(first.observations.filter((item) => item.definition_key).length, 2);
  assert.ok(first.observations.every((item) => item.basis.kind === "runtime_observed"));
  assert.ok(first.observations.every((item) => item.basis.scope === "single_execution"));
  assert.equal(first.coverage.status, "partial");
  assert.equal(first.coverage.unmatched_span_count, 1);
  assert.ok(first.capability_candidates.every((item) => item.status === "candidate"));
  assert.ok(first.capability_candidates.some((item) => item.title === "main" && item.entry_definition_key));
});

test("runtime import rejects trace data without spans", () => {
  const { state, overlay } = fixture();
  assert.throws(
    () => importOpenTelemetryJson({
      repository_id: state.repository_id,
      snapshot_id: state.snapshot_id,
      definitions: state.graph.definitions,
      overlay,
      trace: {},
    }),
    (error: unknown) => error instanceof RuntimeImportError && error.code === "INVALID_OTEL_JSON",
  );
});
