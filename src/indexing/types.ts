import type { CanonicalGraph } from "../canonicalization/types.js";
import type {
  Language,
  SyntaxAdapter,
  SyntaxAdapterManifest,
  SyntaxSlice,
} from "../contract/types.js";
import type { RepositoryManifest } from "../resolution/types.js";

export interface RepositorySourceFile {
  relative_path: string;
  language: Language;
  source_bytes: Uint8Array;
  source_digest: string;
}

export interface RepositorySource {
  repository_id: string;
  files: RepositorySourceFile[];
  configuration_files?: Omit<RepositorySourceFile, "language">[];
}

export interface IndexState {
  repository_id: string;
  snapshot_id: string;
  source_manifest_digest: string;
  canonical_ir_version: string;
  index_config_digest: string;
  adapter_profile_digest: string;
  adapter_manifests: SyntaxAdapterManifest[];
  manifest: RepositoryManifest;
  slices: SyntaxSlice[];
  graph: CanonicalGraph;
}

export interface IndexBuildReceipt {
  mode: "full" | "incremental";
  snapshot_id: string;
  extracted_files: string[];
  reused_files: string[];
  removed_files: string[];
  graph_hash: string;
}

export interface IndexBuildResult {
  state: IndexState;
  receipt: IndexBuildReceipt;
}

export interface IndexOptions {
  adapters: SyntaxAdapter[];
  canonical_ir_version?: string;
  index_config?: unknown;
}

export class IndexBuildError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "IndexBuildError";
  }
}
