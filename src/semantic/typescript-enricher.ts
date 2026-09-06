import path from "node:path";
import { createRequire } from "node:module";

import { version as typescriptVersion } from "typescript";
import {
  API as TypeScriptApi,
  DiagnosticCategory,
  type Checker,
  type Diagnostic as TypeScriptDiagnostic,
  type Program,
  type Project,
} from "typescript/unstable/sync";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import * as ast from "typescript/unstable/ast";
import type { Node, SourceFile } from "typescript/unstable/ast";

import { canonicalHash } from "../contract/hash.js";
import type { ByteSpan, Diagnostic } from "../contract/types.js";
import type { CanonicalDefinition } from "../canonicalization/types.js";
import type { RepositorySource, RepositorySourceFile } from "../indexing/types.js";
import { finalizeSemanticOverlay, validateSemanticInput } from "./overlay.js";
import { buildControlFlow } from "./control-flow.js";
import { buildDataFlow } from "./data-flow.js";
import { deriveCallDataFlows } from "./call-data-flow.js";
import { composeApplicationFlows } from "./application-flow.js";
import { SemanticEnrichmentError } from "./types.js";
import { parseJsonc } from "../repository/jsonc.js";
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
export const TYPESCRIPT_SEMANTIC_VERSION = "16" as const;
const PROFILE_VERSION = TYPESCRIPT_SEMANTIC_VERSION;
const VIRTUAL_ROOT = path.resolve("/__semantic_codebase__");
// TypeScript 7 ships its standard declarations beside the platform compiler,
// not beside the JavaScript API's version.cjs entry point.
const compilerRequire = createRequire(import.meta.resolve("typescript"));
const COMPILER_LIB_ROOT = path.join(path.dirname(compilerRequire.resolve(
  `@typescript/typescript-${process.platform}-${process.arch}/package.json`,
)), "lib");

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
    validateSemanticInput(input.state, input.source);
    const files = input.source.files.filter((file) => file.language === "typescript");
    const analysis = createAnalysis(files, input.source.configuration_files ?? []);
    try {
      const ownerByPath = new Map<string, Project>();
      const rootCounts = new Map<string, number>();
      for (const project of analysis.projects) for (const file of project.rootFiles) rootCounts.set(relativePath(file), (rootCounts.get(relativePath(file)) ?? 0) + 1);
      const ambiguousFiles = new Set([...rootCounts].filter(([, count]) => count > 1).map(([file]) => file));
      // Prefer a project's explicit root files over incidental imported dependencies.
      for (const project of analysis.projects) for (const file of project.program.getSourceFileNames()) {
        if (!ownerByPath.has(relativePath(file))) ownerByPath.set(relativePath(file), project);
      }
      for (const project of [...analysis.projects].sort((a, b) => a.configFileName.length - b.configFileName.length)) {
        for (const file of project.rootFiles) ownerByPath.set(relativePath(file), project);
      }
      const contexts = analysis.projects.flatMap((project) => buildSourceContexts(input, project.program,
        files.filter((file) => ownerByPath.get(file.relative_path) === project)));
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
      if (basis.kind === "compiler_exact" && evidenceIds.some((id) => ambiguousFiles.has(evidence.get(id)?.file_path ?? ""))) {
        basis = { kind: "static_possible", rule_id: basis.rule_id, reason_codes: ["typescript_project_context_ambiguous"] };
      }
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
        const checker = ownerByPath.get(context.file.relative_path)!.checker;
        addDefinitionFacts(context, checker, addEvidence, addFact);
        visitSource(context, checker, contextByFile, addEvidence, addFact);
      }
      for (const derived of deriveCallDataFlows(facts)) {
        addFact("call_data_flow", derived.subject, derived.value,
          { kind: "static_possible", rule_id: "typescript_one_hop_parameter_return_v1", reason_codes: derived.reason_codes }, derived.evidence_ids);
      }
      for (const flow of composeApplicationFlows(facts, evidence)) {
        addFact("application_flow", flow.subject, flow.value,
          { kind: "static_possible", rule_id: "typescript_cfg_application_flow_v1", reason_codes: flow.reason_codes }, flow.evidence_ids);
      }

      const diagnostics = analysis.projects.flatMap((project) => compilerDiagnostics(project.program,
        new Map([...contextByFile].filter(([file]) => ownerByPath.get(file) === project))));
      const reasonCodes = diagnostics.some((item) => item.severity === "error")
        ? ["typescript_semantic_diagnostics"]
        : [];
      if (contexts.length < files.length) reasonCodes.push("typescript_files_outside_configured_program");
      if (ambiguousFiles.size) reasonCodes.push("typescript_project_context_ambiguous");
      reasonCodes.push("library_effect_receiver_binding_incomplete");
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
          analyzed_files: contexts.length,
          skipped_files: input.source.files.length - contexts.length,
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
    const parent = node.parent;
    const declaration = parent && ast.isVariableDeclaration(parent) && parent.initializer && (ast.isArrowFunction(parent.initializer) || ast.isFunctionExpression(parent.initializer)) ? parent.initializer : parent;
    if (declaration && (ast.isFunctionDeclaration(declaration) || ast.isMethodDeclaration(declaration) || ast.isArrowFunction(declaration) || ast.isFunctionExpression(declaration)) && declaration.body) {
      const nodes = new Map<string, Node>();
      const evidenceFor = (item: Node): string => {
        const id = addEvidence(context, spanForNode(context, item)).evidence_id;
        nodes.set(id, item);
        return id;
      };
      const graph = buildControlFlow(declaration.body, evidenceFor);
      addFact(
        "control_flow",
        { kind: "definition", definition_key: definition.definition_key },
        { ...graph },
        { kind: "static_possible", rule_id: "typescript_statement_cfg_v1", reason_codes: graph.unknowns },
        graph.blocks.map((item) => item.evidence_id),
      );
      const data = buildDataFlow(declaration, graph, nodes, checker, evidenceFor);
      addFact(
        "data_flow",
        { kind: "definition", definition_key: definition.definition_key },
        { ...data, accesses: data.accesses.map((item) => ({ ...item })) },
        { kind: "static_possible", rule_id: "typescript_local_reaching_definitions_v1", reason_codes: data.unknowns },
        [...graph.blocks.map((item) => item.evidence_id), ...data.accesses.flatMap((item) => [item.evidence_id, item.symbol]), ...data.parameter_defaults.map((item) => item.evidence_id)],
      );
    }
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
      const resolvedTarget = signature ? definitionForDeclaration(signature.declaration?.resolve(), contextByFile) : null;
      const target = resolvedTarget && (ast.isNewExpression(node)
        ? ["class", "function"].includes(resolvedTarget.kind)
        : ["function", "method"].includes(resolvedTarget.kind))
        ? resolvedTarget
        : null;
      const expression = node.expression;
      const callText = limitText(expression.getText(context.sourceFile), 180);
      const argumentEvidence = (node.arguments ?? []).map((argument) => addEvidence(context, spanForNode(context, argument)).evidence_id);
      const receiver = node.parent && ast.isVariableDeclaration(node.parent) && node.parent.initializer === node && ast.isIdentifier(node.parent.name) ? node.parent.name : null;
      const resultEvidence = receiver ? addEvidence(context, spanForNode(context, receiver)).evidence_id : null;
      const callSite = { call_site_evidence_id: evidence.evidence_id, argument_evidence_ids: argumentEvidence,
        argument_expressions: (node.arguments ?? []).map((argument) => limitText(argument.getText(context.sourceFile), 240)),
        result_binding: receiver ? receiver.getText(context.sourceFile) : null,
        returned_directly: ast.isReturnStatement(node.parent) && node.parent.expression === node,
        result_binding_evidence_id: resultEvidence,
        has_spread_arguments: (node.arguments ?? []).some((argument) => ast.isSpreadElement(argument)) };
      if (ast.isCallExpression(node)) {
        const importSource = (item: Node | undefined): string | null => {
          let imported = item;
          while (imported && !ast.isImportDeclaration(imported) && !ast.isSourceFile(imported)) imported = imported.parent;
          return imported && ast.isImportDeclaration(imported) ? imported.moduleSpecifier.getText().replace(/['"]/g, "") : null;
        };
        const callable = checker.getSymbolAtLocation(expression)?.declarations[0]?.resolve();
        const callbackEntry = (entryKind: string, handler: Node | undefined, rule: string): void => {
          const handlerDeclaration = handler ? checker.getSymbolAtLocation(handler)?.valueDeclaration?.resolve() : undefined;
          const handlerTarget = definitionForDeclaration(handlerDeclaration, contextByFile);
          if (handlerTarget) addFact("entrypoint", { kind: "definition", definition_key: handlerTarget.definition_key },
            { entry_kind: entryKind, qualified_name: handlerTarget.qualified_name, registration: callText },
            { kind: "framework_heuristic", rule_id: rule }, [evidence.evidence_id, ...argumentEvidence]);
        };
        const importedName = callable && ast.isImportSpecifier(callable) ? (callable.propertyName ?? callable.name).getText() : expression.getText();
        if (["setInterval", "setTimeout"].includes(importedName) &&
            (["node:timers", "timers"].includes(importSource(callable) ?? "") ||
             (!callable && ast.isIdentifier(expression)))) {
          callbackEntry("scheduled_job", node.arguments[0], "node_timer_callback_v1");
        }
        if (ast.isPropertyAccessExpression(expression)) {
          const method = expression.name.getText();
          const receiver = checker.getSymbolAtLocation(expression.expression)?.valueDeclaration?.resolve();
          const initializer = receiver && ast.isVariableDeclaration(receiver) ? receiver.initializer : undefined;
          const factory = initializer && (ast.isNewExpression(initializer) || ast.isCallExpression(initializer))
            ? checker.getSymbolAtLocation(initializer.expression)?.declarations[0]?.resolve() : undefined;
          const module = importSource(factory);
          if (["on", "once", "addListener"].includes(method) && ["node:events", "events"].includes(module ?? "")) {
            callbackEntry("event_handler", node.arguments[1], "node_event_emitter_callback_v1");
          }
          if (method === "action" && module === "commander") callbackEntry("cli", node.arguments[0], "commander_named_action_v1");
        }
      }
      if (ast.isCallExpression(node) && ast.isPropertyAccessExpression(expression) &&
          /^(get|post|put|patch|delete|options|head|all)$/.test(expression.name.getText())) {
        const receiver = checker.getSymbolAtLocation(expression.expression)?.valueDeclaration?.resolve();
        const initializer = receiver && ast.isVariableDeclaration(receiver) ? receiver.initializer : undefined;
        if (initializer && ast.isCallExpression(initializer)) {
          const factory = checker.getSymbolAtLocation(initializer.expression)?.declarations[0]?.resolve();
          let imported: Node | undefined = factory;
          while (imported && !ast.isImportDeclaration(imported) && !ast.isSourceFile(imported)) imported = imported.parent;
          const supportedFactory = factory && (ast.isImportClause(factory) || (ast.isImportSpecifier(factory) && (factory.propertyName ?? factory.name).getText() === "Router"));
          if (supportedFactory && imported && ast.isImportDeclaration(imported) && imported.moduleSpecifier.getText().replace(/['"]/g, "") === "express") {
            const route = node.arguments[0];
            const handler = node.arguments.at(-1);
            const handlerDeclaration = handler ? checker.getSymbolAtLocation(handler)?.valueDeclaration?.resolve() : undefined;
            const handlerTarget = definitionForDeclaration(handlerDeclaration, contextByFile);
            if (route && ast.isStringLiteralLikeNode(route) && handlerTarget) {
              addFact("entrypoint", { kind: "definition", definition_key: handlerTarget.definition_key },
                { entry_kind: "http_route", framework: "express", method: expression.name.getText().toUpperCase(), route: route.text, qualified_name: handlerTarget.qualified_name },
                { kind: "framework_heuristic", rule_id: "express_imported_factory_route_v1" }, [evidence.evidence_id, ...argumentEvidence]);
            }
          }
        }
      }
      if (target) {
        addFact(
          "call_target",
          subject,
          {
            call: callText,
            ...callSite,
            target_definition_key: target.definition_key,
            target_qualified_name: target.qualified_name,
          },
          ast.isPropertyAccessExpression(expression) || target.kind === "method"
            ? { kind: "static_possible", rule_id: "typescript_signature_declaration_target", reason_codes: ["runtime_dispatch_not_proven"] }
            : { kind: "compiler_exact", rule_id: "typescript_resolved_signature" },
          [evidence.evidence_id, ...argumentEvidence, ...(resultEvidence ? [resultEvidence] : [])],
        );
      } else {
        addFact(
          "call_target",
          subject,
          { call: callText, target_definition_key: null, ...callSite },
          {
            kind: "static_possible",
            rule_id: "typescript_unresolved_signature",
            reason_codes: [signature ? "target_outside_snapshot" : "signature_unresolved"],
          },
          [evidence.evidence_id, ...argumentEvidence, ...(resultEvidence ? [resultEvidence] : [])],
        );
      }
      const effect = effectForCall(expression, checker);
      if (ast.isCallExpression(node) && ast.isPropertyAccessExpression(expression) &&
          /^(push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|set|add|delete|clear)$/.test(expression.name.getText())) {
        const type = checker.getTypeAtLocation(expression.expression);
        const declaration = signature?.declaration?.resolve();
        const owner = declaration?.parent && ast.isInterfaceDeclaration(declaration.parent) ? declaration.parent.name.text : "";
        const method = expression.name.getText();
        const array = owner === "Array" && type && (checker.isArrayType(type) || checker.isTupleType(type));
        const collection = (owner === "Map" && /^(set|delete|clear)$/.test(method)) ||
          (owner === "Set" && /^(add|delete|clear)$/.test(method));
        if ((array || collection) && declaration && compilerLibrary(declaration.getSourceFile().fileName) &&
            !isFreshLocalExpression(expression.expression, subject, context, checker)) {
          addFact("effect", subject, { effect_kind: "state", operation: callText,
            receiver: limitText(expression.expression.getText(context.sourceFile), 180), mutation_kind: owner.toLowerCase() },
          { kind: "static_possible", rule_id: array ? "typescript_standard_array_mutation_v1" : "typescript_standard_collection_mutation_v1", reason_codes: ["runtime_method_override_not_excluded"] },
          [evidence.evidence_id, ...argumentEvidence]);
        }
      }
      if (effect) {
        addFact(
          "effect",
          subject,
          { effect_kind: effect, operation: effect === "database" ? limitText(node.getText(context.sourceFile), 240) : callText },
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

    if (ast.isBinaryExpression(node) && ast.isAssignmentOperator(node.operatorToken.kind) &&
        isObservableAssignment(node.left, subject, context, checker)) {
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


type FactAdder = (
  kind: SemanticFactKind,
  subject: SemanticSubject,
  value: CanonicalValue,
  basis: ClaimBasis,
  evidenceIds: string[],
) => SemanticFact;

function createAnalysis(files: RepositorySourceFile[], configurations: NonNullable<RepositorySource["configuration_files"]>): {
  api: TypeScriptApi;
  projects: readonly Project[];
} {
  const configPath = path.join(VIRTUAL_ROOT, "tsconfig.json");
  const virtualFiles = Object.fromEntries([...files, ...configurations].map((file) => [
    virtualPath(file.relative_path),
    decode(file.source_bytes),
  ]));
  const configuredRoots = configurations.filter((file) => path.posix.basename(file.relative_path) === "tsconfig.json").map((file) => virtualPath(file.relative_path));
  if (!configuredRoots.length) virtualFiles[configPath] ??= JSON.stringify({
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
  const projectPaths = new Set<string>();
  const visitConfig = (fileName: string): void => {
    if (projectPaths.has(fileName)) return;
    if (!insideVirtualRoot(fileName) || virtualFiles[fileName] === undefined) {
      throw new SemanticEnrichmentError("INVALID_PROJECT_CONFIGURATION", `Project reference is outside frozen inputs: ${fileName}`);
    }
    projectPaths.add(fileName);
    let config: { references?: { path: string }[] };
    try { config = parseJsonc(virtualFiles[fileName]!) as typeof config; }
    catch { throw new SemanticEnrichmentError("INVALID_PROJECT_CONFIGURATION", `Invalid JSONC project: ${fileName}`); }
    if (!config || typeof config !== "object" || (config.references !== undefined && !Array.isArray(config.references))) {
      throw new SemanticEnrichmentError("INVALID_PROJECT_CONFIGURATION", `Invalid references: ${fileName}`);
    }
    for (const reference of config.references ?? []) {
      if (typeof reference?.path !== "string") throw new SemanticEnrichmentError("INVALID_PROJECT_CONFIGURATION", `Invalid reference path: ${fileName}`);
      const target = path.resolve(path.dirname(fileName), reference.path);
      visitConfig(target.endsWith(".json") ? target : path.join(target, "tsconfig.json"));
    }
  };
  for (const root of configuredRoots.includes(configPath) ? [configPath] : configuredRoots.length ? configuredRoots : [configPath]) visitConfig(root);
  const virtualFs = createVirtualFileSystem(virtualFiles);
  const api = new TypeScriptApi({
    cwd: VIRTUAL_ROOT,
    fs: {
      readFile: (fileName) => virtualFs.fileExists?.(fileName)
        ? virtualFs.readFile?.(fileName)
        : compilerLibrary(fileName) ? undefined : null,
      fileExists: (fileName) => virtualFs.fileExists?.(fileName)
        ? true
        : compilerLibrary(fileName) ? undefined : false,
      directoryExists: (directoryName) => virtualFs.directoryExists?.(directoryName)
        ? true
        : directoryName === COMPILER_LIB_ROOT ? undefined : false,
      getAccessibleEntries: (directoryName) => virtualFs.directoryExists?.(directoryName)
        ? virtualFs.getAccessibleEntries?.(directoryName)
        : directoryName === COMPILER_LIB_ROOT ? undefined : { files: [], directories: [] },
      realpath: (fileName) => insideVirtualRoot(fileName) ? fileName : undefined,
    },
  });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [...projectPaths].sort() });
    const projects = snapshot.getProjects();
    if (!projects.length) {
      throw new Error("TypeScript Compiler did not create a project for the frozen Snapshot");
    }
    const configErrors = projects.flatMap((project) => project.program.getConfigFileParsingDiagnostics()).filter((item) => item.category === DiagnosticCategory.Error);
    if (configErrors.length) {
      throw new SemanticEnrichmentError("INVALID_PROJECT_CONFIGURATION", `TypeScript frozen configuration is invalid: ${configErrors.map((item) => item.text).join("; ")}`);
    }
    return { api, projects };
  } catch (error) {
    api.close();
    throw error;
  }
}

function compilerLibrary(fileName: string): boolean {
  return path.dirname(fileName) === COMPILER_LIB_ROOT && /^lib(?:\..+)?\.d\.ts$/.test(path.basename(fileName));
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
    .filter((diagnostic) => diagnostic.fileName && contexts.has(relativePath(diagnostic.fileName)))
    // The compiler may return parallel diagnostic batches in different orders.
    // Select the bounded prefix only after imposing a stable order.
    .sort((left, right) => left.fileName!.localeCompare(right.fileName!) ||
      left.pos - right.pos || left.end - right.end || left.code - right.code ||
      left.text.localeCompare(right.text));
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

function effectForCall(expression: Node, checker: Checker): "file" | "process" | "network" | "event" | "database" | null {
  const root = ast.isPropertyAccessExpression(expression) ? expression.expression : expression;
  const operation = ast.isPropertyAccessExpression(expression) ? expression.name.getText() : expression.getText();
  if (operation === "write" && isNodeProcessStream(root, checker)) return "event";
  const type = checker.getTypeAtLocation(root);
  const receiverType = type ? limitText(checker.typeToString(type, root), 240) : "";
  if ((operation === "exec" && /\bDatabaseSync\b/.test(receiverType)) ||
      (operation === "run" && /\bStatementSync\b/.test(receiverType))) return "database";
  if (operation === "run" && ast.isCallExpression(root) && ast.isPropertyAccessExpression(root.expression) &&
      root.expression.name.getText() === "prepare") {
    const database = root.expression.expression;
    const databaseType = checker.getTypeAtLocation(database);
    if (databaseType && /\bDatabaseSync\b/.test(checker.typeToString(databaseType, database))) return "database";
  }
  const declaration = checker.getSymbolAtLocation(root)?.declarations[0]?.resolve();
  if (!declaration) return null;
  const importedOperation = ast.isPropertyAccessExpression(expression) ? expression.name.getText() :
    ast.isImportSpecifier(declaration) ? (declaration.propertyName ?? declaration.name).getText() : expression.getText();
  if (compilerLibrary(declaration.getSourceFile().fileName)) {
    if (root.getText() === "fetch" && importedOperation === "fetch") return "network";
    if (root.getText() === "console") return "event";
  }
  if (!ast.isImportSpecifier(declaration) && !ast.isNamespaceImport(declaration) && !ast.isImportClause(declaration)) return null;
  let imported: Node | undefined = declaration;
  while (imported && !ast.isImportDeclaration(imported) && !ast.isSourceFile(imported)) imported = imported.parent;
  if (!imported || !ast.isImportDeclaration(imported)) return null;
  const module = imported.moduleSpecifier.getText().replace(/['"]/g, "").replace(/^node:/, "");
  if (["fs", "fs/promises"].includes(module) && /^(writeFile|writeFileSync|appendFile|appendFileSync|unlink|unlinkSync|mkdir|mkdirSync|rename|renameSync|rm|rmSync)$/.test(importedOperation)) return "file";
  if (module === "child_process" && /^(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)$/.test(importedOperation)) return "process";
  if (["http", "https"].includes(module) && /^(request|get)$/.test(importedOperation)) return "network";
  return null;
}

function isNodeProcessStream(root: Node, checker: Checker): boolean {
  if (!ast.isPropertyAccessExpression(root) || !ast.isIdentifier(root.expression) ||
      root.expression.text !== "process" || !/^(stdout|stderr)$/.test(root.name.text)) return false;
  const declaration = checker.getSymbolAtLocation(root.expression)?.declarations[0]?.resolve();
  // Repository slices often omit the ambient Node declaration files. An
  // unresolved global `process` is therefore the expected frozen-input case;
  // a local shadow still resolves to its parameter or variable declaration.
  if (!declaration) return true;
  const fileName = declaration.getSourceFile().fileName.replaceAll("\\", "/");
  return compilerLibrary(fileName) || /\/@types\/node\/(?:globals|process)\.d\.ts$/.test(fileName);
}

function isObservableAssignment(left: Node, subject: SemanticSubject, context: SourceContext, checker: Checker): boolean {
  if (ast.isPropertyAccessExpression(left) || ast.isElementAccessExpression(left)) {
    return !isFreshLocalExpression(left.expression, subject, context, checker);
  }
  if (!ast.isIdentifier(left)) return false;
  const declaration = checker.getSymbolAtLocation(left)?.valueDeclaration?.resolve();
  return !declaration || !insideSubject(declaration, subject, context);
}

function isFreshLocalExpression(
  expression: Node,
  subject: SemanticSubject,
  context: SourceContext,
  checker: Checker,
  seen = new Set<Node>(),
): boolean {
  if (seen.has(expression)) return false;
  seen.add(expression);
  if (ast.isArrayLiteralExpression(expression) || ast.isObjectLiteralExpression(expression) || ast.isNewExpression(expression)) return true;
  if (ast.isPropertyAccessExpression(expression) || ast.isElementAccessExpression(expression)) {
    return isFreshLocalExpression(expression.expression, subject, context, checker, seen);
  }
  if (ast.isCallExpression(expression) && ast.isPropertyAccessExpression(expression.expression) &&
      /^(slice|filter|map|flatMap|concat|copy)$/.test(expression.expression.name.getText())) return true;
  if (!ast.isIdentifier(expression)) return false;
  const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration?.resolve();
  return Boolean(declaration && ast.isVariableDeclaration(declaration) && declaration.initializer &&
    (declaration.parent.flags & ast.NodeFlags.Const) !== 0 &&
    insideSubject(declaration, subject, context) &&
    isFreshLocalExpression(declaration.initializer, subject, context, checker, seen));
}

function insideSubject(node: Node, subject: SemanticSubject, context: SourceContext): boolean {
  if (subject.kind !== "definition") return false;
  const definition = context.definitions.find((item) => item.definition_key === subject.definition_key);
  if (!definition) return false;
  const span = spanForNode(context, node);
  return definition.definition_span.start_byte <= span.start_byte && span.end_byte <= definition.definition_span.end_byte;
}

function isExportedDefinition(node: Node): boolean {
  let current: Node | undefined = node;
  while (current && !ast.isSourceFile(current)) {
    if (/^export\b/.test(current.getText(current.getSourceFile()).trimStart())) return true;
    if (ast.isFunctionDeclaration(current) || ast.isFunctionExpression(current) || ast.isArrowFunction(current)) return false;
    current = current.parent;
  }
  return false;
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
