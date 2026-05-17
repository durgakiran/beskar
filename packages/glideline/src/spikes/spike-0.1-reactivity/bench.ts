/**
 * Spike 0.1 — Benchmark Harness
 *
 * Three tests, three candidates. No mocking, no assertions — real timing.
 */

import type { ReactiveStore } from "./types.js";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function makeRecord(i: number) {
  return { id: `shape:${i}`, type: "box", x: i, y: i, w: 100, h: 100 };
}

function seed(store: ReactiveStore, count: number) {
  const records = Array.from({ length: count }, (_, i) => makeRecord(i));
  store.put(records);
}

function hrMs(): number {
  return Number(process.hrtime.bigint()) / 1e6;
}

// ─────────────────────────────────────────────────────────────
// Test 1: Isolation
// "Update record A — listener on record B must NOT fire."
// ─────────────────────────────────────────────────────────────

export interface IsolationResult {
  /** Did the listener on the watched record fire? (expect: true) */
  watchedFired: number;
  /** Did any listener on un-watched records fire? (expect: 0) */
  unwatchedFired: number;
  pass: boolean;
}

export function benchIsolation(store: ReactiveStore, recordCount = 5000): IsolationResult {
  seed(store, recordCount);

  const watchedId = `shape:${Math.floor(recordCount / 2)}`; // middle record
  const unwatchedId = `shape:0`;

  let watchedFired = 0;
  let unwatchedFired = 0;

  store.subscribe(watchedId, () => { watchedFired++; });
  store.subscribe(unwatchedId, () => { unwatchedFired++; });

  // Update a third record — neither watched nor unwatched
  store.put([makeRecord(recordCount - 1)]);
  // Should not fire either listener
  const unwatchedAfterUnrelated = unwatchedFired;
  const watchedAfterUnrelated = watchedFired;

  // Now update the watched record
  store.put([{ ...makeRecord(Number(watchedId.split(":")[1])), x: 9999 }]);

  return {
    watchedFired,
    unwatchedFired,
    pass:
      watchedFired === 1 &&
      unwatchedFired === 0 &&
      watchedAfterUnrelated === 0 &&
      unwatchedAfterUnrelated === 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Test 2: Throughput
// "Update every record once — how long does it take?"
// ─────────────────────────────────────────────────────────────

export interface ThroughputResult {
  recordCount: number;
  totalMs: number;
  msPerUpdate: number;
  updatesPerSec: number;
}

export function benchThroughput(store: ReactiveStore, recordCount: number): ThroughputResult {
  seed(store, recordCount);

  const updates = Array.from({ length: recordCount }, (_, i) => ({
    ...makeRecord(i),
    x: i * 2, // changed value
  }));

  const start = hrMs();
  store.put(updates);
  const totalMs = hrMs() - start;

  return {
    recordCount,
    totalMs,
    msPerUpdate: totalMs / recordCount,
    updatesPerSec: recordCount / (totalMs / 1000),
  };
}

// ─────────────────────────────────────────────────────────────
// Test 3: Batch fire-once
// "100 records updated in one batch — each subscriber fires exactly once."
// ─────────────────────────────────────────────────────────────

export interface BatchResult {
  /** How many times each subscriber fired. Ideal: 1. Bad: N (= batch size). */
  fireCounts: number[];
  /** Max fires across all subscribers. */
  maxFires: number;
  /** All fired exactly once? */
  allFireOnce: boolean;
  totalMs: number;
}

export function benchBatch(store: ReactiveStore, batchSize = 100): BatchResult {
  // Use 10 shapes updated batchSize times each inside one batch.
  // Real drag = same shapes updated on EVERY pointer-move event.
  // Ideal: each subscriber fires once at end of batch.
  // Jotai (no real batch): fires batchSize times per subscriber.
  const shapeCount = 10;
  seed(store, shapeCount);

  const fireCounts: number[] = Array(shapeCount).fill(0);

  for (let i = 0; i < shapeCount; i++) {
    const idx = i;
    store.subscribe(`shape:${i}`, () => {
      fireCounts[idx]++;
    });
  }

  // batchSize "pointer-move ticks", each moving all shapeCount shapes
  const start = hrMs();
  store.batch(() => {
    for (let tick = 0; tick < batchSize; tick++) {
      for (let i = 0; i < shapeCount; i++) {
        store.put([{ ...makeRecord(i), x: tick * 2 }]);
      }
    }
  });
  const totalMs = hrMs() - start;

  const maxFires = Math.max(...fireCounts);

  return {
    fireCounts,
    maxFires,
    allFireOnce: fireCounts.every(c => c === 1),
    totalMs,
  };
}
