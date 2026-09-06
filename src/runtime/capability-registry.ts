import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { createRequire } from "node:module";
import { canonicalHash } from "../contract/hash.js";
import type { RuntimeObservationSet } from "./types.js";

interface Decision {
  capability_id: string;
  repository_id: string;
  snapshot_id: string;
  candidate_id: string;
  title: string;
  status: "accepted" | "rejected" | "merged";
  merged_into: string | null;
  version: number;
  actor: string;
  reason: string;
  observation_ids: string[];
  observation_set_hash: string;
}

export interface ConfirmedCapability {
  capability_id: string;
  repository_id: string;
  snapshot_id: string;
  title: string;
  basis: "human_confirmed";
  members: { candidate_id: string; version: number; actor: string; reason: string; observation_set_hash: string; observation_ids: string[] }[];
  definition_keys: string[];
}

export class CapabilityRegistry {
  private db: DatabaseSyncType;
  constructor(databasePath: string, options: { read_only?: boolean } = {}) {
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
    this.db = new DatabaseSync(databasePath, { readOnly: options.read_only ?? false });
    if (!options.read_only) this.db.exec(`CREATE TABLE IF NOT EXISTS capability_decisions (
      capability_id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, value_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS capability_decision_events (
      capability_id TEXT NOT NULL, version INTEGER NOT NULL, value_json TEXT NOT NULL,
      PRIMARY KEY (capability_id, version));
      CREATE TABLE IF NOT EXISTS capability_observation_sets (
      observation_set_hash TEXT PRIMARY KEY, value_json TEXT NOT NULL);`);
  }
  list(repositoryId: string, snapshotId: string) {
    if (!this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'capability_decisions'").get()) return [];
    return this.db.prepare("SELECT value_json FROM capability_decisions WHERE repository_id = ? ORDER BY capability_id").all(repositoryId)
      .map((row) => { const decision = JSON.parse(row.value_json as string) as Decision; return { ...decision, stale: decision.snapshot_id !== snapshotId }; });
  }
  confirmed(repositoryId: string, snapshotId: string): ConfirmedCapability[] {
    const current = this.list(repositoryId, snapshotId).filter((item) => !item.stale);
    const byId = new Map(current.map((item) => [item.capability_id, item]));
    const rootOf = (item: typeof current[number]): string | null => {
      const seen = new Set<string>();
      while (item.status === "merged" && item.merged_into) {
        if (seen.has(item.capability_id)) return null;
        seen.add(item.capability_id);
        const parent = byId.get(item.merged_into); if (!parent) return null; item = parent;
      }
      return item.status === "accepted" ? item.capability_id : null;
    };
    return current.filter((item) => item.status === "accepted").map((root) => {
      const members = current.filter((item) => rootOf(item) === root.capability_id);
      const definitions = new Set<string>();
      for (const member of members) {
        const row = this.db.prepare("SELECT value_json FROM capability_observation_sets WHERE observation_set_hash = ?").get(member.observation_set_hash);
        if (!row) throw new Error("CAPABILITY_OBSERVATION_SET_MISSING");
        const runtime = JSON.parse(row.value_json as string) as RuntimeObservationSet;
        for (const observation of runtime.observations) if (member.observation_ids.includes(observation.observation_id) && observation.definition_key) definitions.add(observation.definition_key);
      }
      return { capability_id: root.capability_id, repository_id: repositoryId, snapshot_id: snapshotId, title: root.title, basis: "human_confirmed" as const,
        members: members.map((item) => ({ candidate_id: item.candidate_id, version: item.version, actor: item.actor, reason: item.reason,
          observation_set_hash: item.observation_set_hash, observation_ids: item.observation_ids })), definition_keys: [...definitions].sort() };
    });
  }
  decide(input: { runtime: RuntimeObservationSet; candidate_id: string; action: "accept" | "reject" | "merge" | "revalidate"; capability_id?: string; title?: string; into_id?: string; actor: string; reason: string; expected_version: number }) {
    const { observation_set_hash, ...runtimeBody } = input.runtime;
    if (canonicalHash(runtimeBody) !== observation_set_hash) throw new Error("CAPABILITY_INVALID_OBSERVATION_HASH");
    const candidate = input.runtime.capability_candidates.find((item) => item.candidate_id === input.candidate_id);
    if (!candidate || !input.actor.trim() || !input.reason.trim()) throw new Error("CAPABILITY_INVALID_DECISION");
    if (input.action !== "reject" && !candidate.observed_definition_keys.length) throw new Error("CAPABILITY_NO_CODE_EVIDENCE");
    if (!candidate.observation_ids.length || candidate.observation_ids.some((id) => !input.runtime.observations.some((item) => item.observation_id === id))) throw new Error("CAPABILITY_EVIDENCE_NOT_CLOSED");
    const observedKeys = new Set(input.runtime.observations.filter((item) => candidate.observation_ids.includes(item.observation_id)).map((item) => item.definition_key));
    if (candidate.observed_definition_keys.some((key) => !observedKeys.has(key))) throw new Error("CAPABILITY_EVIDENCE_NOT_CLOSED");
    const id = input.action === "revalidate" ? input.capability_id : canonicalHash({ repository_id: input.runtime.repository_id, candidate_id: candidate.candidate_id });
    if (!id) throw new Error("CAPABILITY_ID_REQUIRED");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.list(input.runtime.repository_id, input.runtime.snapshot_id).find((item) => item.capability_id === id);
      if (input.action === "revalidate" && (!existing || !existing.stale || existing.status !== "accepted")) throw new Error("CAPABILITY_REVALIDATION_REQUIRES_STALE_ACCEPTED");
      if ((existing?.version ?? 0) !== input.expected_version) throw new Error("CAPABILITY_VERSION_CONFLICT");
      if (existing?.status === "merged") throw new Error("CAPABILITY_MERGE_IS_TERMINAL");
      let into: string | null = null;
      if (input.action === "merge") {
        const target = this.list(input.runtime.repository_id, input.runtime.snapshot_id).find((item) => item.capability_id === input.into_id);
        if (!target || target.capability_id === id || target.status !== "accepted" || target.stale) throw new Error("CAPABILITY_INVALID_MERGE_TARGET");
        into = target.capability_id;
      }
      const decision: Decision = {
        capability_id: id, repository_id: input.runtime.repository_id, snapshot_id: input.runtime.snapshot_id,
        candidate_id: candidate.candidate_id, title: input.title?.trim() || existing?.title || candidate.title,
        status: input.action === "accept" || input.action === "revalidate" ? "accepted" : input.action === "reject" ? "rejected" : "merged", merged_into: into,
        version: input.expected_version + 1, actor: input.actor, reason: input.reason,
        observation_ids: [...candidate.observation_ids], observation_set_hash: input.runtime.observation_set_hash,
      };
      this.db.prepare("INSERT OR REPLACE INTO capability_decisions VALUES (?, ?, ?)").run(id, decision.repository_id, JSON.stringify(decision));
      this.db.prepare("INSERT OR IGNORE INTO capability_observation_sets VALUES (?, ?)").run(input.runtime.observation_set_hash, JSON.stringify(input.runtime));
      this.db.prepare("INSERT INTO capability_decision_events VALUES (?, ?, ?)").run(id, decision.version, JSON.stringify(decision));
      this.db.exec("COMMIT");
      return decision;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  close(): void { this.db.close(); }
}
