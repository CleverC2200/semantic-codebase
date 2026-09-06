import Parser from "tree-sitter";
import Python from "tree-sitter-python";
import type { ByteSpan } from "../contract/types.js";
import type { ControlFlowGraph } from "./control-flow.js";
import { pythonDataFlow } from "./python-data-flow.js";

export function pythonControlFlows(text: string, evidenceFor: (span: ByteSpan) => string) {
  const parser = new Parser(); parser.setLanguage(Python);
  const tree = parser.parse((index) => text.slice(index, index + 8192));
  const span = (node: Parser.SyntaxNode) => ({ start_byte: Buffer.byteLength(text.slice(0, node.startIndex)), end_byte: Buffer.byteLength(text.slice(0, node.endIndex)) });
  const results = [];
  for (const declaration of tree.rootNode.descendantsOfType("function_definition")) {
    const body = declaration.childForFieldName("body")!;
    const blocks: ControlFlowGraph["blocks"] = [];
    const nodes = new Map<string, Parser.SyntaxNode>();
    const nodeEvidence = (node: Parser.SyntaxNode) => { const id = evidenceFor(span(node)); nodes.set(id, node); return id; };
    const edges: ControlFlowGraph["edges"] = [];
    const own = (node: Parser.SyntaxNode) => {
      let parent = node.parent;
      while (parent && parent.type !== "function_definition") parent = parent.parent;
      return parent?.id === declaration.id;
    };
    const rootIdentifier = (node: Parser.SyntaxNode | null): string | null => {
      let current = node;
      while (current && ["attribute", "subscript"].includes(current.type)) {
        current = current.childForFieldName("object") ?? current.childForFieldName("value");
      }
      return current?.type === "identifier" ? current.text : null;
    };
    const assignments = declaration.descendantsOfType(["assignment", "augmented_assignment"]).filter(own);
    const parameterNames = new Set((declaration.childForFieldName("parameters")?.descendantsOfType("identifier") ?? []).map((node) => node.text));
    const nonlocalNames = new Set(declaration.descendantsOfType(["global_statement", "nonlocal_statement"]).filter(own)
      .flatMap((node) => node.descendantsOfType("identifier").map((item) => item.text)));
    const localReceivers = new Set(assignments.flatMap((node) => {
      const left = node.childForFieldName("left");
      return left?.type === "identifier" && !nonlocalNames.has(left.text) ? [left.text] : [];
    }));
    for (const node of assignments) {
      const left = node.childForFieldName("left");
      const rightRoot = rootIdentifier(node.childForFieldName("right"));
      if (left?.type === "identifier" && rightRoot && (parameterNames.has(rightRoot) || ["self", "cls"].includes(rightRoot))) {
        localReceivers.delete(left.text);
      }
    }
    const unknowns = new Set(["python_dynamic_dispatch", "implicit_exceptions_not_modeled", "expression_internal_flow_not_modeled"]);
    const block = (kind: string, node: Parser.SyntaxNode) => {
      const id = blocks.length;
      blocks.push({ id, kind, evidence_id: nodeEvidence(node),
        ...(kind === "entry" || kind === "exit" ? {} : { source_excerpt: node.text.slice(0, 800) + (node.text.length > 800 ? "…" : "") }) });
      return id;
    };
    const entry = block("entry", body); const exit = block("exit", body);
    const edge = (from: number, to: number, kind = "next") => { edges.push({ from, to, kind }); };
    type Completion = { returned: number; thrown: number };
    const awaitPrefix = (node: Parser.SyntaxNode, next: number, completion: Completion) => {
      let head = next;
      const awaits = node.descendantsOfType("await").filter((item) => {
        let parent = item.parent;
        while (parent && parent.id !== node.id) {
          if (["function_definition", "lambda", "conditional_expression", "boolean_operator"].includes(parent.type)) {
            unknowns.add("conditional_or_nested_await_unknown"); return false;
          }
          parent = parent.parent;
        }
        return !["function_definition", "decorated_definition"].includes(node.type);
      });
      for (const item of awaits.reverse()) {
        const suspend = block("await_suspend", item); const resume = block("await_resume", item);
        edge(suspend, resume, "resume"); edge(suspend, completion.thrown, "reject"); edge(resume, head); head = suspend;
      }
      if (awaits.length) unknowns.add("await_expression_evaluation_order_approximate");
      return head;
    };
    const lower = (node: Parser.SyntaxNode, next: number, loop?: { stop: number; again: number }, completion: Completion = { returned: exit, thrown: exit }): number => {
      if (node.type === "block" || node.type === "else_clause") {
        let head = next;
        for (const child of [...node.namedChildren].reverse()) head = lower(child, head, loop, completion);
        return head;
      }
      if (node.type === "if_statement" || node.type === "elif_clause") {
        let alternative = next;
        for (const child of [...node.childrenForFieldName("alternative")].reverse()) alternative = lower(child, alternative, loop, completion);
        const condition = block("condition", node.childForFieldName("condition")!);
        edge(condition, lower(node.childForFieldName("consequence")!, next, loop, completion), "true");
        edge(condition, alternative, "false"); return condition;
      }
      if (node.type === "while_statement" || node.type === "for_statement") {
        const condition = block("condition", node.childForFieldName("condition") ?? node.childForFieldName("right")!);
        const alternative = node.childForFieldName("alternative");
        edge(condition, lower(node.childForFieldName("body")!, condition, { stop: next, again: condition }, completion), "true");
        edge(condition, alternative ? lower(alternative, next, loop, completion) : next, "false");
        if (node.type === "for_statement") unknowns.add("python_iterator_binding_not_modeled");
        return condition;
      }
      if (node.type === "try_statement") {
        const finallyBody = node.namedChildren.find((item) => item.type === "finally_clause")?.namedChildren.find((item) => item.type === "block");
        const finalize = (target: number) => finallyBody ? lower(finallyBody, target, loop, completion) : target;
        const normal = finalize(next);
        const wrapped = { returned: finalize(completion.returned), thrown: finalize(completion.thrown) };
        const wrappedLoop = loop ? { stop: finalize(loop.stop), again: finalize(loop.again) } : undefined;
        const handlers = node.namedChildren.filter((item) => item.type === "except_clause");
        let thrown = wrapped.thrown;
        if (handlers.length) {
          thrown = block("exception_dispatch", node);
          for (const handler of handlers) {
            const handlerBody = handler.namedChildren.find((item) => item.type === "block")!;
            edge(thrown, lower(handlerBody, normal, wrappedLoop, wrapped), "except_possible");
          }
          edge(thrown, wrapped.thrown, "unmatched_exception_possible");
          unknowns.add("python_exception_type_and_binding_unknown");
        }
        const alternative = node.namedChildren.find((item) => item.type === "else_clause");
        return lower(node.childForFieldName("body")!, alternative ? lower(alternative, normal, wrappedLoop, wrapped) : normal, wrappedLoop, { ...wrapped, thrown });
      }
      if (node.type === "with_statement") {
        const clause = node.namedChildren.find((item) => item.type === "with_clause")!;
        const cleanup = (target: number) => { const id = block("context_exit", clause); edge(id, target, "exit_possible"); return id; };
        const enter = block("context_enter", clause);
        const normal = cleanup(next);
        const wrapped = { returned: cleanup(completion.returned), thrown: cleanup(completion.thrown) };
        const wrappedLoop = loop ? { stop: cleanup(loop.stop), again: cleanup(loop.again) } : undefined;
        edge(enter, lower(node.childForFieldName("body")!, normal, wrappedLoop, wrapped), "enter_possible");
        edge(enter, completion.thrown, "enter_failure_possible");
        unknowns.add("python_context_manager_binding_and_exception_suppression_unknown");
        return enter;
      }
      if (["return_statement", "raise_statement"].includes(node.type)) {
        const kind = node.type === "return_statement" ? "return" : "throw";
        const id = block(kind, node); edge(id, kind === "return" ? completion.returned : completion.thrown, kind); return awaitPrefix(node, id, completion);
      }
      if (["break_statement", "continue_statement"].includes(node.type)) {
        const id = block(node.type === "break_statement" ? "break" : "continue", node);
        if (loop) edge(id, node.type === "break_statement" ? loop.stop : loop.again);
        else unknowns.add("invalid_loop_jump");
        return id;
      }
      if (["expression_statement", "pass_statement", "comment", "global_statement", "nonlocal_statement", "import_statement", "import_from_statement", "function_definition", "class_definition", "decorated_definition"].includes(node.type)) {
        const kind = ["function_definition", "class_definition", "decorated_definition"].includes(node.type) ? "declaration" : "statement";
        const id = block(kind, node); edge(id, next); return awaitPrefix(node, id, completion);
      }
      unknowns.add(`unsupported_python_${node.type}`); return block("unknown", node);
    };
    edge(entry, lower(body, exit));
    const reachable = new Set([entry]);
    // Bounded fixed point avoids recursion through loop backedges.
    for (let changed = true; changed;) {
      changed = false;
      for (const item of edges) if (reachable.has(item.from) && !reachable.has(item.to)) { reachable.add(item.to); changed = true; }
    }
    const graph = { entry, exit, blocks: blocks.filter((item) => reachable.has(item.id) || item.id === exit), edges: edges.filter((item) => reachable.has(item.from)), unknowns: [...unknowns].sort() };
    const calls = declaration.descendantsOfType("call").filter((node) => {
      let parent = node.parent; while (parent && parent.type !== "function_definition") parent = parent.parent;
      return parent?.id === declaration.id;
    }).map((node) => {
      const callee = node.childForFieldName("function")!;
      const arguments_ = node.childForFieldName("arguments")?.namedChildren ?? [];
      const parent = node.parent;
      const receiver = parent?.type === "assignment" && parent.childForFieldName("right")?.id === node.id ? parent.childForFieldName("left") : null;
      return { call: callee.text, function_span: span(callee), call_site_evidence_id: nodeEvidence(node), argument_evidence_ids: arguments_.map(nodeEvidence),
        receiver_local_fresh: localReceivers.has(rootIdentifier(callee) ?? ""),
        returned_directly: parent?.type === "return_statement" && parent.namedChildren.length === 1,
        argument_names: arguments_.map((argument) => argument.type === "keyword_argument" ? argument.childForFieldName("name")?.text ?? null : null),
        result_binding_evidence_id: receiver?.type === "identifier" ? nodeEvidence(receiver) : null,
        has_spread_arguments: arguments_.some((argument) => ["list_splat", "dictionary_splat"].includes(argument.type)) };
    });
    const stateWrites = declaration.descendantsOfType(["assignment", "augmented_assignment"]).filter(own).flatMap((node) => {
      const target = node.childForFieldName("left");
      if (!target || !["attribute", "subscript"].includes(target.type)) return [];
      if (localReceivers.has(rootIdentifier(target) ?? "")) return [];
      return [{ operation: target.text, evidence_id: nodeEvidence(node), scope: "heap" }];
    });
    results.push({ name_span: span(declaration.childForFieldName("name")!), graph, calls, state_writes: stateWrites, data: pythonDataFlow(declaration, graph, nodes, nodeEvidence) });
  }
  return results;
}
