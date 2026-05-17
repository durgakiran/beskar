/**
 * Candidate A: Straight line router.
 * Simplest possible: M start L end.
 * No obstacle avoidance. Good baseline.
 * Ignores normals entirely.
 */

import type { AnchoredPoint, BBox, RouteResult, Router } from "../types.js";

export class StraightRouter implements Router {
  name = "straight";

  route(start: AnchoredPoint, end: AnchoredPoint, _obstacles?: BBox[]): RouteResult {
    return {
      path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
      points: [{ x: start.x, y: start.y }, { x: end.x, y: end.y }],
    };
  }
}
