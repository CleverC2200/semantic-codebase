#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

import { canonicalJson } from "../contract/hash.js";
import {
  answerContextPackage,
  answerContextPackageWithCodex,
  buildContextPackage,
  ContextPackageError,
} from "../context/index.js";
import { DEFINITION_KINDS, RELATION_KINDS, type DefinitionKind, type RelationKind } from "../contract/types.js";
import { RepositoryIndexer } from "../indexing/indexer.js";
import { IndexBuildError, type IndexBuildResult } from "../indexing/types.js";
import { DefinitionQueryService } from "../query/definition-query.js";
import { GraphQueryService } from "../query/graph-query.js";
import { QueryError } from "../query/types.js";
import { importOpenTelemetryJson, RuntimeImportError } from "../runtime/index.js";
import {
  SEMANTIC_FACT_KINDS,
  SemanticEnrichmentError,
  SemanticRepositoryEnricher,
  type SemanticFactKind,
} from "../semantic/index.js";
import {
  discoverRepository,
  repositoryManifestSummary,
  RepositorySourceError,
} from "../repository/source.js";
import { repositoryStatus } from "../repository/status.js";
import { PythonTreeSitterAdapter, TypeScriptTreeSitterAdapter } from "../syntax/index.js";
import { SqliteSnapshotStore } from "../store/sqlite-store.js";
import { SnapshotStoreError } from "../store/types.js";

interface CliIo {
  stdout: { write(value: string): unknown };
  stderr: { write(value: string): unknown };
}

interface ParsedArguments {
  command: string[];
  options: Map<string, string>;
}

export async function runCli(argv: string[], io: CliIo = process): Promise<number> {
  try {
    const parsed = parseArguments(argv);
    validateCommandOptions(parsed);
    const repositoryPath = requiredOption(parsed, "repo");
    const discovered = discoverRepository(repositoryPath, parsed.options.get("store"));
    const store = new SqliteSnapshotStore(discovered.store_path);
    try {
      const output = execute(parsed, discovered, store);
      io.stdout.write(`${canonicalJson(output)}\n`);
      return 0;
    } finally {
      store.close();
    }
  } catch (error) {
    const normalized = normalizeError(error);
    io.stdout.write(`${canonicalJson({ schema_version: 1, error: normalized })}\n`);
    return exitCode(normalized.code);
  }
}

function execute(
  parsed: ParsedArguments,
  discovered: ReturnType<typeof discoverRepository>,
  store: SqliteSnapshotStore,
): unknown {
  const command = parsed.command.join(" ");
  if (command === "index" || command === "sync") {
    const indexer = createIndexer();
    const previous = command === "sync" ? store.getCurrentReady(discovered.source.repository_id) : null;
    const result = previous
      ? indexer.buildIncremental(previous, discovered.source)
      : indexer.buildFull(discovered.source);
    return publishIndexResult(command, discovered, store, result);
  }
  if (command === "status") {
    return repositoryStatus(discovered, store);
  }
  if (command === "semantic build") {
    const state = store.getCurrentReady(discovered.source.repository_id);
    if (!state) throw new QueryError("NO_READY_SNAPSHOT", "Repository has no Ready Snapshot");
    if (repositoryManifestSummary(discovered.source).digest !== state.source_manifest_digest) {
      throw new QueryError("STALE_SNAPSHOT", "Ready Snapshot does not match the observed Manifest");
    }
    const overlay = new SemanticRepositoryEnricher().enrich({ state, source: discovered.source });
    store.publishSemanticOverlay(overlay);
    return {
      schema_version: 1,
      command,
      repository_id: state.repository_id,
      snapshot_id: state.snapshot_id,
      overlay_hash: overlay.overlay_hash,
      profile: overlay.profile,
      coverage: overlay.coverage,
      fact_count: overlay.facts.length,
      evidence_count: overlay.evidence.length,
      store_path: discovered.store_path,
    };
  }
  if (command === "semantic status") {
    const state = store.getCurrentReady(discovered.source.repository_id);
    const overlay = state ? store.getSemanticOverlay(state.repository_id, state.snapshot_id) : null;
    return {
      schema_version: 1,
      repository_id: discovered.source.repository_id,
      snapshot_id: state?.snapshot_id ?? null,
      semantic_overlay: overlay ? {
        status: "ready",
        overlay_hash: overlay.overlay_hash,
        profile: overlay.profile,
        coverage: overlay.coverage,
      } : { status: "unavailable" },
    };
  }
  if (command === "semantic facts") {
    const selector = parsed.options.get("snapshot") ?? "current_ready";
    const state = selector === "current_ready"
      ? store.getCurrentReady(discovered.source.repository_id)
      : store.getSnapshot(discovered.source.repository_id, selector);
    if (!state) throw new QueryError("SNAPSHOT_NOT_FOUND", `Snapshot not found: ${selector}`);
    const freshness = repositoryManifestSummary(discovered.source).digest === state.source_manifest_digest
      ? "fresh"
      : "stale";
    if (parsed.options.get("require-fresh") === "true" && freshness !== "fresh") {
      throw new QueryError("STALE_SNAPSHOT", "Ready Snapshot does not match the observed Manifest");
    }
    const overlay = store.getSemanticOverlay(state.repository_id, state.snapshot_id);
    if (!overlay) throw new QueryError("SEMANTIC_OVERLAY_NOT_FOUND", "Snapshot has no Semantic Overlay");
    const facts = store.readSemanticFacts(state.repository_id, state.snapshot_id, {
      ...(parsed.options.get("file-path") ? { file_path: parsed.options.get("file-path") } : {}),
      ...(parsed.options.get("definition-key") ? { definition_key: parsed.options.get("definition-key") } : {}),
      ...(semanticFactKindOption(parsed) ? { kind: semanticFactKindOption(parsed) } : {}),
      ...(numberOption(parsed, "max-results") !== undefined ? { limit: numberOption(parsed, "max-results") } : {}),
    });
    const evidenceIds = new Set(facts.flatMap((fact) => fact.evidence_ids));
    return {
      schema_version: 1,
      snapshot: { snapshot_id: state.snapshot_id, freshness },
      data: {
        facts,
        evidence: overlay.evidence.filter((item) => evidenceIds.has(item.evidence_id)),
      },
      coverage: overlay.coverage,
    };
  }
  if (command === "runtime import") {
    const state = store.getCurrentReady(discovered.source.repository_id);
    if (!state) throw new QueryError("NO_READY_SNAPSHOT", "Repository has no Ready Snapshot");
    const overlay = store.getSemanticOverlay(state.repository_id, state.snapshot_id);
    if (!overlay) throw new QueryError("SEMANTIC_OVERLAY_NOT_FOUND", "Snapshot has no Semantic Overlay");
    const tracePath = requiredOption(parsed, "trace");
    const trace = JSON.parse(readFileSync(tracePath, "utf8")) as unknown;
    return importOpenTelemetryJson({
      repository_id: state.repository_id,
      snapshot_id: state.snapshot_id,
      definitions: state.graph.definitions,
      overlay,
      trace,
    });
  }
  if (command === "context ask") {
    const state = store.getCurrentReady(discovered.source.repository_id);
    if (!state) throw new QueryError("NO_READY_SNAPSHOT", "Repository has no Ready Snapshot");
    const overlay = store.getSemanticOverlay(state.repository_id, state.snapshot_id);
    if (!overlay) throw new QueryError("SEMANTIC_OVERLAY_NOT_FOUND", "Snapshot has no Semantic Overlay");
    const runtime = parsed.options.get("trace")
      ? importOpenTelemetryJson({
          repository_id: state.repository_id,
          snapshot_id: state.snapshot_id,
          definitions: state.graph.definitions,
          overlay,
          trace: JSON.parse(readFileSync(parsed.options.get("trace")!, "utf8")) as unknown,
        })
      : null;
    const context = buildContextPackage({
      state,
      overlay,
      question: requiredOption(parsed, "question"),
      ...(parsed.options.get("file-path") ? { file_path: parsed.options.get("file-path") } : {}),
      ...(parsed.options.get("definition-key") ? { definition_key: parsed.options.get("definition-key") } : {}),
      ...(numberOption(parsed, "max-results") !== undefined ? { max_facts: numberOption(parsed, "max-results") } : {}),
      runtime,
    });
    const answer = parsed.options.get("codex") === "true"
      ? answerContextPackageWithCodex(context)
      : answerContextPackage(context);
    return { schema_version: 1, context, answer };
  }

  const query = new DefinitionQueryService(store);
  const observedManifest = repositoryManifestSummary(discovered.source);
  const scope = {
    repository_id: discovered.source.repository_id,
    snapshot: parsed.options.get("snapshot") ?? "current_ready",
    observed_manifest_digest: observedManifest.digest,
    require_fresh: parsed.options.get("require-fresh") === "true",
  };
  if (command === "definitions find") {
    return query.findDefinitions({
      ...scope,
      query: requiredOption(parsed, "query"),
      ...(definitionKindOption(parsed) ? { kind: definitionKindOption(parsed) } : {}),
      ...(parsed.options.get("file-path") ? { file_path: parsed.options.get("file-path") } : {}),
      ...(numberOption(parsed, "max-results") !== undefined
        ? { max_results: numberOption(parsed, "max-results") }
        : {}),
    });
  }
  if (command === "definition get") {
    return query.getDefinition({ ...scope, definition_key: requiredOption(parsed, "definition-key") });
  }
  if (command === "evidence get") {
    return query.getEvidence({
      ...scope,
      evidence_id: requiredOption(parsed, "evidence-id"),
      repository_root: discovered.root_path,
      ...(numberOption(parsed, "source-bytes") !== undefined
        ? { source_bytes: numberOption(parsed, "source-bytes") }
        : {}),
    });
  }
  if (command === "graph traverse") {
    return new GraphQueryService(store).traverse({
      ...scope,
      start_definition_key: requiredOption(parsed, "start-definition-key"),
      ...(parsed.options.get("direction") ? { direction: parsed.options.get("direction") as "out" | "in" | "outgoing" | "incoming" | "both" } : {}),
      ...(relationKindsOption(parsed) ? { relation_kinds: relationKindsOption(parsed) } : {}),
      ...(numberOption(parsed, "max-depth") !== undefined ? { max_depth: numberOption(parsed, "max-depth") } : {}),
      ...(numberOption(parsed, "max-nodes") !== undefined ? { max_nodes: numberOption(parsed, "max-nodes") } : {}),
      ...(numberOption(parsed, "max-results") !== undefined ? { max_results: numberOption(parsed, "max-results") } : {}),
      ...(numberOption(parsed, "timeout-ms") !== undefined ? { timeout_ms: numberOption(parsed, "timeout-ms") } : {}),
    });
  }
  if (command === "graph paths") {
    return new GraphQueryService(store).findPaths({
      ...scope,
      start_definition_key: requiredOption(parsed, "start-definition-key"),
      end_definition_key: requiredOption(parsed, "end-definition-key"),
      ...(parsed.options.get("direction") ? { direction: parsed.options.get("direction") as "out" | "in" | "outgoing" | "incoming" | "both" } : {}),
      ...(relationKindsOption(parsed) ? { relation_kinds: relationKindsOption(parsed) } : {}),
      ...(numberOption(parsed, "max-depth") !== undefined ? { max_depth: numberOption(parsed, "max-depth") } : {}),
      ...(numberOption(parsed, "max-nodes") !== undefined ? { max_nodes: numberOption(parsed, "max-nodes") } : {}),
      ...(numberOption(parsed, "max-paths") !== undefined ? { max_paths: numberOption(parsed, "max-paths") } : {}),
      ...(numberOption(parsed, "timeout-ms") !== undefined ? { timeout_ms: numberOption(parsed, "timeout-ms") } : {}),
    });
  }
  throw new QueryError("INVALID_ARGUMENT", `Unknown command: ${command || "<empty>"}`);
}

function createIndexer(): RepositoryIndexer {
  return new RepositoryIndexer({
    adapters: [new TypeScriptTreeSitterAdapter(), new PythonTreeSitterAdapter()],
    index_config: { excluded_directories: "v1-defaults" },
  });
}

function publishIndexResult(
  command: "index" | "sync",
  discovered: ReturnType<typeof discoverRepository>,
  store: SqliteSnapshotStore,
  result: IndexBuildResult,
): unknown {
  const existing = store.getSnapshotSummary(discovered.source.repository_id, result.state.snapshot_id);
  const verifyObservedManifest = () => {
    const observed = discoverRepository(discovered.root_path, discovered.store_path);
    if (repositoryManifestSummary(observed.source).digest !== result.state.source_manifest_digest) {
      throw new QueryError("INDEX_BUILD_FAILED", "Repository Manifest changed during index publication");
    }
  };
  if (existing && ["ready", "superseded"].includes(existing.status)) {
    verifyObservedManifest();
    store.activateReady(discovered.source.repository_id, result.state.snapshot_id);
  } else {
    store.beginBuild(discovered.source.repository_id, result.state.snapshot_id);
    try {
      store.publishReady(result.state, { before_pointer: verifyObservedManifest });
    } catch (error) {
      store.markFailed(discovered.source.repository_id, result.state.snapshot_id, String(error));
      throw error;
    }
  }
  return {
    schema_version: 1,
    command,
    repository_id: discovered.source.repository_id,
    snapshot_id: result.state.snapshot_id,
    graph_hash: result.state.graph.graph_hash,
    coverage: result.state.graph.coverage,
    receipt: result.receipt,
    reused_snapshot: Boolean(existing),
    store_path: discovered.store_path,
  };
}

function parseArguments(argv: string[]): ParsedArguments {
  const command: string[] = [];
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("--")) {
      if (options.size > 0) throw new QueryError("INVALID_ARGUMENT", `Unexpected argument: ${argument}`);
      command.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (name === "require-fresh" || name === "codex") {
      if (options.has(name)) throw new QueryError("INVALID_ARGUMENT", `Duplicate option: --${name}`);
      options.set(name, "true");
      continue;
    }
    const value = argv[index + 1];
    if (!name || !value || value.startsWith("--")) {
      throw new QueryError("INVALID_ARGUMENT", `Option --${name} requires a value`);
    }
    if (options.has(name)) throw new QueryError("INVALID_ARGUMENT", `Duplicate option: --${name}`);
    options.set(name, value);
    index += 1;
  }
  return { command, options };
}

function validateCommandOptions(parsed: ParsedArguments): void {
  const command = parsed.command.join(" ");
  const common = ["repo", "store"];
  const queryScope = [...common, "snapshot", "require-fresh"];
  const allowedByCommand: Record<string, string[]> = {
    index: common,
    sync: common,
    status: common,
    "semantic build": common,
    "semantic status": common,
    "semantic facts": [...queryScope, "file-path", "definition-key", "kind", "max-results"],
    "runtime import": [...common, "trace"],
    "context ask": [...common, "question", "file-path", "definition-key", "max-results", "trace", "codex"],
    "definitions find": [...queryScope, "query", "kind", "file-path", "max-results"],
    "definition get": [...queryScope, "definition-key"],
    "evidence get": [...queryScope, "evidence-id", "source-bytes"],
    "graph traverse": [
      ...queryScope,
      "start-definition-key",
      "direction",
      "relation-kinds",
      "max-depth",
      "max-nodes",
      "max-results",
      "timeout-ms",
    ],
    "graph paths": [
      ...queryScope,
      "start-definition-key",
      "end-definition-key",
      "direction",
      "relation-kinds",
      "max-depth",
      "max-nodes",
      "max-paths",
      "timeout-ms",
    ],
  };
  const allowed = allowedByCommand[command];
  if (!allowed) throw new QueryError("INVALID_ARGUMENT", `Unknown command: ${command || "<empty>"}`);
  const unknown = [...parsed.options.keys()].find((name) => !allowed.includes(name));
  if (unknown) throw new QueryError("INVALID_ARGUMENT", `Unknown option for ${command}: --${unknown}`);
}

function requiredOption(parsed: ParsedArguments, name: string): string {
  const value = parsed.options.get(name);
  if (!value) throw new QueryError("INVALID_ARGUMENT", `--${name} is required`);
  return value;
}

function numberOption(parsed: ParsedArguments, name: string): number | undefined {
  const raw = parsed.options.get(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new QueryError("INVALID_ARGUMENT", `--${name} must be an integer`);
  return value;
}

function relationKindsOption(parsed: ParsedArguments): RelationKind[] | undefined {
  const raw = parsed.options.get("relation-kinds");
  if (!raw) return undefined;
  const allowed = new Set<RelationKind>(RELATION_KINDS);
  const values = raw.split(",").filter(Boolean);
  if (values.length === 0 || values.some((value) => !allowed.has(value as RelationKind))) {
    throw new QueryError("INVALID_ARGUMENT", "--relation-kinds contains an unsupported Relation kind");
  }
  return values as RelationKind[];
}

function definitionKindOption(parsed: ParsedArguments): DefinitionKind | undefined {
  const raw = parsed.options.get("kind");
  if (!raw) return undefined;
  if (!DEFINITION_KINDS.includes(raw as DefinitionKind)) {
    throw new QueryError("INVALID_ARGUMENT", `Unsupported Definition kind: ${raw}`);
  }
  return raw as DefinitionKind;
}

function semanticFactKindOption(parsed: ParsedArguments): SemanticFactKind | undefined {
  const raw = parsed.options.get("kind");
  if (!raw) return undefined;
  if (!SEMANTIC_FACT_KINDS.includes(raw as SemanticFactKind)) {
    throw new QueryError("INVALID_ARGUMENT", `Unsupported Semantic Fact kind: ${raw}`);
  }
  return raw as SemanticFactKind;
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (
    error instanceof QueryError ||
    error instanceof SnapshotStoreError ||
    error instanceof RepositorySourceError ||
    error instanceof SemanticEnrichmentError ||
    error instanceof RuntimeImportError ||
    error instanceof ContextPackageError
  ) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof IndexBuildError) {
    return { code: "INDEX_BUILD_FAILED", message: error.message };
  }
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    return { code: "REPOSITORY_NOT_FOUND", message: "Repository path does not exist" };
  }
  return { code: "INTERNAL_QUERY_ERROR", message: error instanceof Error ? error.message : String(error) };
}

function exitCode(code: string): number {
  if (code === "INVALID_ARGUMENT") return 2;
  if ([
    "REPOSITORY_NOT_FOUND",
    "SNAPSHOT_NOT_FOUND",
    "NO_READY_SNAPSHOT",
    "SNAPSHOT_NOT_READY",
    "STALE_SNAPSHOT",
    "SEMANTIC_OVERLAY_NOT_FOUND",
  ].includes(code)) return 3;
  return 4;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
