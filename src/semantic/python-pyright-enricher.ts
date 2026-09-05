import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { canonicalHash } from "../contract/hash.js";
import type { ByteSpan, Diagnostic } from "../contract/types.js";
import type { CanonicalEvidence, CanonicalRelation } from "../canonicalization/types.js";
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

const PROFILE_ID = "python-pyright-preview";
const PROFILE_VERSION = "1";
const require = createRequire(import.meta.url);
const pyrightVersion = (require("pyright/package.json") as { version: string }).version;
const pyrightCli = require.resolve("pyright");

interface PyrightOutput {
  generalDiagnostics?: Array<{
    file: string;
    severity: "error" | "warning" | "information";
    message: string;
    rule?: string;
    range?: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  }>;
  summary?: { filesAnalyzed?: number; errorCount?: number; warningCount?: number };
}

export class PythonPyrightEnricher implements SemanticEnricher {
  enrich(input: SemanticEnrichmentInput): SemanticOverlay {
    const files = input.source.files.filter((file) => file.language === "python");
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "semantic-codebase-pyright-"));
    try {
      for (const file of files) {
        const target = path.join(temporaryRoot, ...file.relative_path.split("/"));
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, file.source_bytes);
      }
      writeFileSync(path.join(temporaryRoot, "pyrightconfig.json"), JSON.stringify({
        include: ["**/*.py"],
        pythonVersion: "3.12",
        typeCheckingMode: "basic",
        useLibraryCodeForTypes: true,
      }));
      const result = spawnSync(process.execPath, [pyrightCli, "--outputjson", "--project", temporaryRoot], {
        cwd: temporaryRoot,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      });
      const parsed = parsePyrightOutput(result.stdout);
      const diagnostics = mapDiagnostics(parsed, temporaryRoot, input);
      if (result.error || (!parsed && result.status !== 0)) {
        diagnostics.push({
          code: "pyright_execution_failed",
          severity: "error",
          file_path: "",
          message: result.error?.message ?? (result.stderr.trim() || "Pyright did not return JSON output"),
        });
      }
      return buildOverlay(input, files.length, parsed, diagnostics);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}

function buildOverlay(
  input: SemanticEnrichmentInput,
  fileCount: number,
  pyright: PyrightOutput | null,
  diagnostics: Diagnostic[],
): SemanticOverlay {
  const evidence = new Map<string, SemanticEvidence>();
  const facts: SemanticFact[] = [];
  const sourceByPath = new Map(input.source.files.map((file) => [file.relative_path, file]));
  const canonicalEvidence = new Map(input.state.graph.evidence.map((item) => [item.evidence_id, item]));
  const filesWithErrors = new Set(diagnostics.filter((item) => item.severity === "error").map((item) => item.file_path));

  const addEvidence = (item: CanonicalEvidence | { file_path: string; span: ByteSpan }): SemanticEvidence | null => {
    const file = sourceByPath.get(item.file_path);
    if (!file || item.span.end_byte <= item.span.start_byte) return null;
    const semantic: SemanticEvidence = {
      evidence_id: canonicalHash({
        type: "semantic_evidence",
        snapshot_id: input.state.snapshot_id,
        file_path: item.file_path,
        span: item.span,
        source_digest: file.source_digest,
        producer: `${PROFILE_ID}@${PROFILE_VERSION}`,
      }),
      file_path: item.file_path,
      span: item.span,
      source_digest: file.source_digest,
      producer: `${PROFILE_ID}@${PROFILE_VERSION}`,
    };
    evidence.set(semantic.evidence_id, semantic);
    return semantic;
  };
  const addFact = (
    kind: SemanticFactKind,
    subject: SemanticSubject,
    value: CanonicalValue,
    basis: ClaimBasis,
    evidenceIds: string[],
  ): SemanticFact => {
    const fact: SemanticFact = {
      fact_id: canonicalHash({ type: "semantic_fact", snapshot_id: input.state.snapshot_id, kind, subject, value, basis }),
      kind,
      subject,
      value,
      basis,
      evidence_ids: [...new Set(evidenceIds)].sort(),
    };
    facts.push(fact);
    return fact;
  };

  for (const definition of input.state.graph.definitions.filter((item) => item.language === "python")) {
    const file = sourceByPath.get(definition.file_path);
    const sourceEvidence = addEvidence({ file_path: definition.file_path, span: definition.name_span });
    if (!file || !sourceEvidence) continue;
    const declaration = Buffer.from(file.source_bytes)
      .subarray(definition.definition_span.start_byte, definition.definition_span.end_byte)
      .toString("utf8");
    const type = declaredPythonType(definition.kind, definition.qualified_name, declaration);
    const typeBasis: ClaimBasis = filesWithErrors.has(definition.file_path)
      ? { kind: "static_possible", rule_id: "pyright_declared_type_with_diagnostics", reason_codes: ["pyright_diagnostics"] }
      : type === "unknown"
        ? { kind: "static_possible", rule_id: "python_type_unknown", reason_codes: ["declaration_annotation_unavailable"] }
        : { kind: "compiler_exact", rule_id: "pyright_validated_declared_type" };
    addFact(
      "symbol_type",
      { kind: "definition", definition_key: definition.definition_key },
      { qualified_name: definition.qualified_name, type },
      typeBasis,
      [sourceEvidence.evidence_id],
    );
    if (definition.kind === "function" && definition.container_definition_key === null) {
      addFact(
        "entrypoint",
        { kind: "definition", definition_key: definition.definition_key },
        { entry_kind: "exported_api_candidate", qualified_name: definition.qualified_name },
        { kind: "static_possible", rule_id: "python_public_module_callable", reason_codes: ["python_exports_are_dynamic"] },
        [sourceEvidence.evidence_id],
      );
    }
  }

  for (const relation of input.state.graph.relations.filter((item) =>
    ["IMPORTS", "REFERENCES", "CALLS"].includes(item.kind) && relationTouchesPython(item, input),
  )) {
    const relationEvidence = relation.evidence_ids
      .map((id) => canonicalEvidence.get(id))
      .filter((item): item is CanonicalEvidence => Boolean(item))
      .map(addEvidence)
      .filter((item): item is SemanticEvidence => Boolean(item));
    if (relationEvidence.length === 0) continue;
    const kind = relation.kind === "IMPORTS"
      ? "import_target"
      : relation.kind === "REFERENCES" ? "reference_target" : "call_target";
    addFact(
      kind,
      relation.source,
      relationTargetValue(relation),
      relation.kind === "IMPORTS" && relation.target.kind === "source_file"
        ? { kind: "compiler_exact", rule_id: "pyright_validated_local_import" }
        : { kind: "static_possible", rule_id: "pyright_python_target", reason_codes: ["python_dynamic_dispatch"] },
      relationEvidence.map((item) => item.evidence_id),
    );
  }

  addPythonFlows(facts, evidence, input.state.snapshot_id, addFact);
  const reasonCodes = diagnostics.some((item) => item.severity === "error")
    ? ["pyright_semantic_diagnostics"]
    : pyright ? [] : ["pyright_unavailable"];
  return finalizeSemanticOverlay(input.state, input.source, {
    profile: { id: PROFILE_ID, version: PROFILE_VERSION, compiler_version: pyrightVersion },
    facts,
    evidence: [...evidence.values()],
    diagnostics,
    coverage: {
      status: reasonCodes.length > 0 ? "partial" : "complete",
      analyzed_files: pyright?.summary?.filesAnalyzed ?? fileCount,
      skipped_files: input.source.files.length - fileCount,
      reason_codes: reasonCodes,
    },
  });
}

function parsePyrightOutput(stdout: string): PyrightOutput | null {
  try {
    return JSON.parse(stdout) as PyrightOutput;
  } catch {
    return null;
  }
}

function mapDiagnostics(
  output: PyrightOutput | null,
  root: string,
  input: SemanticEnrichmentInput,
): Diagnostic[] {
  const sourceByPath = new Map(input.source.files.map((file) => [file.relative_path, file]));
  return (output?.generalDiagnostics ?? []).flatMap((item): Diagnostic[] => {
    const filePath = path.relative(root, item.file).split(path.sep).join("/");
    const file = sourceByPath.get(filePath);
    if (!file) return [];
    const text = Buffer.from(file.source_bytes).toString("utf8");
    return [{
      code: `pyright_${item.rule ?? "diagnostic"}`,
      severity: item.severity === "information" ? "info" : item.severity,
      file_path: filePath,
      ...(item.range ? { span: lspRangeToByteSpan(text, item.range) } : {}),
      message: item.message,
    }];
  });
}

function lspRangeToByteSpan(
  text: string,
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
): ByteSpan {
  const lines = text.split(/(?<=\n)/);
  const offset = (position: { line: number; character: number }) => {
    const prefix = lines.slice(0, position.line).join("") + (lines[position.line] ?? "").slice(0, position.character);
    return Buffer.byteLength(prefix);
  };
  const start = offset(range.start);
  return { start_byte: start, end_byte: Math.max(start + 1, offset(range.end)) };
}

function declaredPythonType(kind: string, qualifiedName: string, declaration: string): string {
  if (kind === "class") return `type[${qualifiedName}]`;
  const header = declaration.split("\n", 1)[0] ?? declaration;
  const match = header.match(/(?:async\s+)?def\s+[^\s(]+\s*(\([^)]*\))\s*(?:->\s*([^:]+))?/);
  if (!match) return "unknown";
  return `${match[1]} -> ${(match[2] ?? "Any").trim()}`;
}

function relationTouchesPython(relation: CanonicalRelation, input: SemanticEnrichmentInput): boolean {
  const source = relation.source;
  if (source.kind === "source_file") {
    return input.state.graph.source_files.some((file) => file.relative_path === source.file_path && file.language === "python");
  }
  return input.state.graph.definitions.some((definition) =>
    definition.definition_key === source.definition_key && definition.language === "python",
  );
}

function relationTargetValue(relation: CanonicalRelation): CanonicalValue {
  return relation.target.kind === "source_file"
    ? { target_kind: "source_file", target_file_path: relation.target.file_path }
    : { target_kind: "definition", target_definition_key: relation.target.definition_key };
}

function addPythonFlows(
  facts: SemanticFact[],
  evidence: Map<string, SemanticEvidence>,
  snapshotId: string,
  addFact: (
    kind: SemanticFactKind,
    subject: SemanticSubject,
    value: CanonicalValue,
    basis: ClaimBasis,
    evidenceIds: string[],
  ) => SemanticFact,
): void {
  for (const entry of facts.filter((fact) => fact.kind === "entrypoint" && fact.subject.kind === "definition")) {
    if (entry.subject.kind !== "definition") continue;
    const entryDefinitionKey = entry.subject.definition_key;
    const calls = facts.filter((fact) =>
      fact.kind === "call_target" && fact.subject.kind === "definition" &&
      fact.subject.definition_key === entryDefinitionKey,
    );
    addFact(
      "application_flow",
      entry.subject,
      { entry_definition_key: entryDefinitionKey, snapshot_id: snapshotId, steps: calls.map((fact) => ({ kind: fact.kind, value: fact.value })), truncated: false },
      { kind: "static_possible", rule_id: "python_source_order_flow", reason_codes: ["not_path_sensitive", "python_dynamic_dispatch"] },
      [...new Set([entry, ...calls].flatMap((fact) => fact.evidence_ids))].filter((id) => evidence.has(id)),
    );
  }
}
