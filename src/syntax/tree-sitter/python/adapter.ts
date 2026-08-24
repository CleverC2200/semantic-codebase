import { readFileSync } from "node:fs";
import Parser from "tree-sitter";
import PythonGrammar from "tree-sitter-python";

import { sha256Text } from "../../../contract/hash.js";
import type { DefinitionKind } from "../../../contract/types.js";
import { TreeSitterSyntaxAdapter, type RawDefinition } from "../base-adapter.js";

const DEFAULT_QUERY = readFileSync(new URL("./definitions.scm", import.meta.url), "utf8");

export class PythonTreeSitterAdapter extends TreeSitterSyntaxAdapter {
  constructor(options: { definitionsQuerySource?: string; maxSourceBytes?: number } = {}) {
    super({
      manifest: {
        id: "tree-sitter-python",
        version: "0.1.0",
        language: "python",
        runtime: { id: "tree-sitter", version: "0.21.1" },
        grammar: {
          id: "tree-sitter-python",
          version: "0.21.0",
          digest: sha256Text("tree-sitter-python@0.21.0"),
        },
        capabilities: {
          definition_kinds: ["class", "function", "method"],
          exact_relation_kinds: ["CONTAINS"],
          candidate_relation_kinds: [],
        },
      },
      language: PythonGrammar,
      definitionsQuerySource: options.definitionsQuerySource ?? DEFAULT_QUERY,
      config: { max_source_bytes: options.maxSourceBytes },
    });
  }

  protected collectDefinitions(rootNode: Parser.SyntaxNode): RawDefinition[] {
    return this.definitionsQuery.matches(rootNode).flatMap((match) => {
      const definition = match.captures.find((capture) => capture.name.endsWith(".definition"));
      const name = match.captures.find((capture) => capture.name.endsWith(".name"));
      if (!definition || !name) return [];
      const kind: DefinitionKind =
        definition.name === "class.definition"
          ? "class"
          : isDirectClassMember(definition.node)
            ? "method"
            : "function";
      return [{ node: decoratedSpanNode(definition.node), nameNode: name.node, kind }];
    });
  }
}

function decoratedSpanNode(node: Parser.SyntaxNode): Parser.SyntaxNode {
  return node.parent?.type === "decorated_definition" ? node.parent : node;
}

function isDirectClassMember(node: Parser.SyntaxNode): boolean {
  let parent = node.parent;
  if (parent?.type === "decorated_definition") parent = parent.parent;
  if (parent?.type !== "block") return false;
  return parent.parent?.type === "class_definition";
}
