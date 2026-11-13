import type { Vec2 } from './types.js';

export type ConnectionAnchorMode = 'geometry';

/** Coordinates in the shape's bounds, or in its reference geometry when a local point is supplied. */
export interface ShapeConnectionAnchor {
  readonly normalizedAnchor: Vec2;
  /** Resolve this same reference coordinate against the current shape geometry on resize. */
  readonly localPoint?: Vec2;
}

export interface PageConnectionAnchor {
  readonly normalizedAnchor: Vec2;
  readonly point: Vec2;
  readonly anchorMode?: ConnectionAnchorMode;
}

export const QUARTERS = [0.25, 0.5, 0.75] as const;
export const MIDPOINT = [0.5] as const;

export function interpolate(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function segmentPoints(a: Vec2, b: Vec2, fractions: readonly number[]): Vec2[] {
  return fractions.map(t => interpolate(a, b, t));
}

export function polygonPoints(vertices: readonly Vec2[], fractions: readonly number[]): Vec2[] {
  return [
    ...vertices,
    ...vertices.flatMap((a, i) => segmentPoints(a, vertices[(i + 1) % vertices.length]!, fractions)),
  ];
}

export function boundsAnchors(fractions: readonly number[], corners = true): ShapeConnectionAnchor[] {
  const vertices = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  // Prefer the four side midpoints in distance ties, as before.
  const midpoints = vertices.map((a, i) => interpolate(a, vertices[(i + 1) % 4]!, 0.5));
  const points = polygonPoints(vertices, fractions.filter(t => t !== 0.5));
  return [...(fractions.includes(0.5) ? midpoints : []), ...(corners ? points : points.slice(4))]
    .map(normalizedAnchor => ({ normalizedAnchor }));
}

/**
 * Use coordinates on a reference square to identify a feature, then evaluate
 * the same feature on the live outline. Order here only pairs the two
 * evaluations; indices are never stored in bindings.
 */
export function geometryAnchors(w: number, h: number, points: (w: number, h: number) => Vec2[]): ShapeConnectionAnchor[] {
  const referenceSize = 100;
  const local = points(w, h);
  return points(referenceSize, referenceSize).map((p, i) => ({
    normalizedAnchor: { x: p.x / referenceSize, y: p.y / referenceSize },
    localPoint: local[i]!,
  }));
}

/** Sample a curve at fractions of its outline length and return points on the curve. */
export function curvePoints(at: (t: number) => Vec2, fractions: readonly number[]): Vec2[] {
  const samples = 64;
  const lengths = [0];
  let previous = at(0);
  for (let i = 1; i <= samples; i++) {
    const point = at(i / samples);
    lengths.push(lengths[i - 1]! + Math.hypot(point.x - previous.x, point.y - previous.y));
    previous = point;
  }
  const total = lengths[samples]!;
  if (total === 0) return fractions.map(() => previous);
  return fractions.map(f => {
    const target = total * f;
    const i = lengths.findIndex(length => length >= target);
    const t = (target - lengths[i - 1]!) / (lengths[i]! - lengths[i - 1]!);
    return at((i - 1 + t) / samples);
  });
}

export function closestConnectionAnchor(anchors: readonly PageConnectionAnchor[], point: Vec2): PageConnectionAnchor | undefined {
  let closest: PageConnectionAnchor | undefined;
  let distance = Infinity;
  for (const anchor of anchors) {
    const squared = (anchor.point.x - point.x) ** 2 + (anchor.point.y - point.y) ** 2;
    if (squared < distance) {
      closest = anchor;
      distance = squared;
    }
  }
  return closest;
}
