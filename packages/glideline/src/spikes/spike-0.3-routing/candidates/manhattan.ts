/**
 * Candidate C: Manhattan / Orthogonal router.
 *
 * All segments are axis-aligned (horizontal or vertical only).
 * Looks like Lucidchart, draw.io, Miro connectors.
 *
 * Strategy:
 *   1. Exit start along its normal for a "stub" distance.
 *   2. Exit end against its normal for a "stub" distance.
 *   3. Connect the two stubs with a rectilinear path.
 *
 * Cases handled:
 *   A. Shapes on opposite sides (easy: 3-segment L-shape)
 *   B. Shapes on same axis (needs U-bend: 5-segment path)
 *   C. Self-loop (special case: fixed loop above the shape)
 *   D. Overlapping anchors (degenerate: fallback to straight line)
 */

import type { AnchoredPoint, BBox, Point, RouteResult, Router } from "../types.js";

const STUB = 20; // minimum exit/entry stub length in world units

function r(n: number) { return Math.round(n * 10) / 10; }

function toPath(pts: Point[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${r(p.x)} ${r(p.y)}`).join(" ");
}

/** True if two numbers are within epsilon */
function near(a: number, b: number, eps = 1) { return Math.abs(a - b) < eps; }

export class ManhattanRouter implements Router {
  name = "manhattan";

  route(start: AnchoredPoint, end: AnchoredPoint, _obstacles?: BBox[]): RouteResult {
    // Self-loop: start === end shape (same anchor point)
    if (near(start.x, end.x) && near(start.y, end.y)) {
      return this.selfLoop(start);
    }

    // Stub endpoints: move away from shape surfaces
    const s = { x: start.x + start.normal.dx * STUB, y: start.y + start.normal.dy * STUB };
    const e = { x: end.x - end.normal.dx * STUB,   y: end.y - end.normal.dy * STUB };

    // Classify routing based on dominant normal axes
    const startHoriz = Math.abs(start.normal.dx) > Math.abs(start.normal.dy);
    const endHoriz   = Math.abs(end.normal.dx)   > Math.abs(end.normal.dy);

    let mid: Point[];

    if (startHoriz && endHoriz) {
      // Both exit horizontally → connect via vertical midpoint
      mid = this.horizToHoriz(s, e, start.normal.dx, end.normal.dx);
    } else if (!startHoriz && !endHoriz) {
      // Both exit vertically → connect via horizontal midpoint
      mid = this.vertToVert(s, e, start.normal.dy, end.normal.dy);
    } else if (startHoriz && !endHoriz) {
      // Start exits horizontal, end exits vertical → simple L
      mid = [{ x: e.x, y: s.y }];
    } else {
      // Start exits vertical, end exits horizontal → simple L
      mid = [{ x: s.x, y: e.y }];
    }

    const pts: Point[] = [
      { x: start.x, y: start.y },
      s,
      ...mid,
      e,
      { x: end.x, y: end.y },
    ];

    return { path: toPath(pts), points: pts };
  }

  /**
   * Both normals horizontal (→ or ←).
   * facing = start→ end← (opposite) → simple Z through midX
   * same dir = both→ or both← → U-bend around shapes
   */
  private horizToHoriz(s: Point, e: Point, sDx: number, eDx: number): Point[] {
    // Normals face each other when their horizontal components have opposite signs
    const facing = sDx * eDx < 0;

    if (facing) {
      const midX = (s.x + e.x) / 2;
      return [{ x: midX, y: s.y }, { x: midX, y: e.y }];
    } else {
      // Same direction → U-bend above/below
      const loopY = Math.min(s.y, e.y) - STUB * 2;
      return [
        { x: s.x, y: loopY },
        { x: e.x, y: loopY },
      ];
    }
  }

  /**
   * Both normals vertical (↑ or ↓).
   * facing = start↓ end↑ → simple Z through midY
   * same dir = both↓ or both↑ → U-bend left/right
   */
  private vertToVert(s: Point, e: Point, sDy: number, eDy: number): Point[] {
    const facing = sDy * eDy < 0;

    if (facing) {
      const midY = (s.y + e.y) / 2;
      return [{ x: s.x, y: midY }, { x: e.x, y: midY }];
    } else {
      const loopX = Math.min(s.x, e.x) - STUB * 2;
      return [
        { x: loopX, y: s.y },
        { x: loopX, y: e.y },
      ];
    }
  }

  /** Self-loop: a rectangular loop above the shape anchor. */
  private selfLoop(anchor: AnchoredPoint): RouteResult {
    const offset = 50;
    const pts: Point[] = [
      { x: anchor.x,          y: anchor.y },
      { x: anchor.x,          y: anchor.y - offset },
      { x: anchor.x + offset, y: anchor.y - offset },
      { x: anchor.x + offset, y: anchor.y },
      { x: anchor.x,          y: anchor.y },
    ];
    return { path: toPath(pts), points: pts };
  }
}
