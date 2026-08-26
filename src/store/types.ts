import type { IndexState } from "../indexing/types.js";

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
