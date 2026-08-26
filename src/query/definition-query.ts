import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import type { CanonicalCoverage } from "../canonicalization/types.js";
import { sha256Bytes } from "../contract/hash.js";
import type {
  DefinitionFindInput,
  DefinitionGetInput,
  DefinitionQueryStore,
  EvidenceData,
  EvidenceGetInput,
  QueryResult,
} from "./types.js";
import { QueryError } from "./types.js";

const DEFAULT_MAX_RESULTS = 50;
const MAX_RESULTS = 500;
const DEFAULT_SOURCE_BYTES = 16 * 1024;
const MAX_SOURCE_BYTES = 128 * 1024;

interface ResolvedScope {
  repository_id: string;
  snapshot_id: string;
  revision: string | null;
  freshness: "unknown";
  coverage: CanonicalCoverage;
}

export class DefinitionQueryService {
  constructor(private readonly store: DefinitionQueryStore) {}

  findDefinitions(input: DefinitionFindInput): QueryResult<{ definitions: ReturnType<DefinitionQueryStore["findDefinitions"]> }> {
    if (!input.query.trim()) throw new QueryError("INVALID_ARGUMENT", "query must not be empty");
    const maxResults = bounded(input.max_results ?? DEFAULT_MAX_RESULTS, 1, MAX_RESULTS, "max_results");
    const scope = this.resolveScope(input.repository_id, input.snapshot);
    const definitions = this.store.findDefinitions(
      input.repository_id,
      scope.snapshot_id,
      input.query.normalize("NFC"),
      maxResults + 1,
    );
    const truncated = definitions.length > maxResults;
    const data = definitions.slice(0, maxResults);
    return result(scope, { definitions: data }, truncated, { max_results: data.length },
      data.flatMap((definition) => definition.evidence_ids));
  }

  getDefinition(input: DefinitionGetInput): QueryResult<{ definition: ReturnType<DefinitionQueryStore["readDefinition"]> }> {
    if (!input.definition_key) throw new QueryError("INVALID_ARGUMENT", "definition_key is required");
    const scope = this.resolveScope(input.repository_id, input.snapshot);
    const definition = this.store.readDefinition(input.repository_id, scope.snapshot_id, input.definition_key);
    return result(scope, { definition }, false, { max_results: definition ? 1 : 0 }, definition?.evidence_ids ?? []);
  }

  getEvidence(input: EvidenceGetInput): QueryResult<EvidenceData> {
    if (!input.evidence_id) throw new QueryError("INVALID_ARGUMENT", "evidence_id is required");
    const sourceBudget = bounded(input.source_bytes ?? DEFAULT_SOURCE_BYTES, 1, MAX_SOURCE_BYTES, "source_bytes");
    const scope = this.resolveScope(input.repository_id, input.snapshot);
    const evidence = this.store.readEvidence(input.repository_id, scope.snapshot_id, input.evidence_id);
    if (!evidence) {
      throw new QueryError("INVALID_ARGUMENT", `Evidence not found: ${input.evidence_id}`);
    }
    const source = readEvidenceSource(input.repository_root, evidence.file_path, evidence.source_digest, evidence.span, sourceBudget);
    return result(scope, { evidence, source }, source.truncated, { source_bytes: source.text ? Buffer.byteLength(source.text) : 0 }, [evidence.evidence_id]);
  }

  private resolveScope(repositoryId: string, selector: "current_ready" | string): ResolvedScope {
    if (!repositoryId) throw new QueryError("INVALID_ARGUMENT", "repository_id is required");
    const snapshot = this.store.resolveReadySnapshot(repositoryId, selector);
    if (!snapshot) {
      throw new QueryError(
        selector === "current_ready" ? "NO_READY_SNAPSHOT" : "SNAPSHOT_NOT_FOUND",
        selector === "current_ready" ? "Repository has no Ready Snapshot" : `Snapshot not found: ${selector}`,
      );
    }
    return {
      ...snapshot,
      repository_id: repositoryId,
      revision: null,
      freshness: "unknown" as const,
    };
  }
}

function result<T>(
  scope: ResolvedScope,
  data: T,
  truncated: boolean,
  budgetUsed: Record<string, number>,
  evidenceRefs: string[],
): QueryResult<T> {
  const { coverage, ...snapshot } = scope;
  return {
    schema_version: 1,
    snapshot,
    data,
    completeness: {
      complete: !truncated,
      truncated,
      reason: truncated ? "budget_exhausted" : null,
      budget_used: budgetUsed,
    },
    coverage,
    evidence_refs: [...new Set(evidenceRefs)].sort(),
  };
}

function readEvidenceSource(
  repositoryRoot: string,
  filePath: string,
  expectedDigest: string,
  span: { start_byte: number; end_byte: number },
  budget: number,
): EvidenceData["source"] {
  try {
    const root = realpathSync(repositoryRoot);
    const absolute = realpathSync(path.join(root, filePath));
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      return { available: false, text: null, truncated: false, reason: "path_outside_repository" };
    }
    const bytes = readFileSync(absolute);
    if (sha256Bytes(bytes) !== expectedDigest) {
      return { available: false, text: null, truncated: false, reason: "source_digest_mismatch" };
    }
    const end = Math.min(span.end_byte, span.start_byte + budget);
    return {
      available: true,
      text: new TextDecoder().decode(bytes.subarray(span.start_byte, end)),
      truncated: end < span.end_byte,
      reason: end < span.end_byte ? "source_bytes" : null,
    };
  } catch {
    return { available: false, text: null, truncated: false, reason: "source_unavailable" };
  }
}

function bounded(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new QueryError("INVALID_ARGUMENT", `${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
