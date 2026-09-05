import { canonicalHash } from "../contract/hash.js";
import type { CanonicalDefinition } from "../canonicalization/types.js";
import type { SemanticOverlay } from "../semantic/types.js";
import type {
  CapabilityCandidate,
  RuntimeObservation,
  RuntimeObservationSet,
} from "./types.js";
import { RuntimeImportError } from "./types.js";

interface OtelSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes?: Array<{ key?: string; value?: unknown }>;
}

export function importOpenTelemetryJson(input: {
  repository_id: string;
  snapshot_id: string;
  definitions: CanonicalDefinition[];
  overlay: SemanticOverlay;
  trace: unknown;
}): RuntimeObservationSet {
  if (
    input.overlay.repository_id !== input.repository_id ||
    input.overlay.snapshot_id !== input.snapshot_id
  ) {
    throw new RuntimeImportError("RUNTIME_SNAPSHOT_MISMATCH", "Trace import requires the matching Semantic Overlay");
  }
  const spans = extractSpans(input.trace);
  if (spans.length === 0) {
    throw new RuntimeImportError("INVALID_OTEL_JSON", "OpenTelemetry JSON contains no spans");
  }
  const traceDigest = canonicalHash(input.trace);
  const executionId = canonicalHash({ type: "execution", snapshot_id: input.snapshot_id, trace_digest: traceDigest });
  const diagnostics: RuntimeObservationSet["diagnostics"] = [];
  const observations = spans.map((span): RuntimeObservation => {
    const attributes = normalizeAttributes(span.attributes ?? []);
    const filePath = stringAttribute(attributes, ["code.file.path", "code.filepath", "code.file.name"]);
    const functionName = stringAttribute(attributes, ["code.function.name", "code.function", "code.namespace"]);
    const definition = matchDefinition(input.definitions, filePath, functionName, span.name ?? "");
    if (!definition) {
      diagnostics.push({
        code: "runtime_span_unmatched",
        severity: "warning",
        file_path: filePath ?? "",
        message: `Span could not be linked to one Definition: ${span.name ?? "<unnamed>"}`,
      });
    }
    const traceId = span.traceId ?? "";
    const spanId = span.spanId ?? "";
    if (!traceId || !spanId) {
      throw new RuntimeImportError("INVALID_OTEL_JSON", "Every OpenTelemetry span requires traceId and spanId");
    }
    const withoutId = {
      execution_id: executionId,
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: span.parentSpanId || null,
      name: span.name ?? "<unnamed>",
      definition_key: definition?.definition_key ?? null,
      file_path: definition?.file_path ?? filePath,
      start_time_unix_nano: span.startTimeUnixNano ?? null,
      end_time_unix_nano: span.endTimeUnixNano ?? null,
      attributes,
      basis: { kind: "runtime_observed" as const, scope: "single_execution" as const },
    };
    return { observation_id: canonicalHash({ type: "runtime_observation", ...withoutId }), ...withoutId };
  }).sort((left, right) => left.trace_id.localeCompare(right.trace_id) || left.span_id.localeCompare(right.span_id));
  const capabilityCandidates = buildCapabilityCandidates(observations, input.overlay);
  const unmatched = observations.filter((item) => !item.definition_key).length;
  const withoutHash = {
    schema_version: 1 as const,
    repository_id: input.repository_id,
    snapshot_id: input.snapshot_id,
    semantic_overlay_hash: input.overlay.overlay_hash,
    execution_id: executionId,
    trace_digest: traceDigest,
    observations,
    capability_candidates: capabilityCandidates,
    diagnostics: diagnostics.sort((left, right) => left.file_path.localeCompare(right.file_path) || left.message.localeCompare(right.message)),
    coverage: {
      status: unmatched > 0 ? "partial" as const : "complete" as const,
      span_count: observations.length,
      matched_span_count: observations.length - unmatched,
      unmatched_span_count: unmatched,
      reason_codes: unmatched > 0 ? ["unmatched_runtime_spans"] : [],
    },
  };
  return { ...withoutHash, observation_set_hash: canonicalHash(withoutHash) };
}

function extractSpans(value: unknown): OtelSpan[] {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  if (Array.isArray(root.spans)) return root.spans as OtelSpan[];
  const resourceSpans = Array.isArray(root.resourceSpans) ? root.resourceSpans : [];
  return resourceSpans.flatMap((resource): OtelSpan[] => {
    if (!resource || typeof resource !== "object") return [];
    const scopes = (resource as Record<string, unknown>).scopeSpans;
    if (!Array.isArray(scopes)) return [];
    return scopes.flatMap((scope): OtelSpan[] => {
      if (!scope || typeof scope !== "object") return [];
      const spans = (scope as Record<string, unknown>).spans;
      return Array.isArray(spans) ? spans as OtelSpan[] : [];
    });
  });
}

function normalizeAttributes(attributes: NonNullable<OtelSpan["attributes"]>): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const item of attributes) {
    if (!item.key) continue;
    result[item.key] = attributeValue(item.value);
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function attributeValue(value: unknown): string | number | boolean | null {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return value as string | number | boolean | null;
  }
  if (!value || typeof value !== "object") return String(value);
  const object = value as Record<string, unknown>;
  for (const key of ["stringValue", "intValue", "doubleValue", "boolValue"]) {
    if (key in object) return attributeValue(object[key]);
  }
  return JSON.stringify(value);
}

function stringAttribute(attributes: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (typeof attributes[key] === "string") return attributes[key] as string;
  }
  return null;
}

function matchDefinition(
  definitions: CanonicalDefinition[],
  filePath: string | null,
  functionName: string | null,
  spanName: string,
): CanonicalDefinition | null {
  const normalizedPath = filePath?.replaceAll("\\", "/");
  const name = functionName ?? spanName.split(/[ ./]/).at(-1) ?? spanName;
  const candidates = definitions.filter((definition) =>
    (!normalizedPath || definition.file_path === normalizedPath || normalizedPath.endsWith(`/${definition.file_path}`)) &&
    (definition.name === name || definition.qualified_name === name || definition.qualified_name.endsWith(`.${name}`)),
  );
  return candidates.length === 1 ? candidates[0]! : null;
}

function buildCapabilityCandidates(
  observations: RuntimeObservation[],
  overlay: SemanticOverlay,
): CapabilityCandidate[] {
  const observedSpanIds = new Set(observations.map((item) => item.span_id));
  const roots = observations.filter((item) => !item.parent_span_id || !observedSpanIds.has(item.parent_span_id));
  return roots.map((root): CapabilityCandidate => {
    const descendants = observations.filter((item) => item.trace_id === root.trace_id);
    const definitionKeys = [...new Set(descendants.flatMap((item) => item.definition_key ? [item.definition_key] : []))].sort();
    const staticFlowFactIds = root.definition_key
      ? overlay.facts.filter((fact) =>
          fact.kind === "application_flow" && fact.subject.kind === "definition" &&
          fact.subject.definition_key === root.definition_key,
        ).map((fact) => fact.fact_id).sort()
      : [];
    const withoutId = {
      status: "candidate" as const,
      title: root.name,
      entry_definition_key: root.definition_key,
      observed_definition_keys: definitionKeys,
      observation_ids: descendants.map((item) => item.observation_id).sort(),
      static_flow_fact_ids: staticFlowFactIds,
    };
    return { candidate_id: canonicalHash({ type: "capability_candidate", ...withoutId }), ...withoutId };
  }).sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
}
