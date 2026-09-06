import * as ast from "typescript/unstable/ast";
import type { Node } from "typescript/unstable/ast";
import type { Checker } from "typescript/unstable/sync";
import type { ControlFlowGraph } from "./control-flow.js";

import { solveDataFlow, type Access } from "./reaching-definitions.js";
/** May-reaching definitions for local identifiers; not a heap or taint analysis. */
export function buildDataFlow(
  declaration: ast.FunctionDeclaration | ast.MethodDeclaration | ast.ArrowFunction | ast.FunctionExpression,
  graph: ControlFlowGraph,
  nodes: Map<string, Node>,
  checker: Checker,
  evidenceFor: (node: Node) => string,
) {
  const accesses: Access[] = [];
  const unknowns = new Set(graph.unknowns);
  const events = new Map<number, Access[]>();
  const opaqueCallReads = new Set<number>();
  const parameterDefaults: { name: string; evidence_id: string }[] = [];
  const add = (node: Node, kind: Access["kind"], block: number, inputs: number[] = []): void => {
    const symbol = checker.getSymbolAtLocation(node);
    const target = symbol?.valueDeclaration?.resolve();
    if (!target || target.getSourceFile() !== declaration.getSourceFile() ||
        target.pos < declaration.pos || target.end > declaration.end) {
      unknowns.add("nonlocal_or_unresolved_symbol");
      return;
    }
    const item: Access = { id: accesses.length, symbol: evidenceFor(target), name: node.getText(), kind, evidence_id: evidenceFor(node), block, inputs };
    accesses.push(item);
    events.set(block, [...(events.get(block) ?? []), item]);
  };
  const usesSince = (start: number) => accesses.slice(start).filter((item) => item.kind === "use" && !opaqueCallReads.has(item.id)).map((item) => item.id);
  const visit = (node: Node, block: number): void => {
    if (ast.isFunctionDeclaration(node) || ast.isFunctionExpression(node) || ast.isArrowFunction(node) || ast.isClassExpression(node)) {
      unknowns.add("nested_callable_not_expanded");
      return;
    }
    if (ast.isConditionalExpression(node) || (ast.isBinaryExpression(node) &&
        [ast.SyntaxKind.AmpersandAmpersandToken, ast.SyntaxKind.BarBarToken, ast.SyntaxKind.QuestionQuestionToken,
          ast.SyntaxKind.AmpersandAmpersandEqualsToken, ast.SyntaxKind.BarBarEqualsToken, ast.SyntaxKind.QuestionQuestionEqualsToken].includes(node.operatorToken.kind))) {
      unknowns.add("conditional_expression_data_flow_unknown");
      return;
    }
    if (ast.isVariableDeclaration(node)) {
      const start = accesses.length;
      if (node.initializer) visit(node.initializer, block);
      else unknowns.add("uninitialized_local_definition");
      if (ast.isIdentifier(node.name)) add(node.name, "definition", block, usesSince(start));
      else unknowns.add("destructuring_data_flow_unknown");
      return;
    }
    if (ast.isBinaryExpression(node) && ast.isAssignmentOperator(node.operatorToken.kind)) {
      if (ast.isIdentifier(node.left)) {
        const start = accesses.length;
        if (node.operatorToken.kind !== ast.SyntaxKind.EqualsToken) add(node.left, "use", block);
        visit(node.right, block);
        add(node.left, "definition", block, usesSince(start));
      } else { unknowns.add("heap_write_not_modeled"); }
      return;
    }
    if ((ast.isPrefixUnaryExpression(node) || ast.isPostfixUnaryExpression(node)) &&
        [ast.SyntaxKind.PlusPlusToken, ast.SyntaxKind.MinusMinusToken].includes(node.operator)) {
      if (ast.isIdentifier(node.operand)) {
        const start = accesses.length;
        add(node.operand, "use", block);
        add(node.operand, "definition", block, usesSince(start));
      }
      else unknowns.add("heap_write_not_modeled");
      return;
    }
    if (ast.isPropertyAccessExpression(node)) { visit(node.expression, block); unknowns.add("heap_read_not_modeled"); return; }
    if (ast.isCallExpression(node) || ast.isNewExpression(node)) {
      unknowns.add("call_side_effects_not_modeled");
      const start = accesses.length;
      for (const argument of node.arguments ?? []) visit(argument, block);
      // Reading an argument does not prove the callee returns a value derived from it.
      for (const item of accesses.slice(start)) if (item.kind === "use") opaqueCallReads.add(item.id);
      return;
    }
    if (ast.isIdentifier(node)) { add(node, "use", block); return; }
    node.forEachChild((child) => visit(child, block));
  };
  for (const parameter of declaration.parameters) {
    if (ast.isIdentifier(parameter.name)) add(parameter.name, "definition", graph.entry);
    else unknowns.add("destructuring_parameter_unknown");
    if (parameter.initializer) {
      const value = parameter.initializer;
      if (ast.isIdentifier(parameter.name) && (ast.isStringLiteralLikeNode(value) || ast.isNumericLiteral(value) ||
          [ast.SyntaxKind.TrueKeyword, ast.SyntaxKind.FalseKeyword, ast.SyntaxKind.NullKeyword].includes(value.kind))) {
        parameterDefaults.push({ name: parameter.name.text, evidence_id: evidenceFor(value) });
      } else unknowns.add("default_parameter_flow_unknown");
    }
    if (parameter.dotDotDotToken) unknowns.add("rest_parameter_flow_unknown");
  }
  for (const block of graph.blocks) {
    if (["entry", "exit", "unknown", "declaration", "always", "await_suspend", "await_resume"].includes(block.kind)) continue;
    const node = nodes.get(block.evidence_id);
    if (node) visit(node, block.id);
  }
  return { ...solveDataFlow(graph, accesses, events, unknowns, opaqueCallReads), parameter_defaults: parameterDefaults };
}
