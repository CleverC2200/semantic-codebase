import Parser from "tree-sitter";
import Python from "tree-sitter-python";

export function pythonCallQueries(text: string) {
  const parser = new Parser(); parser.setLanguage(Python);
  const tree = parser.parse((index) => text.slice(index, index + 8192));
  return tree.rootNode.descendantsOfType("call").flatMap((call) => {
    const callee = call.childForFieldName("function")!;
    const name = callee.type === "attribute" ? callee.childForFieldName("attribute") : callee;
    if (!name || name.type !== "identifier") return [];
    const prefix = text.slice(0, name.startIndex).split("\n");
    return [{ span: { start_byte: Buffer.byteLength(text.slice(0, callee.startIndex)), end_byte: Buffer.byteLength(text.slice(0, callee.endIndex)) },
      position: { line: prefix.length - 1, character: prefix.at(-1)!.length } }];
  });
}

/** Deliberately limited, versioned registration rules; results are heuristic. */
export function pythonEntrypoints(text: string) {
  const parser = new Parser(); parser.setLanguage(Python);
  const tree = parser.parse((index) => text.slice(index, index + 8192));
  const registrations: { name: string; entry_kind: string; rule_id: string; span: { start_byte: number; end_byte: number } }[] = [];
  const add = (node: Parser.SyntaxNode, name: string, entry_kind: string, rule_id: string) => {
    if (!/^\w+$/.test(name)) return;
    registrations.push({ name, entry_kind, rule_id, span: { start_byte: Buffer.byteLength(text.slice(0, node.startIndex)), end_byte: Buffer.byteLength(text.slice(0, node.endIndex)) } });
  };
  const importsSignal = tree.rootNode.namedChildren.some((item) => item.type === "import_statement" && item.text === "import signal");
  const importsThreading = tree.rootNode.namedChildren.some((item) => item.type === "import_statement" && item.text === "import threading");
  for (const call of tree.rootNode.descendantsOfType("call")) {
    const callee = call.childForFieldName("function")!;
    const args = call.childForFieldName("arguments")?.namedChildren ?? [];
    let parent = call.parent;
    let mainGuard = false;
    let nested = false;
    while (parent) {
      if (parent.type === "function_definition" || parent.type === "class_definition") nested = true;
      if (parent.type === "if_statement" && /^__name__\s*==\s*['"]__main__['"]$/.test(parent.childForFieldName("condition")?.text ?? "")) mainGuard = true;
      parent = parent.parent;
    }
    if (!nested && mainGuard && callee.type === "identifier") add(call, callee.text, "cli", "python_main_guard_v1");
    if (!nested && importsSignal && callee.text === "signal.signal" && args[1]) add(call, args[1].text, "event_handler", "python_signal_registration_v1");
    if (!nested && importsThreading && callee.text === "threading.Timer" && args[1]) add(call, args[1].text, "scheduled_job", "python_timer_candidate_v1");
  }
  return registrations;
}
