import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalHash } from "../contract/hash.js";
import type { ByteSpan, Diagnostic } from "../contract/types.js";
import type { CanonicalEvidence, CanonicalRelation } from "../canonicalization/types.js";
import { finalizeSemanticOverlay, validateSemanticInput } from "./overlay.js";
import { pythonControlFlows } from "./python-control-flow.js";
import { pythonEntrypoints, pythonCallQueries } from "./python-entrypoints.js";
import { composeApplicationFlows } from "./application-flow.js";
import { deriveCallDataFlows } from "./call-data-flow.js";
import { pythonConfiguration } from "./python-configuration.js";
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
export const PYTHON_SEMANTIC_VERSION = "10";
const PROFILE_VERSION = PYTHON_SEMANTIC_VERSION;
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

interface TypeServiceResult { results: { key: string; hover: { contents?: { value?: string } } | null; definitions: { file_path: string; stdlib?: { module: string; owner: string; name: string } | null; range: { start: { line: number; character: number }; end: { line: number; character: number } } }[] }[]; truncated: boolean }

export class PythonPyrightEnricher implements SemanticEnricher {
  enrich(input: SemanticEnrichmentInput): SemanticOverlay {
    const files = input.source.files.filter((file) => file.language === "python");
    validateSemanticInput(input.state, input.source);
    const configuration = pythonConfiguration(input.source);
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "semantic-codebase-pyright-"));
    try {
      for (const file of [...files, ...(input.source.configuration_files ?? []).filter((file) => file.relative_path.endsWith(".pyi"))]) {
        const target = path.join(temporaryRoot, ...file.relative_path.split("/"));
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, file.source_bytes);
      }
      writeFileSync(path.join(temporaryRoot, "pyrightconfig.json"), JSON.stringify(configuration));
      const pythonPath = path.join(temporaryRoot, ".snapshot-no-host-interpreter");
      const result = spawnSync(process.execPath, [pyrightCli, "--outputjson", "--project", temporaryRoot, "--pythonpath", pythonPath], {
        cwd: temporaryRoot,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        timeout: 25000,
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
      const queries = input.state.graph.definitions.filter((item) => item.language === "python").map((item) => {
        const bytes = files.find((file) => file.relative_path === item.file_path)!.source_bytes;
        const prefix = Buffer.from(bytes).subarray(0, item.name_span.start_byte).toString("utf8");
        const lines = prefix.split("\n");
        return { key: item.definition_key, file: path.join(temporaryRoot, item.file_path), position: { line: lines.length - 1, character: lines.at(-1)!.length } };
      });
      const callEvidence = new Set(input.state.graph.relations.filter((item) => item.kind === "CALLS").flatMap((item) => item.evidence_ids));
      for (const file of files) for (const query of pythonCallQueries(Buffer.from(file.source_bytes).toString("utf8"))) {
        queries.push({ key: canonicalHash({ type: "pyright_call_query", file_path: file.relative_path, span: query.span }),
          file: path.join(temporaryRoot, file.relative_path), position: query.position });
      }
      for (const item of input.state.graph.evidence.filter((item) => callEvidence.has(item.evidence_id))) {
        const file = files.find((file) => file.relative_path === item.file_path);
        if (!file) continue;
        const text = Buffer.from(file.source_bytes).subarray(item.span.start_byte, item.span.end_byte).toString("utf8");
        const match = /^\s*(?:[A-Za-z_]\w*\.)*([A-Za-z_]\w*)(?:\s*\(|\s*$)/.exec(text);
        if (!match) continue;
        const nameIndex = match[0].lastIndexOf(match[1]!);
        const prefix = Buffer.from(file.source_bytes).subarray(0, item.span.start_byte).toString("utf8") + text.slice(0, nameIndex);
        const lines = prefix.split("\n");
        queries.push({ key: item.evidence_id, file: path.join(temporaryRoot, item.file_path), position: { line: lines.length - 1, character: lines.at(-1)!.length } });
      }
      const service = spawnSync(process.execPath, [fileURLToPath(new URL("../../scripts/pyright-semantic-worker.mjs", import.meta.url))], {
        input: JSON.stringify({ root: temporaryRoot, server: path.join(path.dirname(pyrightCli), "langserver.index.js"), queries, pythonPath }),
        encoding: "utf8", timeout: 25000, maxBuffer: 8 * 1024 * 1024,
      });
      let types: TypeServiceResult = { results: [], truncated: true };
      if (service.status === 0) {
        try { types = JSON.parse(service.stdout) as TypeServiceResult; } catch { /* reported below */ }
      }
      if (types.truncated) diagnostics.push({ code: "pyright_type_service_partial", severity: "warning", file_path: "", message: "Type service unavailable or query budget reached" });
      return buildOverlay(input, files.length, parsed, diagnostics, types);
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
  types: TypeServiceResult,
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
    const fullText = Buffer.from(file.source_bytes).toString("utf8");
    const factories = [...fullText.matchAll(/^from fastapi import FastAPI(?: as (\w+))?\s*$/gm)].map((match) => match[1] ?? "FastAPI");
    const apps = [...fullText.matchAll(/^(\w+)\s*=\s*(\w+)\s*\(/gm)].filter((match) => factories.includes(match[2]!)).map((match) => match[1]!);
    for (const route of declaration.matchAll(/^@(\w+)\.(get|post|put|patch|delete|options|head)\(["']([^"']+)["']/gm)) {
      if (definition.kind !== "function" || !apps.includes(route[1]!)) continue;
      addFact("entrypoint", { kind: "definition", definition_key: definition.definition_key },
        { entry_kind: "http_route", framework: "fastapi", method: route[2]!.toUpperCase(), route: route[3]!, qualified_name: definition.qualified_name },
        { kind: "framework_heuristic", rule_id: "fastapi_imported_factory_decorator_v1" }, [addEvidence({ file_path: definition.file_path, span: definition.definition_span })!.evidence_id]);
    }
    const hover = types.results.find((item) => item.key === definition.definition_key)?.hover?.contents?.value;
    const type = hover?.replace(/^```python\s*|\s*```$/g, "").trim() || declaredPythonType(definition.kind, definition.qualified_name, declaration);
    const typeBasis: ClaimBasis = filesWithErrors.has(definition.file_path)
      ? { kind: "static_possible", rule_id: "pyright_declared_type_with_diagnostics", reason_codes: ["pyright_diagnostics"] }
      : type === "unknown"
        ? { kind: "static_possible", rule_id: "python_type_unknown", reason_codes: ["declaration_annotation_unavailable"] }
        : hover ? { kind: "compiler_exact", rule_id: "pyright_language_server_hover" }
          : { kind: "static_possible", rule_id: "python_declared_type_fallback", reason_codes: ["type_service_result_unavailable"] };
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

  for (const file of input.source.files.filter((item) => item.language === "python")) {
    for (const registration of pythonEntrypoints(Buffer.from(file.source_bytes).toString("utf8"))) {
      const definition = input.state.graph.definitions.find((item) => item.file_path === file.relative_path &&
        item.kind === "function" && item.container_definition_key === null && item.name === registration.name);
      if (!definition) continue;
      const evidence = addEvidence({ file_path: file.relative_path, span: registration.span });
      if (evidence) addFact("entrypoint", { kind: "definition", definition_key: definition.definition_key },
        { entry_kind: registration.entry_kind, qualified_name: definition.qualified_name },
        { kind: "framework_heuristic", rule_id: registration.rule_id }, [evidence.evidence_id]);
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
    for (const id of relation.evidence_ids) {
      const bindings = types.results.find((item) => item.key === id)?.definitions ?? [];
      if (bindings.length !== 1) continue;
      const binding = bindings[0]!;
      const file = sourceByPath.get(binding.file_path);
      if (!file) continue;
      const span = lspRangeToByteSpan(Buffer.from(file.source_bytes).toString("utf8"), binding.range);
      const target = input.state.graph.definitions.find((item) => item.file_path === binding.file_path && item.name_span.start_byte === span.start_byte);
      if (!target) continue;
      const targetEvidence = addEvidence({ file_path: binding.file_path, span });
      if (targetEvidence) addFact("reference_target", relation.source,
        { target_definition_key: target.definition_key, binding_source: "pyright_definition", source_evidence_id: relationEvidence[0]!.evidence_id },
        { kind: "compiler_exact", rule_id: "pyright_language_server_definition" },
        [...relationEvidence.map((item) => item.evidence_id), targetEvidence.evidence_id]);
    }
    const kind = relation.kind === "IMPORTS"
      ? "import_target"
      : relation.kind === "REFERENCES" ? "reference_target" : "call_target";
    addFact(
      kind,
      relation.source,
      relationTargetValue(relation),
      relation.kind === "IMPORTS" && relation.target.kind === "source_file"
        ? { kind: "static_possible", rule_id: "python_structural_import", reason_codes: ["language_server_binding_pending"] }
        : { kind: "static_possible", rule_id: "pyright_python_target", reason_codes: ["python_dynamic_dispatch"] },
      relationEvidence.map((item) => item.evidence_id),
    );
  }

  for (const file of input.source.files.filter((item) => item.language === "python")) {
    for (const flow of pythonControlFlows(Buffer.from(file.source_bytes).toString("utf8"), (span) => addEvidence({ file_path: file.relative_path, span })!.evidence_id)) {
      const definition = input.state.graph.definitions.find((item) => item.file_path === file.relative_path && item.name_span.start_byte === flow.name_span.start_byte);
      if (!definition) continue;
      addFact("control_flow", { kind: "definition", definition_key: definition.definition_key }, flow.graph,
        { kind: "static_possible", rule_id: "python_statement_cfg_v1", reason_codes: flow.graph.unknowns }, flow.graph.blocks.map((item) => item.evidence_id));
      for (const write of flow.state_writes) addFact("effect", { kind: "definition", definition_key: definition.definition_key },
        { effect_kind: "state", operation: write.operation, scope: write.scope },
        { kind: "static_possible", rule_id: "python_heap_assignment_v1", reason_codes: ["python_descriptor_dispatch_unknown"] }, [write.evidence_id]);
      addFact("data_flow", { kind: "definition", definition_key: definition.definition_key }, { ...flow.data, accesses: flow.data.accesses.map((item) => ({ ...item })) },
        { kind: "static_possible", rule_id: "python_local_reaching_definitions_v1", reason_codes: flow.data.unknowns },
        [...flow.graph.blocks.map((item) => item.evidence_id), ...flow.data.accesses.flatMap((item) => [item.evidence_id, item.symbol]), ...flow.data.parameter_defaults.map((item) => item.evidence_id)]);
      for (const block of flow.graph.blocks.filter((item) => ["return", "throw"].includes(item.kind))) {
        addFact("effect", { kind: "definition", definition_key: definition.definition_key }, { effect_kind: block.kind, source_evidence_id: block.evidence_id },
          { kind: "static_possible", rule_id: "python_control_effect_v1", reason_codes: ["python_dynamic_dispatch"] }, [block.evidence_id]);
      }
      const oldCalls = facts.filter((fact) => fact.kind === "call_target" && fact.subject.kind === "definition" && fact.subject.definition_key === definition.definition_key);
      const bindings = facts.filter((fact) => fact.kind === "reference_target" && fact.subject.kind === "definition" && fact.subject.definition_key === definition.definition_key);
      for (const old of oldCalls) facts.splice(facts.indexOf(old), 1);
      for (const call of flow.calls) {
        const serviceBindings = types.results.find((item) => item.key === canonicalHash({ type: "pyright_call_query", file_path: file.relative_path, span: call.function_span }))?.definitions ?? [];
        const identities = serviceBindings.map((binding) => binding.stdlib);
        const library = identities[0];
        if (library && identities.every((identity) => identity && canonicalHash(identity) === canonicalHash(library))) {
          const collection = library.module === "builtins" && (
            library.owner === "list" && /^(append|extend|insert|pop|remove|clear|reverse|sort)$/.test(library.name) ||
            library.owner === "dict" && /^(update|setdefault|pop|popitem|clear)$/.test(library.name)) ||
            library.module === "typing" && library.owner === "MutableMapping" && /^(update|setdefault|pop|popitem|clear)$/.test(library.name);
          const processEffect = library.module === "subprocess" && /^(run|call|check_call|check_output|Popen)$/.test(library.name);
          const fileEffect = library.module === "pathlib" && /^(write_text|write_bytes|unlink|mkdir|rename|replace|touch|rmdir)$/.test(library.name);
          const databaseEffect = ["sqlite3", "sqlite3.dbapi2"].includes(library.module) && /^(connect|execute|executemany|executescript|commit|rollback)$/.test(library.name);
          const networkEffect = library.module === "urllib.request" && /^(urlopen|urlretrieve)$/.test(library.name) ||
            library.module === "http.client" && /^(request|connect|send)$/.test(library.name);
          if ((!call.receiver_local_fresh && collection) || processEffect || fileEffect || databaseEffect || networkEffect) addFact("effect", { kind: "definition", definition_key: definition.definition_key },
            { effect_kind: collection ? "state" : processEffect ? "process" : databaseEffect ? "database" : networkEffect ? "network" : "file", operation: call.call,
              library_module: library.module, library_owner: library.owner, ...(collection ? { mutation_kind: library.owner } : {}) },
            { kind: "static_possible", rule_id: "python_typeshed_library_effect_v1", reason_codes: ["python_runtime_override_not_excluded"] },
            [call.call_site_evidence_id, ...call.argument_evidence_ids]);
        }
        let directTarget: string | null = null;
        const directEvidence: string[] = [];
        if (serviceBindings.length === 1) {
          const binding = serviceBindings[0]!;
          const targetSource = sourceByPath.get(binding.file_path);
          if (targetSource) {
            const targetSpan = lspRangeToByteSpan(Buffer.from(targetSource.source_bytes).toString("utf8"), binding.range);
            directTarget = input.state.graph.definitions.find((item) => item.file_path === binding.file_path && item.name_span.start_byte === targetSpan.start_byte)?.definition_key ?? null;
            if (directTarget) directEvidence.push(addEvidence({ file_path: binding.file_path, span: targetSpan })!.evidence_id);
          }
        }
        const bound = [...bindings, ...oldCalls].find((fact) => fact.evidence_ids.some((id) => {
          const item = evidence.get(id);
          return item?.file_path === file.relative_path && item.span.end_byte === call.function_span.end_byte;
        }));
        const target = directTarget ?? (bound?.value as { target_definition_key?: string } | undefined)?.target_definition_key ?? null;
        const sourceText = (id: string | null) => {
          const item = id ? evidence.get(id) : undefined;
          const source = item ? sourceByPath.get(item.file_path) : undefined;
          if (!item || !source) return null;
          const text = Buffer.from(source.source_bytes).subarray(item.span.start_byte, item.span.end_byte).toString();
          return text.slice(0, 240) + (text.length > 240 ? "…" : "");
        };
        addFact("call_target", { kind: "definition", definition_key: definition.definition_key }, { ...call, target_definition_key: target,
          argument_expressions: call.argument_evidence_ids.map(sourceText), result_binding: sourceText(call.result_binding_evidence_id) },
          { kind: "static_possible", rule_id: "python_callsite_binding_v1", reason_codes: [target ? "python_dynamic_dispatch" : "call_binding_unknown"] },
          [call.call_site_evidence_id, ...call.argument_evidence_ids, ...directEvidence, ...(call.result_binding_evidence_id ? [call.result_binding_evidence_id] : []), ...(bound?.evidence_ids ?? [])]);
        // execute/query also belong to command runners and syntax engines; keep
        // the call without inventing a database effect from its method name.
        const effect = /\.(emit|publish|info|line|line_error|write_line|write_error_line)$/.test(call.call) ? "event"
          : call.call === "virtualenv.cli_run" ? "process"
            : call.call === "xattr.setxattr" || call.call === "remove_directory" ? "file" : null;
        if (effect) addFact("effect", { kind: "definition", definition_key: definition.definition_key }, { effect_kind: effect, operation: call.call },
          { kind: "framework_heuristic", rule_id: "python_library_effect_v1" }, [call.call_site_evidence_id]);
      }
    }
  }
  for (const derived of deriveCallDataFlows(facts)) addFact("call_data_flow", derived.subject, derived.value,
    { kind: "static_possible", rule_id: "python_one_hop_parameter_return_v1", reason_codes: derived.reason_codes }, derived.evidence_ids);
  for (const flow of composeApplicationFlows(facts, evidence)) addFact("application_flow", flow.subject, flow.value,
    { kind: "static_possible", rule_id: "python_cfg_application_flow_v1", reason_codes: flow.reason_codes }, flow.evidence_ids);
  const reasonCodes = diagnostics.some((item) => item.severity === "error")
    ? ["pyright_semantic_diagnostics"]
    : pyright ? [] : ["pyright_unavailable"];
  if (types.truncated) reasonCodes.push("pyright_type_service_partial");
  reasonCodes.push("python_installed_environment_not_frozen");
  reasonCodes.push("library_effect_receiver_binding_incomplete");
  return finalizeSemanticOverlay(input.state, input.source, {
    profile: { id: PROFILE_ID, version: PROFILE_VERSION, compiler_version: pyrightVersion },
    facts,
    evidence: [...evidence.values()],
    diagnostics,
    coverage: {
      status: reasonCodes.length > 0 ? "partial" : "complete",
      analyzed_files: fileCount,
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
