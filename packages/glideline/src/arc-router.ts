import type { Vec2, Box2d } from './types';

/**
 * Compute the intersection parameters (t) of a quadratic Bezier curve with an axis-aligned box boundary.
 */
export function intersectBezierWithBox(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  box: Box2d
): number[] {
  const tValues: number[] = [];

  function solveQuadratic(a: number, b: number, c: number): number[] {
    const roots: number[] = [];
    if (Math.abs(a) < 1e-9) {
      if (Math.abs(b) >= 1e-9) {
        roots.push(-c / b);
      }
    } else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const sqrtD = Math.sqrt(disc);
        roots.push((-b - sqrtD) / (2 * a));
        roots.push((-b + sqrtD) / (2 * a));
      }
    }
    return roots.filter(t => t >= 0 && t <= 1);
  }

  function evalY(t: number): number {
    return (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
  }

  function evalX(t: number): number {
    return (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
  }

  // Vertical lines: x = box.x (left) and x = box.x + box.w (right)
  const xCoords = [box.x, box.x + box.w];
  for (const cx of xCoords) {
    const a = p0.x - 2 * p1.x + p2.x;
    const b = 2 * (p1.x - p0.x);
    const c = p0.x - cx;
    const roots = solveQuadratic(a, b, c);
    for (const t of roots) {
      const y = evalY(t);
      if (y >= box.y && y <= box.y + box.h) {
        tValues.push(t);
      }
    }
  }

  // Horizontal lines: y = box.y (top) and y = box.y + box.h (bottom)
  const yCoords = [box.y, box.y + box.h];
  for (const cy of yCoords) {
    const a = p0.y - 2 * p1.y + p2.y;
    const b = 2 * (p1.y - p0.y);
    const c = p0.y - cy;
    const roots = solveQuadratic(a, b, c);
    for (const t of roots) {
      const x = evalX(t);
      if (x >= box.x && x <= box.x + box.w) {
        tValues.push(t);
      }
    }
  }

  return tValues.sort((a, b) => a - b);
}

/**
 * Truncate a quadratic Bezier curve defined by p0, p1, p2 to the interval [u, v].
 * Returns [q0, q1, q2] for the sub-segment.
 */
export function getBezierSegment(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  u: number,
  v: number
): [Vec2, Vec2, Vec2] {
  // Split at u to get the right part [u, 1]
  const r0 = {
    x: (1 - u) * (1 - u) * p0.x + 2 * (1 - u) * u * p1.x + u * u * p2.x,
    y: (1 - u) * (1 - u) * p0.y + 2 * (1 - u) * u * p1.y + u * u * p2.y,
  };
  const r1 = {
    x: (1 - u) * p1.x + u * p2.x,
    y: (1 - u) * p1.y + u * p2.y,
  };
  const r2 = p2;

  // Now split R at w = (v - u) / (1 - u)
  const w = Math.abs(1 - u) < 1e-9 ? 0 : (v - u) / (1 - u);
  const q0 = r0;
  const q1 = {
    x: (1 - w) * r0.x + w * r1.x,
    y: (1 - w) * r0.y + w * r1.y,
  };
  const q2 = {
    x: (1 - w) * (1 - w) * r0.x + 2 * (1 - w) * w * r1.x + w * w * r2.x,
    y: (1 - w) * (1 - w) * r0.y + 2 * (1 - w) * w * r1.y + w * w * r2.y,
  };
  return [q0, q1, q2];
}

/**
 * Compute an SVG path string for an arc-style (curve) arrow, optionally clipped at bounding boxes.
 *
 * @param start - Start point in page coords (usually shape center if bound)
 * @param end   - End point in page coords (usually shape center if bound)
 * @param bend  - Scalar: 0 = straight, ±0.5 = symmetric arc.
 * @param sourceBox - Bounding box of the source shape (if bound)
 * @param destBox   - Bounding box of the destination shape (if bound)
 */
export function computeArcPath(
  start: Vec2,
  end: Vec2,
  bend: number
): string {
  const sx = start.x;
  const sy = start.y;
  const ex = end.x;
  const ey = end.y;

  // Chord length
  const dx = ex - sx;
  const dy = ey - sy;
  const chord = Math.sqrt(dx * dx + dy * dy);

  if (chord < 1e-9) {
    // Degenerate: zero-length chord, no arc possible
    return `M ${sx} ${sy} L ${ex} ${ey}`;
  }

  // Calculate control point P1 (even for bend = 0, we can use the midpoint)
  let cpx: number;
  let cpy: number;
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2;

  if (bend === 0) {
    cpx = mx;
    cpy = my;
  } else {
    // Rotate chord 90° CW: perp = (dy, -dx) / chord
    const perpX = dy / chord;
    const perpY = -dx / chord;
    const offset = chord * bend;
    cpx = mx + perpX * offset;
    cpy = my + perpY * offset;
  }

  const p0 = start;
  const p1 = { x: cpx, y: cpy };
  const p2 = end;

  let tStart = 0;
  let tEnd = 1;

  // Return the full Bezier curve
  if (bend === 0) {
    return `M ${sx} ${sy} L ${ex} ${ey}`;
  }

  return `M ${sx} ${sy} Q ${cpx} ${cpy} ${ex} ${ey}`;
}

/**
 * Parse the control point from an arc path string (for testing).
 * Returns undefined if the path is a straight line (no Q command).
 */
export function parseArcControlPoint(path: string): Vec2 | undefined {
  // Match Q command
  const match = path.match(/Q\s+([\d.\-]+)\s+([\d.\-]+)/);
  if (!match) return undefined;
  return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
}

