import { readFileSync } from "node:fs";
import Parser from "tree-sitter";
import PythonGrammar from "tree-sitter-python";

import { sha256Text } from "../../../contract/hash.js";
import type { DefinitionKind } from "../../../contract/types.js";
import {
  TreeSitterSyntaxAdapter,
  type CandidateExtraction,
  type DefinitionContext,
  type RawDefinition,
} from "../base-adapter.js";

const DEFAULT_QUERY = readFileSync(new URL("./definitions.scm", import.meta.url), "utf8");
const DEFAULT_RELATIONS_QUERY = readFileSync(new URL("./relations.scm", import.meta.url), "utf8");

export class PythonTreeSitterAdapter extends TreeSitterSyntaxAdapter {
  constructor(options: { definitionsQuerySource?: string; relationsQuerySource?: string; maxSourceBytes?: number } = {}) {
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
          candidate_relation_kinds: ["IMPORTS", "CALLS", "INHERITS"],
        },
      },
      language: PythonGrammar,
      definitionsQuerySource: options.definitionsQuerySource ?? DEFAULT_QUERY,
      relationsQuerySource: options.relationsQuerySource ?? DEFAULT_RELATIONS_QUERY,
      config: { max_source_bytes: options.maxSourceBytes },
    });
  }

  protected collectRelationCandidates(context: DefinitionContext): CandidateExtraction {
    const output: CandidateExtraction = { candidates: [], evidence: [] };
    for (const capture of this.relationsQuery?.captures(context.rootNode) ?? []) {
      const entries = this.candidatesForCapture(capture.name, capture.node, context);
      for (const entry of entries) {
        output.candidates.push(entry.candidate);
        output.evidence.push(entry.evidence);
      }
    }
    return output;
  }

  private candidatesForCapture(
    captureName: string,
    node: Parser.SyntaxNode,
    context: DefinitionContext,
  ): ReturnType<PythonTreeSitterAdapter["makeCandidate"]>[] {
    if (captureName === "relation.call") {
      const callable = node.childForFieldName("function");
      if (!callable) return [];
      const hint = callable.type === "identifier"
        ? { kind: "name" as const, name: callable.text }
        : attributeHint(callable);
      return hint ? [this.makeCandidate(context, "CALLS", hint, callable)] : [];
    }
    if (captureName === "relation.inherits") {
      return node.namedChildren.flatMap((base) => {
        const hint = base.type === "identifier"
          ? { kind: "name" as const, name: base.text }
          : attributeAsNameHint(base);
        return hint ? [this.makeCandidate(context, "INHERITS", hint, base)] : [];
      });
    }
    if (captureName === "relation.import") {
      return node.childrenForFieldName("name").flatMap((imported) => {
        const { name, alias } = importedName(imported);
        return [
          this.makeCandidate(
            context,
            "IMPORTS",
            { kind: "module", specifier: name, ...(alias ? { alias } : {}) },
            imported,
          ),
        ];
      });
    }
    if (captureName === "relation.import_from") {
      const moduleName = node.childForFieldName("module_name");
      if (!moduleName) return [];
      return node.childrenForFieldName("name").map((imported) => {
        const { name, alias } = importedName(imported);
        return this.makeCandidate(
          context,
          "IMPORTS",
          {
            kind: "module",
            specifier: moduleName.text,
            imported_name: name,
            ...(alias ? { alias } : {}),
          },
          imported,
        );
      });
    }
    return [];
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

function importedName(node: Parser.SyntaxNode): { name: string; alias?: string } {
  if (node.type !== "aliased_import") return { name: node.text };
  const name = node.childForFieldName("name")?.text ?? node.text;
  const alias = node.childForFieldName("alias")?.text;
  return { name, ...(alias ? { alias } : {}) };
}

function attributeHint(node: Parser.SyntaxNode) {
  if (node.type !== "attribute") return null;
  const object = node.childForFieldName("object");
  const attribute = node.childForFieldName("attribute");
  if (!object || !attribute) return null;
  return { kind: "member" as const, receiver_text: object.text, member: attribute.text };
}

function attributeAsNameHint(node: Parser.SyntaxNode) {
  const hint = attributeHint(node);
  return hint
    ? { kind: "name" as const, name: hint.member, qualifier: hint.receiver_text }
    : null;
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
