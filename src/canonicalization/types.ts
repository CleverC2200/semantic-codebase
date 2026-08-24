import type {
  ByteSpan,
  DefinitionKind,
  Diagnostic,
  EvidenceDraft,
  Language,
  RelationCandidate,
  RelationKind,
} from "../contract/types.js";
import type {
  FrozenRepositoryView,
  ResolvedEndpoint,
  ResolutionCoverage,
  ResolutionSlice,
} from "../resolution/types.js";

export interface CanonicalSourceFile {
  relative_path: string;
  language: Language;
  source_digest: string;
  byte_length: number;
}

export interface CanonicalEvidence extends Omit<EvidenceDraft, "local_id"> {
  evidence_id: string;
}

export interface CanonicalDefinition {
  definition_key: string;
  snapshot_id: string;
  file_path: string;
  kind: DefinitionKind;
  language: Language;
  name: string;
  qualified_name: string;
  name_span: ByteSpan;
  definition_span: ByteSpan;
  content_hash: string;
  container_definition_key: string | null;
  evidence_ids: string[];
}

export type CanonicalEndpoint =
  | { kind: "source_file"; file_path: string }
  | { kind: "definition"; definition_key: string };

export interface CanonicalRelation {
  relation_key: string;
  snapshot_id: string;
  kind: RelationKind;
  source: CanonicalEndpoint;
  target: CanonicalEndpoint;
  evidence_ids: string[];
  origin: "syntax_exact" | "resolver";
  candidate_local_ids: string[];
}

export interface CanonicalCoverage {
  status: "ready" | "failed";
  file_count: number;
  definition_count: number;
  relation_count: number;
  unresolved_candidate_count: number;
  resolution: ResolutionCoverage;
}

export interface CanonicalGraph {
  repository_id: string;
  snapshot_id: string;
  adapter_profile_digest: string;
  source_files: CanonicalSourceFile[];
  definitions: CanonicalDefinition[];
  relations: CanonicalRelation[];
  unresolved_candidates: RelationCandidate[];
  evidence: CanonicalEvidence[];
  diagnostics: Diagnostic[];
  coverage: CanonicalCoverage;
  graph_hash: string;
}

export interface CanonicalizationInput {
  repository: FrozenRepositoryView;
  resolution: ResolutionSlice;
}

export interface Canonicalizer {
  canonicalize(input: CanonicalizationInput): CanonicalGraph;
}

export interface EndpointMappingContext {
  snapshot_id: string;
  endpoint: ResolvedEndpoint;
}
