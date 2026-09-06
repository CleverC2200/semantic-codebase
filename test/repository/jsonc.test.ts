import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJsonc } from "../../src/repository/jsonc.js";

test("JSONC keeps comments and comma-like sequences inside strings and rejects incomplete tokens", () => {
  assert.deepEqual(parseJsonc('{/* config */ "url":"https://sample.test/", "literal":",}", "items":[1,],}'),
    { url: "https://sample.test/", literal: ",}", items: [1] });
  for (const text of ['{"a":1}"', '{"a":1} /* unfinished', '{"a":"unfinished}']) assert.throws(() => parseJsonc(text));
});
