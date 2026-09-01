import type {
  CanonicalCoverage,
  CanonicalDefinition,
  CanonicalEvidence,
  CanonicalRelation,
} from "../canonicalization/types.js";
import type { DefinitionKind, RelationKind } from "../contract/types.js";

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
  kind?: DefinitionKind;
  file_path?: string;
  max_results?: number;
  observed_manifest_digest?: string;
  require_fresh?: boolean;
}

export interface DefinitionFilter {
  kind?: DefinitionKind;
  file_path?: string;
}

export interface DefinitionGetInput {
  repository_id: string;
  snapshot: "current_ready" | string;
  definition_key: string;
  observed_manifest_digest?: string;
  require_fresh?: boolean;
}

export interface EvidenceGetInput {
  repository_id: string;
  snapshot: "current_ready" | string;
  evidence_id: string;
  repository_root: string;
  source_bytes?: number;
  observed_manifest_digest?: string;
  require_fresh?: boolean;
}

export interface EvidenceData {
  evidence: CanonicalEvidence;
  source: { available: boolean; text: string | null; truncated: boolean; reason: string | null };
}

export interface DefinitionQueryStore {
  resolveReadySnapshot(repositoryId: string, selector: "current_ready" | string): {
    snapshot_id: string;
    source_manifest_digest: string;
    coverage: CanonicalCoverage;
  } | null;
  findDefinitions(
    repositoryId: string,
    snapshotId: string,
    query: string,
    filter: DefinitionFilter,
    limit: number,
  ): CanonicalDefinition[];
  readDefinition(repositoryId: string, snapshotId: string, definitionKey: string): CanonicalDefinition | null;
  readEvidence(repositoryId: string, snapshotId: string, evidenceId: string): CanonicalEvidence | null;
}

export type TraversalDirection = "out" | "in" | "both" | "outgoing" | "incoming";
export type NormalizedTraversalDirection = "outgoing" | "incoming" | "both";

export interface TraverseInput {
  repository_id: string;
  snapshot: "current_ready" | string;
  start_definition_key: string;
  direction?: TraversalDirection;
  relation_kinds?: RelationKind[];
  max_depth?: number;
  max_nodes?: number;
  max_results?: number;
  timeout_ms?: number;
  observed_manifest_digest?: string;
  require_fresh?: boolean;
}

export interface TraverseData {
  start_definition_key: string;
  nodes: Array<{ definition: CanonicalDefinition; depth: number }>;
  relations: CanonicalRelation[];
}

export interface PathsInput {
  repository_id: string;
  snapshot: "current_ready" | string;
  start_definition_key: string;
  end_definition_key: string;
  direction?: TraversalDirection;
  relation_kinds?: RelationKind[];
  max_depth?: number;
  max_nodes?: number;
  max_paths?: number;
  timeout_ms?: number;
  observed_manifest_digest?: string;
  require_fresh?: boolean;
}

export interface GraphPath {
  nodes: CanonicalDefinition[];
  relations: CanonicalRelation[];
}

export interface PathsData {
  start_definition_key: string;
  end_definition_key: string;
  paths: GraphPath[];
}

export interface GraphQueryStore extends DefinitionQueryStore {
  readAdjacentRelations(
    repositoryId: string,
    snapshotId: string,
    definitionKeys: string[],
    direction: NormalizedTraversalDirection,
    relationKinds: RelationKind[],
  ): CanonicalRelation[];
}

export class QueryError extends Error {
  constructor(
    readonly code:
      | "INVALID_ARGUMENT"
      | "NO_READY_SNAPSHOT"
      | "SNAPSHOT_NOT_FOUND"
      | "STALE_SNAPSHOT"
      | "INDEX_BUILD_FAILED"
      | "INTERNAL_QUERY_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "QueryError";
  }
}
