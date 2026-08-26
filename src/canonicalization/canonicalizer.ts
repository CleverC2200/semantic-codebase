import { canonicalHash, canonicalJson } from "../contract/hash.js";
import type {
  DefinitionDraft,
  Diagnostic,
  EvidenceDraft,
  ExactRelationDraft,
  RelationCandidate,
  SyntaxAdapterManifest,
  SyntaxSlice,
} from "../contract/types.js";
import type { FrozenRepositoryView, ResolvedEndpoint, ResolutionSlice } from "../resolution/types.js";
import type {
  CanonicalDefinition,
  CanonicalEndpoint,
  CanonicalEvidence,
  CanonicalGraph,
  CanonicalRelation,
  CanonicalizationInput,
  Canonicalizer,
} from "./types.js";

interface LocatedDefinition {
  file_path: string;
  slice: SyntaxSlice;
  draft: DefinitionDraft;
}

interface LocatedCandidate {
  file_path: string;
  candidate: RelationCandidate;
}

interface CanonicalizationState {
  input: CanonicalizationInput;
  diagnostics: Diagnostic[];
  manifestsByLanguage: Map<string, SyntaxAdapterManifest>;
  canonicalEvidenceByDraftRef: Map<string, CanonicalEvidence>;
  canonicalDefinitionsByDraftRef: Map<string, CanonicalDefinition>;
  conflictedDefinitionRefs: Set<string>;
}

export class SnapshotCanonicalizer implements Canonicalizer {
  canonicalize(input: CanonicalizationInput): CanonicalGraph {
    const diagnostics = validateTopLevel(input);
    const manifestsByLanguage = new Map(
      input.repository.adapter_manifests.map((manifest) => [manifest.language, manifest]),
    );
    const state: CanonicalizationState = {
      input,
      diagnostics,
      manifestsByLanguage,
      canonicalEvidenceByDraftRef: new Map(),
      canonicalDefinitionsByDraftRef: new Map(),
      conflictedDefinitionRefs: new Set(),
    };

    const evidence = canonicalizeEvidence(state);
    const definitions = canonicalizeDefinitions(state);
    const relations = canonicalizeRelations(state);
    const adapter_profile_digest = canonicalHash(
      [...input.repository.adapter_manifests].sort((left, right) => left.id.localeCompare(right.id)),
    );
    const source_files = [...input.repository.manifest.files].sort((left, right) =>
      left.relative_path.localeCompare(right.relative_path),
    );
    const unresolved_candidates = [...input.resolution.unresolved_candidates].sort((left, right) =>
      left.local_id.localeCompare(right.local_id),
    );
    const allDiagnostics = uniqueDiagnostics([
      ...input.repository.slices.flatMap((slice) =>
        slice.diagnostics.filter((diagnostic) => diagnostic.code !== "unresolved_relation_candidate"),
      ),
      ...input.resolution.diagnostics,
      ...state.diagnostics,
    ]).sort(compareDiagnostics);
    const coverage = {
      status: allDiagnostics.some((diagnostic) => diagnostic.severity === "error")
        ? "failed" as const
        : "ready" as const,
      file_count: source_files.length,
      definition_count: definitions.length,
      relation_count: relations.length,
      unresolved_candidate_count: unresolved_candidates.length,
      resolution: input.resolution.coverage,
    };
    const graphWithoutHash = {
      repository_id: input.repository.manifest.repository_id,
      snapshot_id: input.repository.manifest.snapshot_id,
      adapter_profile_digest,
      source_files,
      definitions,
      relations,
      unresolved_candidates,
      evidence,
      diagnostics: allDiagnostics,
      coverage,
    };
    return { ...graphWithoutHash, graph_hash: canonicalHash(graphWithoutHash) };
  }
}

function validateTopLevel(input: CanonicalizationInput): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (
    input.resolution.repository_id !== input.repository.manifest.repository_id ||
    input.resolution.snapshot_id !== input.repository.manifest.snapshot_id
  ) {
    diagnostics.push({
      code: "cross_snapshot_resolution",
      severity: "error",
      file_path: "",
      message: "ResolutionSlice does not belong to the Repository Snapshot",
    });
  }
  if (input.resolution.coverage.status !== "complete") {
    diagnostics.push({
      code: "resolution_incomplete",
      severity: "error",
      file_path: "",
      message: "A failed ResolutionSlice cannot produce a Ready Snapshot",
    });
  }
  return diagnostics;
}

function canonicalizeEvidence(state: CanonicalizationState): CanonicalEvidence[] {
  const canonicalById = new Map<string, CanonicalEvidence>();
  for (const slice of state.input.repository.slices) {
    const file = state.input.repository.manifest.files.find(
      (candidate) => candidate.relative_path === slice.file.relative_path,
    );
    const manifest = state.manifestsByLanguage.get(slice.file.language);
    for (const draft of slice.evidence) {
      const draftRef = localRef(slice.file.relative_path, draft.local_id);
      if (!file || !manifest || !validEvidenceDraft(draft, slice, file.byte_length, manifest)) {
        state.diagnostics.push({
          code: "invalid_evidence",
          severity: "error",
          file_path: slice.file.relative_path,
          span: draft.span,
          message: "Evidence does not match source, range, or Adapter Profile",
        });
        continue;
      }
      const evidence_id = canonicalHash({
        type: "evidence",
        snapshot_id: state.input.repository.manifest.snapshot_id,
        file_path: draft.file_path,
        span: draft.span,
        original_position_encoding: draft.original_position_encoding,
        source_digest: draft.source_digest,
        adapter_id: draft.adapter_id,
        adapter_version: draft.adapter_version,
        grammar_digest: draft.grammar_digest,
        query_digest: draft.query_digest,
        config_digest: draft.config_digest,
      });
      const canonical: CanonicalEvidence = {
        evidence_id,
        file_path: draft.file_path,
        span: draft.span,
        original_position_encoding: draft.original_position_encoding,
        source_digest: draft.source_digest,
        adapter_id: draft.adapter_id,
        adapter_version: draft.adapter_version,
        grammar_digest: draft.grammar_digest,
        query_digest: draft.query_digest,
        config_digest: draft.config_digest,
      };
      state.canonicalEvidenceByDraftRef.set(draftRef, canonical);
      canonicalById.set(evidence_id, canonical);
    }
  }
  return [...canonicalById.values()].sort((left, right) =>
    left.file_path.localeCompare(right.file_path) ||
    left.span.start_byte - right.span.start_byte ||
    left.span.end_byte - right.span.end_byte ||
    left.evidence_id.localeCompare(right.evidence_id),
  );
}

function canonicalizeDefinitions(state: CanonicalizationState): CanonicalDefinition[] {
  const located: LocatedDefinition[] = [];
  for (const slice of state.input.repository.slices) {
    const file = state.input.repository.manifest.files.find(
      (candidate) => candidate.relative_path === slice.file.relative_path,
    );
    const manifest = state.manifestsByLanguage.get(slice.file.language);
    for (const draft of slice.definitions) {
      if (!file || !manifest || !validDefinitionDraft(draft, slice, file.byte_length, manifest)) {
        state.diagnostics.push({
          code: "invalid_definition",
          severity: "error",
          file_path: slice.file.relative_path,
          span: draft.definition_span,
          message: "Definition range, language, or Adapter capability is invalid",
        });
        continue;
      }
      located.push({ file_path: slice.file.relative_path, slice, draft });
    }
  }
  const groups = new Map<string, LocatedDefinition[]>();
  for (const item of located) {
    const definitionKey = definitionKeyFor(state, item);
    const group = groups.get(definitionKey) ?? [];
    group.push(item);
    groups.set(definitionKey, group);
  }
  const definitions: CanonicalDefinition[] = [];
  for (const [definition_key, items] of groups) {
    const semanticForms = new Set(
      items.map((item) =>
        canonicalJson({
          kind: item.draft.kind,
          language: item.draft.language,
          name: item.draft.name,
          qualified_name: item.draft.qualified_name,
          name_span: item.draft.name_span,
          definition_span: item.draft.definition_span,
          content_hash: item.draft.content_hash,
          container_local_id: item.draft.container_local_id,
        }),
      ),
    );
    if (semanticForms.size > 1) {
      for (const item of items) state.conflictedDefinitionRefs.add(localRef(item.file_path, item.draft.local_id));
      state.diagnostics.push({
        code: "definition_conflict",
        severity: "error",
        file_path: items[0]?.file_path ?? "",
        message: `Conflicting drafts produced Definition Key ${definition_key}`,
      });
      continue;
    }
    const item = items[0];
    if (!item) continue;
    const evidence_ids = mapCompleteEvidenceIds(state, item.file_path, item.draft.evidence_local_ids);
    if (!evidence_ids) {
      state.diagnostics.push(missingEvidenceDiagnostic(item.file_path, item.draft.qualified_name));
      continue;
    }
    const canonical: CanonicalDefinition = {
      definition_key,
      snapshot_id: state.input.repository.manifest.snapshot_id,
      file_path: item.file_path,
      kind: item.draft.kind,
      language: item.draft.language,
      name: item.draft.name,
      qualified_name: item.draft.qualified_name,
      name_span: item.draft.name_span,
      definition_span: item.draft.definition_span,
      content_hash: item.draft.content_hash,
      container_definition_key: null,
      evidence_ids,
    };
    definitions.push(canonical);
    for (const equivalent of items) {
      state.canonicalDefinitionsByDraftRef.set(
        localRef(equivalent.file_path, equivalent.draft.local_id),
        canonical,
      );
    }
  }

  for (const locatedDefinition of located) {
    if (!locatedDefinition.draft.container_local_id) continue;
    const canonical = state.canonicalDefinitionsByDraftRef.get(
      localRef(locatedDefinition.file_path, locatedDefinition.draft.local_id),
    );
    const container = state.canonicalDefinitionsByDraftRef.get(
      localRef(locatedDefinition.file_path, locatedDefinition.draft.container_local_id),
    );
    if (canonical && container) canonical.container_definition_key = container.definition_key;
  }
  return definitions.sort((left, right) => left.definition_key.localeCompare(right.definition_key));
}

function canonicalizeRelations(state: CanonicalizationState): CanonicalRelation[] {
  const relations = new Map<string, CanonicalRelation>();
  for (const slice of state.input.repository.slices) {
    for (const exact of slice.exact_relations) {
      const relation = canonicalizeExactRelation(state, slice, exact);
      if (relation) mergeRelation(relations, relation);
    }
  }
  const candidatesById = new Map<string, LocatedCandidate[]>();
  for (const slice of state.input.repository.slices) {
    for (const candidate of slice.relation_candidates) {
      const located = candidatesById.get(candidate.local_id) ?? [];
      located.push({ file_path: slice.file.relative_path, candidate });
      candidatesById.set(candidate.local_id, located);
    }
  }
  const resolutionCounts = new Map<string, number>();
  for (const resolved of state.input.resolution.resolved_relations) {
    resolutionCounts.set(
      resolved.candidate_local_id,
      (resolutionCounts.get(resolved.candidate_local_id) ?? 0) + 1,
    );
  }
  for (const resolved of state.input.resolution.resolved_relations) {
    const candidates = candidatesById.get(resolved.candidate_local_id) ?? [];
    if (candidates.length !== 1) {
      state.diagnostics.push({
        code: "stale_resolution",
        severity: "error",
        file_path: candidates[0]?.file_path ?? "",
        message: "Resolved relation must reference exactly one current Candidate",
      });
      continue;
    }
    const located = candidates[0]!;
    if (resolutionCounts.get(resolved.candidate_local_id) !== 1) {
      state.diagnostics.push({
        code: "duplicate_candidate_resolution",
        severity: "error",
        file_path: located.file_path,
        message: "A Candidate may produce at most one resolved relation",
      });
      continue;
    }
    const manifest = manifestForFile(state, located.file_path);
    if (!manifest?.capabilities.candidate_relation_kinds.includes(located.candidate.kind)) {
      state.diagnostics.push({
        code: "undeclared_relation_capability",
        severity: "error",
        file_path: located.file_path,
        message: `${located.candidate.kind} is not declared by the source Adapter Profile`,
      });
      continue;
    }
    const source = located.candidate.source_local_ref.kind === "source_file"
      ? { kind: "source_file" as const, file_path: located.file_path }
      : mapDefinitionEndpoint(state, located.file_path, located.candidate.source_local_ref.local_id);
    const target = mapEndpoint(state, resolved.target);
    const evidence_ids = mapCompleteEvidenceIds(
      state,
      located.file_path,
      located.candidate.evidence_local_ids,
    );
    if (!source || !target || !evidence_ids) {
      state.diagnostics.push({
        code: "invalid_resolved_relation",
        severity: "error",
        file_path: located.file_path,
        message: "Resolved relation has a missing endpoint or Evidence",
      });
      continue;
    }
    mergeRelation(relations, makeCanonicalRelation(
      state,
      located.candidate.kind,
      source,
      target,
      evidence_ids,
      "resolver",
      [resolved.candidate_local_id],
    ));
  }
  return [...relations.values()]
    .map((relation) => ({
      ...relation,
      evidence_ids: [...new Set(relation.evidence_ids)].sort(),
      candidate_local_ids: [...new Set(relation.candidate_local_ids)].sort(),
    }))
    .sort((left, right) => left.relation_key.localeCompare(right.relation_key));
}

function canonicalizeExactRelation(
  state: CanonicalizationState,
  slice: SyntaxSlice,
  exact: ExactRelationDraft,
): CanonicalRelation | null {
  const manifest = state.manifestsByLanguage.get(slice.file.language);
  if (!manifest?.capabilities.exact_relation_kinds.includes(exact.kind)) {
    state.diagnostics.push({
      code: "undeclared_relation_capability",
      severity: "error",
      file_path: slice.file.relative_path,
      message: `${exact.kind} is not declared by the Adapter Profile`,
    });
    return null;
  }
  const source: CanonicalEndpoint | null = exact.source_local_ref.kind === "source_file"
    ? { kind: "source_file", file_path: slice.file.relative_path }
    : mapDefinitionEndpoint(state, slice.file.relative_path, exact.source_local_ref.local_id);
  const target = mapDefinitionEndpoint(state, slice.file.relative_path, exact.target_local_id);
  const evidence_ids = mapCompleteEvidenceIds(state, slice.file.relative_path, exact.evidence_local_ids);
  if (!source || !target || !evidence_ids) {
    state.diagnostics.push({
      code: "invalid_exact_relation",
      severity: "error",
      file_path: slice.file.relative_path,
      message: "Exact relation has a missing endpoint or Evidence",
    });
    return null;
  }
  return makeCanonicalRelation(
    state,
    exact.kind,
    source,
    target,
    evidence_ids,
    "syntax_exact",
    [],
  );
}

function makeCanonicalRelation(
  state: CanonicalizationState,
  kind: CanonicalRelation["kind"],
  source: CanonicalEndpoint,
  target: CanonicalEndpoint,
  evidence_ids: string[],
  origin: CanonicalRelation["origin"],
  candidate_local_ids: string[],
): CanonicalRelation {
  const relation_key = canonicalHash({
    type: "relation",
    snapshot_id: state.input.repository.manifest.snapshot_id,
    kind,
    source,
    target,
  });
  return {
    relation_key,
    snapshot_id: state.input.repository.manifest.snapshot_id,
    kind,
    source,
    target,
    evidence_ids,
    origin,
    candidate_local_ids,
  };
}

function definitionKeyFor(state: CanonicalizationState, item: LocatedDefinition): string {
  return canonicalHash({
    type: "definition",
    snapshot_id: state.input.repository.manifest.snapshot_id,
    file_path: item.file_path,
    language: item.draft.language,
    kind: item.draft.kind,
    qualified_name: item.draft.qualified_name,
    definition_span: item.draft.definition_span,
  });
}

function validEvidenceDraft(
  evidence: EvidenceDraft,
  slice: SyntaxSlice,
  byteLength: number,
  manifest: SyntaxAdapterManifest,
): boolean {
  return (
    evidence.file_path === slice.file.relative_path &&
    evidence.source_digest === slice.file.source_digest &&
    Number.isInteger(evidence.span.start_byte) &&
    Number.isInteger(evidence.span.end_byte) &&
    evidence.span.start_byte >= 0 &&
    evidence.span.end_byte >= evidence.span.start_byte &&
    evidence.span.end_byte <= byteLength &&
    evidence.adapter_id === manifest.id &&
    evidence.adapter_version === manifest.version &&
    evidence.grammar_digest === manifest.grammar.digest &&
    evidence.query_digest === manifest.query_digest &&
    evidence.config_digest === manifest.config_digest
  );
}

function validDefinitionDraft(
  definition: DefinitionDraft,
  slice: SyntaxSlice,
  byteLength: number,
  manifest: SyntaxAdapterManifest,
): boolean {
  const spans = [definition.name_span, definition.definition_span];
  return (
    definition.language === slice.file.language &&
    manifest.capabilities.definition_kinds.includes(definition.kind) &&
    spans.every(
      (span) =>
        Number.isInteger(span.start_byte) &&
        Number.isInteger(span.end_byte) &&
        span.start_byte >= 0 &&
        span.end_byte >= span.start_byte &&
        span.end_byte <= byteLength,
    ) &&
    definition.definition_span.start_byte <= definition.name_span.start_byte &&
    definition.definition_span.end_byte >= definition.name_span.end_byte
  );
}

function mapEvidenceIds(
  state: CanonicalizationState,
  filePath: string,
  localIds: string[],
): string[] {
  return [...new Set(localIds.flatMap((localId) => {
    const evidence = state.canonicalEvidenceByDraftRef.get(localRef(filePath, localId));
    return evidence ? [evidence.evidence_id] : [];
  }))].sort();
}

function mapCompleteEvidenceIds(
  state: CanonicalizationState,
  filePath: string,
  localIds: string[],
): string[] | null {
  const uniqueLocalIds = [...new Set(localIds)];
  if (uniqueLocalIds.length === 0) return null;
  const evidenceIds = mapEvidenceIds(state, filePath, uniqueLocalIds);
  return evidenceIds.length === uniqueLocalIds.length ? evidenceIds : null;
}

function mapEndpoint(
  state: CanonicalizationState,
  endpoint: ResolvedEndpoint,
): CanonicalEndpoint | null {
  if (!state.input.repository.manifest.files.some((file) => file.relative_path === endpoint.file_path)) {
    return null;
  }
  return endpoint.kind === "source_file"
    ? { kind: "source_file", file_path: endpoint.file_path }
    : mapDefinitionEndpoint(state, endpoint.file_path, endpoint.definition_local_id);
}

function mapDefinitionEndpoint(
  state: CanonicalizationState,
  filePath: string,
  localId: string,
): CanonicalEndpoint | null {
  const definition = state.canonicalDefinitionsByDraftRef.get(localRef(filePath, localId));
  return definition ? { kind: "definition", definition_key: definition.definition_key } : null;
}

function manifestForFile(
  state: CanonicalizationState,
  filePath: string,
): SyntaxAdapterManifest | null {
  const file = state.input.repository.manifest.files.find((candidate) => candidate.relative_path === filePath);
  return file ? state.manifestsByLanguage.get(file.language) ?? null : null;
}

function mergeRelation(relations: Map<string, CanonicalRelation>, incoming: CanonicalRelation): void {
  const existing = relations.get(incoming.relation_key);
  if (!existing) {
    relations.set(incoming.relation_key, incoming);
    return;
  }
  existing.evidence_ids.push(...incoming.evidence_ids);
  existing.candidate_local_ids.push(...incoming.candidate_local_ids);
}

function localRef(filePath: string, localId: string): string {
  return `${filePath}\0${localId}`;
}

function missingEvidenceDiagnostic(filePath: string, name: string): Diagnostic {
  return {
    code: "missing_definition_evidence",
    severity: "error",
    file_path: filePath,
    message: `Definition ${name} has no valid Evidence`,
  };
}

function uniqueDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...new Map(diagnostics.map((diagnostic) => [canonicalJson(diagnostic), diagnostic])).values()];
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    left.file_path.localeCompare(right.file_path) ||
    (left.span?.start_byte ?? Number.MAX_SAFE_INTEGER) -
      (right.span?.start_byte ?? Number.MAX_SAFE_INTEGER) ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}
