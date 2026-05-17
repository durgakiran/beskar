/**
 * Candidate B: Cubic Bezier router.
 *
 * Uses the attachment normals to compute smooth cubic bezier control points.
 * Control point offset = dist(start, end) * tension — scales with distance
 * so short arrows don't overshoot and long ones curve naturally.
 *
 * No obstacle avoidance but looks professional for general diagrams.
 * Used by: Figma connectors (approximate), many diagramming tools.
 */

import type { AnchoredPoint, BBox, RouteResult, Router } from "../types.js";

const TENSION = 0.4; // control point offset as fraction of straight-line distance

export class BezierRouter implements Router {
  name = "bezier";

  route(start: AnchoredPoint, end: AnchoredPoint, _obstacles?: BBox[]): RouteResult {
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    const offset = dist * TENSION;

    // Control point 1: exit start along its normal
    const cp1 = {
      x: start.x + start.normal.dx * offset,
      y: start.y + start.normal.dy * offset,
    };

    // Control point 2: approach end AGAINST its normal (enter from outside)
    const cp2 = {
      x: end.x - end.normal.dx * offset,
      y: end.y - end.normal.dy * offset,
    };

    return {
      path: `M ${r(start.x)} ${r(start.y)} C ${r(cp1.x)} ${r(cp1.y)} ${r(cp2.x)} ${r(cp2.y)} ${r(end.x)} ${r(end.y)}`,
      points: [
        { x: start.x, y: start.y },
        cp1,
        cp2,
        { x: end.x, y: end.y },
      ],
    };
  }
}

function r(n: number) { return Math.round(n * 100) / 100; }
