import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import { canonicalHash, canonicalJson } from "../contract/hash.js";
import type {
  CanonicalCoverage,
  CanonicalDefinition,
  CanonicalEvidence,
} from "../canonicalization/types.js";
import type { IndexState } from "../indexing/types.js";
import type { SnapshotStatus, SnapshotStore, SnapshotSummary } from "./types.js";
import { SnapshotStoreError } from "./types.js";

interface SnapshotRow {
  repository_id: string;
  snapshot_id: string;
  status: SnapshotStatus;
  graph_hash: string | null;
  error_message: string | null;
  state_json: string | null;
}

const SCHEMA_VERSION = 1;
const require = createRequire(import.meta.url);

export class SqliteSnapshotStore implements SnapshotStore {
  private readonly database: DatabaseSyncType;

  constructor(readonly databasePath: string) {
    mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    this.migrate();
  }

  beginBuild(repositoryId: string, snapshotId: string): void {
    requireIdentity(repositoryId, snapshotId);
    this.transaction(() => {
      this.database.prepare(
        "INSERT INTO repositories(repository_id) VALUES (?) ON CONFLICT(repository_id) DO NOTHING",
      ).run(repositoryId);
      const existing = this.snapshotRow(repositoryId, snapshotId);
      if (existing && existing.status !== "failed") {
        throw new SnapshotStoreError(
          "SNAPSHOT_IMMUTABLE",
          `Snapshot ${snapshotId} already exists with status ${existing.status}`,
        );
      }
      if (existing) {
        this.database.prepare(
          "UPDATE snapshots SET status = 'building', error_message = NULL WHERE repository_id = ? AND snapshot_id = ?",
        ).run(repositoryId, snapshotId);
      } else {
        this.database.prepare(
          "INSERT INTO snapshots(repository_id, snapshot_id, status) VALUES (?, ?, 'building')",
        ).run(repositoryId, snapshotId);
      }
    });
  }

  publishReady(state: IndexState): void {
    verifyReadyState(state);
    this.transaction(() => {
      const row = this.snapshotRow(state.repository_id, state.snapshot_id);
      if (!row || row.status !== "building") {
        throw new SnapshotStoreError(
          "SNAPSHOT_NOT_READY",
          `Snapshot ${state.snapshot_id} must be building before publication`,
        );
      }
      this.insertSnapshotFacts(state);
      this.verifyStoredFacts(state);
      const stateJson = canonicalJson(state);
      this.database.prepare(
        `UPDATE snapshots
         SET status = 'ready', source_manifest_digest = ?, canonical_ir_version = ?,
             index_config_digest = ?, adapter_profile_digest = ?, graph_hash = ?, state_json = ?,
             ready_at = CURRENT_TIMESTAMP
         WHERE repository_id = ? AND snapshot_id = ?`,
      ).run(
        state.source_manifest_digest,
        state.canonical_ir_version,
        state.index_config_digest,
        state.adapter_profile_digest,
        state.graph.graph_hash,
        stateJson,
        state.repository_id,
        state.snapshot_id,
      );
      const prior = this.database.prepare(
        "SELECT snapshot_id FROM repository_ready_pointer WHERE repository_id = ?",
      ).get(state.repository_id) as { snapshot_id: string } | undefined;
      if (prior && prior.snapshot_id !== state.snapshot_id) {
        this.database.prepare(
          "UPDATE snapshots SET status = 'superseded' WHERE repository_id = ? AND snapshot_id = ? AND status = 'ready'",
        ).run(state.repository_id, prior.snapshot_id);
      }
      this.database.prepare(
        `INSERT INTO repository_ready_pointer(repository_id, snapshot_id)
         VALUES (?, ?)
         ON CONFLICT(repository_id) DO UPDATE SET snapshot_id = excluded.snapshot_id, updated_at = CURRENT_TIMESTAMP`,
      ).run(state.repository_id, state.snapshot_id);
    });
  }

  markFailed(repositoryId: string, snapshotId: string, message: string): void {
    const result = this.database.prepare(
      `UPDATE snapshots SET status = 'failed', error_message = ?
       WHERE repository_id = ? AND snapshot_id = ? AND status = 'building'`,
    ).run(message, repositoryId, snapshotId);
    if (Number(result.changes) !== 1) {
      throw new SnapshotStoreError(
        "SNAPSHOT_IMMUTABLE",
        `Only a building Snapshot can transition to failed: ${snapshotId}`,
      );
    }
  }

  activateReady(repositoryId: string, snapshotId: string): void {
    this.transaction(() => {
      const selected = this.snapshotRow(repositoryId, snapshotId);
      if (!selected || !["ready", "superseded"].includes(selected.status) || !selected.state_json) {
        throw new SnapshotStoreError("SNAPSHOT_NOT_READY", `Snapshot is not publishable: ${snapshotId}`);
      }
      const prior = this.database.prepare(
        "SELECT snapshot_id FROM repository_ready_pointer WHERE repository_id = ?",
      ).get(repositoryId) as { snapshot_id: string } | undefined;
      if (prior && prior.snapshot_id !== snapshotId) {
        this.database.prepare(
          "UPDATE snapshots SET status = 'superseded' WHERE repository_id = ? AND snapshot_id = ? AND status = 'ready'",
        ).run(repositoryId, prior.snapshot_id);
      }
      this.database.prepare(
        "UPDATE snapshots SET status = 'ready' WHERE repository_id = ? AND snapshot_id = ?",
      ).run(repositoryId, snapshotId);
      this.database.prepare(
        `INSERT INTO repository_ready_pointer(repository_id, snapshot_id) VALUES (?, ?)
         ON CONFLICT(repository_id) DO UPDATE SET snapshot_id = excluded.snapshot_id, updated_at = CURRENT_TIMESTAMP`,
      ).run(repositoryId, snapshotId);
    });
  }

  getCurrentReady(repositoryId: string): IndexState | null {
    const row = this.database.prepare(
      `SELECT s.* FROM repository_ready_pointer p
       JOIN snapshots s ON s.repository_id = p.repository_id AND s.snapshot_id = p.snapshot_id
       WHERE p.repository_id = ? AND s.status IN ('ready', 'superseded')`,
    ).get(repositoryId) as SnapshotRow | undefined;
    return parseState(row);
  }

  getSnapshot(repositoryId: string, snapshotId: string): IndexState | null {
    return parseState(this.snapshotRow(repositoryId, snapshotId));
  }

  getSnapshotSummary(repositoryId: string, snapshotId: string): SnapshotSummary | null {
    const row = this.snapshotRow(repositoryId, snapshotId);
    return row
      ? {
          repository_id: row.repository_id,
          snapshot_id: row.snapshot_id,
          status: row.status,
          graph_hash: row.graph_hash,
          error_message: row.error_message,
        }
      : null;
  }

  resolveReadySnapshot(
    repositoryId: string,
    selector: "current_ready" | string,
  ): { snapshot_id: string; coverage: CanonicalCoverage } | null {
    const snapshotId = selector === "current_ready"
      ? (this.database.prepare(
          "SELECT snapshot_id FROM repository_ready_pointer WHERE repository_id = ?",
        ).get(repositoryId) as { snapshot_id: string } | undefined)?.snapshot_id
      : selector;
    if (!snapshotId) return null;
    const row = this.database.prepare(
      `SELECT s.status, c.coverage_json
       FROM snapshots s JOIN snapshot_coverage c
         ON c.repository_id = s.repository_id AND c.snapshot_id = s.snapshot_id
       WHERE s.repository_id = ? AND s.snapshot_id = ? AND s.status IN ('ready', 'superseded')`,
    ).get(repositoryId, snapshotId) as { status: SnapshotStatus; coverage_json: string } | undefined;
    return row ? { snapshot_id: snapshotId, coverage: JSON.parse(row.coverage_json) as CanonicalCoverage } : null;
  }

  findDefinitions(
    repositoryId: string,
    snapshotId: string,
    query: string,
    limit: number,
  ): CanonicalDefinition[] {
    const ftsQuery = `"${query.replaceAll('"', '""')}"`;
    const rows = this.database.prepare(
      `SELECT d.definition_json
       FROM definitions d
       LEFT JOIN definitions_fts f ON f.repository_id = d.repository_id
         AND f.snapshot_id = d.snapshot_id AND f.definition_key = d.definition_key
       WHERE d.repository_id = ? AND d.snapshot_id = ? AND (
         d.qualified_name = ? OR d.name = ? OR d.qualified_name LIKE ? ESCAPE '\\' OR definitions_fts MATCH ?
       )
       ORDER BY
         CASE
           WHEN d.qualified_name = ? THEN 0
           WHEN d.name = ? THEN 1
           WHEN d.qualified_name LIKE ? ESCAPE '\\' THEN 2
           ELSE 3
         END,
         d.definition_key
       LIMIT ?`,
    ).all(
      repositoryId,
      snapshotId,
      query,
      query,
      `${escapeLike(query)}%`,
      ftsQuery,
      query,
      query,
      `${escapeLike(query)}%`,
      limit,
    ) as Array<{ definition_json: string }>;
    return rows.map((row) => JSON.parse(row.definition_json) as CanonicalDefinition);
  }

  readDefinition(repositoryId: string, snapshotId: string, definitionKey: string): CanonicalDefinition | null {
    const row = this.database.prepare(
      `SELECT definition_json FROM definitions
       WHERE repository_id = ? AND snapshot_id = ? AND definition_key = ?`,
    ).get(repositoryId, snapshotId, definitionKey) as { definition_json: string } | undefined;
    return row ? JSON.parse(row.definition_json) as CanonicalDefinition : null;
  }

  readEvidence(repositoryId: string, snapshotId: string, evidenceId: string): CanonicalEvidence | null {
    const row = this.database.prepare(
      `SELECT evidence_json FROM evidence
       WHERE repository_id = ? AND snapshot_id = ? AND evidence_id = ?`,
    ).get(repositoryId, snapshotId, evidenceId) as { evidence_json: string } | undefined;
    return row ? JSON.parse(row.evidence_json) as CanonicalEvidence : null;
  }

  close(): void {
    this.database.close();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const applied = this.database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {
      version: number | null;
    };
    if ((applied.version ?? 0) > SCHEMA_VERSION) {
      throw new SnapshotStoreError("STORE_INTEGRITY_ERROR", "Store schema is newer than this runtime");
    }
    if ((applied.version ?? 0) === SCHEMA_VERSION) return;
    this.transaction(() => {
      this.database.exec(SCHEMA_V1);
      this.database.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(SCHEMA_VERSION);
    });
  }

  private insertSnapshotFacts(state: IndexState): void {
    const repositoryId = state.repository_id;
    const snapshotId = state.snapshot_id;
    const insertSource = this.database.prepare(
      `INSERT INTO source_files(repository_id, snapshot_id, file_path, language, source_digest, byte_length)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const file of state.graph.source_files) {
      insertSource.run(repositoryId, snapshotId, file.relative_path, file.language, file.source_digest, file.byte_length);
    }
    const insertManifest = this.database.prepare(
      `INSERT INTO adapter_manifests(repository_id, snapshot_id, language, manifest_json)
       VALUES (?, ?, ?, ?)`,
    );
    for (const manifest of state.adapter_manifests) {
      insertManifest.run(repositoryId, snapshotId, manifest.language, canonicalJson(manifest));
    }
    const insertDefinition = this.database.prepare(
      `INSERT INTO definitions(
         repository_id, snapshot_id, definition_key, file_path, kind, language, name, qualified_name,
         start_byte, end_byte, content_hash, container_definition_key, definition_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertFts = this.database.prepare(
      "INSERT INTO definitions_fts(repository_id, snapshot_id, definition_key, name, qualified_name) VALUES (?, ?, ?, ?, ?)",
    );
    for (const definition of state.graph.definitions) {
      insertDefinition.run(
        repositoryId,
        snapshotId,
        definition.definition_key,
        definition.file_path,
        definition.kind,
        definition.language,
        definition.name,
        definition.qualified_name,
        definition.definition_span.start_byte,
        definition.definition_span.end_byte,
        definition.content_hash,
        definition.container_definition_key,
        canonicalJson(definition),
      );
      insertFts.run(repositoryId, snapshotId, definition.definition_key, definition.name, definition.qualified_name);
    }
    const insertRelation = this.database.prepare(
      `INSERT INTO relations(
         repository_id, snapshot_id, relation_key, kind, source_kind, source_file_path,
         source_definition_key, target_kind, target_file_path, target_definition_key, origin, relation_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const relation of state.graph.relations) {
      insertRelation.run(
        repositoryId,
        snapshotId,
        relation.relation_key,
        relation.kind,
        relation.source.kind,
        relation.source.kind === "source_file" ? relation.source.file_path : null,
        relation.source.kind === "definition" ? relation.source.definition_key : null,
        relation.target.kind,
        relation.target.kind === "source_file" ? relation.target.file_path : null,
        relation.target.kind === "definition" ? relation.target.definition_key : null,
        relation.origin,
        canonicalJson(relation),
      );
    }
    const insertEvidence = this.database.prepare(
      `INSERT INTO evidence(
         repository_id, snapshot_id, evidence_id, file_path, start_byte, end_byte, source_digest, evidence_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const evidence of state.graph.evidence) {
      insertEvidence.run(
        repositoryId,
        snapshotId,
        evidence.evidence_id,
        evidence.file_path,
        evidence.span.start_byte,
        evidence.span.end_byte,
        evidence.source_digest,
        canonicalJson(evidence),
      );
    }
    const resolvedCandidateIds = new Set(
      state.graph.relations.flatMap((relation) => relation.candidate_local_ids),
    );
    const candidateLocations = new Map(
      state.slices.flatMap((slice) =>
        slice.relation_candidates.map((candidate) => [candidate.local_id, slice.file.relative_path] as const),
      ),
    );
    const insertCandidate = this.database.prepare(
      `INSERT INTO relation_candidates(
         repository_id, snapshot_id, candidate_local_id, file_path, kind, resolution_status, candidate_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const candidate of state.slices.flatMap((slice) => slice.relation_candidates)) {
      const candidatePath = candidateLocations.get(candidate.local_id);
      if (!candidatePath) {
        throw new SnapshotStoreError("STORE_INTEGRITY_ERROR", "Candidate file ownership is missing");
      }
      insertCandidate.run(
        repositoryId,
        snapshotId,
        candidate.local_id,
        candidatePath,
        candidate.kind,
        resolvedCandidateIds.has(candidate.local_id) ? "resolved" : "unresolved",
        canonicalJson(candidate),
      );
    }
    const insertDiagnostic = this.database.prepare(
      `INSERT INTO diagnostics(repository_id, snapshot_id, ordinal, severity, code, file_path, diagnostic_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    state.graph.diagnostics.forEach((diagnostic, ordinal) => {
      insertDiagnostic.run(
        repositoryId,
        snapshotId,
        ordinal,
        diagnostic.severity,
        diagnostic.code,
        diagnostic.file_path,
        canonicalJson(diagnostic),
      );
    });
    this.database.prepare(
      `INSERT INTO snapshot_coverage(repository_id, snapshot_id, coverage_json) VALUES (?, ?, ?)`,
    ).run(repositoryId, snapshotId, canonicalJson(state.graph.coverage));
  }

  private verifyStoredFacts(state: IndexState): void {
    const expected: Array<[string, number]> = [
      ["source_files", state.graph.source_files.length],
      ["definitions", state.graph.definitions.length],
      ["relations", state.graph.relations.length],
      ["evidence", state.graph.evidence.length],
      ["relation_candidates", state.slices.reduce((count, slice) => count + slice.relation_candidates.length, 0)],
      ["diagnostics", state.graph.diagnostics.length],
    ];
    for (const [table, count] of expected) {
      const row = this.database.prepare(
        `SELECT COUNT(*) AS count FROM ${table} WHERE repository_id = ? AND snapshot_id = ?`,
      ).get(state.repository_id, state.snapshot_id) as { count: number };
      if (Number(row.count) !== count) {
        throw new SnapshotStoreError("STORE_INTEGRITY_ERROR", `${table} row count mismatch`);
      }
    }
    const missingEndpoints = this.database.prepare(
      `SELECT COUNT(*) AS count FROM relations r
       WHERE r.repository_id = ? AND r.snapshot_id = ? AND (
         (r.source_kind = 'definition' AND NOT EXISTS (
           SELECT 1 FROM definitions d WHERE d.repository_id = r.repository_id
             AND d.snapshot_id = r.snapshot_id AND d.definition_key = r.source_definition_key
         )) OR
         (r.target_kind = 'definition' AND NOT EXISTS (
           SELECT 1 FROM definitions d WHERE d.repository_id = r.repository_id
             AND d.snapshot_id = r.snapshot_id AND d.definition_key = r.target_definition_key
         ))
       )`,
    ).get(state.repository_id, state.snapshot_id) as { count: number };
    if (Number(missingEndpoints.count) !== 0) {
      throw new SnapshotStoreError("STORE_INTEGRITY_ERROR", "Relation endpoint integrity check failed");
    }
  }

  private snapshotRow(repositoryId: string, snapshotId: string): SnapshotRow | undefined {
    return this.database.prepare(
      `SELECT repository_id, snapshot_id, status, graph_hash, error_message, state_json
       FROM snapshots WHERE repository_id = ? AND snapshot_id = ?`,
    ).get(repositoryId, snapshotId) as SnapshotRow | undefined;
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function verifyReadyState(state: IndexState): void {
  if (
    !state.repository_id ||
    state.snapshot_id !== state.graph.snapshot_id ||
    state.repository_id !== state.graph.repository_id ||
    state.graph.coverage.status !== "ready"
  ) {
    throw new SnapshotStoreError("STORE_INTEGRITY_ERROR", "Only a coherent Ready IndexState can be published");
  }
  const { graph_hash, ...graphWithoutHash } = state.graph;
  if (canonicalHash(graphWithoutHash) !== graph_hash) {
    throw new SnapshotStoreError("STORE_INTEGRITY_ERROR", "Canonical graph hash mismatch");
  }
}

function parseState(row: SnapshotRow | undefined): IndexState | null {
  if (!row?.state_json || !["ready", "superseded"].includes(row.status)) return null;
  return JSON.parse(row.state_json) as IndexState;
}

function requireIdentity(repositoryId: string, snapshotId: string): void {
  if (!repositoryId || !snapshotId) {
    throw new SnapshotStoreError("STORE_INTEGRITY_ERROR", "Repository and Snapshot identities are required");
  }
}

function escapeLike(value: string): string {
  return value.replaceAll("%", "\\%").replaceAll("_", "\\_");
}

const SCHEMA_V1 = `
  CREATE TABLE repositories (
    repository_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE snapshots (
    repository_id TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('building', 'ready', 'failed', 'superseded')),
    source_manifest_digest TEXT,
    canonical_ir_version TEXT,
    index_config_digest TEXT,
    adapter_profile_digest TEXT,
    graph_hash TEXT,
    state_json TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ready_at TEXT,
    PRIMARY KEY(repository_id, snapshot_id),
    FOREIGN KEY(repository_id) REFERENCES repositories(repository_id)
  );
  CREATE TABLE source_files (
    repository_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, file_path TEXT NOT NULL,
    language TEXT NOT NULL, source_digest TEXT NOT NULL, byte_length INTEGER NOT NULL,
    PRIMARY KEY(repository_id, snapshot_id, file_path)
  );
  CREATE TABLE adapter_manifests (
    repository_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, language TEXT NOT NULL, manifest_json TEXT NOT NULL,
    PRIMARY KEY(repository_id, snapshot_id, language)
  );
  CREATE TABLE definitions (
    repository_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, definition_key TEXT NOT NULL,
    file_path TEXT NOT NULL, kind TEXT NOT NULL, language TEXT NOT NULL, name TEXT NOT NULL,
    qualified_name TEXT NOT NULL, start_byte INTEGER NOT NULL, end_byte INTEGER NOT NULL,
    content_hash TEXT NOT NULL, container_definition_key TEXT, definition_json TEXT NOT NULL,
    PRIMARY KEY(repository_id, snapshot_id, definition_key)
  );
  CREATE VIRTUAL TABLE definitions_fts USING fts5(
    repository_id UNINDEXED, snapshot_id UNINDEXED, definition_key UNINDEXED, name, qualified_name,
    tokenize = 'unicode61'
  );
  CREATE TABLE relations (
    repository_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, relation_key TEXT NOT NULL, kind TEXT NOT NULL,
    source_kind TEXT NOT NULL, source_file_path TEXT, source_definition_key TEXT,
    target_kind TEXT NOT NULL, target_file_path TEXT, target_definition_key TEXT,
    origin TEXT NOT NULL, relation_json TEXT NOT NULL,
    PRIMARY KEY(repository_id, snapshot_id, relation_key),
    UNIQUE(repository_id, snapshot_id, kind, source_kind, source_file_path, source_definition_key,
      target_kind, target_file_path, target_definition_key)
  );
  CREATE TABLE evidence (
    repository_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, evidence_id TEXT NOT NULL,
    file_path TEXT NOT NULL, start_byte INTEGER NOT NULL, end_byte INTEGER NOT NULL,
    source_digest TEXT NOT NULL, evidence_json TEXT NOT NULL,
    PRIMARY KEY(repository_id, snapshot_id, evidence_id)
  );
  CREATE TABLE relation_candidates (
    repository_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, candidate_local_id TEXT NOT NULL,
    file_path TEXT NOT NULL, kind TEXT NOT NULL, resolution_status TEXT NOT NULL, candidate_json TEXT NOT NULL,
    PRIMARY KEY(repository_id, snapshot_id, candidate_local_id)
  );
  CREATE TABLE diagnostics (
    repository_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
    severity TEXT NOT NULL, code TEXT NOT NULL, file_path TEXT NOT NULL, diagnostic_json TEXT NOT NULL,
    PRIMARY KEY(repository_id, snapshot_id, ordinal)
  );
  CREATE TABLE snapshot_coverage (
    repository_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, coverage_json TEXT NOT NULL,
    PRIMARY KEY(repository_id, snapshot_id)
  );
  CREATE TABLE repository_ready_pointer (
    repository_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX definitions_lookup ON definitions(repository_id, snapshot_id, name, qualified_name, file_path, kind);
  CREATE INDEX relations_source ON relations(repository_id, snapshot_id, source_definition_key, source_file_path, kind);
  CREATE INDEX relations_target ON relations(repository_id, snapshot_id, target_definition_key, target_file_path, kind);
  CREATE INDEX evidence_lookup ON evidence(repository_id, snapshot_id, evidence_id);
  CREATE INDEX candidates_status ON relation_candidates(repository_id, snapshot_id, file_path, kind, resolution_status);
`;
