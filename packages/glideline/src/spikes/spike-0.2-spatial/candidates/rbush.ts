/**
 * Candidate A: RBush (R-Tree)
 * npm package: rbush (already installed)
 * Used by tldraw v2. O(log N) query, incremental insert/remove.
 */

import RBush from "rbush";
import type { BBox, SpatialIndex } from "../types.js";

export class RBushIndex implements SpatialIndex {
  private tree = new RBush<BBox>();
  private map = new Map<string, BBox>(); // id → bbox for O(1) remove

  get size() { return this.map.size; }

  load(items: BBox[]): void {
    for (const item of items) this.map.set(item.id, item);
    this.tree.load(items);
  }

  insert(item: BBox): void {
    this.map.set(item.id, item);
    this.tree.insert(item);
  }

  remove(id: string): void {
    const item = this.map.get(id);
    if (!item) return;
    this.tree.remove(item, (a, b) => a.id === b.id);
    this.map.delete(id);
  }

  search(query: { minX: number; minY: number; maxX: number; maxY: number }): BBox[] {
    return this.tree.search(query);
  }
}
