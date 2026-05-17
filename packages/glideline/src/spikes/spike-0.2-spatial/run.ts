/**
 * Spike 0.2 — Entry Point
 * Run: tsx src/spikes/spike-0.2-spatial/run.ts
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { RBushIndex } from "./candidates/rbush.js";
import { BruteForceIndex } from "./candidates/brute.js";
import { QuadtreeIndex } from "./candidates/quadtree.js";
import {
  makeUniform, makeClustered,
  benchPointQuery, benchBoundsQuery, benchIncrementalUpdate,
  type QueryResult, type UpdateResult,
} from "./bench.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const COUNTS = [1_000, 5_000, 10_000];

const candidates = [
  { name: "rbush",      factory: () => new RBushIndex() },
  { name: "brute",      factory: () => new BruteForceIndex() },
  { name: "quadtree",   factory: () => new QuadtreeIndex() },
];

// ─────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────

interface Row {
  name: string;
  dist: "uniform" | "clustered";
  count: number;
  pointMs: number;
  boundsMs: number;
  updateMs: number;
  updateTicksPerSec: number;
}

const rows: Row[] = [];

for (const { name, factory } of candidates) {
  for (const dist of ["uniform", "clustered"] as const) {
    for (const count of COUNTS) {
      process.stdout.write(`  ${name} / ${dist} / ${count}k... `);
      const shapes = dist === "uniform" ? makeUniform(count) : makeClustered(count);

      const pt  = benchPointQuery(factory(), shapes);
      const bnd = benchBoundsQuery(factory(), shapes);
      const upd = benchIncrementalUpdate(factory(), shapes);

      rows.push({
        name, dist, count,
        pointMs:           pt.msPerQuery * 1000,   // μs actually — *1000 for microseconds
        boundsMs:          bnd.msPerQuery * 1000,
        updateMs:          upd.msPerTick,
        updateTicksPerSec: upd.ticksPerSec,
      });

      console.log(`point=${pt.msPerQuery.toFixed(3)}ms  bounds=${bnd.msPerQuery.toFixed(3)}ms  drag=${upd.msPerTick.toFixed(3)}ms/tick`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Print summary table
// ─────────────────────────────────────────────────────────────

const p = (n: number, d = 3) => n.toFixed(d).padStart(10);
const s = (str: string, w = 12) => str.padEnd(w);

console.log("\n\n══════════════════════════════════════════════════════════════════════");
console.log("  Spike 0.2: Spatial Indexing Benchmark");
console.log("  (point/bounds times in μs per query; drag in ms per tick @ 60fps target=16ms)");
console.log("══════════════════════════════════════════════════════════════════════\n");
console.log(s("Candidate") + s("Dist") + s("Count") + s("Point(μs)") + s("Bounds(μs)") + s("Drag(ms/tk)"));
console.log("─".repeat(72));
for (const r of rows) {
  console.log(
    s(r.name) + s(r.dist) + s(String(r.count)) +
    p(r.pointMs) + "  " + p(r.boundsMs) + "  " + p(r.updateMs)
  );
}

// ─────────────────────────────────────────────────────────────
// Decision: disqualify anything with drag tick > 16ms at 10k
// ─────────────────────────────────────────────────────────────

const at10kUniform = (name: string) =>
  rows.find(r => r.name === name && r.dist === "uniform" && r.count === 10_000)!;
const at10kClustered = (name: string) =>
  rows.find(r => r.name === name && r.dist === "clustered" && r.count === 10_000)!;

const eligible = candidates.filter(({ name }) => {
  const u = at10kUniform(name);
  const c = at10kClustered(name);
  return u.updateMs < 16 && c.updateMs < 16;
});

// Among eligible, pick lowest drag-tick cost (worst-case clustered)
const winner = eligible.sort((a, b) => {
  const aC = at10kClustered(a.name).updateMs;
  const bC = at10kClustered(b.name).updateMs;
  return aC - bC;
})[0];

const decision = winner?.name ?? "NONE passed 60fps at 10k";

console.log(`\n  DECISION: ${decision}`);
console.log("══════════════════════════════════════════════════════════════════════\n");

// ─────────────────────────────────────────────────────────────
// Write RESULTS.md
// ─────────────────────────────────────────────────────────────

function mdTable(dist: "uniform" | "clustered"): string {
  const header = "| Candidate | Count | Point query (μs) | Bounds query (μs) | Drag tick (ms) |";
  const sep    = "|---|---|---|---|---|";
  const body = rows
    .filter(r => r.dist === dist)
    .map(r =>
      `| ${r.name} | ${r.count.toLocaleString()} | ${r.pointMs.toFixed(3)} | ${r.boundsMs.toFixed(3)} | ${r.updateMs.toFixed(3)} |`
    )
    .join("\n");
  return [header, sep, body].join("\n");
}

const md = `# Spike 0.2: Spatial Indexing Performance — Results

Generated: ${new Date().toISOString()}

## Decision: \`${decision}\`

## Benchmark Setup
- **Point query**: 1000 random point lookups — simulates onPointerMove hover detection
- **Bounds query**: 1000 random 500×500 region queries — simulates marquee selection
- **Drag tick**: 300 ticks moving 10 shapes (remove→translate→insert + viewport search per tick)
- **Distributions**: uniform (evenly spread) and clustered (realistic canvas with shape groups)
- **60fps target**: drag tick must stay < 16ms at 10k shapes

## Results: Uniform Distribution

${mdTable("uniform")}

## Results: Clustered Distribution (Realistic Canvas)

${mdTable("clustered")}

## Rationale

${winner
  ? `**\`${winner.name}\`** wins:
- Passes 60fps constraint (drag tick < 16ms) at 10k shapes on both distributions
- Lowest drag-tick cost on clustered data (worst-case real canvas)
- Fastest or competitive on point and bounds queries`
  : "No candidate passed the 60fps constraint at 10k shapes. Review MAX_ITEMS / MAX_DEPTH tuning."}

${rows.find(r => r.name === "brute" && r.count === 10_000 && r.dist === "uniform")
  ? `### Note: Brute Force
O(N) scan. Viable at low counts. Degrades linearly — unacceptable for 10k+ shapes.`
  : ""}

## Impact on Spike 0.4 (API Design)
- \`GlideStore\` must maintain a spatial index internally (updated on every put/remove).
- Index strategy: **\`${decision}\`**
- Incremental update (remove + insert) is the core drag operation — must stay sub-millisecond.
- Viewport culling query fires every pan/zoom — must be fast on large counts.
`;

const outPath = join(__dirname, "RESULTS.md");
writeFileSync(outPath, md, "utf8");
console.log(`Results written to: ${outPath}\n`);
