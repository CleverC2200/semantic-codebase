import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { getHeapSpaceStatistics } from "node:v8";
import { RepositoryIndexer, TypeScriptTreeSitterAdapter, TypeScriptSemanticEnricher, sha256Bytes, buildContextPackage, answerContextPackage } from "../dist/index.js";

const duration = Number(process.argv[2] ?? 120000);
const targetRounds = process.env.SOAK_ROUNDS === undefined ? null : Number(process.env.SOAK_ROUNDS);
if (targetRounds !== null && (!Number.isInteger(targetRounds) || targetRounds < 100 || targetRounds > 100000)) throw new Error("SOAK_ROUNDS must be 100..100000");
const mode = process.env.SOAK_MODE ?? "context";
if (!["syntax", "semantic", "context"].includes(mode)) throw new Error("SOAK_MODE must be syntax, semantic or context");
const yieldEvents = process.env.SOAK_YIELD !== "0";
const label = process.env.SOAK_LABEL ?? "";
if (!/^[a-z0-9-]{0,40}$/.test(label)) throw new Error("SOAK_LABEL must contain at most 40 lowercase letters, digits or hyphens");
if (!Number.isInteger(duration) || duration < 1000 || duration > 600000) throw new Error("Duration must be 1000..600000 ms");
if (!global.gc) throw new Error("Use --expose-gc for comparable retained-memory samples");
const output = fileURLToPath(new URL("../.workspace/acceptance/engine-soak/", import.meta.url));
mkdirSync(output, { recursive: true });
const indexer = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] });
const enricher = new TypeScriptSemanticEnricher();
const hashes = new Map(), samples = [];
const started = performance.now();
let rounds = 0, state;
let lastLogged = 0;
function sampleMemory() {
  const memory = process.memoryUsage();
  return { rounds, elapsed_ms: Math.round(performance.now() - started), rss_bytes: memory.rss, heap_bytes: memory.heapUsed,
    heap_total_bytes: memory.heapTotal, external_bytes: memory.external, array_buffer_bytes: memory.arrayBuffers,
    heap_spaces: getHeapSpaceStatistics().map((space) => ({ name: space.space_name, size_bytes: space.space_size, used_bytes: space.space_used_size, physical_bytes: space.physical_space_size })),
    active_resources: process.getActiveResourcesInfo().reduce((counts, name) => ({ ...counts, [name]: (counts[name] ?? 0) + 1 }), {}) };
}
while (performance.now() - started < duration && (targetRounds === null || rounds < targetRounds)) {
  const variant = rounds % 8;
  const source_bytes = Buffer.from(`export function inner(x: number) { return x + ${variant}; }\nexport function main(x: number) { return inner(x); }\n`);
  const source = { repository_id: "bounded-engine-soak", files: [{ relative_path: "main.ts", language: "typescript", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  state = state ? indexer.buildIncremental(state, source).state : indexer.buildFull(source).state;
  const overlay = mode === "syntax" ? null : enricher.enrich({ state, source });
  const currentHash = overlay?.overlay_hash ?? state.graph.graph_hash;
  const hash = hashes.get(variant);
  if (hash) assert.equal(currentHash, hash);
  else hashes.set(variant, currentHash);
  if (mode === "context") answerContextPackage(buildContextPackage({ state, overlay, question: "main 的数据流" }));
  rounds++;
  if (rounds % 20 === 0) {
    // Child-process close callbacks need event-loop turns even for the sync API.
    // SOAK_YIELD=0 retains the blocking-loop control for diagnosis.
    if (yieldEvents) { await setImmediate(); await setImmediate(); }
    global.gc();
    const sample = sampleMemory();
    samples.push(sample);
    if (sample.elapsed_ms - lastLogged >= 10000) {
      const { heap_spaces: _spaces, ...summary } = sample;
      console.log(JSON.stringify(summary));
      lastLogged = sample.elapsed_ms;
    }
  }
}
global.gc();
const tail = sampleMemory();
samples.push(tail);
const baseline = samples.find((sample) => sample.rounds >= 100) ?? samples[0];
const growth = tail.rss_bytes - baseline.rss_bytes;
const secondHalf = samples.filter((sample) => sample.elapsed_ms >= tail.elapsed_ms / 2);
const steadyStart = secondHalf[0] ?? tail;
const completed = targetRounds === null || rounds === targetRounds;
const passed = completed && Math.max(...samples.map((sample) => sample.rss_bytes)) < 2 * 1024 ** 3 && growth < 256 * 1024 ** 2;
writeFileSync(path.join(output, `receipt-${mode}-${yieldEvents ? "yield" : "blocking"}${targetRounds === null ? "" : `-${targetRounds}-rounds`}${label ? `-${label}` : ""}.json`), JSON.stringify({ scope: "one persistent Node host, reused engines, eight small TS inputs; not a production daemon or Python soak",
  mode, yield_events: yieldEvents,
  exec_args: process.execArgv,
  runtime: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch },
  completed, requested_duration_ms: duration, requested_rounds: targetRounds,
  duration_ms: tail.elapsed_ms, rounds, variants: hashes.size, samples, retained_rss_growth_bytes: growth, passed,
  retained_heap_growth_bytes: tail.heap_bytes - baseline.heap_bytes,
  second_half: { rounds: tail.rounds - steadyStart.rounds, heap_growth_bytes: tail.heap_bytes - steadyStart.heap_bytes,
    rss_growth_bytes: tail.rss_bytes - steadyStart.rss_bytes },
  interpretation: "passed checks resource ceilings only; inspect retained heap/RSS trends separately, not proof of long-term stability",
  budgets: { rss_bytes: 2 * 1024 ** 3, post_warmup_growth_bytes: 256 * 1024 ** 2 } }, null, 2));
console.log(JSON.stringify({ duration_ms: tail.elapsed_ms, rounds, growth, passed }));
if (!passed) process.exitCode = 1;
