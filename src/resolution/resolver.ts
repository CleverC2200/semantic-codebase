import path from "node:path";

import { canonicalJson } from "../contract/hash.js";
import type {
  DefinitionDraft,
  Diagnostic,
  RelationCandidate,
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

interface LocatedDefinition {
  file_path: string;
  definition: DefinitionDraft;
}

interface ImportBinding {
  local_name: string;
  target_file?: string;
  target_definition?: LocatedDefinition;
}

interface ResolutionContext {
  view: FrozenRepositoryView;
  slicesByPath: Map<string, SyntaxSlice>;
  definitions: LocatedDefinition[];
  importBindings: Map<string, ImportBinding[]>;
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
    const definitions = view.slices.flatMap((slice) =>
      slice.definitions.map((definition) => ({ file_path: slice.file.relative_path, definition })),
    );
    const context: ResolutionContext = {
      view,
      slicesByPath,
      definitions,
      importBindings: new Map(),
    };
    context.importBindings = buildImportBindings(context);

    const candidates = view.slices
      .flatMap((slice) =>
        slice.relation_candidates.map((candidate) => ({
          file_path: slice.file.relative_path,
          slice,
          candidate,
        })),
      )
      .sort(compareCandidateLocations);
    const resolved_relations: ResolvedRelationDraft[] = [];
    const unresolved_candidates: RelationCandidate[] = [];
    const diagnostics: Diagnostic[] = [];

    for (const location of candidates) {
      const result = resolveCandidate(location, context);
      if (!result) {
        unresolved_candidates.push(location.candidate);
        const evidence = location.slice.evidence.find((item) =>
          location.candidate.evidence_local_ids.includes(item.local_id),
        );
        diagnostics.push({
          code: "unresolved_relation_candidate",
          severity: "info",
          file_path: location.file_path,
          ...(evidence ? { span: evidence.span } : {}),
          message: `${location.candidate.kind} candidate has zero or multiple exact targets`,
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
      const targetFile = resolveModulePath(slice.file.relative_path, slice.file.language, hint.specifier, context);
      const localName = hint.alias ?? hint.imported_name ?? moduleLocalName(hint.specifier);
      const binding: ImportBinding = { local_name: localName };
      if (targetFile) binding.target_file = targetFile;
      if (targetFile && hint.imported_name && !["*", "default"].includes(hint.imported_name)) {
        const target = uniqueDefinition(context, targetFile, hint.imported_name);
        if (target) binding.target_definition = target;
      }
      fileBindings.push(binding);
    }
    bindings.set(slice.file.relative_path, fileBindings);
  }
  return bindings;
}

function resolveCandidate(
  location: CandidateLocation,
  context: ResolutionContext,
): TargetResolution | null {
  const { candidate, file_path, slice } = location;
  if (["IMPORTS", "EXPORTS"].includes(candidate.kind) && candidate.target_hint.kind === "module") {
    return resolveModuleHint(file_path, slice.file.language, candidate.target_hint, context);
  }
  if (candidate.kind === "EXPORTS" && candidate.target_hint.kind === "name") {
    const definition = uniqueDefinition(context, file_path, candidate.target_hint.name);
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
  if (hint.imported_name === "default") return null;
  const definition = uniqueDefinition(context, targetFile, hint.imported_name);
  return definition
    ? {
        target: definitionEndpoint(definition),
        derivation: ["manifest_unique_module_path", "target_file_unique_name"],
      }
    : null;
}

function resolveCall(location: CandidateLocation, context: ResolutionContext): TargetResolution | null {
  const { target_hint: hint } = location.candidate;
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
  if (binding?.target_file) {
    const definition = uniqueDefinition(context, binding.target_file, hint.member);
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
    const target = binding?.target_file
      ? uniqueDefinition(context, binding.target_file, hint.name, ["class", "interface"])
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
  const matches = context.definitions.filter(
    (located) =>
      located.file_path === filePath &&
      (located.definition.name === name || located.definition.qualified_name === name) &&
      (!kinds || kinds.includes(located.definition.kind)),
  );
  return matches.length === 1 ? matches[0] ?? null : null;
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

function compareCandidateLocations(left: CandidateLocation, right: CandidateLocation): number {
  return (
    left.file_path.localeCompare(right.file_path) ||
    canonicalJson(left.candidate).localeCompare(canonicalJson(right.candidate))
  );
}
