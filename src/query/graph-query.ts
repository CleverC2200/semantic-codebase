import { performance } from "node:perf_hooks";

import type { CanonicalDefinition, CanonicalRelation } from "../canonicalization/types.js";
import type {
  GraphQueryStore,
  QueryResult,
  TraverseData,
  TraverseInput,
  TraversalDirection,
} from "./types.js";
import { QueryError } from "./types.js";

const DEFAULT_MAX_DEPTH = 3;
const MAX_DEPTH = 8;
const DEFAULT_MAX_NODES = 500;
const MAX_NODES = 5_000;
const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 10_000;

interface Scope {
  repository_id: string;
  snapshot_id: string;
  revision: null;
  freshness: "fresh" | "stale" | "unknown";
  coverage: NonNullable<ReturnType<GraphQueryStore["resolveReadySnapshot"]>>["coverage"];
}

export class GraphQueryService {
  constructor(private readonly store: GraphQueryStore) {}

  traverse(input: TraverseInput): QueryResult<TraverseData> {
    if (!input.start_definition_key) {
      throw new QueryError("INVALID_ARGUMENT", "start_definition_key is required");
    }
    const direction = input.direction ?? "outgoing";
    if (!["outgoing", "incoming", "both"].includes(direction)) {
      throw new QueryError("INVALID_ARGUMENT", `Invalid traversal direction: ${direction}`);
    }
    const maxDepth = bounded(input.max_depth ?? DEFAULT_MAX_DEPTH, 0, MAX_DEPTH, "max_depth");
    const maxNodes = bounded(input.max_nodes ?? DEFAULT_MAX_NODES, 1, MAX_NODES, "max_nodes");
    const timeoutMs = bounded(input.timeout_ms ?? DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS, "timeout_ms");
    const relationKinds = [...new Set(input.relation_kinds ?? [])].sort();
    const scope = resolveScope(this.store, input);
    const start = this.store.readDefinition(input.repository_id, scope.snapshot_id, input.start_definition_key);
    if (!start) {
      return makeResult(scope, {
        start_definition_key: input.start_definition_key,
        nodes: [],
        relations: [],
      }, null, { max_depth: maxDepth, max_nodes: 0, timeout_ms: 0 }, []);
    }

    const started = performance.now();
    const definitions = new Map<string, { definition: CanonicalDefinition; depth: number }>([
      [start.definition_key, { definition: start, depth: 0 }],
    ]);
    const relations = new Map<string, CanonicalRelation>();
    let frontier = [start.definition_key];
    let truncationReason: string | null = null;
    let depth = 0;

    while (frontier.length > 0 && depth < maxDepth) {
      if (performance.now() - started >= timeoutMs) {
        truncationReason = "timeout_ms";
        break;
      }
      const adjacent = this.store.readAdjacentRelations(
        input.repository_id,
        scope.snapshot_id,
        frontier,
        direction,
        relationKinds,
      );
      const next = new Set<string>();
      for (const relation of adjacent) {
        relations.set(relation.relation_key, relation);
        for (const neighborKey of neighboringDefinitions(relation, frontier, direction)) {
          if (definitions.has(neighborKey)) continue;
          if (definitions.size >= maxNodes) {
            truncationReason = "max_nodes";
            break;
          }
          const definition = this.store.readDefinition(input.repository_id, scope.snapshot_id, neighborKey);
          if (definition) {
            definitions.set(neighborKey, { definition, depth: depth + 1 });
            next.add(neighborKey);
          }
        }
        if (truncationReason) break;
      }
      if (truncationReason) break;
      frontier = [...next].sort();
      depth += 1;
    }

    if (!truncationReason && frontier.length > 0 && depth === maxDepth) {
      const probe = this.store.readAdjacentRelations(
        input.repository_id,
        scope.snapshot_id,
        frontier,
        direction,
        relationKinds,
      );
      if (probe.some((relation) =>
        neighboringDefinitions(relation, frontier, direction).some((key) => !definitions.has(key)),
      )) {
        truncationReason = "max_depth";
      }
    }

    const nodes = [...definitions.values()].sort((left, right) =>
      left.depth - right.depth || left.definition.definition_key.localeCompare(right.definition.definition_key),
    );
    const edges = [...relations.values()].sort((left, right) =>
      left.kind.localeCompare(right.kind) || left.relation_key.localeCompare(right.relation_key),
    );
    return makeResult(
      scope,
      { start_definition_key: input.start_definition_key, nodes, relations: edges },
      truncationReason,
      {
        max_depth: nodes.reduce((maximum, node) => Math.max(maximum, node.depth), 0),
        max_nodes: nodes.length,
        timeout_ms: Math.ceil(performance.now() - started),
      },
      [...nodes.flatMap((node) => node.definition.evidence_ids), ...edges.flatMap((edge) => edge.evidence_ids)],
    );
  }
}

function resolveScope(store: GraphQueryStore, input: TraverseInput): Scope {
  if (!input.repository_id) throw new QueryError("INVALID_ARGUMENT", "repository_id is required");
  const snapshot = store.resolveReadySnapshot(input.repository_id, input.snapshot);
  if (!snapshot) {
    throw new QueryError(
      input.snapshot === "current_ready" ? "NO_READY_SNAPSHOT" : "SNAPSHOT_NOT_FOUND",
      input.snapshot === "current_ready" ? "Repository has no Ready Snapshot" : `Snapshot not found: ${input.snapshot}`,
    );
  }
  const freshness = input.observed_manifest_digest
    ? input.observed_manifest_digest === snapshot.source_manifest_digest ? "fresh" as const : "stale" as const
    : "unknown" as const;
  if (input.require_fresh && freshness !== "fresh") {
    throw new QueryError("STALE_SNAPSHOT", "Ready Snapshot does not match the observed Manifest");
  }
  return {
    repository_id: input.repository_id,
    snapshot_id: snapshot.snapshot_id,
    revision: null,
    freshness,
    coverage: snapshot.coverage,
  };
}

function neighboringDefinitions(
  relation: CanonicalRelation,
  frontier: string[],
  direction: TraversalDirection,
): string[] {
  const frontierSet = new Set(frontier);
  const neighbors: string[] = [];
  if (
    direction !== "incoming" &&
    relation.source.kind === "definition" &&
    frontierSet.has(relation.source.definition_key) &&
    relation.target.kind === "definition"
  ) {
    neighbors.push(relation.target.definition_key);
  }
  if (
    direction !== "outgoing" &&
    relation.target.kind === "definition" &&
    frontierSet.has(relation.target.definition_key) &&
    relation.source.kind === "definition"
  ) {
    neighbors.push(relation.source.definition_key);
  }
  return [...new Set(neighbors)].sort();
}

function makeResult<T>(
  scope: Scope,
  data: T,
  truncationReason: string | null,
  budgetUsed: Record<string, number>,
  evidenceRefs: string[],
): QueryResult<T> {
  const { coverage, ...snapshot } = scope;
  return {
    schema_version: 1,
    snapshot,
    data,
    completeness: {
      complete: truncationReason === null,
      truncated: truncationReason !== null,
      reason: truncationReason,
      budget_used: budgetUsed,
    },
    coverage,
    evidence_refs: [...new Set(evidenceRefs)].sort(),
  };
}

function bounded(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new QueryError("INVALID_ARGUMENT", `${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
