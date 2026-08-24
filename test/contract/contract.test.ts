import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalHash,
  canonicalJson,
  failedSyntaxSlice,
  sha256Bytes,
  validateSourceInput,
  type SyntaxAdapter,
  type SyntaxAdapterManifest,
} from "../../src/index.js";

const manifest: SyntaxAdapterManifest = {
  id: "test-adapter",
  version: "1",
  language: "typescript",
  runtime: { id: "none", version: "1" },
  grammar: { id: "none", version: "1", digest: "grammar" },
  query_digest: "query",
  config_digest: "config",
  capabilities: {
    definition_kinds: [],
    exact_relation_kinds: [],
    candidate_relation_kinds: [],
  },
};

test("canonical JSON sorts object keys, preserves array order and normalizes Unicode", () => {
  const first = { z: [2, 1], b: "e\u0301", a: { y: null, x: -0 } };
  const second = { a: { x: 0, y: null }, b: "é", z: [2, 1] };

  assert.equal(
    canonicalJson(first),
    '{"a":{"x":0,"y":null},"b":"é","z":[2,1]}',
  );
  assert.equal(canonicalHash(first), canonicalHash(second));
});

test("digest mismatch produces a stable failed slice through the public interface", () => {
  const bytes = new TextEncoder().encode("const x = 1;\r\n");
  const input = {
    repository_id: "repo",
    snapshot_id: "snapshot",
    relative_path: "src/x.ts",
    language: "typescript" as const,
    source_bytes: bytes,
    source_digest: "not-the-digest",
  };
  const adapter: SyntaxAdapter = {
    manifest,
    extract(source) {
      const diagnostic = validateSourceInput(source, manifest);
      assert.ok(diagnostic);
      return failedSyntaxSlice(source, diagnostic);
    },
  };

  const actual = adapter.extract(input);
  assert.deepEqual(actual.definitions, []);
  assert.deepEqual(actual.evidence, []);
  assert.equal(actual.coverage.status, "failed");
  assert.equal(actual.diagnostics[0]?.code, "source_digest_mismatch");
  assert.equal(sha256Bytes(bytes).length, 64);
});

test("byte spans use UTF-8 half-open offsets", () => {
  const bytes = new TextEncoder().encode("a中文🙂z");
  const start = new TextEncoder().encode("a").length;
  const end = new TextEncoder().encode("a中文🙂").length;
  assert.equal(new TextDecoder().decode(bytes.slice(start, end)), "中文🙂");
  assert.deepEqual({ start_byte: start, end_byte: end }, { start_byte: 1, end_byte: 11 });
});
