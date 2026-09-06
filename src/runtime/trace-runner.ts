import { spawn } from "node:child_process";
import { closeSync, constants, fstatSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalHash, sha256Bytes } from "../contract/hash.js";
import type { IndexState } from "../indexing/types.js";
import { discoverRepository, repositoryManifestSummary } from "../repository/source.js";
import type { SemanticOverlay } from "../semantic/types.js";
import { importOpenTelemetryJson } from "./otel-importer.js";
import { RuntimeImportError } from "./types.js";

/** Executes only an explicit argv command. Instrumentation must emit OTLP JSON itself. */
export async function runTrace(input: { root: string; state: IndexState; overlay: SemanticOverlay; argv: string[]; timeout_ms?: number }) {
  if (!input.argv.length) throw new RuntimeImportError("INVALID_ARGUMENT", "trace run requires -- <command> [args]");
  const timeout = input.timeout_ms ?? 30000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300000) throw new RuntimeImportError("INVALID_ARGUMENT", "timeout-ms must be between 1 and 300000");
  const fresh = () => repositoryManifestSummary(discoverRepository(input.root).source).digest === input.state.source_manifest_digest;
  if (!fresh()) throw new RuntimeImportError("STALE_SNAPSHOT", "Refusing to run against stale source");
  const directory = mkdtempSync(path.join(os.tmpdir(), "scb-trace-run-"));
  const tracePath = path.join(directory, "trace.json");
  const startedAt = new Date().toISOString(), start = performance.now();
  try {
    const result = await executeCommand(input.argv, input.root, timeout, tracePath, input.state.snapshot_id);
    const execution = {
      snapshot_id: input.state.snapshot_id, cwd: input.root, command_digest: canonicalHash(input.argv),
      environment: { platform: process.platform, arch: process.arch, node: process.version },
      started_at: startedAt, duration_ms: Math.round(performance.now() - start), timeout_ms: timeout,
      exit_code: result.status, signal: result.signal, error_code: result.error ? "EXECUTION_FAILED_OR_TIMED_OUT" : null,
      stdout_digest: sha256Bytes(result.stdout ?? Buffer.alloc(0)), stderr_digest: sha256Bytes(result.stderr ?? Buffer.alloc(0)),
      termination_scope: process.platform === "win32" ? "direct_child_only" : "owned_process_group",
    };
    let unchanged = false;
    try { unchanged = fresh(); } catch { /* Target command may have changed or removed its source tree. */ }
    if (!unchanged) return { execution, status: "source_changed", observations: null };
    let descriptor: number;
    try { descriptor = openSync(tracePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { execution, status: "no_trace", observations: null };
      return { execution, status: "invalid_trace", observations: null, error_code: "INVALID_OTEL_JSON" };
    }
    let trace: unknown;
    try {
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error("Trace exceeds file budget");
      trace = JSON.parse(readFileSync(descriptor, "utf8"));
    } catch { return { execution, status: "invalid_trace", observations: null, error_code: "INVALID_OTEL_JSON" }; }
    finally { closeSync(descriptor); }
    try {
      return { execution, status: "imported", observations: importOpenTelemetryJson({
        repository_id: input.state.repository_id, snapshot_id: input.state.snapshot_id, definitions: input.state.graph.definitions, overlay: input.overlay, trace,
      }) };
    } catch (error) {
      return { execution, status: "invalid_trace", observations: null, error_code: error instanceof RuntimeImportError ? error.code : "INVALID_OTEL_JSON" };
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function executeCommand(argv: string[], cwd: string, timeout: number, tracePath: string, snapshotId: string): Promise<{
  status: number | null; signal: NodeJS.Signals | null; error: Error | null; stdout: Buffer; stderr: Buffer;
}> {
  return new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, SCB_TRACE_OUTPUT: tracePath, SCB_SNAPSHOT_ID: snapshotId } });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let bytes = 0, error: Error | null = null;
    const stop = () => {
      if (!child.pid) return;
      try { if (process.platform === "win32") child.kill("SIGKILL"); else process.kill(-child.pid, "SIGKILL"); } catch { /* Owned group already exited. */ }
    };
    const timer = setTimeout(() => { error = new Error("EXECUTION_TIMEOUT"); stop(); }, timeout);
    const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) { error = new Error("EXECUTION_OUTPUT_BUDGET"); stop(); return; }
      chunks.push(chunk);
    };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
    child.once("error", (failure) => { error = failure; });
    child.once("exit", stop);
    child.once("close", (status, signal) => {
      clearTimeout(timer); stop();
      resolve({ status, signal, error, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}
