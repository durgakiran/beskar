/**
 * Candidate B: Brute-force linear scan
 * O(N) for every query. Baseline/control.
 * Expected to be fast at low N, degrade badly at high N.
 */

import type { BBox, SpatialIndex } from "../types.js";

export class BruteForceIndex implements SpatialIndex {
  private items = new Map<string, BBox>();

  get size() { return this.items.size; }

  load(items: BBox[]): void {
    for (const item of items) this.items.set(item.id, item);
  }

  insert(item: BBox): void {
    this.items.set(item.id, item);
  }

  remove(id: string): void {
    this.items.delete(id);
  }

  search(query: { minX: number; minY: number; maxX: number; maxY: number }): BBox[] {
    const result: BBox[] = [];
    for (const item of this.items.values()) {
      if (
        item.maxX >= query.minX &&
        item.minX <= query.maxX &&
        item.maxY >= query.minY &&
        item.minY <= query.maxY
      ) {
        result.push(item);
      }
    }
    return result;
  }
}
