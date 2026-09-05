import type { CanonicalDefinition, CanonicalRelation } from "../canonicalization/types.js";
import type { RuntimeObservationSet } from "../runtime/types.js";
import type { SemanticEvidence, SemanticFact, SemanticOverlay } from "../semantic/types.js";

export type QuestionIntent = "file_role" | "call_path" | "entry_flow" | "impact_scope";

export interface ContextPackage {
  schema_version: 1;
  repository_id: string;
  snapshot_id: string;
  question: string;
  intent: QuestionIntent;
  target: { file_path: string | null; definition_key: string | null };
  definitions: CanonicalDefinition[];
  structural_relations: CanonicalRelation[];
  semantic_facts: SemanticFact[];
  semantic_evidence: SemanticEvidence[];
  runtime: RuntimeObservationSet | null;
  coverage: SemanticOverlay["coverage"];
  unknowns: string[];
  package_hash: string;
}

export interface EvidenceFinding {
  text: string;
  fact_ids: string[];
  evidence_ids: string[];
  basis_kinds: string[];
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
}

export class ContextPackageError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ContextPackageError";
  }
}
