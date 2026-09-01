#!/usr/bin/env node
import { existsSync } from "node:fs";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

import { canonicalJson } from "../contract/hash.js";
import {
  DEFINITION_KINDS,
  RELATION_KINDS,
  type DefinitionKind,
  type RelationKind,
} from "../contract/types.js";
import { DefinitionQueryService } from "../query/definition-query.js";
import { GraphQueryService } from "../query/graph-query.js";
import { QueryError } from "../query/types.js";
import {
  discoverRepository,
  repositoryManifestSummary,
  RepositorySourceError,
} from "../repository/source.js";
import { repositoryStatus } from "../repository/status.js";
import { SqliteSnapshotStore } from "../store/sqlite-store.js";
import { SnapshotStoreError } from "../store/types.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface ToolResult {
  structuredContent: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

type JsonSchemaValue = string | number | boolean;
type JsonSchemaProperty = {
  type: string;
  enum?: JsonSchemaValue[];
  items?: { type: string; enum?: JsonSchemaValue[] };
  minimum?: number;
  maximum?: number;
};

type JsonSchema = {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  additionalProperties: false;
};

export const MCP_TOOLS: Array<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: { readOnlyHint: true; destructiveHint: false; idempotentHint: true; openWorldHint: false };
}> = [
  tool("semantic_codebase_status", "读取 Repository 当前 Ready Snapshot 与 Freshness。", {}, []),
  tool("semantic_codebase_find_definitions", "按名称或 qualified name 查找 Definition。", {
    query: { type: "string" },
    kind: { type: "string", enum: [...DEFINITION_KINDS] },
    file_path: { type: "string" },
    max_results: { type: "number", minimum: 1, maximum: 500 },
  }, ["query"]),
  tool("semantic_codebase_get_definition", "按 Definition Key 读取 Definition。", {
    definition_key: { type: "string" },
  }, ["definition_key"]),
  tool("semantic_codebase_get_evidence", "读取 Evidence 与 digest 校验后的源码片段。", {
    evidence_id: { type: "string" },
    source_bytes: { type: "number", minimum: 1, maximum: 131072 },
  }, ["evidence_id"]),
  tool("semantic_codebase_traverse", "按预算和方向遍历 Definition Graph。", {
    start_definition_key: { type: "string" },
    direction: { type: "string", enum: ["out", "in", "both", "outgoing", "incoming"] },
    relation_kinds: { type: "array", items: { type: "string", enum: [...RELATION_KINDS] } },
    max_depth: { type: "number", minimum: 0, maximum: 8 },
    max_nodes: { type: "number", minimum: 1, maximum: 5000 },
    max_results: { type: "number", minimum: 1, maximum: 5000 },
    timeout_ms: { type: "number", minimum: 1, maximum: 10000 },
  }, ["start_definition_key"]),
  tool("semantic_codebase_find_paths", "查找两个 Definition 之间的有预算简单路径。", {
    start_definition_key: { type: "string" },
    end_definition_key: { type: "string" },
    direction: { type: "string", enum: ["out", "in", "both", "outgoing", "incoming"] },
    relation_kinds: { type: "array", items: { type: "string", enum: [...RELATION_KINDS] } },
    max_depth: { type: "number", minimum: 0, maximum: 8 },
    max_nodes: { type: "number", minimum: 1, maximum: 5000 },
    max_paths: { type: "number", minimum: 1, maximum: 100 },
    timeout_ms: { type: "number", minimum: 1, maximum: 10000 },
  }, ["start_definition_key", "end_definition_key"]),
];

export async function handleMcpRequest(request: JsonRpcRequest): Promise<Record<string, unknown> | null> {
  if (request.method.startsWith("notifications/")) return null;
  const base = { jsonrpc: "2.0" as const, id: request.id ?? null };
  if (request.method === "initialize") {
    const requestedVersion = (request.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
    const supportedVersions = new Set(["2025-11-25", "2025-06-18"]);
    return {
      ...base,
      result: {
        protocolVersion: typeof requestedVersion === "string" && supportedVersions.has(requestedVersion)
          ? requestedVersion
          : "2025-11-25",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "semantic-codebase", version: "0.1.0" },
      },
    };
  }
  if (request.method === "tools/list") return { ...base, result: { tools: MCP_TOOLS } };
  if (request.method === "tools/call") {
    const params = request.params as { name?: unknown; arguments?: unknown } | undefined;
    const name = String(params?.name ?? "");
    if (!MCP_TOOLS.some((toolDefinition) => toolDefinition.name === name)) {
      return { ...base, error: { code: -32602, message: `Unknown tool: ${name}` } };
    }
    const result = await callMcpTool(name, params?.arguments);
    return { ...base, result };
  }
  return {
    ...base,
    error: { code: -32601, message: `Method not found: ${request.method}` },
  };
}

export async function callMcpTool(name: string, rawArguments: unknown): Promise<ToolResult> {
  try {
    const definition = MCP_TOOLS.find((candidate) => candidate.name === name);
    if (!definition) throw new QueryError("INVALID_ARGUMENT", `Unknown tool: ${name}`);
    const args = validateArguments(definition.inputSchema, rawArguments);
    const discovered = discoverRepository(args.repo as string, args.store as string | undefined);
    if (name === "semantic_codebase_status" && !existsSync(discovered.store_path)) {
      return success(repositoryStatus(discovered, null));
    }
    if (!existsSync(discovered.store_path)) {
      throw new QueryError("NO_READY_SNAPSHOT", "Repository has no Ready Snapshot");
    }
    const store = new SqliteSnapshotStore(discovered.store_path, { read_only: true });
    try {
      if (name === "semantic_codebase_status") return success(repositoryStatus(discovered, store));
      const observed = repositoryManifestSummary(discovered.source);
      const scope = {
        repository_id: discovered.source.repository_id,
        snapshot: typeof args.snapshot === "string" ? args.snapshot : "current_ready",
        observed_manifest_digest: observed.digest,
        require_fresh: args.require_fresh === true,
      };
      const definitions = new DefinitionQueryService(store);
      if (name === "semantic_codebase_find_definitions") {
        return success(definitions.findDefinitions({
          ...scope,
          query: args.query as string,
          ...(args.kind !== undefined ? { kind: args.kind as DefinitionKind } : {}),
          ...(args.file_path !== undefined ? { file_path: args.file_path as string } : {}),
          ...(args.max_results !== undefined ? { max_results: args.max_results as number } : {}),
        }));
      }
      if (name === "semantic_codebase_get_definition") {
        return success(definitions.getDefinition({ ...scope, definition_key: args.definition_key as string }));
      }
      if (name === "semantic_codebase_get_evidence") {
        return success(definitions.getEvidence({
          ...scope,
          repository_root: discovered.root_path,
          evidence_id: args.evidence_id as string,
          ...(args.source_bytes !== undefined ? { source_bytes: args.source_bytes as number } : {}),
        }));
      }
      const graph = new GraphQueryService(store);
      if (args.relation_kinds) validateRelationKinds(args.relation_kinds as string[]);
      const graphOptions = {
        ...scope,
        ...(args.direction ? { direction: args.direction as "out" | "in" | "outgoing" | "incoming" | "both" } : {}),
        ...(args.relation_kinds ? { relation_kinds: args.relation_kinds as RelationKind[] } : {}),
        ...(args.max_depth !== undefined ? { max_depth: args.max_depth as number } : {}),
        ...(args.max_nodes !== undefined ? { max_nodes: args.max_nodes as number } : {}),
        ...(args.max_results !== undefined ? { max_results: args.max_results as number } : {}),
        ...(args.timeout_ms !== undefined ? { timeout_ms: args.timeout_ms as number } : {}),
      };
      if (name === "semantic_codebase_traverse") {
        return success(graph.traverse({
          ...graphOptions,
          start_definition_key: args.start_definition_key as string,
        }));
      }
      return success(graph.findPaths({
        ...graphOptions,
        start_definition_key: args.start_definition_key as string,
        end_definition_key: args.end_definition_key as string,
        ...(args.max_paths !== undefined ? { max_paths: args.max_paths as number } : {}),
      }));
    } finally {
      store.close();
    }
  } catch (error) {
    const normalized = normalizeToolError(error);
    const body = {
      schema_version: 1,
      error: normalized,
    };
    return { ...success(body), isError: true };
  }
}

function normalizeToolError(error: unknown): { code: string; message: string } {
  if (error instanceof QueryError || error instanceof SnapshotStoreError || error instanceof RepositorySourceError) {
    return { code: error.code, message: error.message };
  }
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    return { code: "REPOSITORY_NOT_FOUND", message: "Repository path does not exist" };
  }
  return { code: "INTERNAL_QUERY_ERROR", message: error instanceof Error ? error.message : String(error) };
}

export async function runMcpStdio(): Promise<void> {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    let response: Record<string, unknown> | null;
    try {
      response = await handleMcpRequest(JSON.parse(line) as JsonRpcRequest);
    } catch (error) {
      response = {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: error instanceof Error ? error.message : String(error) },
      };
    }
    if (response) process.stdout.write(`${canonicalJson(response)}\n`);
  }
}

function tool(
  name: string,
  description: string,
  commandProperties: JsonSchema["properties"],
  commandRequired: string[],
): (typeof MCP_TOOLS)[number] {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        store: { type: "string" },
        schema_version: { type: "number", enum: [1] },
        snapshot: { type: "string" },
        require_fresh: { type: "boolean" },
        ...commandProperties,
      },
      required: ["repo", ...commandRequired],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

function validateRelationKinds(values: string[]): void {
  const allowed = new Set<string>(RELATION_KINDS);
  if (values.some((value) => !allowed.has(value))) {
    throw new QueryError("INVALID_ARGUMENT", "relation_kinds contains an unsupported Relation kind");
  }
}

function validateArguments(schema: JsonSchema, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new QueryError("INVALID_ARGUMENT", "Tool arguments must be an object");
  }
  const args = value as Record<string, unknown>;
  const unknown = Object.keys(args).find((key) => !(key in schema.properties));
  if (unknown) throw new QueryError("INVALID_ARGUMENT", `Unknown argument: ${unknown}`);
  const missing = schema.required.find((key) => !(key in args));
  if (missing) throw new QueryError("INVALID_ARGUMENT", `Missing required argument: ${missing}`);
  for (const [key, argument] of Object.entries(args)) {
    const property = schema.properties[key]!;
    if (property.type === "array") {
      if (!Array.isArray(argument) || argument.some((item) => typeof item !== property.items?.type)) {
        throw new QueryError("INVALID_ARGUMENT", `${key} must be an array of ${property.items?.type}`);
      }
      if (property.items?.enum && argument.some((item) => !property.items!.enum!.includes(item as JsonSchemaValue))) {
        throw new QueryError("INVALID_ARGUMENT", `${key} contains an unsupported value`);
      }
    } else if (typeof argument !== property.type) {
      throw new QueryError("INVALID_ARGUMENT", `${key} must be ${property.type}`);
    }
    if (property.enum && !property.enum.includes(argument as string)) {
      throw new QueryError("INVALID_ARGUMENT", `${key} has an unsupported value`);
    }
    if (typeof argument === "number" && (
      !Number.isInteger(argument) ||
      (property.minimum !== undefined && argument < property.minimum) ||
      (property.maximum !== undefined && argument > property.maximum)
    )) {
      throw new QueryError("INVALID_ARGUMENT", `${key} is outside its supported integer range`);
    }
  }
  return args;
}

function success(body: unknown): ToolResult {
  return {
    structuredContent: body,
    content: [{ type: "text", text: canonicalJson(body) }],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMcpStdio();
}
