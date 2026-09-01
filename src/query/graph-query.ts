import { performance } from "node:perf_hooks";

import type { CanonicalDefinition, CanonicalRelation } from "../canonicalization/types.js";
import type {
  GraphQueryStore,
  GraphPath,
  PathsData,
  PathsInput,
  QueryResult,
  TraverseData,
  TraverseInput,
  TraversalDirection,
  NormalizedTraversalDirection,
} from "./types.js";
import { QueryError } from "./types.js";

const DEFAULT_MAX_DEPTH = 3;
const MAX_DEPTH = 8;
const DEFAULT_MAX_NODES = 500;
const MAX_NODES = 5_000;
const DEFAULT_MAX_RESULTS = 5_000;
const MAX_RESULTS = 5_000;
const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_PATHS = 20;
const MAX_PATHS = 100;

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
    const direction = normalizeDirection(input.direction ?? "out");
    const maxDepth = bounded(input.max_depth ?? DEFAULT_MAX_DEPTH, 0, MAX_DEPTH, "max_depth");
    const maxNodes = bounded(input.max_nodes ?? DEFAULT_MAX_NODES, 1, MAX_NODES, "max_nodes");
    const maxResults = bounded(input.max_results ?? DEFAULT_MAX_RESULTS, 1, MAX_RESULTS, "max_results");
    const timeoutMs = bounded(input.timeout_ms ?? DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS, "timeout_ms");
    const relationKinds = [...new Set(input.relation_kinds ?? [])].sort();
    const scope = resolveScope(this.store, input);
    const start = this.store.readDefinition(input.repository_id, scope.snapshot_id, input.start_definition_key);
    if (!start) {
      return makeResult(scope, {
        start_definition_key: input.start_definition_key,
        nodes: [],
        relations: [],
      }, null, { max_depth: maxDepth, max_nodes: 0, max_results: 0, timeout_ms: 0 }, []);
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
        let relationIncluded = false;
        for (const neighborKey of neighboringDefinitions(relation, frontier, direction)) {
          if (definitions.has(neighborKey)) {
            relationIncluded = true;
            continue;
          }
          if (definitions.size >= maxResults) {
            truncationReason = "max_results";
            break;
          }
          if (definitions.size >= maxNodes) {
            truncationReason = "max_nodes";
            break;
          }
          const definition = this.store.readDefinition(input.repository_id, scope.snapshot_id, neighborKey);
          if (definition) {
            definitions.set(neighborKey, { definition, depth: depth + 1 });
            next.add(neighborKey);
            relationIncluded = true;
          }
        }
        if (relationIncluded) relations.set(relation.relation_key, relation);
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
        max_results: nodes.length,
        timeout_ms: Math.ceil(performance.now() - started),
      },
      [...nodes.flatMap((node) => node.definition.evidence_ids), ...edges.flatMap((edge) => edge.evidence_ids)],
    );
  }

  findPaths(input: PathsInput): QueryResult<PathsData> {
    if (!input.start_definition_key || !input.end_definition_key) {
      throw new QueryError("INVALID_ARGUMENT", "start_definition_key and end_definition_key are required");
    }
    const direction = normalizeDirection(input.direction ?? "out");
    const maxDepth = bounded(input.max_depth ?? DEFAULT_MAX_DEPTH, 0, MAX_DEPTH, "max_depth");
    const maxNodes = bounded(input.max_nodes ?? DEFAULT_MAX_NODES, 1, MAX_NODES, "max_nodes");
    const maxPaths = bounded(input.max_paths ?? DEFAULT_MAX_PATHS, 1, MAX_PATHS, "max_paths");
    const timeoutMs = bounded(input.timeout_ms ?? DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS, "timeout_ms");
    const relationKinds = [...new Set(input.relation_kinds ?? [])].sort();
    const scope = resolveScope(this.store, input);
    const start = this.store.readDefinition(input.repository_id, scope.snapshot_id, input.start_definition_key);
    const end = this.store.readDefinition(input.repository_id, scope.snapshot_id, input.end_definition_key);
    if (!start || !end) {
      return makeResult(scope, {
        start_definition_key: input.start_definition_key,
        end_definition_key: input.end_definition_key,
        paths: [],
      }, null, { max_depth: 0, max_nodes: 0, max_paths: 0, timeout_ms: 0 }, []);
    }
    if (start.definition_key === end.definition_key) {
      return makeResult(scope, {
        start_definition_key: start.definition_key,
        end_definition_key: end.definition_key,
        paths: [{ nodes: [start], relations: [] }],
      }, null, { max_depth: 0, max_nodes: 1, max_paths: 1, timeout_ms: 0 }, start.evidence_ids);
    }

    interface PendingPath {
      definitions: CanonicalDefinition[];
      relations: CanonicalRelation[];
    }
    const started = performance.now();
    const queue: PendingPath[] = [{ definitions: [start], relations: [] }];
    const paths: GraphPath[] = [];
    let exploredNodes = 1;
    let truncationReason: string | null = null;

    while (queue.length > 0) {
      if (performance.now() - started >= timeoutMs) {
        truncationReason = "timeout_ms";
        break;
      }
      const current = queue.shift()!;
      const tail = current.definitions.at(-1)!;
      if (current.relations.length >= maxDepth) {
        const probe = this.store.readAdjacentRelations(
          input.repository_id,
          scope.snapshot_id,
          [tail.definition_key],
          direction,
          relationKinds,
        );
        const visited = new Set(current.definitions.map((definition) => definition.definition_key));
        if (probe.some((relation) =>
          neighboringDefinitions(relation, [tail.definition_key], direction).some((key) => !visited.has(key)),
        )) {
          truncationReason ??= "max_depth";
        }
        continue;
      }
      const adjacent = this.store.readAdjacentRelations(
        input.repository_id,
        scope.snapshot_id,
        [tail.definition_key],
        direction,
        relationKinds,
      );
      const visited = new Set(current.definitions.map((definition) => definition.definition_key));
      for (const relation of adjacent) {
        for (const neighborKey of neighboringDefinitions(relation, [tail.definition_key], direction)) {
          if (visited.has(neighborKey)) continue;
          if (exploredNodes >= maxNodes) {
            truncationReason = "max_nodes";
            break;
          }
          const definition = this.store.readDefinition(input.repository_id, scope.snapshot_id, neighborKey);
          if (!definition) continue;
          exploredNodes += 1;
          const next: PendingPath = {
            definitions: [...current.definitions, definition],
            relations: [...current.relations, relation],
          };
          if (neighborKey === end.definition_key) {
            paths.push({ nodes: next.definitions, relations: next.relations });
            if (paths.length >= maxPaths) {
              truncationReason = "max_paths";
              break;
            }
          } else {
            queue.push(next);
          }
        }
        if (["max_nodes", "max_paths"].includes(truncationReason ?? "")) break;
      }
      if (["max_nodes", "max_paths"].includes(truncationReason ?? "")) break;
      queue.sort(comparePendingPaths);
    }

    const ordered = paths.sort((left, right) =>
      left.relations.length - right.relations.length ||
      relationSequence(left.relations).localeCompare(relationSequence(right.relations)),
    );
    return makeResult(
      scope,
      {
        start_definition_key: start.definition_key,
        end_definition_key: end.definition_key,
        paths: ordered,
      },
      truncationReason,
      {
        max_depth: ordered.reduce((maximum, path) => Math.max(maximum, path.relations.length), 0),
        max_nodes: exploredNodes,
        max_paths: ordered.length,
        timeout_ms: Math.ceil(performance.now() - started),
      },
      ordered.flatMap((path) => [
        ...path.nodes.flatMap((definition) => definition.evidence_ids),
        ...path.relations.flatMap((relation) => relation.evidence_ids),
      ]),
    );
  }
}

function resolveScope(
  store: GraphQueryStore,
  input: Pick<
    TraverseInput | PathsInput,
    "repository_id" | "snapshot" | "observed_manifest_digest" | "require_fresh"
  >,
): Scope {
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

function comparePendingPaths(
  left: { relations: CanonicalRelation[] },
  right: { relations: CanonicalRelation[] },
): number {
  return left.relations.length - right.relations.length ||
    relationSequence(left.relations).localeCompare(relationSequence(right.relations));
}

function relationSequence(relations: CanonicalRelation[]): string {
  return relations.map((relation) => relation.relation_key).join("\0");
}

function neighboringDefinitions(
  relation: CanonicalRelation,
  frontier: string[],
  direction: NormalizedTraversalDirection,
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

function normalizeDirection(direction: TraversalDirection): NormalizedTraversalDirection {
  if (direction === "out" || direction === "outgoing") return "outgoing";
  if (direction === "in" || direction === "incoming") return "incoming";
  if (direction === "both") return "both";
  throw new QueryError("INVALID_ARGUMENT", `Invalid traversal direction: ${direction}`);
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
