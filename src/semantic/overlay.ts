import { canonicalJson, canonicalRecordHash, sha256Bytes } from "../contract/hash.js";
import type { Diagnostic } from "../contract/types.js";
import type { IndexState, RepositorySource } from "../indexing/types.js";
import { sourceManifestDigest } from "../indexing/source-manifest.js";
import type {
  SemanticCoverage,
  SemanticEvidence,
  SemanticFact,
  SemanticOverlay,
} from "./types.js";
import { SemanticEnrichmentError } from "./types.js";

interface OverlayDraft {
  profile: SemanticOverlay["profile"];
  facts: SemanticFact[];
  evidence: SemanticEvidence[];
  diagnostics: Diagnostic[];
  coverage: Omit<SemanticCoverage, "fact_count">;
}

export function finalizeSemanticOverlay(
  state: IndexState,
  source: RepositorySource,
  draft: OverlayDraft,
): SemanticOverlay {
  validateSemanticInput(state, source);
  const manifestByPath = new Map(state.manifest.files.map((file) => [file.relative_path, file]));
  const evidenceById = new Map<string, SemanticEvidence>();
  for (const evidence of draft.evidence) {
    const file = manifestByPath.get(evidence.file_path);
    if (
      !file ||
      file.source_digest !== evidence.source_digest ||
      evidence.span.start_byte < 0 ||
      evidence.span.end_byte <= evidence.span.start_byte ||
      evidence.span.end_byte > file.byte_length
    ) {
      throw new SemanticEnrichmentError(
        "INVALID_EVIDENCE",
        `Semantic Evidence does not match Ready Snapshot: ${evidence.file_path}`,
      );
    }
    const existing = evidenceById.get(evidence.evidence_id);
    if (existing && canonicalJson(existing) !== canonicalJson(evidence)) {
      throw new SemanticEnrichmentError("EVIDENCE_CONFLICT", "Conflicting Semantic Evidence IDs");
    }
    evidenceById.set(evidence.evidence_id, evidence);
  }

  const factsById = new Map<string, SemanticFact>();
  for (const fact of draft.facts) {
    if (fact.evidence_ids.length === 0 || fact.evidence_ids.some((id) => !evidenceById.has(id))) {
      throw new SemanticEnrichmentError("EVIDENCE_NOT_CLOSED", `Fact has missing Evidence: ${fact.fact_id}`);
    }
    const declared = new Set(fact.evidence_ids);
    const pending: unknown[] = [fact.value];
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== "object") continue;
      if (Array.isArray(value)) { pending.push(...value); continue; }
      for (const [key, item] of Object.entries(value)) {
        const references = key === "evidence_id" || key.endsWith("_evidence_id") ? [item]
          : key === "evidence_ids" || key.endsWith("_evidence_ids") ? Array.isArray(item) ? item : [item] : [];
        if (references.some((id) => id !== null && (typeof id !== "string" || !declared.has(id)))) {
          throw new SemanticEnrichmentError("EVIDENCE_NOT_CLOSED", `Fact payload references undeclared Evidence: ${fact.fact_id}`);
        }
        if (item && typeof item === "object") pending.push(item);
      }
    }
    if (fact.subject.kind === "definition") {
      const definitionKey = fact.subject.definition_key;
      if (!state.graph.definitions.some((definition) => definition.definition_key === definitionKey)) {
        throw new SemanticEnrichmentError("UNKNOWN_SUBJECT", `Unknown Definition: ${definitionKey}`);
      }
    }
    const existing = factsById.get(fact.fact_id);
    if (existing && canonicalJson({ ...existing, evidence_ids: [] }) !== canonicalJson({ ...fact, evidence_ids: [] })) {
      throw new SemanticEnrichmentError("FACT_CONFLICT", `Conflicting Semantic Fact IDs: ${fact.fact_id}`);
    }
    factsById.set(fact.fact_id, existing ? {
      ...existing,
      evidence_ids: [...new Set([...existing.evidence_ids, ...fact.evidence_ids])].sort(),
    } : { ...fact, evidence_ids: [...fact.evidence_ids].sort() });
  }

  const evidence = [...evidenceById.values()].sort(compareEvidence);
  const facts = [...factsById.values()].sort((left, right) => left.fact_id.localeCompare(right.fact_id));
  const capabilityGaps = facts.flatMap((fact) => fact.basis.kind === "static_possible" ? fact.basis.reason_codes : [])
    .filter((code) => /unknown|unavailable|not_modeled|not_expanded|unresolved|exceeded|withheld/.test(code));
  const withoutHash = {
    schema_version: 1 as const,
    repository_id: state.repository_id,
    snapshot_id: state.snapshot_id,
    structural_graph_hash: state.graph.graph_hash,
    profile: draft.profile,
    facts,
    evidence,
    diagnostics: [...draft.diagnostics].sort(compareDiagnostics),
    coverage: {
      ...draft.coverage,
      status: capabilityGaps.length ? "partial" as const : draft.coverage.status,
      reason_codes: [...new Set([...draft.coverage.reason_codes, ...capabilityGaps])].sort(),
      fact_count: facts.length,
    },
  };
  return { ...withoutHash, overlay_hash: canonicalRecordHash(withoutHash) };
}

export function validateSemanticInput(state: IndexState, source: RepositorySource): void {
  if (
    state.repository_id !== source.repository_id ||
    state.graph.repository_id !== state.repository_id ||
    state.graph.snapshot_id !== state.snapshot_id ||
    state.graph.coverage.status !== "ready"
  ) {
    throw new SemanticEnrichmentError("INVALID_SNAPSHOT_VIEW", "Semantic Enricher requires one Ready Snapshot");
  }
  if (sourceManifestDigest(source) !== state.source_manifest_digest) {
    throw new SemanticEnrichmentError("SOURCE_DIGEST_MISMATCH", "Source or configuration no longer matches Ready Snapshot");
  }
  const sourceByPath = new Map(source.files.map((file) => [file.relative_path, file]));
  for (const file of state.manifest.files) {
    const input = sourceByPath.get(file.relative_path);
    if (
      !input ||
      input.source_digest !== file.source_digest ||
      sha256Bytes(input.source_bytes) !== file.source_digest ||
      input.source_bytes.byteLength !== file.byte_length
    ) {
      throw new SemanticEnrichmentError(
        "SOURCE_DIGEST_MISMATCH",
        `Source no longer matches Ready Snapshot: ${file.relative_path}`,
      );
    }
  }
}

function compareEvidence(left: SemanticEvidence, right: SemanticEvidence): number {
  return left.file_path.localeCompare(right.file_path) ||
    left.span.start_byte - right.span.start_byte ||
    left.span.end_byte - right.span.end_byte ||
    left.evidence_id.localeCompare(right.evidence_id);
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return left.file_path.localeCompare(right.file_path) ||
    (left.span?.start_byte ?? -1) - (right.span?.start_byte ?? -1) ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message);
}
