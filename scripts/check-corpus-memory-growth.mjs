import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Diagnostic regression envelope, not a production daemon/SLA acceptance gate.
const filename = process.argv[2];
assert.ok(filename, "Provide a verify-corpus-memory receipt");
const receipt = JSON.parse(readFileSync(filename, "utf8"));
assert.ok(receipt.gc_mode === "forced" || (receipt.gc_mode === undefined && receipt.exec_args?.includes("--expose-gc")), "Retained-memory regression requires forced-GC samples");
const rounds = receipt.result?.rounds ?? [];
assert.ok(receipt.passed && rounds.length >= 12 && rounds.length === receipt.requested_rounds, "At least 12 completed resource-passing rounds are required");
const rss = rounds.map((round) => round.memory.rss);
assert.ok(rss.every((value) => Number.isFinite(value) && value > 0));
const totalGrowth = rss.at(-1) - rss[0];
const tail = rss.slice(Math.floor(rss.length / 2));
const tailRange = Math.max(...tail) - Math.min(...tail);
const passed = totalGrowth <= 256 * 1024 ** 2 && tailRange <= 128 * 1024 ** 2;
console.log(JSON.stringify({ passed, rounds: rounds.length, retained_rss_growth_bytes: totalGrowth, second_half_rss_range_bytes: tailRange,
  budgets: { retained_growth_bytes: 256 * 1024 ** 2, second_half_range_bytes: 128 * 1024 ** 2 },
  scope: "diagnostic envelope for this frozen corpus; not proof of leak absence or long-duration stability" }));
assert.ok(passed, "Retained RSS exceeds the frozen-corpus regression envelope");
