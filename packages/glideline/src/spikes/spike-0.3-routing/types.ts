/**
 * Spike 0.3 — Shared types for all routing candidates.
 *
 * A router takes two anchored endpoints and produces an SVG path string.
 * The `normal` vector tells the router which direction the arrow exits/enters
 * the shape (e.g. right-edge attachment → normal = {dx: 1, dy: 0}).
 */

export interface Point {
  x: number;
  y: number;
}

export interface AnchoredPoint extends Point {
  /** Unit vector: direction the arrow exits (start) or enters (end) the shape. */
  normal: { dx: number; dy: number };
}

export interface BBox {
  minX: number; minY: number;
  maxX: number; maxY: number;
}

export interface RouteResult {
  /** SVG path data string, e.g. "M 10 20 L 100 200" */
  path: string;
  /** Computed waypoints (for debug/inspection) */
  points: Point[];
}

export interface Router {
  name: string;
  /**
   * Compute a route between two anchored points.
   * @param start  Exit point on the source shape
   * @param end    Entry point on the target shape
   * @param obstacles  Other shapes on canvas (for avoidance)
   */
  route(start: AnchoredPoint, end: AnchoredPoint, obstacles?: BBox[]): RouteResult;
}
