import Parser from "tree-sitter";

import { canonicalHash, canonicalJson, sha256Bytes, sha256Text } from "../../contract/hash.js";
import { AdapterUnavailableError, failedSyntaxSlice, validateSourceInput } from "../../contract/validation.js";
import type {
  ByteSpan,
  DefinitionDraft,
  DefinitionKind,
  Diagnostic,
  EvidenceDraft,
  ExactRelationDraft,
  RelationCandidate,
  SourceFileInput,
  SubjectLocalRef,
  SyntaxAdapter,
  SyntaxAdapterManifest,
  SyntaxSlice,
} from "../../contract/types.js";

export interface RawDefinition {
  node: Parser.SyntaxNode;
  nameNode: Parser.SyntaxNode;
  kind: DefinitionKind;
}

export interface DefinitionContext {
  input: SourceFileInput;
  sourceText: string;
  rootNode: Parser.SyntaxNode;
  definitions: DefinitionDraft[];
  rawDefinitions: RawDefinition[];
  offsetMap: Utf8OffsetMap;
}

export interface Utf8OffsetMap {
  byteOffset(characterIndex: number): number;
  span(node: Parser.SyntaxNode): ByteSpan;
}

export interface AdapterConstruction {
  manifest: Omit<SyntaxAdapterManifest, "query_digest" | "config_digest">;
  language: unknown;
  definitionsQuerySource: string;
  config?: { max_source_bytes?: number };
}

const DEFAULT_MAX_SOURCE_BYTES = 2_000_000;

function spanOf(node: Parser.SyntaxNode): ByteSpan {
  return { start_byte: node.startIndex, end_byte: node.endIndex };
}

function compareSpans(left: ByteSpan, right: ByteSpan): number {
  return left.start_byte - right.start_byte || left.end_byte - right.end_byte;
}

function contains(outer: ByteSpan, inner: ByteSpan): boolean {
  return (
    outer.start_byte <= inner.start_byte &&
    outer.end_byte >= inner.end_byte &&
    (outer.start_byte !== inner.start_byte || outer.end_byte !== inner.end_byte)
  );
}

function sourceRefKey(reference: SubjectLocalRef): string {
  return reference.kind === "source_file" ? "file" : `definition:${reference.local_id}`;
}

export abstract class TreeSitterSyntaxAdapter implements SyntaxAdapter {
  readonly manifest: SyntaxAdapterManifest;
  protected readonly definitionsQuery: Parser.Query;
  protected readonly language: unknown;
  private readonly maxSourceBytes: number;

  protected constructor(construction: AdapterConstruction) {
    this.language = construction.language;
    this.maxSourceBytes = construction.config?.max_source_bytes ?? DEFAULT_MAX_SOURCE_BYTES;
    this.manifest = {
      ...construction.manifest,
      query_digest: sha256Text(construction.definitionsQuerySource),
      config_digest: canonicalHash({ max_source_bytes: this.maxSourceBytes }),
    };
    try {
      this.definitionsQuery = new Parser.Query(
        construction.language,
        construction.definitionsQuerySource,
      );
    } catch (error) {
      throw new AdapterUnavailableError(
        this.manifest.id,
        "query_incompatible",
        `Definitions query is incompatible with ${this.manifest.grammar.id}: ${String(error)}`,
      );
    }
  }

  extract(input: SourceFileInput): SyntaxSlice {
    const invalid = validateSourceInput(input, this.manifest);
    if (invalid) return failedSyntaxSlice(input, invalid);

    if (input.source_bytes.byteLength > this.maxSourceBytes) {
      return failedSyntaxSlice(input, {
        code: "resource_limit_exceeded",
        severity: "error",
        file_path: input.relative_path,
        message: `Source exceeds ${this.maxSourceBytes} byte adapter limit`,
      });
    }

    let sourceText: string;
    try {
      sourceText = new TextDecoder("utf-8", { fatal: true }).decode(input.source_bytes);
    } catch {
      return failedSyntaxSlice(input, {
        code: "invalid_utf8_range",
        severity: "error",
        file_path: input.relative_path,
        message: "Source is not valid UTF-8",
      });
    }

    const parser = new Parser();
    parser.setLanguage(this.language);
    const tree = parser.parse(sourceText);
    const offsetMap = createUtf8OffsetMap(sourceText);
    const diagnostics = collectSyntaxDiagnostics(tree.rootNode, input.relative_path, offsetMap);
    const rawDefinitions = this.collectDefinitions(tree.rootNode);
    const { definitions, evidence } = this.normalizeDefinitions(input, rawDefinitions, offsetMap);
    const exactRelations = createContainsRelations(input, definitions);
    const relationCandidates = this.collectRelationCandidates({
      input,
      sourceText,
      rootNode: tree.rootNode,
      definitions,
      rawDefinitions,
      offsetMap,
    });
    const candidateEvidence = relationCandidates.flatMap((candidate) =>
      this.candidateEvidence(candidate, input),
    );
    const allEvidence = uniqueByLocalId([...evidence, ...candidateEvidence]);
    const candidateDiagnostics = relationCandidates.map((candidate) => {
      const candidateEvidenceItem = allEvidence.find((item) =>
        candidate.evidence_local_ids.includes(item.local_id),
      );
      return {
        code: "unresolved_relation_candidate",
        severity: "info" as const,
        file_path: input.relative_path,
        span: candidateEvidenceItem?.span,
        message: `${candidate.kind} candidate awaits repository resolution`,
      };
    });
    const allDiagnostics = [...diagnostics, ...this.collectLanguageDiagnostics(tree.rootNode, rawDefinitions, input, offsetMap), ...candidateDiagnostics];

    const hasSyntaxErrors = diagnostics.length > 0;
    const candidateCapability = this.manifest.capabilities.candidate_relation_kinds.length > 0;
    return {
      file: {
        relative_path: input.relative_path,
        language: input.language,
        source_digest: input.source_digest,
      },
      definitions: definitions.sort(compareDefinitions),
      exact_relations: exactRelations.sort(compareRelations),
      relation_candidates: relationCandidates.sort((left, right) => {
        const leftSpan = evidenceSpan(left.evidence_local_ids, allEvidence);
        const rightSpan = evidenceSpan(right.evidence_local_ids, allEvidence);
        return (
          leftSpan.start_byte - rightSpan.start_byte ||
          left.kind.localeCompare(right.kind) ||
          sourceRefKey(left.source_local_ref).localeCompare(sourceRefKey(right.source_local_ref)) ||
          left.local_id.localeCompare(right.local_id)
        );
      }),
      evidence: allEvidence.sort((left, right) =>
        compareSpans(left.span, right.span) || left.local_id.localeCompare(right.local_id),
      ),
      diagnostics: allDiagnostics.sort(compareDiagnostics),
      coverage: {
        status: hasSyntaxErrors ? "partial" : "complete",
        definitions: hasSyntaxErrors ? "partial" : "complete",
        relation_candidates: candidateCapability
          ? hasSyntaxErrors
            ? "partial"
            : "complete"
          : "unsupported",
        error_count: allDiagnostics.filter((item) => item.severity === "error").length,
        unresolved_candidate_count: relationCandidates.length,
      },
    };
  }

  protected abstract collectDefinitions(rootNode: Parser.SyntaxNode): RawDefinition[];

  protected collectLanguageDiagnostics(
    _rootNode: Parser.SyntaxNode,
    _definitions: RawDefinition[],
    _input: SourceFileInput,
    _offsetMap: Utf8OffsetMap,
  ): Diagnostic[] {
    return [];
  }

  protected collectRelationCandidates(_context: DefinitionContext): RelationCandidate[] {
    return [];
  }

  protected candidateEvidence(
    _candidate: RelationCandidate,
    _input: SourceFileInput,
  ): EvidenceDraft[] {
    return [];
  }

  protected makeEvidence(input: SourceFileInput, span: ByteSpan, discriminator: unknown): EvidenceDraft {
    const local_id = canonicalHash({ type: "evidence", span, discriminator });
    return {
      local_id,
      file_path: input.relative_path,
      span,
      original_position_encoding: "utf8_bytes",
      source_digest: input.source_digest,
      adapter_id: this.manifest.id,
      adapter_version: this.manifest.version,
      grammar_digest: this.manifest.grammar.digest,
      query_digest: this.manifest.query_digest,
      config_digest: this.manifest.config_digest,
    };
  }

  private normalizeDefinitions(
    input: SourceFileInput,
    rawDefinitions: RawDefinition[],
    offsetMap: Utf8OffsetMap,
  ): { definitions: DefinitionDraft[]; evidence: EvidenceDraft[] } {
    const uniqueRaw = uniqueRawDefinitions(rawDefinitions);
    const ordered = uniqueRaw.sort(
      (left, right) =>
        left.node.startIndex - right.node.startIndex ||
        right.node.endIndex - left.node.endIndex ||
        left.kind.localeCompare(right.kind),
    );
    const definitions: DefinitionDraft[] = [];
    const evidence: EvidenceDraft[] = [];

    for (const raw of ordered) {
      const definitionSpan = offsetMap.span(raw.node);
      const nameSpan = offsetMap.span(raw.nameNode);
      if (!isValidSpan(definitionSpan, input.source_bytes.byteLength) || !isValidSpan(nameSpan, input.source_bytes.byteLength)) {
        continue;
      }
      const container = definitions
        .filter((candidate) => contains(candidate.definition_span, definitionSpan))
        .sort((left, right) =>
          (left.definition_span.end_byte - left.definition_span.start_byte) -
          (right.definition_span.end_byte - right.definition_span.start_byte),
        )[0];
      const name = decodeSpan(input.source_bytes, nameSpan).normalize("NFC");
      const qualified_name = container ? `${container.qualified_name}.${name}` : name;
      const local_id = canonicalHash({
        type: "definition",
        language: input.language,
        kind: raw.kind,
        name,
        qualified_name,
        definition_span: definitionSpan,
        config_digest: this.manifest.config_digest,
        query_digest: this.manifest.query_digest,
      });
      const definitionEvidence = this.makeEvidence(input, definitionSpan, {
        type: "definition",
        local_id,
      });
      evidence.push(definitionEvidence);
      definitions.push({
        local_id,
        container_local_id: container?.local_id ?? null,
        kind: raw.kind,
        language: input.language,
        name,
        qualified_name,
        name_span: nameSpan,
        definition_span: definitionSpan,
        content_hash: sha256Bytes(input.source_bytes.slice(definitionSpan.start_byte, definitionSpan.end_byte)),
        evidence_local_ids: [definitionEvidence.local_id],
      });
    }
    return { definitions, evidence };
  }
}

export function nearestDefinitionReference(
  definitions: DefinitionDraft[],
  span: ByteSpan,
): SubjectLocalRef {
  const definition = definitions
    .filter((candidate) =>
      candidate.definition_span.start_byte <= span.start_byte &&
      candidate.definition_span.end_byte >= span.end_byte,
    )
    .sort(
      (left, right) =>
        left.definition_span.end_byte - left.definition_span.start_byte -
        (right.definition_span.end_byte - right.definition_span.start_byte),
    )[0];
  return definition
    ? { kind: "definition", local_id: definition.local_id }
    : { kind: "source_file" };
}

export function nodeSpan(node: Parser.SyntaxNode, offsetMap: Utf8OffsetMap): ByteSpan {
  return offsetMap.span(node);
}

function createContainsRelations(
  input: SourceFileInput,
  definitions: DefinitionDraft[],
): ExactRelationDraft[] {
  return definitions.map((definition) => {
    const source_local_ref: SubjectLocalRef = definition.container_local_id
      ? { kind: "definition", local_id: definition.container_local_id }
      : { kind: "source_file" };
    return {
      local_id: canonicalHash({
        type: "exact_relation",
        kind: "CONTAINS",
        source: source_local_ref,
        target: definition.local_id,
        file: input.relative_path,
      }),
      kind: "CONTAINS",
      source_local_ref,
      target_local_id: definition.local_id,
      evidence_local_ids: definition.evidence_local_ids,
    };
  });
}

function collectSyntaxDiagnostics(
  rootNode: Parser.SyntaxNode,
  filePath: string,
  offsetMap: Utf8OffsetMap,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const visit = (node: Parser.SyntaxNode): void => {
    if (node.isError) {
      diagnostics.push({
        code: "syntax_error",
        severity: "error",
        file_path: filePath,
        span: offsetMap.span(node),
        message: "Tree-sitter recovered from invalid syntax",
      });
    }
    if (node.isMissing) {
      diagnostics.push({
        code: "missing_syntax",
        severity: "error",
        file_path: filePath,
        span: offsetMap.span(node),
        message: `Tree-sitter inserted missing ${node.type}`,
      });
    }
    for (const child of node.children) visit(child);
  };
  visit(rootNode);
  return diagnostics;
}

function createUtf8OffsetMap(sourceText: string): Utf8OffsetMap {
  const offsets = new Uint32Array(sourceText.length + 1);
  let byteOffset = 0;
  for (let index = 0; index < sourceText.length; ) {
    const codePoint = sourceText.codePointAt(index);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    const width = character.length;
    offsets[index] = byteOffset;
    if (width === 2) offsets[index + 1] = byteOffset;
    byteOffset += Buffer.byteLength(character, "utf8");
    index += width;
    offsets[index] = byteOffset;
  }
  return {
    byteOffset(characterIndex) {
      if (characterIndex < 0 || characterIndex >= offsets.length) {
        throw new RangeError(`Character index ${characterIndex} is outside source`);
      }
      return offsets[characterIndex] ?? byteOffset;
    },
    span(node) {
      return {
        start_byte: offsets[node.startIndex] ?? byteOffset,
        end_byte: offsets[node.endIndex] ?? byteOffset,
      };
    },
  };
}

function uniqueRawDefinitions(definitions: RawDefinition[]): RawDefinition[] {
  const seen = new Set<string>();
  return definitions.filter((definition) => {
    const key = canonicalJson({
      kind: definition.kind,
      definition: spanOf(definition.node),
      name: spanOf(definition.nameNode),
    });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueByLocalId<T extends { local_id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.local_id, item])).values()];
}

function isValidSpan(span: ByteSpan, byteLength: number): boolean {
  return (
    Number.isInteger(span.start_byte) &&
    Number.isInteger(span.end_byte) &&
    span.start_byte >= 0 &&
    span.end_byte >= span.start_byte &&
    span.end_byte <= byteLength
  );
}

function decodeSpan(bytes: Uint8Array, span: ByteSpan): string {
  return new TextDecoder().decode(bytes.slice(span.start_byte, span.end_byte));
}

function compareDefinitions(left: DefinitionDraft, right: DefinitionDraft): number {
  return (
    left.definition_span.start_byte - right.definition_span.start_byte ||
    left.kind.localeCompare(right.kind) ||
    left.qualified_name.localeCompare(right.qualified_name) ||
    left.local_id.localeCompare(right.local_id)
  );
}

function compareRelations(left: ExactRelationDraft, right: ExactRelationDraft): number {
  return (
    left.kind.localeCompare(right.kind) ||
    sourceRefKey(left.source_local_ref).localeCompare(sourceRefKey(right.source_local_ref)) ||
    left.target_local_id.localeCompare(right.target_local_id) ||
    left.local_id.localeCompare(right.local_id)
  );
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    (left.span?.start_byte ?? Number.MAX_SAFE_INTEGER) -
      (right.span?.start_byte ?? Number.MAX_SAFE_INTEGER) ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}

function evidenceSpan(localIds: string[], evidence: EvidenceDraft[]): ByteSpan {
  return evidence.find((item) => localIds.includes(item.local_id))?.span ?? {
    start_byte: Number.MAX_SAFE_INTEGER,
    end_byte: Number.MAX_SAFE_INTEGER,
  };
}
