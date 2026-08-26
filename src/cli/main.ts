#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { canonicalJson } from "../contract/hash.js";
import type { RelationKind } from "../contract/types.js";
import { RepositoryIndexer } from "../indexing/indexer.js";
import { IndexBuildError, type IndexBuildResult, type IndexState } from "../indexing/types.js";
import { DefinitionQueryService } from "../query/definition-query.js";
import { GraphQueryService } from "../query/graph-query.js";
import { QueryError } from "../query/types.js";
import {
  discoverRepository,
  repositoryManifestSummary,
  RepositorySourceError,
} from "../repository/source.js";
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
    return statusOutput(discovered, store);
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
      ...(parsed.options.get("direction") ? { direction: parsed.options.get("direction") as "outgoing" | "incoming" | "both" } : {}),
      ...(relationKindsOption(parsed) ? { relation_kinds: relationKindsOption(parsed) } : {}),
      ...(numberOption(parsed, "max-depth") !== undefined ? { max_depth: numberOption(parsed, "max-depth") } : {}),
      ...(numberOption(parsed, "max-nodes") !== undefined ? { max_nodes: numberOption(parsed, "max-nodes") } : {}),
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

function statusOutput(
  discovered: ReturnType<typeof discoverRepository>,
  store: SqliteSnapshotStore,
): unknown {
  const current = store.getCurrentReady(discovered.source.repository_id);
  const observed = repositoryManifestSummary(discovered.source);
  const indexed = current ? manifestSummaryForState(current) : null;
  const freshness = !indexed ? "unknown" : indexed.digest === observed.digest ? "fresh" : "stale";
  return {
    schema_version: 1,
    command: "status",
    repository_id: discovered.source.repository_id,
    store_path: discovered.store_path,
    current_ready: current
      ? { snapshot_id: current.snapshot_id, graph_hash: current.graph.graph_hash, coverage: current.graph.coverage }
      : null,
    freshness: {
      status: freshness,
      reason: !indexed ? "no_ready_snapshot" : freshness === "stale" ? "manifest_digest_mismatch" : null,
      observed_manifest: observed,
      indexed_manifest: indexed,
    },
  };
}

function manifestSummaryForState(state: IndexState) {
  return {
    digest: state.source_manifest_digest,
    file_count: state.manifest.files.length,
    byte_length: state.manifest.files.reduce((total, file) => total + file.byte_length, 0),
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
    if (name === "require-fresh") {
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
  const allowed = new Set<RelationKind>([
    "CONTAINS", "IMPORTS", "EXPORTS", "CALLS", "INHERITS", "IMPLEMENTS", "REFERENCES",
  ]);
  const values = raw.split(",").filter(Boolean);
  if (values.length === 0 || values.some((value) => !allowed.has(value as RelationKind))) {
    throw new QueryError("INVALID_ARGUMENT", "--relation-kinds contains an unsupported Relation kind");
  }
  return values as RelationKind[];
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof QueryError || error instanceof SnapshotStoreError || error instanceof RepositorySourceError) {
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
  ].includes(code)) return 3;
  return 4;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
