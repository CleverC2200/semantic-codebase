import path from "node:path";

import { canonicalJson } from "../contract/hash.js";
import type {
  DefinitionDraft,
  Diagnostic,
  RelationCandidate,
  SubjectLocalRef,
  SyntaxSlice,
  TargetHint,
} from "../contract/types.js";
import type {
  FrozenRepositoryView,
  ResolvedEndpoint,
  ResolvedRelationDraft,
  ResolutionSlice,
  Resolver,
} from "./types.js";

export const RESOLVER_PROFILE_VERSION = "2";

interface LocatedDefinition {
  file_path: string;
  definition: DefinitionDraft;
}

interface ImportBinding {
  local_name: string;
  target_file?: string;
  target_definition?: LocatedDefinition;
}

interface ExportBinding {
  exported_name: string;
  target_file?: string;
  target_definition?: LocatedDefinition;
  derivation: string[];
}

interface ResolutionContext {
  view: FrozenRepositoryView;
  slicesByPath: Map<string, SyntaxSlice>;
  definitionsByPath: Map<string, LocatedDefinition[]>;
  exportBindings: Map<string, ExportBinding[]>;
  importBindings: Map<string, ImportBinding[]>;
  localImportNames: Map<string, Map<string, Set<string>>>;
}

interface CandidateLocation {
  file_path: string;
  slice: SyntaxSlice;
  candidate: RelationCandidate;
}

interface TargetResolution {
  target: ResolvedEndpoint;
  derivation: string[];
}

export class DeterministicResolver implements Resolver {
  resolve(view: FrozenRepositoryView): ResolutionSlice {
    const validationDiagnostics = validateView(view);
    if (validationDiagnostics.length > 0) {
      return {
        repository_id: view.manifest.repository_id,
        snapshot_id: view.manifest.snapshot_id,
        resolved_relations: [],
        unresolved_candidates: view.slices.flatMap((slice) => slice.relation_candidates),
        diagnostics: validationDiagnostics,
        coverage: {
          status: "failed",
          candidate_count: view.slices.reduce((count, slice) => count + slice.relation_candidates.length, 0),
          resolved_count: 0,
          unresolved_count: view.slices.reduce((count, slice) => count + slice.relation_candidates.length, 0),
        },
      };
    }

    const slicesByPath = new Map(view.slices.map((slice) => [slice.file.relative_path, slice]));
    const definitionsByPath = new Map<string, LocatedDefinition[]>();
    for (const slice of view.slices) {
      const definitions = definitionsByPath.get(slice.file.relative_path) ?? [];
      for (const definition of slice.definitions) definitions.push({ file_path: slice.file.relative_path, definition });
      definitionsByPath.set(slice.file.relative_path, definitions);
    }
    const context: ResolutionContext = {
      view,
      slicesByPath,
      definitionsByPath,
      exportBindings: new Map(),
      importBindings: new Map(),
      localImportNames: new Map(),
    };
    context.exportBindings = buildExportBindings(context);
    context.importBindings = buildImportBindings(context);

    const candidates = view.slices
      .flatMap((slice) =>
        slice.relation_candidates.map((candidate) => ({
          file_path: slice.file.relative_path,
          slice,
          candidate,
          sort_key: canonicalJson(candidate),
        })),
      )
      .sort((left, right) => left.file_path.localeCompare(right.file_path) || left.sort_key.localeCompare(right.sort_key));
    const resolved_relations: ResolvedRelationDraft[] = [];
    const unresolved_candidates: RelationCandidate[] = [];
    const diagnostics: Diagnostic[] = [];

    for (const location of candidates) {
      const supportedSource = supportsCandidateSource(location.slice, location.candidate);
      const result = supportedSource ? resolveCandidate(location, context) : null;
      if (!result) {
        unresolved_candidates.push(location.candidate);
        const evidence = location.slice.evidence.find((item) =>
          location.candidate.evidence_local_ids.includes(item.local_id),
        );
        diagnostics.push({
          code: supportedSource ? "unresolved_relation_candidate" : "unsupported_relation_source",
          severity: "info",
          file_path: location.file_path,
          ...(evidence ? { span: evidence.span } : {}),
          message: supportedSource ? `${location.candidate.kind} candidate has zero or multiple exact targets` : `${location.candidate.kind} source scope is outside the structural relation contract`,
        });
        continue;
      }
      resolved_relations.push({
        candidate_local_id: location.candidate.local_id,
        target: result.target,
        derivation: [...result.derivation],
      });
    }

    resolved_relations.sort((left, right) =>
      left.candidate_local_id.localeCompare(right.candidate_local_id) ||
      canonicalJson(left).localeCompare(canonicalJson(right)),
    );
    unresolved_candidates.sort((left, right) => left.local_id.localeCompare(right.local_id));
    diagnostics.sort((left, right) =>
      left.file_path.localeCompare(right.file_path) ||
      (left.span?.start_byte ?? Number.MAX_SAFE_INTEGER) -
        (right.span?.start_byte ?? Number.MAX_SAFE_INTEGER) ||
      left.code.localeCompare(right.code),
    );
    return {
      repository_id: view.manifest.repository_id,
      snapshot_id: view.manifest.snapshot_id,
      resolved_relations,
      unresolved_candidates,
      diagnostics,
      coverage: {
        status: "complete",
        candidate_count: candidates.length,
        resolved_count: resolved_relations.length,
        unresolved_count: unresolved_candidates.length,
      },
    };
  }
}

function validateView(view: FrozenRepositoryView): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const manifestFiles = new Map(view.manifest.files.map((file) => [file.relative_path, file]));
  for (const slice of view.slices) {
    const manifestFile = manifestFiles.get(slice.file.relative_path);
    if (
      !manifestFile ||
      manifestFile.language !== slice.file.language ||
      manifestFile.source_digest !== slice.file.source_digest
    ) {
      diagnostics.push({
        code: "repository_view_mismatch",
        severity: "error",
        file_path: slice.file.relative_path,
        message: "SyntaxSlice does not match the frozen Repository Manifest",
      });
    }
  }
  if (view.slices.length !== view.manifest.files.length) {
    diagnostics.push({
      code: "repository_view_incomplete",
      severity: "error",
      file_path: "",
      message: "Frozen Repository View must contain exactly one SyntaxSlice per manifest file",
    });
  }
  return diagnostics;
}

function buildImportBindings(context: ResolutionContext): Map<string, ImportBinding[]> {
  const bindings = new Map<string, ImportBinding[]>();
  for (const slice of context.view.slices) {
    const fileBindings: ImportBinding[] = [];
    for (const candidate of slice.relation_candidates) {
      if (candidate.kind !== "IMPORTS" || candidate.target_hint.kind !== "module") continue;
      const hint = candidate.target_hint;
      const localName = hint.alias ?? hint.imported_name ?? moduleLocalName(hint.specifier);
      if (!supportsCandidateSource(slice, candidate)) {
        if (candidate.source_local_ref.kind === "definition") {
          const scopes = context.localImportNames.get(slice.file.relative_path) ?? new Map<string, Set<string>>();
          const names = scopes.get(candidate.source_local_ref.local_id) ?? new Set<string>();
          names.add(localName); scopes.set(candidate.source_local_ref.local_id, names);
          context.localImportNames.set(slice.file.relative_path, scopes);
        }
        continue;
      }
      const targetFile = resolveModulePath(slice.file.relative_path, slice.file.language, hint.specifier, context);
      const binding: ImportBinding = { local_name: localName };
      if (targetFile) binding.target_file = targetFile;
      if (targetFile && hint.imported_name && hint.imported_name !== "*") {
        const target = importableBinding(context, targetFile, hint.imported_name);
        if (target?.target_definition) binding.target_definition = target.target_definition;
        if (target?.target_file) binding.target_file = target.target_file;
      }
      fileBindings.push(binding);
    }
    bindings.set(slice.file.relative_path, fileBindings);
  }
  return bindings;
}

function supportsCandidateSource(slice: SyntaxSlice, candidate: RelationCandidate): boolean {
  const source = candidate.source_local_ref;
  if (source.kind === "source_file") return true;
  if (!["IMPORTS", "EXPORTS", "CALLS"].includes(candidate.kind)) return true;
  const kind = slice.definitions.find((definition) => definition.local_id === source.local_id)?.kind;
  return candidate.kind === "CALLS" ? kind === "function" || kind === "method" : kind === "module";
}

function buildExportBindings(context: ResolutionContext): Map<string, ExportBinding[]> {
  interface ReExportRule {
    source_file: string;
    target_file: string;
    imported_name: string;
    alias?: string;
  }
  const direct = new Map<string, ExportBinding[]>();
  const rules: ReExportRule[] = [];
  for (const [filePath, slice] of context.slicesByPath) {
    if (slice.file.language !== "typescript") continue;
    const bindings: ExportBinding[] = [];
    for (const candidate of slice.relation_candidates) {
      if (candidate.kind !== "EXPORTS" || candidate.source_local_ref.kind !== "source_file") continue;
      const hint = candidate.target_hint;
      if (hint.kind === "name") {
        const target = uniqueDefinitionForSource(context, filePath, candidate.source_local_ref, hint.name);
        if (target) {
          bindings.push({
            exported_name: hint.alias ?? hint.name,
            target_definition: target,
            derivation: ["same_file_export_binding"],
          });
        }
        continue;
      }
      if (hint.kind !== "module" || !hint.imported_name) continue;
      const targetFile = resolveModulePath(filePath, slice.file.language, hint.specifier, context);
      if (!targetFile) continue;
      if (hint.imported_name === "*" && hint.alias) {
        bindings.push({
          exported_name: hint.alias,
          target_file: targetFile,
          derivation: ["manifest_unique_module_path", "namespace_re_export_binding"],
        });
      } else {
        rules.push({
          source_file: filePath,
          target_file: targetFile,
          imported_name: hint.imported_name,
          ...(hint.alias ? { alias: hint.alias } : {}),
        });
      }
    }
    direct.set(filePath, uniqueBindings(bindings));
  }

  let current = new Map([...direct].map(([filePath, bindings]) => [filePath, [...bindings]]));
  const maxPasses = Math.max(1, direct.size + rules.length + 1);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const next = new Map([...direct].map(([filePath, bindings]) => [filePath, [...bindings]]));
    for (const rule of rules) {
      const targetBindings = current.get(rule.target_file) ?? [];
      const additions = rule.imported_name === "*"
        ? targetBindings
            .filter((binding) => binding.exported_name !== "default")
            .map((binding) => ({
              ...binding,
              derivation: ["manifest_unique_module_path", "wildcard_re_export_binding", ...binding.derivation],
            }))
        : (() => {
            const target = uniqueExportBinding(targetBindings, rule.imported_name);
            return target
              ? [{
                  ...target,
                  exported_name: rule.alias ?? rule.imported_name,
                  derivation: ["manifest_unique_module_path", "named_re_export_binding", ...target.derivation],
                }]
              : [];
          })();
      next.set(rule.source_file, uniqueBindings([...(next.get(rule.source_file) ?? []), ...additions]));
    }
    if (exportBindingMapsEqual(current, next)) return next;
    current = next;
  }
  return current;
}

function resolveCandidate(
  location: CandidateLocation,
  context: ResolutionContext,
): TargetResolution | null {
  const { candidate, file_path, slice } = location;
  if (
    (candidate.kind === "IMPORTS" || candidate.kind === "EXPORTS") &&
    candidate.target_hint.kind === "module"
  ) {
    return resolveModuleHint(candidate.kind, file_path, slice.file.language, candidate.target_hint, context);
  }
  if (candidate.kind === "EXPORTS" && candidate.target_hint.kind === "name") {
    const definition = uniqueDefinitionForSource(
      context,
      file_path,
      candidate.source_local_ref,
      candidate.target_hint.name,
    );
    return definition
      ? { target: definitionEndpoint(definition), derivation: ["same_file_unique_name"] }
      : null;
  }
  if (candidate.kind === "CALLS") {
    return resolveCall(location, context);
  }
  if (["INHERITS", "IMPLEMENTS"].includes(candidate.kind) && candidate.target_hint.kind === "name") {
    return resolveNamedType(file_path, candidate.target_hint, context);
  }
  return null;
}

function resolveModuleHint(
  relationKind: "IMPORTS" | "EXPORTS",
  sourceFile: string,
  language: SyntaxSlice["file"]["language"],
  hint: Extract<TargetHint, { kind: "module" }>,
  context: ResolutionContext,
): TargetResolution | null {
  const targetFile = resolveModulePath(sourceFile, language, hint.specifier, context);
  if (!targetFile) return null;
  if (!hint.imported_name || hint.imported_name === "*") {
    return {
      target: { kind: "source_file", file_path: targetFile },
      derivation: ["manifest_unique_module_path"],
    };
  }
  const binding = importableBinding(context, targetFile, hint.imported_name);
  const endpoint = binding?.target_definition
    ? definitionEndpoint(binding.target_definition)
    : binding?.target_file
      ? { kind: "source_file" as const, file_path: binding.target_file }
      : null;
  return endpoint
    ? {
        target: endpoint,
        derivation: [
          "manifest_unique_module_path",
          relationKind === "IMPORTS" ? "target_export_binding" : "target_re_export_binding",
          ...(binding?.derivation ?? []),
        ],
      }
    : null;
}

function resolveCall(location: CandidateLocation, context: ResolutionContext): TargetResolution | null {
  const { target_hint: hint } = location.candidate;
  const localScopes = context.localImportNames.get(location.file_path);
  const name = hint.kind === "name" ? hint.name : hint.kind === "member" ? hint.receiver_text : null;
  if (localScopes && name && location.candidate.source_local_ref.kind === "definition") {
    let owner: string | null = location.candidate.source_local_ref.local_id;
    const visited = new Set<string>();
    while (owner && !visited.has(owner)) {
      visited.add(owner);
      const names = localScopes.get(owner);
      if (names?.has(name) || names?.has("*")) return null;
      owner = location.slice.definitions.find((definition) => definition.local_id === owner)?.container_local_id ?? null;
    }
  }
  if (hint.kind === "name") {
    const sameFile = uniqueDefinition(context, location.file_path, hint.name);
    if (sameFile) {
      return { target: definitionEndpoint(sameFile), derivation: ["same_file_unique_name"] };
    }
    const imported = uniqueBinding(context, location.file_path, hint.name)?.target_definition;
    return imported
      ? { target: definitionEndpoint(imported), derivation: ["explicit_import_alias", "target_file_unique_name"] }
      : null;
  }
  if (hint.kind !== "member") return null;
  if (["this", "self"].includes(hint.receiver_text)) {
    const owner = owningClass(location);
    const member = owner
      ? uniqueDefinitionInContainer(location.slice, owner.local_id, hint.member)
      : null;
    return member
      ? {
          target: definitionEndpoint({ file_path: location.file_path, definition: member }),
          derivation: ["lexical_class_receiver", "container_unique_member"],
        }
      : null;
  }
  const binding = uniqueBinding(context, location.file_path, hint.receiver_text);
  if (binding?.target_definition) {
    const targetSlice = context.slicesByPath.get(binding.target_definition.file_path);
    const member = targetSlice
      ? uniqueDefinitionInContainer(
          targetSlice,
          binding.target_definition.definition.local_id,
          hint.member,
        )
      : null;
    return member
      ? {
          target: definitionEndpoint({ file_path: binding.target_definition.file_path, definition: member }),
          derivation: ["explicit_import_alias", "container_unique_member"],
        }
      : null;
  }
  if (binding?.target_file) {
    const definition = importableBinding(context, binding.target_file, hint.member)?.target_definition;
    return definition
      ? {
          target: definitionEndpoint(definition),
          derivation: ["explicit_namespace_alias", "target_file_unique_name"],
        }
      : null;
  }
  const receiverClass = uniqueDefinition(context, location.file_path, hint.receiver_text, ["class"]);
  const member = receiverClass
    ? uniqueDefinitionInContainer(
        location.slice,
        receiverClass.definition.local_id,
        hint.member,
      )
    : null;
  return member
    ? {
        target: definitionEndpoint({ file_path: location.file_path, definition: member }),
        derivation: ["same_file_unique_class", "container_unique_member"],
      }
    : null;
}

function resolveNamedType(
  sourceFile: string,
  hint: Extract<TargetHint, { kind: "name" }>,
  context: ResolutionContext,
): TargetResolution | null {
  if (hint.qualifier) {
    const binding = uniqueBinding(context, sourceFile, hint.qualifier);
    const exported = binding?.target_file
      ? importableBinding(context, binding.target_file, hint.name)
      : null;
    const target = exported?.target_definition && ["class", "interface"].includes(exported.target_definition.definition.kind)
      ? exported.target_definition
      : null;
    return target
      ? { target: definitionEndpoint(target), derivation: ["explicit_namespace_alias", "target_file_unique_type"] }
      : null;
  }
  const imported = uniqueBinding(context, sourceFile, hint.name)?.target_definition;
  if (imported && ["class", "interface"].includes(imported.definition.kind)) {
    return { target: definitionEndpoint(imported), derivation: ["explicit_import_alias"] };
  }
  const sameFile = uniqueDefinition(context, sourceFile, hint.name, ["class", "interface"]);
  return sameFile
    ? { target: definitionEndpoint(sameFile), derivation: ["same_file_unique_type"] }
    : null;
}

function resolveModulePath(
  sourceFile: string,
  language: SyntaxSlice["file"]["language"],
  specifier: string,
  context: ResolutionContext,
): string | null {
  const available = new Set(context.view.manifest.files.map((file) => file.relative_path));
  const candidates = language === "typescript"
    ? typescriptModuleCandidates(sourceFile, specifier)
    : pythonModuleCandidates(sourceFile, specifier);
  const matches = [...new Set(candidates.filter((candidate) => available.has(candidate)))];
  return matches.length === 1 ? matches[0] ?? null : null;
}

function typescriptModuleCandidates(sourceFile: string, specifier: string): string[] {
  if (!specifier.startsWith(".")) return [];
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), specifier));
  const extension = path.posix.extname(base);
  if (extension) return [base];
  return [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.posix.join(base, "index.ts"),
    path.posix.join(base, "index.tsx"),
  ];
}

function pythonModuleCandidates(sourceFile: string, specifier: string): string[] {
  let modulePath: string;
  if (specifier.startsWith(".")) {
    const dots = specifier.match(/^\.+/)?.[0].length ?? 1;
    let directory = path.posix.dirname(sourceFile);
    for (let level = 1; level < dots; level += 1) directory = path.posix.dirname(directory);
    const suffix = specifier.slice(dots).replaceAll(".", "/");
    modulePath = path.posix.normalize(path.posix.join(directory, suffix));
  } else {
    modulePath = specifier.replaceAll(".", "/");
  }
  return [`${modulePath}.py`, path.posix.join(modulePath, "__init__.py")];
}

function uniqueDefinition(
  context: ResolutionContext,
  filePath: string,
  name: string,
  kinds?: DefinitionDraft["kind"][],
): LocatedDefinition | null {
  const matches = (context.definitionsByPath.get(filePath) ?? []).filter(
    (located) =>
      (located.definition.name === name || located.definition.qualified_name === name) &&
      (!kinds || kinds.includes(located.definition.kind)),
  );
  return matches.length === 1 ? matches[0] ?? null : null;
}

function uniqueDefinitionForSource(
  context: ResolutionContext,
  filePath: string,
  source: SubjectLocalRef,
  name: string,
): LocatedDefinition | null {
  const matches = (context.definitionsByPath.get(filePath) ?? []).filter((located) =>
    located.definition.name === name &&
    located.definition.container_local_id === (source.kind === "source_file" ? null : source.local_id),
  );
  return matches.length === 1 ? matches[0] ?? null : null;
}

function importableBinding(
  context: ResolutionContext,
  targetFile: string,
  exportedName: string,
): ExportBinding | null {
  const slice = context.slicesByPath.get(targetFile);
  if (!slice) return null;
  if (slice.file.language === "python") {
    const target = (context.definitionsByPath.get(targetFile) ?? []).filter((located) =>
      located.definition.container_local_id === null &&
      located.definition.name === exportedName,
    );
    return target.length === 1
      ? {
          exported_name: exportedName,
          target_definition: target[0],
          derivation: ["python_module_level_binding"],
        }
      : null;
  }
  return uniqueExportBinding(context.exportBindings.get(targetFile) ?? [], exportedName);
}

function uniqueExportBinding(bindings: ExportBinding[], exportedName: string): ExportBinding | null {
  const matches = bindings.filter((binding) => binding.exported_name === exportedName);
  return matches.length === 1 ? matches[0] ?? null : null;
}

function uniqueBindings(bindings: ExportBinding[]): ExportBinding[] {
  const byIdentity = new Map<string, ExportBinding>();
  for (const binding of bindings) {
    byIdentity.set(exportBindingIdentity(binding), binding);
  }
  return [...byIdentity.values()].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function exportBindingMapsEqual(
  left: Map<string, ExportBinding[]>,
  right: Map<string, ExportBinding[]>,
): boolean {
  const filePaths = new Set([...left.keys(), ...right.keys()]);
  return [...filePaths].every((filePath) => {
    const leftIds = (left.get(filePath) ?? []).map(exportBindingIdentity).sort();
    const rightIds = (right.get(filePath) ?? []).map(exportBindingIdentity).sort();
    return canonicalJson(leftIds) === canonicalJson(rightIds);
  });
}

function exportBindingIdentity(binding: ExportBinding): string {
  return canonicalJson({
    exported_name: binding.exported_name,
    ...(binding.target_file ? { target_file: binding.target_file } : {}),
    target_definition: binding.target_definition
      ? {
          file_path: binding.target_definition.file_path,
          local_id: binding.target_definition.definition.local_id,
        }
      : null,
  });
}

function uniqueBinding(
  context: ResolutionContext,
  sourceFile: string,
  localName: string,
): ImportBinding | null {
  const matches = (context.importBindings.get(sourceFile) ?? []).filter(
    (binding) => binding.local_name === localName,
  );
  return matches.length === 1 ? matches[0] ?? null : null;
}

function uniqueDefinitionInContainer(
  slice: SyntaxSlice,
  containerId: string,
  name: string,
): DefinitionDraft | null {
  const matches = slice.definitions.filter(
    (definition) => definition.container_local_id === containerId && definition.name === name,
  );
  return matches.length === 1 ? matches[0] ?? null : null;
}

function owningClass(location: CandidateLocation): DefinitionDraft | null {
  const source = location.candidate.source_local_ref;
  if (source.kind !== "definition") return null;
  let current = location.slice.definitions.find(
    (definition) => definition.local_id === source.local_id,
  );
  while (current) {
    if (current.kind === "class") return current;
    current = current.container_local_id
      ? location.slice.definitions.find((definition) => definition.local_id === current?.container_local_id)
      : undefined;
  }
  return null;
}

function definitionEndpoint(located: LocatedDefinition): ResolvedEndpoint {
  return {
    kind: "definition",
    file_path: located.file_path,
    definition_local_id: located.definition.local_id,
  };
}

function moduleLocalName(specifier: string): string {
  return specifier.split(/[/.]/).filter(Boolean).at(-1) ?? specifier;
}
