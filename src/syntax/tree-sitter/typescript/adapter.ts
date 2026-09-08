import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import Parser from "tree-sitter";
import TypeScriptGrammar from "tree-sitter-typescript";

import { sha256Bytes } from "../../../contract/hash.js";
import type { ByteSpan, Diagnostic, SourceFileInput, SubjectLocalRef } from "../../../contract/types.js";
import {
  type CandidateExtraction,
  type DefinitionContext,
  TreeSitterSyntaxAdapter,
  type RawDefinition,
  type Utf8OffsetMap,
} from "../base-adapter.js";

const DEFAULT_QUERY = readFileSync(new URL("./definitions.scm", import.meta.url), "utf8");
const DEFAULT_RELATIONS_QUERY = readFileSync(new URL("./relations.scm", import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const GRAMMAR_DIGEST = sha256Bytes(readFileSync(require.resolve("tree-sitter-typescript/typescript/src/parser.c")));
if (GRAMMAR_DIGEST !== "aab8611ac5315d03eb6637d7c135a8900b905c9864322d5ab2c1343d0df13621") {
  throw new Error("TypeScript grammar is not prepared; run npm run prepare:grammar (full development dependencies required)");
}
// Detect a stale native/prebuilt binding even when generated sources are current.
{
  const grammarProbe = new Parser();
  grammarProbe.setLanguage(TypeScriptGrammar.typescript);
  if (["interface Box<out T, in U, in out V, out> {}", "function scan(unique: string[]) { for(let i=0;i<unique.length;i++) {} }", "const value = 'before\0after';"].some(source => grammarProbe.parse(source).rootNode.hasError)) {
    throw new Error("TypeScript native grammar is stale; run npm run prepare:grammar");
  }
}

export class TypeScriptTreeSitterAdapter extends TreeSitterSyntaxAdapter {
  constructor(options: { definitionsQuerySource?: string; relationsQuerySource?: string; maxSourceBytes?: number } = {}) {
    super({
      manifest: {
        id: "tree-sitter-typescript",
        version: "0.1.0",
        language: "typescript",
        runtime: { id: "tree-sitter", version: "0.21.1" },
        grammar: {
          id: "tree-sitter-typescript/typescript",
          version: "0.23.2-scb.2",
          digest: GRAMMAR_DIGEST,
        },
        capabilities: {
          definition_kinds: ["module", "class", "interface", "function", "method"],
          exact_relation_kinds: ["CONTAINS"],
          candidate_relation_kinds: ["IMPORTS", "EXPORTS", "CALLS", "INHERITS", "IMPLEMENTS"],
        },
      },
      language: TypeScriptGrammar.typescript,
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
  ): ReturnType<TypeScriptTreeSitterAdapter["makeCandidate"]>[] {
    if (captureName === "relation.import") return this.importCandidates(node, context);
    if (captureName === "relation.export") return this.exportCandidates(node, context);
    if (captureName === "relation.call") {
      const callable = node.childForFieldName("function");
      if (!callable) return [];
      const hint = callable.type === "identifier"
        ? { kind: "name" as const, name: callable.text }
        : memberHint(callable);
      return hint ? [this.makeCandidate(context, "CALLS", hint, callable)] : [];
    }
    const relationKind = captureName === "relation.implements" ? "IMPLEMENTS" : "INHERITS";
    const targets = captureName === "relation.extends" && node.type === "extends_clause"
      ? [node.childForFieldName("value")].filter(isNode)
      : node.namedChildren;
    return targets
      .filter((target) => !["type_arguments"].includes(target.type))
      .map((target) => this.makeCandidate(context, relationKind, typeHint(target), target));
  }

  private importCandidates(
    node: Parser.SyntaxNode,
    context: DefinitionContext,
  ): ReturnType<TypeScriptTreeSitterAdapter["makeCandidate"]>[] {
    const source = node.childForFieldName("source");
    if (!source) return [];
    const specifier = unquote(source.text);
    const clause = node.namedChildren.find((child) => child.type === "import_clause");
    if (!clause) {
      return [this.makeCandidate(context, "IMPORTS", { kind: "module", specifier }, source)];
    }
    const bindings: Array<{ imported_name: string; alias?: string; node: Parser.SyntaxNode }> = [];
    for (const child of clause.namedChildren) {
      if (child.type === "identifier") {
        bindings.push({ imported_name: "default", alias: child.text, node: child });
      } else if (child.type === "namespace_import") {
        const alias = child.namedChildren.find((item) => item.type === "identifier");
        if (alias) bindings.push({ imported_name: "*", alias: alias.text, node: child });
      } else if (child.type === "named_imports") {
        for (const item of child.namedChildren.filter((item) => item.type === "import_specifier")) {
          const name = item.childForFieldName("name");
          const alias = item.childForFieldName("alias");
          if (name) bindings.push({ imported_name: name.text, alias: alias?.text, node: item });
        }
      }
    }
    return bindings.map((binding) =>
      this.makeCandidate(
        context,
        "IMPORTS",
        {
          kind: "module",
          specifier,
          imported_name: binding.imported_name,
          ...(binding.alias ? { alias: binding.alias } : {}),
        },
        binding.node,
      ),
    );
  }

  private exportCandidates(
    node: Parser.SyntaxNode,
    context: DefinitionContext,
  ): ReturnType<TypeScriptTreeSitterAdapter["makeCandidate"]>[] {
    const sourceReference = exportSourceReference(context, node);
    const source = node.childForFieldName("source");
    const specifier = source ? unquote(source.text) : null;
    const clause = node.namedChildren.find((child) => child.type === "export_clause");
    if (clause) {
      return clause.namedChildren
        .filter((child) => child.type === "export_specifier")
        .flatMap((item) => {
          const name = item.childForFieldName("name");
          const alias = item.childForFieldName("alias");
          if (!name) return [];
          const hint = specifier
            ? {
                kind: "module" as const,
                specifier,
                imported_name: name.text,
                ...(alias ? { alias: alias.text } : {}),
              }
            : { kind: "name" as const, name: name.text, ...(alias ? { alias: alias.text } : {}) };
          return [this.makeCandidate(context, "EXPORTS", hint, item, sourceReference)];
        });
    }
    if (specifier) {
      const namespaceExport = node.namedChildren.find((child) => child.type === "namespace_export");
      const alias = namespaceExport?.namedChildren.find((child) => child.type === "identifier")?.text;
      return [this.makeCandidate(
        context,
        "EXPORTS",
        {
          kind: "module",
          specifier,
          imported_name: "*",
          ...(alias ? { alias } : {}),
        },
        namespaceExport ?? source!,
        sourceReference,
      )];
    }
    const declaration = node.childForFieldName("declaration");
    const name = declaration?.childForFieldName("name") ?? declaration?.descendantsOfType(["identifier", "type_identifier"])[0];
    const isDefault = node.children.some((child) => child.type === "default");
    return name
      ? [this.makeCandidate(
          context,
          "EXPORTS",
          { kind: "name", name: name.text, ...(isDefault ? { alias: "default" } : {}) },
          name,
          sourceReference,
        )]
      : [];
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
    const stableBindings = new Set<string>();
    for (const definition of definitions) {
      const value = definition.node.childForFieldName("value");
      if (value) stableBindings.add(`${value.startIndex}:${value.endIndex}`);
    }
    return rootNode
      .descendantsOfType(["arrow_function", "function_expression", "class"])
      .filter((node) => !stableBindings.has(`${node.startIndex}:${node.endIndex}`))
      .map((node) => ({
        code: "unsupported_anonymous_definition",
        severity: "info" as const,
        file_path: input.relative_path,
        span: offsetMap.span(node),
        message: `Anonymous ${node.type} is not a V0.1 Definition`,
      }));
  }
}

function exportSourceReference(context: DefinitionContext, node: Parser.SyntaxNode): SubjectLocalRef {
  const span = context.offsetMap.span(node);
  const owner = context.definitions
    .filter((definition) => definition.kind === "module" && contains(definition.definition_span, span))
    .sort((left, right) => spanLength(left.definition_span) - spanLength(right.definition_span))[0];
  return owner ? { kind: "definition", local_id: owner.local_id } : { kind: "source_file" };
}

function contains(outer: ByteSpan, inner: ByteSpan): boolean {
  return outer.start_byte <= inner.start_byte && outer.end_byte >= inner.end_byte;
}

function spanLength(span: ByteSpan): number {
  return span.end_byte - span.start_byte;
}

function memberHint(node: Parser.SyntaxNode) {
  if (node.type !== "member_expression") return null;
  const object = node.childForFieldName("object");
  const property = node.childForFieldName("property");
  if (!object || !property) return null;
  return { kind: "member" as const, receiver_text: object.text, member: property.text };
}

function typeHint(node: Parser.SyntaxNode) {
  const text = node.text;
  const separator = text.lastIndexOf(".");
  return separator < 0
    ? { kind: "name" as const, name: text }
    : { kind: "name" as const, name: text.slice(separator + 1), qualifier: text.slice(0, separator) };
}

function unquote(value: string): string {
  return value.length >= 2 ? value.slice(1, -1) : value;
}

function isNode(node: Parser.SyntaxNode | null): node is Parser.SyntaxNode {
  return node !== null;
}

function isDefinitionKind(value: string): value is RawDefinition["kind"] {
  return ["module", "class", "interface", "function", "method"].includes(value);
}
