import path from "node:path";

import { SnapshotCanonicalizer } from "../canonicalization/canonicalizer.js";
import { canonicalHash } from "../contract/hash.js";
import type { Language, SyntaxAdapter, SyntaxAdapterManifest, SyntaxSlice } from "../contract/types.js";
import { DeterministicResolver, RESOLVER_PROFILE_VERSION } from "../resolution/resolver.js";
import type { FrozenRepositoryView, RepositoryManifest } from "../resolution/types.js";
import type {
  IndexBuildReceipt,
  IndexBuildResult,
  IndexOptions,
  IndexState,
  RepositorySource,
  RepositorySourceFile,
} from "./types.js";
import { IndexBuildError } from "./types.js";
import { sourceManifestDigest } from "./source-manifest.js";

export class RepositoryIndexer {
  private readonly adaptersByLanguage: Map<Language, SyntaxAdapter>;
  private readonly manifests: SyntaxAdapterManifest[];
  private readonly canonicalIrVersion: string;
  private readonly indexConfigDigest: string;

  constructor(options: IndexOptions) {
    this.adaptersByLanguage = new Map();
    for (const adapter of options.adapters) {
      if (this.adaptersByLanguage.has(adapter.manifest.language)) {
        throw new IndexBuildError(
          "duplicate_adapter",
          `Multiple adapters registered for ${adapter.manifest.language}`,
        );
      }
      this.adaptersByLanguage.set(adapter.manifest.language, adapter);
    }
    this.manifests = [...options.adapters.map((adapter) => adapter.manifest)].sort((left, right) =>
      left.language.localeCompare(right.language),
    );
    this.canonicalIrVersion = options.canonical_ir_version ?? "1";
    this.indexConfigDigest = canonicalHash({ resolver_profile_version: RESOLVER_PROFILE_VERSION, options: options.index_config ?? {} });
  }

  buildFull(source: RepositorySource): IndexBuildResult {
    const files = validateAndSortSource(source);
    const identity = this.buildIdentity(source, files);
    const slices = files.map((file) => this.extractFile(source.repository_id, identity.snapshot_id, file));
    return this.finalize(
      source.repository_id,
      identity,
      files,
      slices,
      {
        mode: "full",
        extracted_files: files.map((file) => file.relative_path),
        reused_files: [],
        removed_files: [],
      },
    );
  }

  buildIncremental(previous: IndexState, source: RepositorySource): IndexBuildResult {
    if (previous.repository_id !== source.repository_id) {
      throw new IndexBuildError(
        "repository_mismatch",
        "Incremental build cannot reuse state from another repository",
      );
    }
    const files = validateAndSortSource(source);
    const identity = this.buildIdentity(source, files);
    const previousSlices = new Map(previous.slices.map((slice) => [slice.file.relative_path, slice]));
    const previousFiles = new Map(previous.manifest.files.map((file) => [file.relative_path, file]));
    const previousProfiles = new Map(
      previous.adapter_manifests.map((manifest) => [manifest.language, canonicalHash(manifest)]),
    );
    const currentProfiles = new Map(
      this.manifests.map((manifest) => [manifest.language, canonicalHash(manifest)]),
    );
    const slices: SyntaxSlice[] = [];
    const extracted_files: string[] = [];
    const reused_files: string[] = [];

    for (const file of files) {
      const priorFile = previousFiles.get(file.relative_path);
      const priorSlice = previousSlices.get(file.relative_path);
      const profileUnchanged =
        previousProfiles.get(file.language) === currentProfiles.get(file.language);
      if (
        priorFile &&
        priorSlice &&
        priorFile.language === file.language &&
        priorFile.source_digest === file.source_digest &&
        priorFile.byte_length === file.source_bytes.byteLength &&
        profileUnchanged
      ) {
        slices.push(priorSlice);
        reused_files.push(file.relative_path);
      } else {
        slices.push(this.extractFile(source.repository_id, identity.snapshot_id, file));
        extracted_files.push(file.relative_path);
      }
    }
    const currentPaths = new Set(files.map((file) => file.relative_path));
    const removed_files = previous.manifest.files
      .map((file) => file.relative_path)
      .filter((filePath) => !currentPaths.has(filePath))
      .sort();
    return this.finalize(
      source.repository_id,
      identity,
      files,
      slices,
      { mode: "incremental", extracted_files, reused_files, removed_files },
    );
  }

  private buildIdentity(source: RepositorySource, files: RepositorySourceFile[]) {
    const adapter_profile_digest = canonicalHash(this.manifests);
    const manifestFiles = files.map((file) => ({
      relative_path: file.relative_path,
      language: file.language,
      source_digest: file.source_digest,
      byte_length: file.source_bytes.byteLength,
    }));
    const source_manifest_digest = sourceManifestDigest(source);
    const snapshot_id = canonicalHash({
      type: "snapshot",
      repository_id: source.repository_id,
      source_manifest_digest,
      canonical_ir_version: this.canonicalIrVersion,
      adapter_profile_digest,
      index_config_digest: this.indexConfigDigest,
    });
    return {
      adapter_profile_digest,
      canonical_ir_version: this.canonicalIrVersion,
      index_config_digest: this.indexConfigDigest,
      source_manifest_digest,
      snapshot_id,
      manifestFiles,
      configurationFiles: [...(source.configuration_files ?? [])]
        .sort((a, b) => a.relative_path.localeCompare(b.relative_path))
        .map((file) => ({ relative_path: file.relative_path, source_digest: file.source_digest, byte_length: file.source_bytes.byteLength })),
    };
  }

  private extractFile(
    repositoryId: string,
    snapshotId: string,
    file: RepositorySourceFile,
  ): SyntaxSlice {
    const adapter = this.adaptersByLanguage.get(file.language);
    if (!adapter) {
      throw new IndexBuildError(
        "adapter_unavailable",
        `No Syntax Adapter registered for ${file.language}`,
      );
    }
    const slice = adapter.extract({
      repository_id: repositoryId,
      snapshot_id: snapshotId,
      relative_path: file.relative_path,
      language: file.language,
      source_bytes: file.source_bytes,
      source_digest: file.source_digest,
    });
    if (["failed", "skipped"].includes(slice.coverage.status)) {
      throw new IndexBuildError(
        "syntax_extraction_failed",
        `${file.relative_path} failed Syntax Adapter extraction`,
      );
    }
    return slice;
  }

  private finalize(
    repositoryId: string,
    identity: ReturnType<RepositoryIndexer["buildIdentity"]>,
    files: RepositorySourceFile[],
    slices: SyntaxSlice[],
    receiptInput: Omit<IndexBuildReceipt, "snapshot_id" | "graph_hash">,
  ): IndexBuildResult {
    const manifest: RepositoryManifest = {
      repository_id: repositoryId,
      snapshot_id: identity.snapshot_id,
      files: identity.manifestFiles,
      ...(identity.configurationFiles.length ? { configuration_files: identity.configurationFiles } : {}),
    };
    const repository: FrozenRepositoryView = {
      manifest,
      slices: [...slices].sort((left, right) =>
        left.file.relative_path.localeCompare(right.file.relative_path),
      ),
      adapter_manifests: this.manifests,
    };
    const resolution = new DeterministicResolver().resolve(repository);
    const graph = new SnapshotCanonicalizer().canonicalize({ repository, resolution });
    if (graph.coverage.status !== "ready") {
      throw new IndexBuildError(
        "snapshot_not_ready",
        "Index build produced errors; no Ready IndexState was published",
      );
    }
    const state: IndexState = {
      repository_id: repositoryId,
      snapshot_id: identity.snapshot_id,
      source_manifest_digest: identity.source_manifest_digest,
      canonical_ir_version: identity.canonical_ir_version,
      index_config_digest: identity.index_config_digest,
      adapter_profile_digest: identity.adapter_profile_digest,
      adapter_manifests: this.manifests,
      manifest,
      slices: repository.slices,
      graph,
    };
    return {
      state,
      receipt: {
        ...receiptInput,
        snapshot_id: identity.snapshot_id,
        graph_hash: graph.graph_hash,
        extracted_files: [...receiptInput.extracted_files].sort(),
        reused_files: [...receiptInput.reused_files].sort(),
        removed_files: [...receiptInput.removed_files].sort(),
      },
    };
  }
}

function validateAndSortSource(source: RepositorySource): RepositorySourceFile[] {
  if (!source.repository_id) {
    throw new IndexBuildError("invalid_repository", "repository_id is required");
  }
  const seen = new Set<string>();
  const files = source.files.map((file) => {
    const normalizedPath = path.posix.normalize(file.relative_path);
    if (
      !file.relative_path ||
      file.relative_path === "." || file.relative_path.includes("\\") || file.relative_path.includes("\0") || file.relative_path.endsWith("/") ||
      normalizedPath !== file.relative_path ||
      path.posix.isAbsolute(file.relative_path) ||
      file.relative_path.startsWith("../")
    ) {
      throw new IndexBuildError("invalid_path", `Invalid repository-relative path: ${file.relative_path}`);
    }
    if (seen.has(file.relative_path)) {
      throw new IndexBuildError("duplicate_path", `Duplicate source path: ${file.relative_path}`);
    }
    seen.add(file.relative_path);
    return file;
  });
  return files.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
}
