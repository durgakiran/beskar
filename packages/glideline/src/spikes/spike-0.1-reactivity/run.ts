/**
 * Spike 0.1 — Entry Point
 *
 * Run: tsx src/spikes/spike-0.1-reactivity/run.ts
 *
 * Produces a results table and writes RESULTS.md.
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SignalsStore } from "./candidates/signals.js";
import { JotaiStore } from "./candidates/jotai.js";
import { CustomStore } from "./candidates/custom.js";
import {
  benchIsolation,
  benchThroughput,
  benchBatch,
  type IsolationResult,
  type ThroughputResult,
  type BatchResult,
} from "./bench.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────
// Run all benchmarks
// ─────────────────────────────────────────────────────────────

interface CandidateResult {
  name: string;
  isolation: IsolationResult;
  throughput1k: ThroughputResult;
  throughput5k: ThroughputResult;
  throughput10k: ThroughputResult;
  batch: BatchResult;
}

const candidates: Array<{ name: string; factory: () => InstanceType<any> }> = [
  { name: "@preact/signals", factory: () => new SignalsStore() },
  { name: "jotai (vanilla)", factory: () => new JotaiStore() },
  { name: "custom atom map", factory: () => new CustomStore() },
];

const results: CandidateResult[] = [];

for (const { name, factory } of candidates) {
  console.log(`\nRunning: ${name}...`);

  const r: CandidateResult = {
    name,
    isolation: benchIsolation(factory(), 5000),
    throughput1k: benchThroughput(factory(), 1000),
    throughput5k: benchThroughput(factory(), 5000),
    throughput10k: benchThroughput(factory(), 10000),
    batch: benchBatch(factory(), 100),
  };

  results.push(r);
}

// ─────────────────────────────────────────────────────────────
// Print table
// ─────────────────────────────────────────────────────────────

const W = 20;
const pad = (s: string | number, w = W) => String(s).padEnd(w);
const padL = (s: string | number, w = W) => String(s).padStart(w);

function ms(n: number) { return `${n.toFixed(2)}ms`; }
function kps(n: number) { return `${(n / 1000).toFixed(0)}k/s`; }
function check(b: boolean) { return b ? "✅" : "❌"; }

console.log("\n\n══════════════════════════════════════════════════");
console.log("  Spike 0.1: Reactivity & Store Scalability");
console.log("══════════════════════════════════════════════════\n");

// Isolation
console.log("── TEST 1: ISOLATION (5000 records, update 1 unrelated) ──\n");
console.log(pad("Candidate") + pad("Watched fired") + pad("Unwatched fired") + pad("Pass"));
console.log("─".repeat(80));
for (const r of results) {
  console.log(
    pad(r.name) +
    pad(r.isolation.watchedFired) +
    pad(r.isolation.unwatchedFired) +
    pad(check(r.isolation.pass))
  );
}

// Throughput
console.log("\n── TEST 2: THROUGHPUT ──\n");
console.log(pad("Candidate") + padL("1k total", 12) + padL("1k rate", 12) + padL("5k total", 12) + padL("5k rate", 12) + padL("10k total", 12) + padL("10k rate", 12));
console.log("─".repeat(80));
for (const r of results) {
  console.log(
    pad(r.name) +
    padL(ms(r.throughput1k.totalMs), 12) +
    padL(kps(r.throughput1k.updatesPerSec), 12) +
    padL(ms(r.throughput5k.totalMs), 12) +
    padL(kps(r.throughput5k.updatesPerSec), 12) +
    padL(ms(r.throughput10k.totalMs), 12) +
    padL(kps(r.throughput10k.updatesPerSec), 12)
  );
}

// Batch
console.log("\n── TEST 3: BATCH (100 records, 100 subscribers) ──\n");
console.log(pad("Candidate") + pad("All fire once?") + pad("Max fires") + pad("Total time"));
console.log("─".repeat(80));
for (const r of results) {
  console.log(
    pad(r.name) +
    pad(check(r.batch.allFireOnce)) +
    pad(r.batch.maxFires) +
    pad(ms(r.batch.totalMs))
  );
}

// ─────────────────────────────────────────────────────────────
// Decision logic
// ─────────────────────────────────────────────────────────────

// Score: isolation pass (required), batch fire-once (required), then throughput
const eligible = results.filter(r => r.isolation.pass && r.batch.allFireOnce);
const winner = eligible.sort((a, b) => a.throughput5k.totalMs - b.throughput5k.totalMs)[0];
const decision = winner?.name ?? "NONE PASSED ALL TESTS";

console.log("\n══════════════════════════════════════════════════");
console.log(`  DECISION: ${decision}`);
console.log("══════════════════════════════════════════════════\n");

if (!winner) {
  console.log("⚠️  No candidate passed all required tests (isolation + batch).");
  console.log("   Review results and consider custom implementation.\n");
}

// ─────────────────────────────────────────────────────────────
// Write RESULTS.md
// ─────────────────────────────────────────────────────────────

const now = new Date().toISOString();

function tableRow(r: CandidateResult) {
  return `| ${r.name} | ${check(r.isolation.pass)} | ${ms(r.throughput1k.totalMs)} (${kps(r.throughput1k.updatesPerSec)}) | ${ms(r.throughput5k.totalMs)} (${kps(r.throughput5k.updatesPerSec)}) | ${ms(r.throughput10k.totalMs)} (${kps(r.throughput10k.updatesPerSec)}) | ${check(r.batch.allFireOnce)} (max: ${r.batch.maxFires}x) |`;
}

const md = `# Spike 0.1: Reactivity & Store Scalability — Results

Generated: ${now}

## Decision: \`${decision}\`

## Test Results

### Test 1: Isolation
Update one record → only its subscriber fires.

| Candidate | Pass | Watched fired | Unwatched fired |
|---|---|---|---|
${results.map(r => `| ${r.name} | ${check(r.isolation.pass)} | ${r.isolation.watchedFired} | ${r.isolation.unwatchedFired} |`).join("\n")}

### Test 2: Throughput

| Candidate | Isolation | 1k | 5k | 10k | Batch fire-once |
|---|---|---|---|---|---|
${results.map(tableRow).join("\n")}

### Test 3: Batch (100 records × 100 subscribers)
All subscribers should fire exactly **once** after the batch, not once per put.

| Candidate | All fire once? | Max fires | Total time |
|---|---|---|---|
${results.map(r => `| ${r.name} | ${check(r.batch.allFireOnce)} | ${r.batch.maxFires}x | ${ms(r.batch.totalMs)} |`).join("\n")}

## Rationale

${winner ? `**${winner.name}** wins because:
- ✅ Passes isolation (update A doesn't fire B's listener)
- ✅ Passes batch fire-once (100 updates → 1 notification per subscriber)
- Fastest eligible candidate at 5k throughput: ${ms(winner.throughput5k.totalMs)}` : `No candidate passed all required tests. Manual review needed.`}

${results.find(r => r.name.includes("jotai") && !r.batch.allFireOnce) ? `
### Note: Jotai Batch Failure
Jotai vanilla store has no batch API. Each \`store.set()\` call notifies subscribers synchronously.
For a drag event firing 60 pointer-move events/sec with 10 selected shapes, this means
600 individual subscriber notifications per second instead of 60. Disqualifying for Glideline.
` : ""}

## Impact on Spike 0.4 (API Design)
- Store \`batch(fn)\` is a **required** primitive in the \`GlideStore\` interface.
- Store signals library: **${decision}**
- Fine-grained subscription (per-record, not global): **confirmed required**.
`;

const outPath = join(__dirname, "RESULTS.md");
writeFileSync(outPath, md, "utf8");
console.log(`Results written to: ${outPath}\n`);
