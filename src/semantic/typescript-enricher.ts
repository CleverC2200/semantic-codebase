import path from "node:path";

import { version as typescriptVersion } from "typescript";
import {
  API as TypeScriptApi,
  DiagnosticCategory,
  type Checker,
  type Diagnostic as TypeScriptDiagnostic,
  type Program,
} from "typescript/unstable/sync";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import * as ast from "typescript/unstable/ast";
import type { Node, SourceFile } from "typescript/unstable/ast";

import { canonicalHash } from "../contract/hash.js";
import type { ByteSpan, Diagnostic } from "../contract/types.js";
import type { CanonicalDefinition } from "../canonicalization/types.js";
import type { RepositorySourceFile } from "../indexing/types.js";
import { finalizeSemanticOverlay } from "./overlay.js";
import type {
  CanonicalValue,
  ClaimBasis,
  SemanticEnricher,
  SemanticEnrichmentInput,
  SemanticEvidence,
  SemanticFact,
  SemanticFactKind,
  SemanticOverlay,
  SemanticSubject,
} from "./types.js";

const PROFILE_ID = "typescript-compiler-preview" as const;
const PROFILE_VERSION = "1" as const;
const VIRTUAL_ROOT = path.resolve("/__semantic_codebase__");

interface SourceContext {
  file: RepositorySourceFile;
  sourceFile: SourceFile;
  text: string;
  byteAt: Uint32Array;
  definitions: CanonicalDefinition[];
  definitionNodes: Map<string, Node>;
}

export class TypeScriptSemanticEnricher implements SemanticEnricher {
  enrich(input: SemanticEnrichmentInput): SemanticOverlay {
    const files = input.source.files.filter((file) => file.language === "typescript");
    const analysis = createAnalysis(files);
    const { program, checker } = analysis;
    try {
      const contexts = buildSourceContexts(input, program, files);
      const contextByFile = new Map(contexts.map((context) => [context.file.relative_path, context]));
      const evidence = new Map<string, SemanticEvidence>();
      const facts: SemanticFact[] = [];

      const addEvidence = (context: SourceContext, span: ByteSpan): SemanticEvidence => {
      const item: SemanticEvidence = {
        evidence_id: canonicalHash({
          type: "semantic_evidence",
          snapshot_id: input.state.snapshot_id,
          file_path: context.file.relative_path,
          span,
          source_digest: context.file.source_digest,
          producer: `${PROFILE_ID}@${PROFILE_VERSION}`,
        }),
        file_path: context.file.relative_path,
        span,
        source_digest: context.file.source_digest,
        producer: `${PROFILE_ID}@${PROFILE_VERSION}`,
      };
      evidence.set(item.evidence_id, item);
      return item;
      };

      const addFact = (
      kind: SemanticFactKind,
      subject: SemanticSubject,
      value: CanonicalValue,
      basis: ClaimBasis,
      evidenceIds: string[],
    ): SemanticFact => {
      const fact: SemanticFact = {
        fact_id: canonicalHash({
          type: "semantic_fact",
          snapshot_id: input.state.snapshot_id,
          kind,
          subject,
          value,
          basis,
        }),
        kind,
        subject,
        value,
        basis,
        evidence_ids: [...new Set(evidenceIds)].sort(),
      };
      facts.push(fact);
      return fact;
      };

      for (const context of contexts) {
        addDefinitionFacts(context, checker, addEvidence, addFact);
        visitSource(context, checker, contextByFile, addEvidence, addFact);
      }
      addApplicationFlows(facts, evidence, input.state.snapshot_id, addFact);

      const diagnostics = compilerDiagnostics(program, contextByFile);
      const reasonCodes = diagnostics.some((item) => item.severity === "error")
        ? ["typescript_semantic_diagnostics"]
        : [];
      return finalizeSemanticOverlay(input.state, input.source, {
        profile: {
          id: PROFILE_ID,
          version: PROFILE_VERSION,
          compiler_version: typescriptVersion,
        },
        facts,
        evidence: [...evidence.values()],
        diagnostics,
        coverage: {
          status: reasonCodes.length > 0 ? "partial" : "complete",
          analyzed_files: files.length,
          skipped_files: input.source.files.length - files.length,
          reason_codes: reasonCodes,
        },
      });
    } finally {
      analysis.api.close();
    }
  }
}

function addDefinitionFacts(
  context: SourceContext,
  checker: Checker,
  addEvidence: (context: SourceContext, span: ByteSpan) => SemanticEvidence,
  addFact: FactAdder,
): void {
  for (const definition of context.definitions) {
    const node = context.definitionNodes.get(definition.definition_key);
    if (!node) continue;
    const evidence = addEvidence(context, definition.name_span);
    const type = checker.getTypeAtLocation(node);
    if (!type) continue;
    const typeText = limitText(checker.typeToString(type, node), 500);
    addFact(
      "symbol_type",
      { kind: "definition", definition_key: definition.definition_key },
      { qualified_name: definition.qualified_name, type: typeText || "unknown" },
      { kind: "compiler_exact", rule_id: "typescript_checker_type_at_definition" },
      [evidence.evidence_id],
    );
    if (isExportedDefinition(node) && ["function", "method"].includes(definition.kind)) {
      addFact(
        "entrypoint",
        { kind: "definition", definition_key: definition.definition_key },
        { entry_kind: "exported_api", qualified_name: definition.qualified_name },
        { kind: "compiler_exact", rule_id: "typescript_exported_callable" },
        [evidence.evidence_id],
      );
    }
  }
}

function visitSource(
  context: SourceContext,
  checker: Checker,
  contextByFile: Map<string, SourceContext>,
  addEvidence: (context: SourceContext, span: ByteSpan) => SemanticEvidence,
  addFact: FactAdder,
): void {
  const visit = (node: Node): void => {
    const span = spanForNode(context, node);
    const subject = subjectFor(context, span.start_byte);
    if (ast.isCallExpression(node) || ast.isNewExpression(node)) {
      const evidence = addEvidence(context, span);
      const signature = checker.getResolvedSignature(node);
      const target = signature ? definitionForDeclaration(signature.declaration?.resolve(), contextByFile) : null;
      const expression = node.expression;
      const callText = limitText(expression.getText(context.sourceFile), 180);
      if (target) {
        addFact(
          "call_target",
          subject,
          {
            call: callText,
            target_definition_key: target.definition_key,
            target_qualified_name: target.qualified_name,
          },
          { kind: "compiler_exact", rule_id: "typescript_resolved_signature" },
          [evidence.evidence_id],
        );
      } else {
        addFact(
          "call_target",
          subject,
          { call: callText, target_definition_key: null },
          {
            kind: "static_possible",
            rule_id: "typescript_unresolved_signature",
            reason_codes: [signature ? "target_outside_snapshot" : "signature_unresolved"],
          },
          [evidence.evidence_id],
        );
      }
      const effect = effectForCall(callText);
      if (effect) {
        addFact(
          "effect",
          subject,
          { effect_kind: effect, operation: callText },
          { kind: "framework_heuristic", rule_id: "preview_library_effect_model" },
          [evidence.evidence_id],
        );
      }
    }

    const control = controlKind(node);
    if (control) {
      const evidence = addEvidence(context, span);
      addFact(
        "control_step",
        subject,
        { step_kind: control },
        { kind: "compiler_exact", rule_id: "typescript_ast_control_step" },
        [evidence.evidence_id],
      );
      if (control === "return" || control === "throw") {
        addFact(
          "effect",
          subject,
          { effect_kind: control },
          { kind: "compiler_exact", rule_id: "typescript_control_effect" },
          [evidence.evidence_id],
        );
      }
    }

    if (ast.isBinaryExpression(node) && ast.isAssignmentOperator(node.operatorToken.kind)) {
      const evidence = addEvidence(context, span);
      addFact(
        "effect",
        subject,
        { effect_kind: "state", operation: limitText(node.left.getText(context.sourceFile), 180) },
        { kind: "compiler_exact", rule_id: "typescript_assignment_effect" },
        [evidence.evidence_id],
      );
    }
    node.forEachChild((child) => visit(child));
  };
  visit(context.sourceFile);
}

function addApplicationFlows(
  facts: SemanticFact[],
  evidence: Map<string, SemanticEvidence>,
  snapshotId: string,
  addFact: FactAdder,
): void {
  const entries = facts.filter((fact) => fact.kind === "entrypoint" && fact.subject.kind === "definition");
  const stepsBySubject = new Map<string, SemanticFact[]>();
  for (const fact of facts) {
    if (fact.subject.kind !== "definition" || !["call_target", "control_step", "effect"].includes(fact.kind)) {
      continue;
    }
    const items = stepsBySubject.get(fact.subject.definition_key) ?? [];
    items.push(fact);
    stepsBySubject.set(fact.subject.definition_key, items);
  }
  for (const entry of entries) {
    if (entry.subject.kind !== "definition") continue;
    const steps = (stepsBySubject.get(entry.subject.definition_key) ?? [])
      .sort((left, right) => evidenceStart(left, evidence) - evidenceStart(right, evidence) || left.fact_id.localeCompare(right.fact_id))
      .slice(0, 80);
    const evidenceIds = [...new Set([entry, ...steps].flatMap((fact) => fact.evidence_ids))];
    addFact(
      "application_flow",
      entry.subject,
      {
        entry_definition_key: entry.subject.definition_key,
        snapshot_id: snapshotId,
        steps: steps.map((step) => ({ kind: step.kind, value: step.value })),
        truncated: (stepsBySubject.get(entry.subject.definition_key)?.length ?? 0) > steps.length,
      },
      {
        kind: "static_possible",
        rule_id: "preview_source_order_flow",
        reason_codes: ["not_path_sensitive", "interprocedural_expansion_pending"],
      },
      evidenceIds,
    );
  }
}

type FactAdder = (
  kind: SemanticFactKind,
  subject: SemanticSubject,
  value: CanonicalValue,
  basis: ClaimBasis,
  evidenceIds: string[],
) => SemanticFact;

function createAnalysis(files: RepositorySourceFile[]): {
  api: TypeScriptApi;
  program: Program;
  checker: Checker;
} {
  const configPath = path.join(VIRTUAL_ROOT, "tsconfig.json");
  const virtualFiles = Object.fromEntries(files.map((file) => [
    virtualPath(file.relative_path),
    decode(file.source_bytes),
  ]));
  virtualFiles[configPath] = JSON.stringify({
    compilerOptions: {
      target: "ES2023",
      module: "ESNext",
      moduleResolution: "Bundler",
      allowJs: true,
      checkJs: false,
      skipLibCheck: true,
      noEmit: true,
    },
    files: files.map((file) => file.relative_path),
  });
  const virtualFs = createVirtualFileSystem(virtualFiles);
  const api = new TypeScriptApi({
    cwd: VIRTUAL_ROOT,
    fs: {
      readFile: (fileName) => virtualFs.fileExists?.(fileName)
        ? virtualFs.readFile?.(fileName)
        : insideVirtualRoot(fileName) ? null : undefined,
      fileExists: (fileName) => virtualFs.fileExists?.(fileName)
        ? true
        : insideVirtualRoot(fileName) ? false : undefined,
      directoryExists: (directoryName) => virtualFs.directoryExists?.(directoryName)
        ? true
        : insideVirtualRoot(directoryName) ? false : undefined,
      getAccessibleEntries: (directoryName) => virtualFs.directoryExists?.(directoryName)
        ? virtualFs.getAccessibleEntries?.(directoryName)
        : insideVirtualRoot(directoryName) ? { files: [], directories: [] } : undefined,
      realpath: (fileName) => insideVirtualRoot(fileName) ? fileName : undefined,
    },
  });
  const snapshot = api.updateSnapshot({ openProjects: [configPath] });
  const project = snapshot.getProjects()[0];
  if (!project) {
    api.close();
    throw new Error("TypeScript Compiler did not create a project for the frozen Snapshot");
  }
  return { api, program: project.program, checker: project.checker };
}

function buildSourceContexts(
  input: SemanticEnrichmentInput,
  program: Program,
  files: RepositorySourceFile[],
): SourceContext[] {
  return files.flatMap((file) => {
    const sourceFile = program.getSourceFile(virtualPath(file.relative_path));
    if (!sourceFile) return [];
    const text = decode(file.source_bytes);
    const context: SourceContext = {
      file,
      sourceFile,
      text,
      byteAt: utf8ByteOffsets(text),
      definitions: input.state.graph.definitions.filter((definition) => definition.file_path === file.relative_path),
      definitionNodes: new Map(),
    };
    const nodesBySpan = new Map<string, Node[]>();
    const collect = (node: Node): void => {
      if (ast.isIdentifier(node) || ast.isStringLiteralLikeNode(node)) {
        const span = spanForNode(context, node);
        const key = `${span.start_byte}:${span.end_byte}`;
        const items = nodesBySpan.get(key) ?? [];
        items.push(node);
        nodesBySpan.set(key, items);
      }
      node.forEachChild((child) => collect(child));
    };
    collect(sourceFile);
    for (const definition of context.definitions) {
      const key = `${definition.name_span.start_byte}:${definition.name_span.end_byte}`;
      const node = nodesBySpan.get(key)?.find((candidate) => candidate.getText(sourceFile).replace(/^['"]|['"]$/g, "") === definition.name);
      if (node) context.definitionNodes.set(definition.definition_key, node);
    }
    return [context];
  });
}

function definitionForDeclaration(
  declaration: Node | undefined,
  contexts: Map<string, SourceContext>,
): CanonicalDefinition | null {
  if (!declaration) return null;
  const context = contexts.get(relativePath(declaration.getSourceFile().fileName));
  if (!context) return null;
  let current: Node | undefined = declaration;
  while (current && !ast.isSourceFile(current)) {
    const named = current as Node & { readonly name?: Node };
    if (named.name && (ast.isIdentifier(named.name) || ast.isStringLiteralLikeNode(named.name))) {
      const span = spanForNode(context, named.name);
      const found = context.definitions.find((definition) =>
        definition.name_span.start_byte === span.start_byte && definition.name_span.end_byte === span.end_byte,
      );
      if (found) return found;
    }
    current = current.parent;
  }
  return null;
}

function compilerDiagnostics(program: Program, contexts: Map<string, SourceContext>): Diagnostic[] {
  const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]
    .filter((diagnostic) => diagnostic.fileName && contexts.has(relativePath(diagnostic.fileName)));
  const mapped = diagnostics.slice(0, 200).map((diagnostic: TypeScriptDiagnostic): Diagnostic => {
    const context = contexts.get(relativePath(diagnostic.fileName!))!;
    const start = diagnostic.pos;
    const end = diagnostic.end;
    return {
      code: `typescript_${diagnostic.code}`,
      severity: diagnostic.category === DiagnosticCategory.Error ? "error" : "warning",
      file_path: context.file.relative_path,
      ...(start >= 0 && end > start
        ? { span: { start_byte: context.byteAt[start]!, end_byte: context.byteAt[end]! } }
        : {}),
      message: diagnostic.text,
    };
  });
  if (diagnostics.length > mapped.length) {
    mapped.push({
      code: "typescript_diagnostics_truncated",
      severity: "warning",
      file_path: "",
      message: `${diagnostics.length - mapped.length} additional TypeScript diagnostics omitted`,
    });
  }
  return mapped;
}

function subjectFor(context: SourceContext, byteOffset: number): SemanticSubject {
  const definition = context.definitions
    .filter((candidate) =>
      candidate.definition_span.start_byte <= byteOffset && byteOffset < candidate.definition_span.end_byte,
    )
    .sort((left, right) =>
      (left.definition_span.end_byte - left.definition_span.start_byte) -
      (right.definition_span.end_byte - right.definition_span.start_byte),
    )[0];
  return definition
    ? { kind: "definition", definition_key: definition.definition_key }
    : { kind: "source_file", file_path: context.file.relative_path };
}

function controlKind(node: Node): string | null {
  if (ast.isIfStatement(node) || ast.isConditionalExpression(node) || ast.isSwitchStatement(node)) return "branch";
  if (ast.isForStatement(node) || ast.isForInStatement(node) || ast.isForOfStatement(node) || ast.isWhileStatement(node) || ast.isDoStatement(node)) return "loop";
  if (ast.isReturnStatement(node)) return "return";
  if (ast.isThrowStatement(node)) return "throw";
  if (ast.isAwaitExpression(node)) return "await";
  if (ast.isYieldExpression(node)) return "yield";
  return null;
}

function effectForCall(callText: string): "file" | "database" | "network" | "event" | null {
  if (/^(?:fetch|axios\.|http\.|https\.)/.test(callText)) return "network";
  if (/^(?:fs\.|readFile|writeFile|open)/.test(callText)) return "file";
  if (/(?:\.query|\.execute|prisma\.|sequelize\.|knex\()/.test(callText)) return "database";
  if (/^(?:console\.|emit\(|publish\(|dispatch\()/.test(callText)) return "event";
  return null;
}

function isExportedDefinition(node: Node): boolean {
  let current: Node | undefined = node;
  while (current && !ast.isSourceFile(current)) {
    if (/^export\b/.test(current.getText(current.getSourceFile()).trimStart())) return true;
    current = current.parent;
  }
  return false;
}

function evidenceStart(fact: SemanticFact, evidence: Map<string, SemanticEvidence>): number {
  return Math.min(...fact.evidence_ids.map((id) => evidence.get(id)?.span.start_byte ?? Number.MAX_SAFE_INTEGER));
}

function spanForNode(context: SourceContext, node: Node): ByteSpan {
  const start = node.getStart(context.sourceFile);
  const end = node.getEnd();
  return { start_byte: context.byteAt[start]!, end_byte: context.byteAt[end]! };
}

function utf8ByteOffsets(text: string): Uint32Array {
  const result = new Uint32Array(text.length + 1);
  let charIndex = 0;
  let byteIndex = 0;
  while (charIndex < text.length) {
    result[charIndex] = byteIndex;
    const codePoint = text.codePointAt(charIndex)!;
    const charWidth = codePoint > 0xffff ? 2 : 1;
    if (charWidth === 2) result[charIndex + 1] = byteIndex;
    byteIndex += Buffer.byteLength(String.fromCodePoint(codePoint));
    charIndex += charWidth;
    result[charIndex] = byteIndex;
  }
  return result;
}

function virtualPath(relativePathValue: string): string {
  return normalizePath(path.join(VIRTUAL_ROOT, ...relativePathValue.split("/")));
}

function relativePath(fileName: string): string {
  return path.relative(VIRTUAL_ROOT, normalizePath(fileName)).split(path.sep).join("/");
}

function normalizePath(value: string): string {
  return path.normalize(value);
}

function insideVirtualRoot(value: string): boolean {
  const normalized = normalizePath(value);
  return normalized === VIRTUAL_ROOT || normalized.startsWith(`${VIRTUAL_ROOT}${path.sep}`);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function limitText(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
