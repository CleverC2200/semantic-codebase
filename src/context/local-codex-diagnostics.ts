import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sha256Bytes } from "../contract/hash.js";
import { readCodexTelemetry } from "./codex-telemetry.js";

/** Explicit local-only capture. Never attach this file to prompts or ordinary receipts. */
export function captureLocalCodexDiagnostics(stdout: string, outputDirectory: string): { path: string; count: number } | null {
  const messages: { message: string; message_hash: string; truncated: boolean }[] = [];
  let remaining = 64 * 1024;
  readCodexTelemetry(stdout, { onDiagnostic(message) {
    const bytes = Buffer.from(message);
    const retained = bytes.subarray(0, remaining);
    remaining -= retained.length;
    messages.push({ message: retained.toString("utf8"), message_hash: sha256Bytes(bytes), truncated: retained.length < bytes.length });
  } });
  if (!messages.length) return null;
  // A new directory avoids overwriting old attempts or following an existing file symlink.
  const directory = mkdtempSync(path.join(outputDirectory, "private-diagnostics-"));
  chmodSync(directory, 0o700);
  const file = path.join(directory, "errors.json");
  writeFileSync(file, JSON.stringify({ warning: "仅限本机诊断；可能含敏感文本；禁止直接外发或提交", messages }, null, 2), { flag: "wx", mode: 0o600 });
  return { path: file, count: messages.length };
}
