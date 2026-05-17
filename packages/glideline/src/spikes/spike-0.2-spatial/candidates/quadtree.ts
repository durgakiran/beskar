/**
 * Candidate C: Simple Quadtree (hand-rolled, no deps)
 *
 * Recursively subdivides space into 4 quadrants.
 * O(log N) average query. Degrades toward O(N) when shapes cluster.
 * Included to compare against RBush on real canvas-like data (clustered + sparse).
 */

import type { BBox, SpatialIndex } from "../types.js";

const MAX_ITEMS = 8;  // split threshold
const MAX_DEPTH = 12; // max subdivision depth

interface QNode {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  items: BBox[];
  children: QNode[] | null;
  depth: number;
}

function makeNode(minX: number, minY: number, maxX: number, maxY: number, depth: number): QNode {
  return { bounds: { minX, minY, maxX, maxY }, items: [], children: null, depth };
}

function intersects(a: QNode['bounds'], b: QNode['bounds']): boolean {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

function subdivide(node: QNode): void {
  const { minX, minY, maxX, maxY } = node.bounds;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const d = node.depth + 1;
  node.children = [
    makeNode(minX, minY, midX, midY, d), // NW
    makeNode(midX, minY, maxX, midY, d), // NE
    makeNode(minX, midY, midX, maxY, d), // SW
    makeNode(midX, midY, maxX, maxY, d), // SE
  ];
  for (const item of node.items) insertNode(node.children, item);
  node.items = [];
}

function insertNode(children: QNode[], item: BBox): void {
  for (const child of children) {
    if (intersects(child.bounds, item)) {
      nodeInsert(child, item);
    }
  }
}

function nodeInsert(node: QNode, item: BBox): void {
  if (node.children) {
    insertNode(node.children, item);
    return;
  }
  node.items.push(item);
  if (node.items.length > MAX_ITEMS && node.depth < MAX_DEPTH) {
    subdivide(node);
  }
}

function nodeSearch(
  node: QNode,
  query: { minX: number; minY: number; maxX: number; maxY: number },
  result: BBox[]
): void {
  if (!intersects(node.bounds, query)) return;
  if (node.children) {
    for (const child of node.children) nodeSearch(child, query, result);
  } else {
    for (const item of node.items) {
      if (intersects(item, query)) result.push(item);
    }
  }
}

function nodeRemove(node: QNode, id: string): boolean {
  if (node.children) {
    for (const child of node.children) nodeRemove(child, id);
    return false;
  }
  const idx = node.items.findIndex(i => i.id === id);
  if (idx !== -1) { node.items.splice(idx, 1); return true; }
  return false;
}

// World bounds — large enough for any realistic canvas
const WORLD = 1_000_000;

export class QuadtreeIndex implements SpatialIndex {
  private root = makeNode(-WORLD, -WORLD, WORLD, WORLD, 0);
  private map = new Map<string, BBox>();

  get size() { return this.map.size; }

  load(items: BBox[]): void {
    // Quadtree has no bulk-load — insert one by one
    for (const item of items) this.insert(item);
  }

  insert(item: BBox): void {
    this.map.set(item.id, item);
    nodeInsert(this.root, item);
  }

  remove(id: string): void {
    if (!this.map.has(id)) return;
    this.map.delete(id);
    nodeRemove(this.root, id);
  }

  search(query: { minX: number; minY: number; maxX: number; maxY: number }): BBox[] {
    const result: BBox[] = [];
    nodeSearch(this.root, query, result);
    // Deduplicate: items near quadrant boundaries can appear in multiple nodes
    const seen = new Set<string>();
    return result.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  }
}
