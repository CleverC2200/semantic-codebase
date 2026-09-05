import { sha256Bytes } from "./hash.js";
import type {
  Diagnostic,
  SourceFileInput,
  SyntaxAdapterManifest,
  SyntaxSlice,
} from "./types.js";

export class AdapterUnavailableError extends Error {
  readonly code = "adapter_unavailable";

  constructor(
    readonly adapterId: string,
    readonly causeCode: "query_incompatible" | "runtime_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "AdapterUnavailableError";
  }
}

export function validateSourceInput(
  input: SourceFileInput,
  manifest: SyntaxAdapterManifest,
): Diagnostic | null {
  if (input.language !== manifest.language) {
    return {
      code: "unsupported_language",
      severity: "error",
      file_path: input.relative_path,
      message: `Adapter ${manifest.id} does not support ${input.language}`,
    };
  }

  if (sha256Bytes(input.source_bytes) !== input.source_digest) {
    return {
      code: "source_digest_mismatch",
      severity: "error",
      file_path: input.relative_path,
      message: "source_digest does not match source_bytes",
    };
  }

  return null;
}

export function failedSyntaxSlice(
  input: SourceFileInput,
  diagnostic: Diagnostic,
): SyntaxSlice {
  return {
    file: {
      relative_path: input.relative_path,
      language: input.language,
      source_digest: input.source_digest,
    },
    definitions: [],
    exact_relations: [],
    relation_candidates: [],
    evidence: [],
    diagnostics: [diagnostic],
    coverage: {
      status: "failed",
      definitions: "partial",
      relation_candidates: "partial",
      error_count: 1,
      unresolved_candidate_count: 0,
    },
  };
}
