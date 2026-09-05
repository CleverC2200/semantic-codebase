import type { IndexState } from "../indexing/types.js";
import type { DiscoveredRepository } from "./source.js";
import { repositoryManifestSummary } from "./source.js";

export interface CurrentReadyReader {
  getCurrentReady(repositoryId: string): IndexState | null;
}

export function repositoryStatus(
  discovered: DiscoveredRepository,
  store: CurrentReadyReader | null,
): unknown {
  const current = store?.getCurrentReady(discovered.source.repository_id) ?? null;
  const observed = repositoryManifestSummary(discovered.source);
  const indexed = current ? manifestSummaryForState(current) : null;
  const freshness = !indexed ? "unknown" : indexed.digest === observed.digest ? "fresh" : "stale";
  return {
    schema_version: 1,
    command: "status",
    repository_id: discovered.source.repository_id,
    store_path: discovered.store_path,
    current_ready: current
      ? { snapshot_id: current.snapshot_id, graph_hash: current.graph.graph_hash, coverage: current.graph.coverage }
      : null,
    freshness: {
      status: freshness,
      reason: !indexed ? "no_ready_snapshot" : freshness === "stale" ? "manifest_digest_mismatch" : null,
      observed_manifest: observed,
      indexed_manifest: indexed,
    },
  };
}

function manifestSummaryForState(state: IndexState) {
  return {
    digest: state.source_manifest_digest,
    file_count: state.manifest.files.length,
    byte_length: state.manifest.files.reduce((total, file) => total + file.byte_length, 0),
  };
}
