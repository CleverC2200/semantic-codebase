import assert from "node:assert/strict";
import { test } from "node:test";
import { executeQueryPlan } from "../../src/context/query-plan.js";
import type { SemanticFact } from "../../src/semantic/types.js";

const call = (source: string, target: string): SemanticFact => ({ fact_id: `${source}-${target}`, kind: "call_target", subject: { kind: "definition", definition_key: source }, value: { target_definition_key: target }, basis: { kind: "static_possible", rule_id: "fixture", reason_codes: [] }, evidence_ids: ["fixture"] });
test("query plans distinguish downstream calls from upstream impact and terminate cycles", () => {
  const facts = [call("a", "b"), call("b", "c"), call("c", "b"), call("z", "a")];
  assert.deepEqual(executeQueryPlan("call_path", ["b"], facts).definition_keys, ["b", "c"]);
  assert.deepEqual(executeQueryPlan("impact_scope", ["b"], facts).definition_keys, ["a", "b", "c", "z"]);
  assert.deepEqual(executeQueryPlan("file_role", ["b"], facts).edges, []);
});
test("query plan depth budget is explicit", () => {
  const facts = Array.from({ length: 8 }, (_, i) => call(String(i), String(i + 1)));
  const plan = executeQueryPlan("call_path", ["0"], facts);
  assert.equal(plan.truncated, true);
  assert.equal(plan.edges.length, 4);
});

test("entry plans use reachable Application Flow calls, not every syntactic call", () => {
  const a = call("a", "b"); const dead = call("a", "dead");
  const flow: SemanticFact = { ...a, fact_id: "flow", kind: "application_flow", value: { calls: [{ call_fact_id: a.fact_id }] } };
  assert.deepEqual(executeQueryPlan("entry_flow", ["a"], [a, dead, flow]).definition_keys, ["a", "b"]);
  assert.deepEqual(executeQueryPlan("call_path", ["a"], [a, call("b", "c")]).paths[0]!.definition_keys, ["a", "b", "c"]);
});
