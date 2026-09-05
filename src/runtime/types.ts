import type { Diagnostic } from "../contract/types.js";
import type { CanonicalValue } from "../semantic/types.js";

export interface RuntimeObservation {
  observation_id: string;
  execution_id: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  name: string;
  definition_key: string | null;
  file_path: string | null;
  start_time_unix_nano: string | null;
  end_time_unix_nano: string | null;
  attributes: { [key: string]: CanonicalValue };
  basis: { kind: "runtime_observed"; scope: "single_execution" };
}

export interface CapabilityCandidate {
  candidate_id: string;
  status: "candidate";
  title: string;
  entry_definition_key: string | null;
  observed_definition_keys: string[];
  observation_ids: string[];
  static_flow_fact_ids: string[];
}

export interface RuntimeObservationSet {
  schema_version: 1;
  repository_id: string;
  snapshot_id: string;
  semantic_overlay_hash: string;
  execution_id: string;
  trace_digest: string;
  observations: RuntimeObservation[];
  capability_candidates: CapabilityCandidate[];
  diagnostics: Diagnostic[];
  coverage: {
    status: "complete" | "partial";
    span_count: number;
    matched_span_count: number;
    unmatched_span_count: number;
    reason_codes: string[];
  };
  observation_set_hash: string;
}

export class RuntimeImportError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RuntimeImportError";
  }
}
