export type Language = "typescript" | "python";

export type DefinitionKind =
  | "module"
  | "class"
  | "interface"
  | "function"
  | "method";

export type RelationKind =
  | "CONTAINS"
  | "IMPORTS"
  | "EXPORTS"
  | "CALLS"
  | "INHERITS"
  | "IMPLEMENTS"
  | "REFERENCES";

export interface ByteSpan {
  start_byte: number;
  end_byte: number;
}

export interface SourceFileInput {
  repository_id: string;
  snapshot_id: string;
  relative_path: string;
  language: Language;
  source_bytes: Uint8Array;
  source_digest: string;
}

export interface SyntaxAdapterManifest {
  id: string;
  version: string;
  language: Language;
  runtime: { id: string; version: string };
  grammar: { id: string; version: string; digest: string };
  query_digest: string;
  config_digest: string;
  capabilities: {
    definition_kinds: DefinitionKind[];
    exact_relation_kinds: RelationKind[];
    candidate_relation_kinds: RelationKind[];
  };
}

export type SubjectLocalRef =
  | { kind: "source_file" }
  | { kind: "definition"; local_id: string };

export interface DefinitionDraft {
  local_id: string;
  container_local_id: string | null;
  kind: DefinitionKind;
  language: Language;
  name: string;
  qualified_name: string;
  name_span: ByteSpan;
  definition_span: ByteSpan;
  content_hash: string;
  evidence_local_ids: string[];
}

export interface ExactRelationDraft {
  local_id: string;
  kind: "CONTAINS";
  source_local_ref: SubjectLocalRef;
  target_local_id: string;
  evidence_local_ids: string[];
}

export type TargetHint =
  | { kind: "name"; name: string; qualifier?: string }
  | { kind: "member"; receiver_text: string; member: string }
  | {
      kind: "module";
      specifier: string;
      imported_name?: string;
      alias?: string;
    };

export interface RelationCandidate {
  local_id: string;
  kind: Exclude<RelationKind, "CONTAINS">;
  source_local_ref: SubjectLocalRef;
  target_hint: TargetHint;
  evidence_local_ids: string[];
}

export interface EvidenceDraft {
  local_id: string;
  file_path: string;
  span: ByteSpan;
  original_position_encoding: "utf8_bytes";
  source_digest: string;
  adapter_id: string;
  adapter_version: string;
  grammar_digest: string;
  query_digest: string;
  config_digest: string;
}

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  file_path: string;
  span?: ByteSpan;
  message: string;
}

export interface FileCoverage {
  status: "complete" | "partial" | "failed" | "skipped";
  definitions: "complete" | "partial" | "unsupported";
  relation_candidates: "complete" | "partial" | "unsupported";
  error_count: number;
  unresolved_candidate_count: number;
}

export interface SyntaxSlice {
  file: {
    relative_path: string;
    language: Language;
    source_digest: string;
  };
  definitions: DefinitionDraft[];
  exact_relations: ExactRelationDraft[];
  relation_candidates: RelationCandidate[];
  evidence: EvidenceDraft[];
  diagnostics: Diagnostic[];
  coverage: FileCoverage;
}

export interface SyntaxAdapter {
  readonly manifest: SyntaxAdapterManifest;
  extract(input: SourceFileInput): SyntaxSlice;
}
