import { readFileSync } from "node:fs";
import Parser from "tree-sitter";
import TypeScriptGrammar from "tree-sitter-typescript";

import { sha256Text } from "../../../contract/hash.js";
import type { Diagnostic, SourceFileInput } from "../../../contract/types.js";
import {
  TreeSitterSyntaxAdapter,
  type RawDefinition,
  type Utf8OffsetMap,
} from "../base-adapter.js";

const DEFAULT_QUERY = readFileSync(new URL("./definitions.scm", import.meta.url), "utf8");

export class TypeScriptTreeSitterAdapter extends TreeSitterSyntaxAdapter {
  constructor(options: { definitionsQuerySource?: string; maxSourceBytes?: number } = {}) {
    super({
      manifest: {
        id: "tree-sitter-typescript",
        version: "0.1.0",
        language: "typescript",
        runtime: { id: "tree-sitter", version: "0.21.1" },
        grammar: {
          id: "tree-sitter-typescript/typescript",
          version: "0.23.2",
          digest: sha256Text("tree-sitter-typescript@0.23.2:typescript"),
        },
        capabilities: {
          definition_kinds: ["module", "class", "interface", "function", "method"],
          exact_relation_kinds: ["CONTAINS"],
          candidate_relation_kinds: [],
        },
      },
      language: TypeScriptGrammar.typescript,
      definitionsQuerySource: options.definitionsQuerySource ?? DEFAULT_QUERY,
      config: { max_source_bytes: options.maxSourceBytes },
    });
  }

  protected collectDefinitions(rootNode: Parser.SyntaxNode): RawDefinition[] {
    return this.definitionsQuery.matches(rootNode).flatMap((match) => {
      const definition = match.captures.find((capture) => capture.name.endsWith(".definition"));
      const name = match.captures.find((capture) => capture.name.endsWith(".name"));
      if (!definition || !name) return [];
      const kind = definition.name.slice(0, -".definition".length);
      if (!isDefinitionKind(kind)) return [];
      return [{ node: definition.node, nameNode: name.node, kind }];
    });
  }

  protected collectLanguageDiagnostics(
    rootNode: Parser.SyntaxNode,
    definitions: RawDefinition[],
    input: SourceFileInput,
    offsetMap: Utf8OffsetMap,
  ): Diagnostic[] {
    const captured = new Set(
      definitions.flatMap((definition) => [definition.node.id, definition.nameNode.id]),
    );
    return rootNode
      .descendantsOfType(["arrow_function", "function_expression", "class"])
      .filter((node) => !isInsideCapturedDefinition(node, definitions) && !captured.has(node.id))
      .map((node) => ({
        code: "unsupported_anonymous_definition",
        severity: "info" as const,
        file_path: input.relative_path,
        span: offsetMap.span(node),
        message: `Anonymous ${node.type} is not a V0.1 Definition`,
      }));
  }
}

function isDefinitionKind(value: string): value is RawDefinition["kind"] {
  return ["module", "class", "interface", "function", "method"].includes(value);
}

function isInsideCapturedDefinition(node: Parser.SyntaxNode, definitions: RawDefinition[]): boolean {
  return definitions.some(
    (definition) =>
      definition.node.startIndex <= node.startIndex &&
      definition.node.endIndex >= node.endIndex &&
      (definition.node.startIndex !== node.startIndex || definition.node.endIndex !== node.endIndex),
  );
}
