import assert from "node:assert/strict";
import { test } from "node:test";
import { CapabilityRegistry } from "../../src/runtime/capability-registry.js";

import {
  RepositoryIndexer,
  RuntimeImportError,
  TypeScriptSemanticEnricher,
  TypeScriptTreeSitterAdapter,
  importOpenTelemetryJson,
  sha256Bytes,
  type RepositorySource,
} from "../../src/index.js";

function fixture(result = 1) {
  const source_bytes = new TextEncoder().encode([
    `export function helper() { return ${result}; }`,
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

test("runtime import rejects a declared Snapshot mismatch", () => {
  const { state, overlay } = fixture();
  const original = trace.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
  const span = { ...original, attributes: [...original.attributes, { key: "scb.snapshot_id", value: { stringValue: "different-snapshot" } }] };
  assert.throws(() => importOpenTelemetryJson({ repository_id: state.repository_id, snapshot_id: state.snapshot_id,
    definitions: state.graph.definitions, overlay, trace: { spans: [span] } }),
  (error: unknown) => error instanceof RuntimeImportError && error.code === "RUNTIME_SOURCE_MISMATCH");
});

test("capabilities require explicit decisions, preserve identity and reject stale versions", () => {
  const { state, overlay } = fixture();
  const runtime = importOpenTelemetryJson({ repository_id: state.repository_id, snapshot_id: state.snapshot_id, definitions: state.graph.definitions, overlay, trace });
  const candidate = runtime.capability_candidates.find((item) => item.title === "main")!;
  const registry = new CapabilityRegistry(":memory:");
  try {
    assert.deepEqual(registry.list(state.repository_id, state.snapshot_id), []);
    const request = { runtime, candidate_id: candidate.candidate_id, actor: "test-human", reason: "verified fixture", expected_version: 0 };
    const accepted = registry.decide({ ...request, action: "accept", title: "Sample capability" });
    assert.equal(accepted.status, "accepted");
    assert.throws(() => registry.decide({ ...request, action: "reject" }), /VERSION_CONFLICT/);
    const rejected = registry.decide({ ...request, expected_version: 1, action: "reject" });
    assert.equal(rejected.capability_id, accepted.capability_id);
    assert.equal(registry.list(state.repository_id, "new-snapshot")[0]!.stale, true);
    assert.throws(() => registry.decide({ ...request, expected_version: 2, action: "merge", into_id: accepted.capability_id }), /INVALID_MERGE_TARGET/);
    assert.equal(registry.list(state.repository_id, state.snapshot_id)[0]!.version, 2);
  } finally { registry.close(); }
});

test("capability merge preserves separate root evidence and requires an accepted target", () => {
  const { state, overlay } = fixture();
  const spans = trace.resourceSpans[0]!.scopeSpans[0]!.spans.slice(0, 2).map((item) => ({ ...item, parentSpanId: "" }));
  const runtime = importOpenTelemetryJson({ repository_id: state.repository_id, snapshot_id: state.snapshot_id, definitions: state.graph.definitions, overlay, trace: { spans } });
  assert.equal(runtime.capability_candidates.length, 2);
  assert.ok(runtime.capability_candidates.every((item) => item.observation_ids.length === 1));
  const registry = new CapabilityRegistry(":memory:");
  try {
    const base = { runtime, actor: "fixture-reviewer", reason: "merge verified samples", expected_version: 0 };
    const target = registry.decide({ ...base, candidate_id: runtime.capability_candidates[0]!.candidate_id, action: "accept" });
    const merged = registry.decide({ ...base, candidate_id: runtime.capability_candidates[1]!.candidate_id, action: "merge", into_id: target.capability_id });
    assert.equal(merged.merged_into, target.capability_id);
    assert.equal(merged.status, "merged");
    const confirmed = registry.confirmed(state.repository_id, state.snapshot_id);
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0]!.members.length, 2);
    assert.equal(confirmed[0]!.definition_keys.length, 2);
    assert.deepEqual(registry.confirmed(state.repository_id, "new-snapshot"), []);
    assert.throws(() => registry.decide({ ...base, candidate_id: merged.candidate_id, expected_version: 1, action: "accept" }), /TERMINAL/);
  } finally { registry.close(); }
  assert.throws(() => importOpenTelemetryJson({ repository_id: state.repository_id, snapshot_id: state.snapshot_id, definitions: state.graph.definitions, overlay, trace: { spans: [spans[0], spans[0]] } }), /Duplicate/);
});

test("explicit revalidation preserves capability identity while replacing stale evidence", () => {
  const old = fixture(1), next = fixture(2);
  const imported = (input: ReturnType<typeof fixture>) => importOpenTelemetryJson({ repository_id: input.state.repository_id,
    snapshot_id: input.state.snapshot_id, definitions: input.state.graph.definitions, overlay: input.overlay, trace });
  const before = imported(old), after = imported(next);
  const registry = new CapabilityRegistry(":memory:");
  try {
    const first = registry.decide({ runtime: before, candidate_id: before.capability_candidates.find((item) => item.title === "main")!.candidate_id,
      action: "accept", actor: "fixture-reviewer", reason: "source verified", expected_version: 0 });
    assert.deepEqual(registry.confirmed(next.state.repository_id, next.state.snapshot_id), []);
    const second = registry.decide({ runtime: after, candidate_id: after.capability_candidates.find((item) => item.title === "main")!.candidate_id,
      action: "revalidate", capability_id: first.capability_id, actor: "fixture-reviewer", reason: "new source and trace reviewed", expected_version: 1 });
    assert.equal(second.capability_id, first.capability_id);
    assert.equal(second.version, 2);
    assert.equal(second.snapshot_id, next.state.snapshot_id);
    assert.equal(registry.confirmed(next.state.repository_id, next.state.snapshot_id).length, 1);
    assert.throws(() => registry.decide({ runtime: after, candidate_id: after.capability_candidates.find((item) => item.title === "main")!.candidate_id,
      action: "revalidate", capability_id: first.capability_id, actor: "fixture-reviewer", reason: "repeat", expected_version: 2 }), /REQUIRES_STALE_ACCEPTED/);
  } finally { registry.close(); }
});
