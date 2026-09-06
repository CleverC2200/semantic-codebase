import * as ast from "typescript/unstable/ast";
import type { Node } from "typescript/unstable/ast";

export interface ControlFlowGraph {
  blocks: { id: number; kind: string; evidence_id: string; source_excerpt?: string }[];
  edges: { from: number; to: number; kind: string }[];
  entry: number;
  exit: number;
  unknowns: string[];
}

/** Statement-level normal-flow graph. Unsupported constructs stop expansion. */
export function buildControlFlow(body: Node, evidenceFor: (node: Node) => string): ControlFlowGraph {
  const blocks: ControlFlowGraph["blocks"] = [];
  const edges: ControlFlowGraph["edges"] = [];
  const unknowns = new Set<string>(["implicit_exceptions_not_modeled", "expression_internal_flow_not_modeled"]);
  const block = (kind: string, node: Node): number => {
    const id = blocks.length;
    blocks.push({ id, kind, evidence_id: evidenceFor(node),
      ...(kind === "entry" || kind === "exit" ? {} : { source_excerpt: node.getText().slice(0, 800) + (node.getText().length > 800 ? "…" : "") }) });
    return id;
  };
  const entry = block("entry", body);
  const exit = block("exit", body);
  const edge = (from: number, to: number, kind = "next"): void => { edges.push({ from, to, kind }); };
  type Loop = { breakTarget: number; continueTarget: number };
  type Completion = { returnTarget: number; throwTarget: number };
  const awaitPrefix = (node: Node, next: number, completion: Completion): number => {
    const awaits: Node[] = [];
    const visit = (item: Node): void => {
      if (ast.isFunctionDeclaration(item) || ast.isFunctionExpression(item) || ast.isArrowFunction(item)) return;
      if (ast.isConditionalExpression(item) || (ast.isBinaryExpression(item) &&
          [ast.SyntaxKind.AmpersandAmpersandToken, ast.SyntaxKind.BarBarToken, ast.SyntaxKind.QuestionQuestionToken].includes(item.operatorToken.kind))) {
        if (item.getText().includes("await")) unknowns.add("conditional_await_flow_unknown");
        return;
      }
      item.forEachChild(visit);
      if (ast.isAwaitExpression(item)) awaits.push(item);
    };
    visit(node);
    let head = next;
    for (const item of awaits.reverse()) {
      const suspend = block("await_suspend", item);
      const resume = block("await_resume", item);
      edge(suspend, resume, "resume");
      edge(suspend, completion.throwTarget, "reject");
      edge(resume, head);
      head = suspend;
    }
    if (awaits.length) unknowns.add("await_expression_evaluation_order_approximate");
    return head;
  };
  const lower = (node: Node, next: number, loop?: Loop, completion: Completion = { returnTarget: exit, throwTarget: exit }): number => {
    if (ast.isBlock(node)) {
      let head = next;
      for (const statement of [...node.statements].reverse()) head = lower(statement, head, loop, completion);
      return head;
    }
    if (ast.isIfStatement(node)) {
      const condition = block("condition", node.expression);
      edge(condition, lower(node.thenStatement, next, loop, completion), "true");
      edge(condition, node.elseStatement ? lower(node.elseStatement, next, loop, completion) : next, "false");
      return condition;
    }
    if (ast.isWhileStatement(node)) {
      const condition = block("condition", node.expression);
      edge(condition, lower(node.statement, condition, { breakTarget: next, continueTarget: condition }, completion), "true");
      edge(condition, next, "false");
      return condition;
    }
    if (ast.isForStatement(node)) {
      const condition = block(node.condition ? "condition" : "always", node.condition ?? node);
      const increment = node.incrementor ? block("statement", node.incrementor) : condition;
      if (increment !== condition) edge(increment, condition);
      edge(condition, lower(node.statement, increment, { breakTarget: next, continueTarget: increment }, completion), "true");
      if (node.condition) edge(condition, next, "false");
      if (!node.initializer) return condition;
      const initialize = block("statement", node.initializer);
      edge(initialize, condition);
      return initialize;
    }
    if (ast.isDoStatement(node)) {
      const condition = block("condition", node.expression);
      const head = lower(node.statement, condition, { breakTarget: next, continueTarget: condition }, completion);
      edge(condition, head, "true");
      edge(condition, next, "false");
      return head;
    }
    if (ast.isForOfStatement(node) || ast.isForInStatement(node)) {
      const iterator = block("condition", node.expression);
      edge(iterator, lower(node.statement, iterator, { breakTarget: next, continueTarget: iterator }, completion), "iteration");
      edge(iterator, next, "exhausted");
      unknowns.add("iterator_binding_data_flow_unknown");
      if (ast.isForOfStatement(node) && node.awaitModifier) unknowns.add("async_iterator_protocol_unknown");
      return iterator;
    }
    if (ast.isSwitchStatement(node)) {
      let head = next;
      const targets: { head: number; label: string }[] = [];
      for (const clause of [...node.caseBlock.clauses].reverse()) {
        for (const statement of [...clause.statements].reverse()) head = lower(statement, head, { breakTarget: next, continueTarget: loop?.continueTarget ?? -1 }, completion);
        targets.unshift({ head, label: ast.isCaseClause(clause) ? `case:${clause.expression.getText()}` : "default" });
      }
      const dispatch = block("condition", node.expression);
      for (const target of targets) edge(dispatch, target.head, target.label);
      if (!targets.some((target) => target.label === "default")) edge(dispatch, next, "no_match");
      unknowns.add("switch_case_expression_effects_not_modeled");
      return dispatch;
    }
    if (ast.isTryStatement(node)) {
      const finalize = (target: number) => node.finallyBlock ? lower(node.finallyBlock, target, loop, completion) : target;
      const normal = finalize(next);
      const wrapped = { returnTarget: finalize(completion.returnTarget), throwTarget: finalize(completion.throwTarget) };
      const wrappedLoop = loop ? { breakTarget: finalize(loop.breakTarget), continueTarget: finalize(loop.continueTarget) } : undefined;
      let throwTarget = wrapped.throwTarget;
      if (node.catchClause) {
        throwTarget = lower(node.catchClause.block, normal, wrappedLoop, wrapped);
        if (node.catchClause.variableDeclaration) unknowns.add("catch_binding_data_flow_not_modeled");
      }
      return lower(node.tryBlock, normal, wrappedLoop, { ...wrapped, throwTarget });
    }
    if (ast.isReturnStatement(node) || ast.isThrowStatement(node)) {
      const kind = ast.isReturnStatement(node) ? "return" : "throw";
      const id = block(kind, node);
      edge(id, kind === "return" ? completion.returnTarget : completion.throwTarget, kind);
      return awaitPrefix(node, id, completion);
    }
    if (ast.isBreakStatement(node) || ast.isContinueStatement(node)) {
      const kind = ast.isBreakStatement(node) ? "break" : "continue";
      const id = block(kind, node);
      if (loop && !node.label && (kind === "break" || loop.continueTarget >= 0)) edge(id, kind === "break" ? loop.breakTarget : loop.continueTarget, kind);
      else unknowns.add("unsupported_jump_target");
      return id;
    }
    if (ast.isExpressionStatement(node) || ast.isVariableStatement(node) ||
        ast.isEmptyStatement(node) || ast.isFunctionDeclaration(node)) {
      const id = block(ast.isFunctionDeclaration(node) ? "declaration" : "statement", node);
      edge(id, next);
      return awaitPrefix(node, id, completion);
    }
    unknowns.add(`unsupported_statement_${node.kind}`);
    return block("unknown", node);
  };
  if (ast.isBlock(body)) edge(entry, lower(body, exit));
  else { const returned = block("return", body); edge(entry, returned); edge(returned, exit, "return"); }
  // Keep unreachable statements out of the executable graph (e.g. after return).
  const reachable = new Set<number>([entry]);
  const pending = [entry];
  const outgoing = new Map<number, number[]>();
  for (const item of edges) outgoing.set(item.from, [...(outgoing.get(item.from) ?? []), item.to]);
  while (pending.length) {
    for (const to of outgoing.get(pending.pop()!) ?? []) {
      if (!reachable.has(to)) { reachable.add(to); pending.push(to); }
    }
  }
  return {
    blocks: blocks.filter((item) => reachable.has(item.id) || item.id === exit),
    edges: edges.filter((item) => reachable.has(item.from)),
    entry, exit, unknowns: [...unknowns].sort(),
  };
}
