import assert from "node:assert/strict";
import { test } from "node:test";
import { pythonControlFlows } from "../../src/semantic/python-control-flow.js";
test("Python with returns through context exit and exposes suppression uncertainty", () => {
  const [result] = pythonControlFlows("def main():\n    with open('file') as f:\n        return f.read()\n", (span) => `${span.start_byte}:${span.end_byte}`);
  const graph = result!.graph;
  const returned = graph.blocks.find((item) => item.kind === "return")!;
  const after = graph.edges.find((item) => item.from === returned.id)!;
  assert.equal(graph.blocks.find((item) => item.id === after.to)!.kind, "context_exit");
  assert.ok(graph.unknowns.some((item) => item.includes("suppression_unknown")));
});
test("Python await rejection enters exception dispatch and return executes finally", () => {
  const text = "async def main():\n    try:\n        await work()\n        return 1\n    except ValueError:\n        return 2\n    finally:\n        cleanup()\n";
  const [result] = pythonControlFlows(text, (span) => `${span.start_byte}:${span.end_byte}`);
  const graph = result!.graph;
  const suspend = graph.blocks.find((item) => item.kind === "await_suspend")!;
  assert.ok(suspend);
  const rejection = graph.edges.find((item) => item.from === suspend.id && item.kind === "reject")!;
  assert.equal(graph.blocks.find((item) => item.id === rejection.to)!.kind, "exception_dispatch");
  for (const returned of graph.blocks.filter((item) => item.kind === "return")) {
    const target = graph.edges.find((item) => item.from === returned.id)!.to;
    assert.notEqual(target, graph.exit);
    const evidence = graph.blocks.find((item) => item.id === target)!.evidence_id.split(":").map(Number);
    assert.equal(Buffer.from(text).subarray(evidence[0], evidence[1]).toString(), "cleanup()");
  }
});
test("Python CFG separates branches, isolates nested functions and excludes unreachable statements", () => {
  const text = "# 中文🙂\ndef main(flag):\n    if flag:\n        return 1\n    elif flag is None:\n        return 2\n    else:\n        raise ValueError()\n    print('dead')\n";
  const [result] = pythonControlFlows(text, (span) => `${span.start_byte}:${span.end_byte}`);
  assert.ok(result);
  assert.equal(result.graph.blocks.filter((item) => item.kind === "condition").length, 2);
  assert.equal(result.graph.blocks.filter((item) => item.kind === "statement").length, 0);
  assert.equal(Buffer.from(text).subarray(result.name_span.start_byte, result.name_span.end_byte).toString(), "main");
});

test("Python data flow merges branch definitions and isolates nested scopes", () => {
  const text = "def main(flag, value):\n    x = value\n    if flag:\n        x = x + 1\n    else:\n        x = value + 2\n    def nested():\n        x = 99\n    return x\n";
  const [result] = pythonControlFlows(text, (span) => `${span.start_byte}:${span.end_byte}`);
  const data = result!.data;
  assert.equal(data.converged, true);
  const returned = result!.graph.blocks.find((item) => item.kind === "return")!;
  const read = data.accesses.find((item) => item.block === returned.id && item.name === "x" && item.kind === "use")!;
  assert.equal(data.links.filter((item) => item.use === read.id).length, 2);
  assert.deepEqual([...new Set(data.parameter_returns.map((item) => data.accesses[item.parameter]!.name))], ["value"]);
});
