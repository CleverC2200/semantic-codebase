import type { CanonicalDefinition, CanonicalRelation } from "../canonicalization/types.js";
import type { RuntimeObservationSet } from "../runtime/types.js";
import type { SemanticEvidence, SemanticFact, SemanticOverlay } from "../semantic/types.js";
import type { executeQueryPlan } from "./query-plan.js";
import type { ConfirmedCapability } from "../runtime/capability-registry.js";

export type QuestionIntent = "file_role" | "call_path" | "entry_flow" | "impact_scope" | "capability" | "data_flow" | "behavior";

export interface ContextPackage {
  schema_version: 1;
  repository_id: string;
  snapshot_id: string;
  question: string;
  intent: QuestionIntent;
  query_plan: ReturnType<typeof executeQueryPlan>;
  target: { file_path: string | null; definition_key: string | null };
  definitions: CanonicalDefinition[];
  structural_relations: CanonicalRelation[];
  semantic_facts: SemanticFact[];
  semantic_evidence: SemanticEvidence[];
  runtime: RuntimeObservationSet | null;
  capabilities: ConfirmedCapability[];
  coverage: SemanticOverlay["coverage"];
  unknowns: string[];
  package_hash: string;
}

export interface EvidenceFinding {
  text: string;
  fact_ids: string[];
  evidence_ids: string[];
  basis_kinds: string[];
  capability_ids?: string[];
}

export interface EvidenceAnswer {
  schema_version: 1;
  status: "answered" | "partial";
  intent: QuestionIntent;
  summary: string;
  findings: EvidenceFinding[];
  coverage: ContextPackage["coverage"];
  unknowns: string[];
  package_hash: string;
  presentation?: { basis: "llm_inferred"; verified: false; summary: string; finding_texts: string[] };
  provider_invocation?: {
    provider: "codex";
    status: "succeeded" | "unavailable" | "invalid_response";
    package_hash: string;
    request_hash: string;
    response_hash: string | null;
    started_at: string;
    duration_ms: number;
    exit_code: number | null;
    input_bytes: number;
    output_bytes: number;
    timeout_ms: number;
    model: "codex-default";
    tool_policy: "text_only_feature_overrides_v1";
    validation: "passed" | "failed" | "not_run";
    error_code: string | null;
    telemetry?: import("./codex-telemetry.js").CodexTelemetry;
  };
}

export class ContextPackageError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ContextPackageError";
  }
}
