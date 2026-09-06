import path from "node:path";

import { canonicalHash, sha256Bytes } from "../contract/hash.js";
import { IndexBuildError, type RepositorySource } from "./types.js";

/** Configuration is frozen input, not a syntax file or source Evidence. */
export function sourceManifestDigest(source: RepositorySource): string {
  const files = [...source.files].sort((a, b) => a.relative_path.localeCompare(b.relative_path)).map((file) => ({
    relative_path: file.relative_path,
    language: file.language,
    source_digest: file.source_digest,
    byte_length: file.source_bytes.byteLength,
  }));
  const seen = new Set(source.files.map((file) => file.relative_path));
  const configurations = [...(source.configuration_files ?? [])]
    .sort((a, b) => a.relative_path.localeCompare(b.relative_path)).map((file) => {
      if (!file.relative_path || file.relative_path === "." || file.relative_path.endsWith("/") || file.relative_path.includes("\\") ||
          path.posix.isAbsolute(file.relative_path) || file.relative_path.startsWith("../") ||
          path.posix.normalize(file.relative_path) !== file.relative_path || seen.has(file.relative_path)) {
        throw new IndexBuildError("invalid_configuration_path", `Invalid configuration path: ${file.relative_path}`);
      }
      seen.add(file.relative_path);
      if (sha256Bytes(file.source_bytes) !== file.source_digest) {
        throw new IndexBuildError("configuration_digest_mismatch", `Configuration digest mismatch: ${file.relative_path}`);
      }
      return { relative_path: file.relative_path, source_digest: file.source_digest, byte_length: file.source_bytes.byteLength };
    });
  // Keep existing snapshots stable for repositories without configuration inputs.
  return canonicalHash(configurations.length ? { files, configurations } : files);
}
