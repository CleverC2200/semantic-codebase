import type { IndexState } from "../indexing/types.js";
import type { SemanticFact, SemanticOverlay } from "../semantic/types.js";

export type SnapshotStatus = "building" | "ready" | "failed" | "superseded";

export interface SnapshotSummary {
  repository_id: string;
  snapshot_id: string;
  status: SnapshotStatus;
  graph_hash: string | null;
  error_message: string | null;
}

export interface SnapshotStore {
  beginBuild(repositoryId: string, snapshotId: string): void;
  publishReady(state: IndexState, options?: { before_pointer?: () => void }): void;
  markFailed(repositoryId: string, snapshotId: string, message: string): void;
  getCurrentReady(repositoryId: string): IndexState | null;
  getSnapshot(repositoryId: string, snapshotId: string): IndexState | null;
  getSnapshotSummary(repositoryId: string, snapshotId: string): SnapshotSummary | null;
  publishSemanticOverlay(overlay: SemanticOverlay): void;
  getSemanticOverlay(repositoryId: string, snapshotId: string): SemanticOverlay | null;
  readSemanticFacts(
    repositoryId: string,
    snapshotId: string,
    filter?: { file_path?: string; definition_key?: string; kind?: string; limit?: number },
  ): SemanticFact[];
  close(): void;
}

export class SnapshotStoreError extends Error {
  constructor(
    readonly code: "STORE_INTEGRITY_ERROR" | "SNAPSHOT_NOT_READY" | "SNAPSHOT_IMMUTABLE",
    message: string,
  ) {
    super(message);
    this.name = "SnapshotStoreError";
  }
}
