/**
 * Glideline — Elbow Router (Phase 4, Story 4.3)
 *
 * computeElbowPath(fromBounds, toBounds, fromEdge, toEdge) → SVG path string
 *
 * Produces rectilinear (axis-aligned) paths between box edges.
 * Handles 16 edge-pair topologies:
 *   - Opposite edges (right→left, left→right, top→bottom, bottom→top): Z-path (3 segments)
 *   - Same edge (right→right, left→left, etc.): U-bend (5 segments)
 *   - Adjacent edges (right→top, top→right, etc.): L-path (2 turns)
 *
 * Overlap fallback: straight line.
 */

import type { Box2d, EdgeName, Vec2 } from './types';

const GAP = 20; // gap for U-bend routing around same-side edges

/** Exit point on a given edge of a bounding box. */
function edgePoint(bounds: Box2d, edge: EdgeName): Vec2 {
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  switch (edge) {
    case 'right':  return { x: bounds.maxX, y: cy };
    case 'left':   return { x: bounds.minX, y: cy };
    case 'top':    return { x: cx, y: bounds.minY };
    case 'bottom': return { x: cx, y: bounds.maxY };
  }
}

/** Serialize an array of points into an SVG path (M + L segments). */
function pointsToPath(pts: Vec2[]): string {
  if (pts.length === 0) return '';
  const [first, ...rest] = pts;
  if (!first) return '';
  const parts = [`M ${first.x} ${first.y}`];
  for (const p of rest) {
    parts.push(`L ${p.x} ${p.y}`);
  }
  return parts.join(' ');
}

/** Check whether two bounding boxes overlap. */
function boxesOverlap(a: Box2d, b: Box2d): boolean {
  return a.minX < b.maxX && a.maxX > b.minX &&
         a.minY < b.maxY && a.maxY > b.minY;
}

/**
 * Compute an SVG path string for an orthogonal (elbow) arrow.
 *
 * All output segments are strictly horizontal or vertical.
 */
export function computeElbowPath(
  fromBounds: Box2d,
  toBounds: Box2d,
  fromEdge: EdgeName,
  toEdge: EdgeName,
  bend = 0,
): string {
  // Overlap fallback
  if (boxesOverlap(fromBounds, toBounds)) {
    const start = edgePoint(fromBounds, fromEdge);
    const end   = edgePoint(toBounds, toEdge);
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }

  const start = edgePoint(fromBounds, fromEdge);
  const end   = edgePoint(toBounds, toEdge);

  const topology = `${fromEdge}→${toEdge}` as const;

  // ── Opposite edges (Z-path: 3 segments, 4 points) ────────────────────────
  if (topology === 'right→left' || topology === 'left→right') {
    const midX = (start.x + end.x) / 2 + bend;
    return pointsToPath([
      start,
      { x: midX, y: start.y },
      { x: midX, y: end.y },
      end,
    ]);
  }

  if (topology === 'top→bottom' || topology === 'bottom→top') {
    const midY = (start.y + end.y) / 2 + bend;
    return pointsToPath([
      start,
      { x: start.x, y: midY },
      { x: end.x,   y: midY },
      end,
    ]);
  }

  // ── Same edge (U-bend: 5 segments, 6 points) ─────────────────────────────
  if (fromEdge === toEdge) {
    switch (fromEdge) {
      case 'right': {
        const rx = Math.max(fromBounds.maxX, toBounds.maxX) + GAP + bend;
        return pointsToPath([
          start,
          { x: rx,      y: start.y },
          { x: rx,      y: end.y },
          end,
        ]);
      }
      case 'left': {
        const lx = Math.min(fromBounds.minX, toBounds.minX) - GAP - bend;
        return pointsToPath([
          start,
          { x: lx,  y: start.y },
          { x: lx,  y: end.y },
          end,
        ]);
      }
      case 'top': {
        const ty = Math.min(fromBounds.minY, toBounds.minY) - GAP - bend;
        return pointsToPath([
          start,
          { x: start.x, y: ty },
          { x: end.x,   y: ty },
          end,
        ]);
      }
      case 'bottom': {
        const by = Math.max(fromBounds.maxY, toBounds.maxY) + GAP + bend;
        return pointsToPath([
          start,
          { x: start.x, y: by },
          { x: end.x,   y: by },
          end,
        ]);
      }
    }
  }

  // ── Adjacent edges (L-path: 2 turns, 3 segments, 3 points) ───────────────
  // If bend is non-zero, route via Z-path to keep segments axis-aligned:
  const isFromHoriz = fromEdge === 'right' || fromEdge === 'left';
  if (bend !== 0) {
    if (isFromHoriz) {
      const dirX = fromEdge === 'right' ? 1 : -1;
      const cornerX = start.x + bend * dirX;
      return pointsToPath([
        start,
        { x: cornerX, y: start.y },
        { x: cornerX, y: end.y },
        end,
      ]);
    } else {
      const dirY = fromEdge === 'bottom' ? 1 : -1;
      const cornerY = start.y + bend * dirY;
      return pointsToPath([
        start,
        { x: start.x, y: cornerY },
        { x: end.x,   y: cornerY },
        end,
      ]);
    }
  }

  if (isFromHoriz) {
    // From exiting horizontally, turn at (end.x, start.y) to reach vertical target
    const corner: Vec2 = { x: end.x, y: start.y };
    return pointsToPath([start, corner, end]);
  } else {
    // From exiting vertically, turn at (start.x, end.y) to reach horizontal target
    const corner: Vec2 = { x: start.x, y: end.y };
    return pointsToPath([start, corner, end]);
  }
}

/**
 * Parse the points from an elbow path string (for testing).
 * Supports M + L sequences.
 */
export function parseElbowPoints(path: string): Vec2[] {
  const pts: Vec2[] = [];
  // Match M or L followed by two numbers
  const re = /[ML]\s+([\d.\-eE+]+)\s+([\d.\-eE+]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    const x = m[1];
    const y = m[2];
    if (x !== undefined && y !== undefined) {
      pts.push({ x: parseFloat(x), y: parseFloat(y) });
    }
  }
  return pts;
}

/** Count segments (number of L commands) in an elbow path. */
export function countElbowSegments(path: string): number {
  return (path.match(/\bL\b/g) ?? []).length;
}

/** Get the handle point for an orthogonal (elbow) line at the center of its middle segment. */
export function getOrthoHandlePoint(pts: Vec2[]): Vec2 {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0]!;
  const N = pts.length;
  if (N % 2 === 0) {
    const pA = pts[N / 2 - 1]!;
    const pB = pts[N / 2]!;
    return { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
  } else {
    return pts[Math.floor(N / 2)]!;
  }
}
