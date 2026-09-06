import type Parser from "tree-sitter";
import type { ControlFlowGraph } from "./control-flow.js";
import { solveDataFlow, type Access } from "./reaching-definitions.js";

export function pythonDataFlow(declaration: Parser.SyntaxNode, graph: ControlFlowGraph, nodes: Map<string, Parser.SyntaxNode>, evidenceFor: (node: Parser.SyntaxNode) => string) {
  const accesses: Access[] = [];
  const events = new Map<number, Access[]>();
  const unknowns = new Set(graph.unknowns);
  const opaque = new Set<number>();
  const locals = new Map<string, string>();
  const parameters = declaration.childForFieldName("parameters")!.namedChildren;
  const parameterDefaults: { name: string; evidence_id: string }[] = [];
  const own = (node: Parser.SyntaxNode) => {
    let parent = node.parent;
    while (parent && parent.type !== "function_definition") parent = parent.parent;
    return parent?.id === declaration.id;
  };
  for (const parameter of parameters) {
    const name = parameter.type === "identifier" ? parameter : parameter.childForFieldName("name") ?? parameter.namedChildren[0];
    if (name?.type === "identifier") locals.set(name.text, evidenceFor(name));
    if (!["identifier", "typed_parameter"].includes(parameter.type)) {
      const value = parameter.childForFieldName("value");
      if (["default_parameter", "typed_default_parameter"].includes(parameter.type) && name?.type === "identifier" &&
          value && ["integer", "float", "string", "true", "false", "none"].includes(value.type) && !value.descendantsOfType("interpolation").length) {
        parameterDefaults.push({ name: name.text, evidence_id: evidenceFor(value) });
      } else unknowns.add("python_complex_parameter_unknown");
    }
  }
  for (const assigned of declaration.descendantsOfType(["assignment", "augmented_assignment"]).filter(own)) {
    const name = assigned.childForFieldName("left");
    if (name?.type === "identifier" && !locals.has(name.text)) locals.set(name.text, evidenceFor(name));
  }
  if (declaration.parent?.parent?.type === "class_definition") unknowns.add("bound_method_arguments_not_modeled");
  const add = (node: Parser.SyntaxNode, kind: Access["kind"], block: number, inputs: number[] = []) => {
    const symbol = locals.get(node.text);
    if (!symbol) { unknowns.add("nonlocal_or_unresolved_symbol"); return; }
    const item: Access = { id: accesses.length, symbol, name: node.text, kind, evidence_id: evidenceFor(node), block, inputs };
    accesses.push(item); events.set(block, [...(events.get(block) ?? []), item]);
  };
  const usesSince = (start: number) => accesses.slice(start).filter((item) => item.kind === "use" && !opaque.has(item.id)).map((item) => item.id);
  const visit = (node: Parser.SyntaxNode, block: number): void => {
    if (["function_definition", "lambda", "class_definition", "decorated_definition"].includes(node.type)) { unknowns.add("nested_callable_not_expanded"); return; }
    if (["conditional_expression", "boolean_operator", "list_comprehension", "dictionary_comprehension", "generator_expression"].includes(node.type)) { unknowns.add("python_expression_scope_unknown"); return; }
    if (["assignment", "augmented_assignment"].includes(node.type)) {
      const start = accesses.length;
      const left = node.childForFieldName("left")!;
      const right = node.childForFieldName("right");
      if (left.type !== "identifier") { unknowns.add("python_heap_or_destructuring_write_unknown"); return; }
      if (node.type === "augmented_assignment") add(left, "use", block);
      if (right) visit(right, block); else unknowns.add("uninitialized_local_definition");
      add(left, "definition", block, usesSince(start)); return;
    }
    if (node.type === "call") {
      const start = accesses.length;
      for (const argument of node.childForFieldName("arguments")?.namedChildren ?? []) visit(argument, block);
      for (const item of accesses.slice(start)) if (item.kind === "use") opaque.add(item.id);
      unknowns.add("call_side_effects_not_modeled"); return;
    }
    if (node.type === "keyword_argument") { const value = node.childForFieldName("value"); if (value) visit(value, block); return; }
    if (node.type === "attribute") { visit(node.childForFieldName("object")!, block); unknowns.add("heap_read_not_modeled"); return; }
    if (node.type === "identifier") { add(node, "use", block); return; }
    for (const child of node.namedChildren) visit(child, block);
  };
  for (const parameter of parameters) {
    const name = parameter.type === "identifier" ? parameter : parameter.childForFieldName("name") ?? parameter.namedChildren[0];
    if (name?.type === "identifier") add(name, "definition", graph.entry);
  }
  for (const block of graph.blocks) {
    if (["entry", "exit", "unknown", "declaration", "exception_dispatch", "context_exit", "await_suspend", "await_resume"].includes(block.kind)) continue;
    const node = nodes.get(block.evidence_id); if (node) visit(node, block.id);
  }
  return { ...solveDataFlow(graph, accesses, events, unknowns, opaque), parameter_defaults: parameterDefaults };
}
