import type {
  Diagnostic,
  Language,
  RelationCandidate,
  RelationKind,
  SyntaxAdapterManifest,
  SyntaxSlice,
} from "../contract/types.js";

export interface RepositoryManifestFile {
  relative_path: string;
  language: Language;
  source_digest: string;
  byte_length: number;
}

export interface RepositoryManifest {
  repository_id: string;
  snapshot_id: string;
  files: RepositoryManifestFile[];
}

export interface FrozenRepositoryView {
  manifest: RepositoryManifest;
  slices: SyntaxSlice[];
  adapter_manifests: SyntaxAdapterManifest[];
}

export type ResolvedEndpoint =
  | { kind: "source_file"; file_path: string }
  | { kind: "definition"; file_path: string; definition_local_id: string };

export interface ResolvedRelationDraft {
  local_id: string;
  candidate_local_id: string;
  kind: Exclude<RelationKind, "CONTAINS">;
  source: ResolvedEndpoint;
  target: ResolvedEndpoint;
  evidence_local_ids: string[];
  derivation: string[];
}

export interface ResolutionCoverage {
  status: "complete" | "failed";
  candidate_count: number;
  resolved_count: number;
  unresolved_count: number;
}

export interface ResolutionSlice {
  repository_id: string;
  snapshot_id: string;
  resolved_relations: ResolvedRelationDraft[];
  unresolved_candidates: RelationCandidate[];
  diagnostics: Diagnostic[];
  coverage: ResolutionCoverage;
}

export interface Resolver {
  resolve(view: FrozenRepositoryView): ResolutionSlice;
}
