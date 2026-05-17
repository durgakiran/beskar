/**
 * Spike 0.2 — Spatial Indexing Benchmark Harness
 *
 * Three tests:
 *  1. Point query        — "which shape is under the cursor?"
 *  2. Bounds query       — "which shapes are inside the marquee selection?"
 *  3. Incremental update — "drag moves N shapes: remove old bbox, insert new bbox"
 *
 * Two data distributions:
 *  - Uniform: shapes evenly spread across world space
 *  - Clustered: shapes concentrated in ~10% of world space (realistic canvas)
 */

import type { BBox, SpatialIndex } from "./types.js";

function hrMs(): number {
  return Number(process.hrtime.bigint()) / 1e6;
}

// ─────────────────────────────────────────────────────────────
// Data generators
// ─────────────────────────────────────────────────────────────

const SHAPE_SIZE = 100; // each shape is 100×100 world units

export function makeUniform(count: number): BBox[] {
  const side = Math.ceil(Math.sqrt(count));
  const gap = 150;
  return Array.from({ length: count }, (_, i) => {
    const col = i % side;
    const row = Math.floor(i / side);
    return {
      id: `shape:${i}`,
      minX: col * gap,
      minY: row * gap,
      maxX: col * gap + SHAPE_SIZE,
      maxY: row * gap + SHAPE_SIZE,
    };
  });
}

export function makeClustered(count: number): BBox[] {
  // 90% of shapes in 3 tight clusters, 10% scattered
  const items: BBox[] = [];
  const clusterCenters = [
    { x: 1000, y: 1000 },
    { x: 5000, y: 2000 },
    { x: 2000, y: 8000 },
  ];
  for (let i = 0; i < count; i++) {
    const scattered = i >= count * 0.9;
    const cx = scattered
      ? Math.random() * 20000
      : clusterCenters[i % 3].x + (Math.random() - 0.5) * 800;
    const cy = scattered
      ? Math.random() * 20000
      : clusterCenters[i % 3].y + (Math.random() - 0.5) * 800;
    items.push({
      id: `shape:${i}`,
      minX: cx,
      minY: cy,
      maxX: cx + SHAPE_SIZE,
      maxY: cy + SHAPE_SIZE,
    });
  }
  return items;
}

// ─────────────────────────────────────────────────────────────
// Test 1: Point Query
// Simulate onPointerMove: "which shape is at cursor position (x, y)?"
// Repeated QUERY_REPS times at random positions.
// ─────────────────────────────────────────────────────────────

const QUERY_REPS = 1000;

export interface QueryResult {
  count: number;
  totalMs: number;
  msPerQuery: number;
  queriesPerSec: number;
  avgHits: number;
}

export function benchPointQuery(index: SpatialIndex, shapes: BBox[]): QueryResult {
  index.load(shapes);

  // Pick query positions distributed across the loaded shape area
  const maxX = Math.max(...shapes.map(s => s.maxX));
  const maxY = Math.max(...shapes.map(s => s.maxY));

  let totalHits = 0;
  const start = hrMs();
  for (let i = 0; i < QUERY_REPS; i++) {
    const x = Math.random() * maxX;
    const y = Math.random() * maxY;
    const hits = index.search({ minX: x, minY: y, maxX: x, maxY: y });
    totalHits += hits.length;
  }
  const totalMs = hrMs() - start;

  return {
    count: shapes.length,
    totalMs,
    msPerQuery: totalMs / QUERY_REPS,
    queriesPerSec: QUERY_REPS / (totalMs / 1000),
    avgHits: totalHits / QUERY_REPS,
  };
}

// ─────────────────────────────────────────────────────────────
// Test 2: Bounds Query
// Simulate marquee selection: search over a 500×500 region.
// ─────────────────────────────────────────────────────────────

const MARQUEE_SIZE = 500;

export function benchBoundsQuery(index: SpatialIndex, shapes: BBox[]): QueryResult {
  index.load(shapes);

  const maxX = Math.max(...shapes.map(s => s.maxX));
  const maxY = Math.max(...shapes.map(s => s.maxY));

  let totalHits = 0;
  const start = hrMs();
  for (let i = 0; i < QUERY_REPS; i++) {
    const x = Math.random() * (maxX - MARQUEE_SIZE);
    const y = Math.random() * (maxY - MARQUEE_SIZE);
    const hits = index.search({
      minX: x, minY: y,
      maxX: x + MARQUEE_SIZE,
      maxY: y + MARQUEE_SIZE,
    });
    totalHits += hits.length;
  }
  const totalMs = hrMs() - start;

  return {
    count: shapes.length,
    totalMs,
    msPerQuery: totalMs / QUERY_REPS,
    queriesPerSec: QUERY_REPS / (totalMs / 1000),
    avgHits: totalHits / QUERY_REPS,
  };
}

// ─────────────────────────────────────────────────────────────
// Test 3: Incremental Update
// Drag scenario: move MOVE_COUNT shapes by delta on every pointer-move tick.
// Each tick = remove old bbox + insert new bbox for each moving shape.
// DRAG_TICKS simulates a multi-second drag at 60fps.
// ─────────────────────────────────────────────────────────────

const MOVE_COUNT = 10;   // shapes being dragged
const DRAG_TICKS = 300;  // ~5 seconds at 60fps
const DELTA = 2;         // pixels per tick

export interface UpdateResult {
  count: number;
  movingShapes: number;
  ticks: number;
  totalMs: number;
  msPerTick: number;
  ticksPerSec: number;
}

export function benchIncrementalUpdate(index: SpatialIndex, shapes: BBox[]): UpdateResult {
  index.load(shapes);

  // The first MOVE_COUNT shapes are the "selected" ones being dragged
  let moving = shapes.slice(0, MOVE_COUNT).map(s => ({ ...s }));

  const start = hrMs();
  for (let tick = 0; tick < DRAG_TICKS; tick++) {
    for (const shape of moving) {
      // Remove old position
      index.remove(shape.id);
      // Apply delta
      shape.minX += DELTA;
      shape.maxX += DELTA;
      shape.minY += DELTA;
      shape.maxY += DELTA;
      // Insert new position
      index.insert(shape);
    }
    // Simulate a viewport query on every tick (what the editor actually does)
    index.search({ minX: 0, minY: 0, maxX: 2000, maxY: 2000 });
  }
  const totalMs = hrMs() - start;

  return {
    count: shapes.length,
    movingShapes: MOVE_COUNT,
    ticks: DRAG_TICKS,
    totalMs,
    msPerTick: totalMs / DRAG_TICKS,
    ticksPerSec: DRAG_TICKS / (totalMs / 1000),
  };
}
