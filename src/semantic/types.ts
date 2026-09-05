import type { ByteSpan, Diagnostic } from "../contract/types.js";
import type { IndexState, RepositorySource } from "../indexing/types.js";

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export type ClaimBasis =
  | { kind: "compiler_exact"; rule_id: string }
  | { kind: "static_possible"; rule_id: string; reason_codes: readonly string[] }
  | { kind: "framework_heuristic"; rule_id: string };

export const SEMANTIC_FACT_KINDS = [
  "symbol_type",
  "import_target",
  "reference_target",
  "call_target",
  "control_step",
  "effect",
  "entrypoint",
  "application_flow",
] as const;
export type SemanticFactKind = (typeof SEMANTIC_FACT_KINDS)[number];

export type SemanticSubject =
  | { kind: "definition"; definition_key: string }
  | { kind: "source_file"; file_path: string };

export interface SemanticEvidence {
  evidence_id: string;
  file_path: string;
  span: ByteSpan;
  source_digest: string;
  producer: string;
}

export interface SemanticFact {
  fact_id: string;
  kind: SemanticFactKind;
  subject: SemanticSubject;
  value: CanonicalValue;
  basis: ClaimBasis;
  evidence_ids: string[];
}

export interface SemanticCoverage {
  status: "complete" | "partial";
  analyzed_files: number;
  skipped_files: number;
  fact_count: number;
  reason_codes: string[];
}

export interface SemanticOverlay {
  schema_version: 1;
  repository_id: string;
  snapshot_id: string;
  structural_graph_hash: string;
  profile: {
    id: string;
    version: string;
    compiler_version: string;
  };
  facts: SemanticFact[];
  evidence: SemanticEvidence[];
  diagnostics: Diagnostic[];
  coverage: SemanticCoverage;
  overlay_hash: string;
}

export interface SemanticEnrichmentInput {
  state: IndexState;
  source: RepositorySource;
}

export interface SemanticEnricher {
  enrich(input: SemanticEnrichmentInput): SemanticOverlay;
}

export class SemanticEnrichmentError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SemanticEnrichmentError";
  }
}
