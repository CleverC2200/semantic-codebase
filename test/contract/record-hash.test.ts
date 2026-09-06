import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalHash, canonicalRecordHash } from "../../src/contract/hash.js";

test("chunked record hashing preserves canonical bytes across row and Unicode boundaries", () => {
  for (const count of [0, 1, 300]) {
    const value = { schema_version: 1, facts: Array.from({ length: count }, (_, i) => ({ i, text: "e\u0301中文🙂".repeat(40), values: [null, -0, true] })), metadata: { b: 2, a: 1 } };
    assert.equal(canonicalRecordHash(value), canonicalHash(value));
  }
  for (const value of [JSON.parse('{"é":2,"é":3,"10":10,"2":2,"__proto__":1}'), { rows: new Array(3) }, { rows: [JSON.parse('{"__proto__":2,"2":1}')] }]) {
    assert.equal(canonicalRecordHash(value), canonicalHash(value));
  }
  assert.throws(() => canonicalRecordHash({ rows: [undefined] }), TypeError);
  assert.throws(() => canonicalRecordHash({ data: undefined }), TypeError);
});
