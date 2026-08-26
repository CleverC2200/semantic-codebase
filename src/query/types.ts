import type {
  CanonicalCoverage,
  CanonicalDefinition,
  CanonicalEvidence,
} from "../canonicalization/types.js";

export type Freshness = "fresh" | "stale" | "unknown";

export interface QuerySnapshot {
  repository_id: string;
  snapshot_id: string;
  revision: string | null;
  freshness: Freshness;
}

export interface QueryCompleteness {
  complete: boolean;
  truncated: boolean;
  reason: string | null;
  budget_used: Record<string, number>;
}

export interface QueryResult<T> {
  schema_version: 1;
  snapshot: QuerySnapshot;
  data: T;
  completeness: QueryCompleteness;
  coverage: CanonicalCoverage;
  evidence_refs: string[];
}

export interface DefinitionFindInput {
  repository_id: string;
  snapshot: "current_ready" | string;
  query: string;
  max_results?: number;
}

export interface DefinitionGetInput {
  repository_id: string;
  snapshot: "current_ready" | string;
  definition_key: string;
}

export interface EvidenceGetInput {
  repository_id: string;
  snapshot: "current_ready" | string;
  evidence_id: string;
  repository_root: string;
  source_bytes?: number;
}

export interface EvidenceData {
  evidence: CanonicalEvidence;
  source: { available: boolean; text: string | null; truncated: boolean; reason: string | null };
}

export interface DefinitionQueryStore {
  resolveReadySnapshot(repositoryId: string, selector: "current_ready" | string): {
    snapshot_id: string;
    coverage: CanonicalCoverage;
  } | null;
  findDefinitions(repositoryId: string, snapshotId: string, query: string, limit: number): CanonicalDefinition[];
  readDefinition(repositoryId: string, snapshotId: string, definitionKey: string): CanonicalDefinition | null;
  readEvidence(repositoryId: string, snapshotId: string, evidenceId: string): CanonicalEvidence | null;
}

export class QueryError extends Error {
  constructor(
    readonly code:
      | "INVALID_ARGUMENT"
      | "NO_READY_SNAPSHOT"
      | "SNAPSHOT_NOT_FOUND"
      | "INTERNAL_QUERY_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "QueryError";
  }
}
