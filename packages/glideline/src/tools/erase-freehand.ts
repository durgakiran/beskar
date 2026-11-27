import type { FreehandPoint } from '../shapes/FreehandUtil.js';
import type { Vec2 } from '../types.js';

type Interval = [start: number, end: number];
export type EraserSweep = { from: Vec2; to: Vec2; radius: number };

const EPSILON = 1e-8;
const whole: Interval = [0, 1];

function intersect(a: Interval | null, b: Interval | null): Interval | null {
  if (!a || !b) return null;
  const start = Math.max(a[0], b[0]);
  const end = Math.min(a[1], b[1]);
  return end > start ? [start, end] : null;
}

function axisInterval(start: number, end: number, min: number, max: number): Interval | null {
  const delta = end - start;
  if (Math.abs(delta) < EPSILON) return start >= min && start <= max ? whole : null;
  const a = (min - start) / delta;
  const b = (max - start) / delta;
  return intersect(whole, [Math.min(a, b), Math.max(a, b)]);
}

export function boxInterval(from: Vec2, to: Vec2, minX: number, minY: number, maxX: number, maxY: number): Interval | null {
  return intersect(axisInterval(from.x, to.x, minX, maxX), axisInterval(from.y, to.y, minY, maxY));
}

function circleInterval(from: Vec2, to: Vec2, center: Vec2, radius: number): Interval | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const x = from.x - center.x;
  const y = from.y - center.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < EPSILON) return x * x + y * y <= radius * radius ? whole : null;
  const closest = -(x * dx + y * dy) / lengthSquared;
  const cross = x * dy - y * dx;
  const remaining = radius * radius - cross * cross / lengthSquared;
  if (remaining <= 0) return null;
  const half = Math.sqrt(remaining / lengthSquared);
  return intersect(whole, [closest - half, closest + half]);
}

export function interpolate(from: Vec2, to: Vec2, t: number): Vec2 {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

function sample(from: FreehandPoint, to: FreehandPoint, t: number): FreehandPoint {
  if (t === 0) return from;
  if (t === 1) return to;
  return {
    ...interpolate(from, to, t),
    pressure: from.pressure + (to.pressure - from.pressure) * t,
    ...(from.tilt !== undefined || to.tilt !== undefined
      ? { tilt: (from.tilt ?? 0) + ((to.tilt ?? 0) - (from.tilt ?? 0)) * t }
      : {}),
    ...(from.tiltDirection || to.tiltDirection
      ? { tiltDirection: interpolate(from.tiltDirection ?? { x: 0, y: 0 }, to.tiltDirection ?? { x: 0, y: 0 }, t) }
      : {}),
  };
}

// Intersect a stroke segment with the capsule swept by a round eraser.
// In the eraser's coordinate system the capsule is a rectangle and two disks.
function erasedIntervals(from: Vec2, to: Vec2, sweep: EraserSweep): Interval[] {
  const { from: start, to: end, radius } = sweep;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const first = circleInterval(from, to, start, radius);
  if (length < EPSILON) return first ? [first] : [];
  const project = (point: Vec2) => {
    const x = point.x - start.x;
    const y = point.y - start.y;
    return { x: (x * dx + y * dy) / length, y: (y * dx - x * dy) / length };
  };
  const middle = boxInterval(project(from), project(to), 0, -radius, length, radius);
  const last = circleInterval(from, to, end, radius);
  return [first, middle, last].filter((interval): interval is Interval => interval !== null);
}

export function splitFreehandStroke(
  points: readonly FreehandPoint[],
  sweep: EraserSweep,
  closed: boolean,
): FreehandPoint[][] | null {
  if (points.length === 0) return null;
  if (points.length === 1) {
    return erasedIntervals(points[0]!, points[0]!, sweep).length > 0 ? [] : null;
  }
  const minX = Math.min(sweep.from.x, sweep.to.x) - sweep.radius;
  const minY = Math.min(sweep.from.y, sweep.to.y) - sweep.radius;
  const maxX = Math.max(sweep.from.x, sweep.to.x) + sweep.radius;
  const maxY = Math.max(sweep.from.y, sweep.to.y) + sweep.radius;
  const path = closed ? [...points, points[0]!] : points;
  const fragments: FreehandPoint[][] = [];
  let fragment = [path[0]!];
  let touched = false;
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1]!;
    const to = path[i]!;
    const mayBeTouched = Math.min(from.x, to.x) <= maxX && Math.max(from.x, to.x) >= minX
      && Math.min(from.y, to.y) <= maxY && Math.max(from.y, to.y) >= minY;
    const cuts = mayBeTouched ? erasedIntervals(from, to, sweep).sort((a, b) => a[0] - b[0]) : [];
    let cursor = 0;
    for (const [start, end] of cuts) {
      if (end <= cursor) continue;
      touched = true;
      if (start > cursor) {
        if (fragment.length === 0) fragment.push(sample(from, to, cursor));
        fragment.push(sample(from, to, start));
      }
      if (fragment.length > 1) fragments.push(fragment);
      fragment = [];
      cursor = end;
    }
    if (cursor < 1) {
      if (fragment.length === 0) fragment.push(sample(from, to, cursor));
      fragment.push(to);
    }
  }
  if (fragment.length > 1) fragments.push(fragment);
  if (!touched) return null;
  const last = fragments[fragments.length - 1];
  if (closed && fragments.length > 1 && fragments[0]![0] === points[0]
    && last?.[last.length - 1] === points[0]) {
    const tail = fragments.pop()!;
    fragments[0] = [...tail, ...fragments[0]!.slice(1)];
  }
  return fragments;
}
