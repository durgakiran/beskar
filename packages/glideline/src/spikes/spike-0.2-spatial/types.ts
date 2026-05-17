/**
 * Spike 0.2 — Shared interface all spatial index candidates must implement.
 */

export interface BBox {
  id: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SpatialIndex {
  /** Bulk-load N items (cold start). */
  load(items: BBox[]): void;

  /** Insert a single item (incremental). */
  insert(item: BBox): void;

  /** Remove a single item by ID. */
  remove(id: string): void;

  /** Find all items whose bounding box intersects the query box. */
  search(query: { minX: number; minY: number; maxX: number; maxY: number }): BBox[];

  /** Total item count. */
  size: number;
}
