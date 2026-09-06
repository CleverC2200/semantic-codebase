import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DeterministicResolver,
  SnapshotCanonicalizer,
  TypeScriptTreeSitterAdapter,
  canonicalHash,
  sha256Bytes,
  type FrozenRepositoryView,
} from "../../src/index.js";

const adapter = new TypeScriptTreeSitterAdapter();

function fixture(): FrozenRepositoryView {
  const files: Array<[string, string]> = [
    ["src/dep.ts", "export class Base { work() {} }\n"],
    ["src/main.ts", 'import { Base } from "./dep"; export class Child extends Base { run() { this.run(); } }\n'],
  ];
  const slices = files.map(([relative_path, source]) => {
    const source_bytes = new TextEncoder().encode(source);
    return adapter.extract({
      repository_id: "repo",
      snapshot_id: "snapshot",
      relative_path,
      language: "typescript",
      source_bytes,
      source_digest: sha256Bytes(source_bytes),
    });
  });
  return {
    manifest: {
      repository_id: "repo",
      snapshot_id: "snapshot",
      files: slices.map((slice) => ({
        ...slice.file,
        byte_length: new TextEncoder().encode(
          files.find(([filePath]) => filePath === slice.file.relative_path)?.[1] ?? "",
        ).byteLength,
      })),
    },
    slices,
    adapter_manifests: [adapter.manifest],
  };
}

test("canonicalizer publishes deterministic definitions, relations and evidence", () => {
  const repository = fixture();
  const resolution = new DeterministicResolver().resolve(repository);
  const canonicalizer = new SnapshotCanonicalizer();
  const graph = canonicalizer.canonicalize({ repository, resolution });

  assert.equal(graph.coverage.status, "ready");
  assert.equal(graph.definitions.length, 4);
  assert.ok(graph.relations.length >= graph.definitions.length);
  assert.ok(graph.definitions.every((definition) => definition.evidence_ids.length > 0));
  assert.ok(graph.relations.every((relation) => relation.evidence_ids.length > 0));
  assert.ok(graph.relations
    .filter((relation) => relation.kind === "EXPORTS")
    .every((relation) => relation.source.kind === "source_file"));
  assert.ok(graph.relations.some((relation) =>
    relation.kind === "CALLS" &&
    relation.source.kind === "definition" &&
    relation.target.kind === "definition" &&
    relation.source.definition_key === relation.target.definition_key,
  ));
  assert.ok(graph.evidence.every((evidence) => evidence.source_digest.length === 64));
  assert.equal(
    graph.diagnostics.filter((diagnostic) => diagnostic.code === "unresolved_relation_candidate").length,
    graph.unresolved_candidates.length,
  );
  assert.equal(graph.graph_hash, canonicalizer.canonicalize({ repository, resolution }).graph_hash);
  assert.equal(canonicalHash(graph).length, 64);
});

test("invalid Definition ranges and partial Evidence references are isolated", () => {
  const repository = fixture();
  const slice = repository.slices[0]!;
  const invalidRange = slice.definitions[0]!;
  invalidRange.name_span = { start_byte: 0, end_byte: repository.manifest.files[0]!.byte_length + 1 };
  const partialEvidence = slice.definitions[1]!;
  partialEvidence.evidence_local_ids = [...partialEvidence.evidence_local_ids, "missing"];
  const resolution = new DeterministicResolver().resolve(repository);
  const graph = new SnapshotCanonicalizer().canonicalize({ repository, resolution });

  assert.equal(graph.coverage.status, "failed");
  assert.ok(graph.diagnostics.some((diagnostic) => diagnostic.code === "invalid_definition"));
  assert.ok(graph.diagnostics.some((diagnostic) => diagnostic.code === "missing_definition_evidence"));
  assert.ok(graph.definitions.every((definition) => definition.file_path !== "src/dep.ts"));
});

test("graph hashing matches canonical JSON across Unicode and chunk boundaries", () => {
  for (const count of [0, 1, 300]) {
    const repository = fixture();
    const resolution = new DeterministicResolver().resolve(repository);
    resolution.diagnostics.push(...Array.from({ length: count }, (_, index) => ({
      code: "probe", severity: "warning" as const, file_path: "src/main.ts",
      message: `${index}: ${'e\u0301 中文 😀 "\\\n'.repeat(40)}`,
    })));
    const graph = new SnapshotCanonicalizer().canonicalize({ repository, resolution });
    const { graph_hash, ...payload } = graph;
    assert.equal(graph_hash, canonicalHash(payload));
  }
});

test("stale Evidence and missing Evidence block fact publication", () => {
  const repository = fixture();
  const firstSlice = repository.slices[0];
  assert.ok(firstSlice);
  const staleEvidence = firstSlice.evidence[0];
  assert.ok(staleEvidence);
  staleEvidence.source_digest = "stale";
  const missingEvidenceDefinition = firstSlice.definitions[1];
  if (missingEvidenceDefinition) missingEvidenceDefinition.evidence_local_ids = ["missing"];
  const resolution = new DeterministicResolver().resolve(repository);
  const graph = new SnapshotCanonicalizer().canonicalize({ repository, resolution });

  assert.equal(graph.coverage.status, "failed");
  assert.ok(graph.diagnostics.some((diagnostic) => diagnostic.code === "invalid_evidence"));
  assert.ok(graph.diagnostics.some((diagnostic) => diagnostic.code === "missing_definition_evidence"));
  assert.ok(graph.definitions.length < 4);
});

test("cross-snapshot and undeclared relation results cannot enter the graph", () => {
  const repository = fixture();
  const resolution = new DeterministicResolver().resolve(repository);
  resolution.snapshot_id = "other-snapshot";
  const firstResolved = resolution.resolved_relations[0];
  assert.ok(firstResolved);
  repository.adapter_manifests[0] = {
    ...repository.adapter_manifests[0]!,
    capabilities: {
      ...repository.adapter_manifests[0]!.capabilities,
      candidate_relation_kinds: [],
    },
  };
  const graph = new SnapshotCanonicalizer().canonicalize({ repository, resolution });

  assert.equal(graph.coverage.status, "failed");
  assert.ok(graph.diagnostics.some((diagnostic) => diagnostic.code === "cross_snapshot_resolution"));
  assert.ok(graph.diagnostics.some((diagnostic) => diagnostic.code === "undeclared_relation_capability"));
  assert.ok(graph.relations.every((relation) => relation.origin === "syntax_exact"));
});

test("canonicalizer rejects stale and duplicate Candidate resolutions", () => {
  const repository = fixture();
  const resolution = new DeterministicResolver().resolve(repository);
  const firstResolved = resolution.resolved_relations[0];
  assert.ok(firstResolved);
  resolution.resolved_relations.push(structuredClone(firstResolved));
  resolution.resolved_relations.push({
    candidate_local_id: "missing-candidate",
    target: firstResolved.target,
    derivation: ["forged"],
  });

  const graph = new SnapshotCanonicalizer().canonicalize({ repository, resolution });

  assert.equal(graph.coverage.status, "failed");
  assert.ok(graph.diagnostics.some((diagnostic) => diagnostic.code === "duplicate_candidate_resolution"));
  assert.ok(graph.diagnostics.some((diagnostic) => diagnostic.code === "stale_resolution"));
  assert.ok(!graph.relations.some((relation) =>
    relation.candidate_local_ids.includes(firstResolved.candidate_local_id),
  ));
});

test("semantic invariant gate rejects the historical EXPORTS self-edge", () => {
  const repository = fixture();
  const resolution = new DeterministicResolver().resolve(repository);
  const exportCandidate = repository.slices
    .flatMap((slice) => slice.relation_candidates)
    .find((candidate) => candidate.kind === "EXPORTS");
  const exportedDefinition = repository.slices
    .flatMap((slice) => slice.definitions)
    .find((definition) => definition.name === "Base");
  assert.ok(exportCandidate);
  assert.ok(exportedDefinition);
  exportCandidate.source_local_ref = { kind: "definition", local_id: exportedDefinition.local_id };
  const graph = new SnapshotCanonicalizer().canonicalize({ repository, resolution });

  assert.equal(graph.coverage.status, "failed");
  assert.ok(graph.diagnostics.some((diagnostic) => diagnostic.code === "forbidden_relation_self_edge"));
  assert.ok(!graph.relations.some((relation) =>
    relation.kind === "EXPORTS" && relation.candidate_local_ids.includes(exportCandidate.local_id),
  ));
});

test("canonicalizer rejects unregistered Resolver derivations", () => {
  const repository = fixture();
  const resolution = new DeterministicResolver().resolve(repository);
  const firstResolved = resolution.resolved_relations[0];
  assert.ok(firstResolved);
  firstResolved.derivation = ["forged_rule"];
  const graph = new SnapshotCanonicalizer().canonicalize({ repository, resolution });

  assert.equal(graph.coverage.status, "failed");
  assert.ok(graph.diagnostics.some((diagnostic) =>
    diagnostic.code === "unregistered_resolution_derivation",
  ));
  assert.ok(!graph.relations.some((relation) =>
    relation.candidate_local_ids.includes(firstResolved.candidate_local_id),
  ));
});

test("equivalent drafts merge while conflicting drafts are isolated", () => {
  const repository = fixture();
  const slice = repository.slices[0]!;
  const original = slice.definitions[0]!;
  slice.definitions.push({ ...original, evidence_local_ids: [...original.evidence_local_ids] });
  let resolution = new DeterministicResolver().resolve(repository);
  let graph = new SnapshotCanonicalizer().canonicalize({ repository, resolution });
  assert.equal(graph.definitions.filter((definition) => definition.file_path === slice.file.relative_path).length, 2);

  slice.definitions[slice.definitions.length - 1] = { ...original, content_hash: "conflict" };
  resolution = new DeterministicResolver().resolve(repository);
  graph = new SnapshotCanonicalizer().canonicalize({ repository, resolution });
  assert.equal(graph.coverage.status, "failed");
  assert.ok(graph.diagnostics.some((diagnostic) => diagnostic.code === "definition_conflict"));
});
