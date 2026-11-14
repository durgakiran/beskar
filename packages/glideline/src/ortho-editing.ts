import type { GlideEditor } from './editor.js';
import { resolveArrowRoute } from './arrow-routing.js';
import type { ArrowShape } from './shapes/ArrowUtil.js';
import type { Box2d, EdgeName, ShapeId, Vec2 } from './types.js';

/** Stored in the connector's parent coordinates, independent of either endpoint. */
export interface OrthoRoutePoint extends Vec2 {
  kind: 'bend' | 'segment' | 'waypoint';
}

const EPSILON = 1e-6;
const MIN_HANDLE_SPACING = 17;
const SEGMENT_SNAP_DISTANCE = 4;
const ANCHOR_CLEARANCE = 12;

type Axis = 'x' | 'y';
type RoutePoint = Vec2 & { control?: number };
type Hit = { segment: number; point: Vec2; distance: number };

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

function segmentAxis(a: Vec2, b: Vec2): Axis | null {
  if (near(a.x, b.x) && !near(a.y, b.y)) return 'y';
  if (near(a.y, b.y) && !near(a.x, b.x)) return 'x';
  return null;
}

function edgeAxis(edge: EdgeName): Axis {
  return edge === 'left' || edge === 'right' ? 'x' : 'y';
}

/** Interior points from an anchor to the nearest manual control. */
function routeOutsideAnchor(anchor: Vec2, control: Vec2, edge: EdgeName, bounds: Box2d): Vec2[] {
  const axis = edgeAxis(edge);
  const cross = axis === 'x' ? 'y' : 'x';
  const outward = edge === 'right' || edge === 'bottom' ? 1 : -1;
  if ((control[axis] - anchor[axis]) * outward > EPSILON) {
    return [{ x: control.x, y: control.y, [cross]: anchor[cross] }];
  }

  const outer = axis === 'x'
    ? outward > 0 ? bounds.maxX : bounds.minX
    : outward > 0 ? bounds.maxY : bounds.minY;
  const lead = { ...anchor, [axis]: outer + outward * ANCHOR_CLEARANCE };
  const min = (cross === 'x' ? bounds.minX : bounds.minY) - ANCHOR_CLEARANCE;
  const max = (cross === 'x' ? bounds.maxX : bounds.maxY) + ANCHOR_CLEARANCE;
  const crossPosition = control[cross];
  if (crossPosition <= min + ANCHOR_CLEARANCE || crossPosition >= max - ANCHOR_CLEARANCE) {
    return [lead, { ...lead, [cross]: crossPosition }];
  }
  const side = crossPosition - min <= max - crossPosition ? min : max;
  // Keep the approach leg outside even if a waypoint lies inside the shape.
  return [lead, { ...lead, [cross]: side }, { x: control.x, y: control.y, [cross]: side }];
}

/** Bypass the rotated terminal's bounds, keeping the approach on its outward side. */
export function avoidRotatedOrthoTerminal<T extends Vec2>(route: T[], edge: EdgeName, bounds: Box2d): (T | Vec2)[] {
  const [anchor, ...rest] = route;
  if (!anchor || !rest.length) return route;
  const axis = edgeAxis(edge);
  const cross = axis === 'x' ? 'y' : 'x';
  const outward = edge === 'right' || edge === 'bottom' ? 1 : -1;
  const low = axis === 'x' ? bounds.minX : bounds.minY;
  const high = axis === 'x' ? bounds.maxX : bounds.maxY;
  const outer = outward > 0 ? high : low;
  const crossLow = cross === 'x' ? bounds.minX : bounds.minY;
  const crossHigh = cross === 'x' ? bounds.maxX : bounds.maxY;
  const lead = { ...anchor, [axis]: outer + outward * ANCHOR_CLEARANCE };
  const crossesBounds = (a: Vec2, b: Vec2) =>
    Math.max(a[axis], b[axis]) > low + EPSILON && Math.min(a[axis], b[axis]) < high - EPSILON &&
    Math.max(a[cross], b[cross]) > crossLow + EPSILON && Math.min(a[cross], b[cross]) < crossHigh - EPSILON;
  // Work back from the far endpoint to find the first leg that enters the bounds.
  let join = rest.length - 1;
  for (let index = rest.length - 1; index > 0; index--) {
    if (crossesBounds(rest[index]!, rest[index - 1]!)) break;
    join = index - 1;
  }
  const first = rest[0]!;
  if (join === 0 && near(first[cross], anchor[cross]) && (first[axis] - outer) * outward >= -EPSILON) {
    return route;
  }
  const point = rest[join]!;
  const suffix = rest.slice(join);
  if ((point[axis] - outer) * outward >= -EPSILON) {
    return [anchor, lead, { ...lead, [cross]: point[cross] }, ...suffix];
  }
  if (point[cross] <= crossLow || point[cross] >= crossHigh) {
    return [anchor, lead, { ...lead, [cross]: point[cross] }, ...suffix];
  }
  const side = point[cross] - crossLow <= crossHigh - point[cross]
    ? crossLow - ANCHOR_CLEARANCE : crossHigh + ANCHOR_CLEARANCE;
  return [anchor, lead, { ...lead, [cross]: side }, { ...point, [cross]: side }, ...suffix];
}

export function resolveManualOrthoPoints(
  start: Vec2, end: Vec2, points: readonly OrthoRoutePoint[], fromEdge: EdgeName, toEdge: EdgeName,
  fromBounds?: Box2d, toBounds?: Box2d,
): RoutePoint[] | null {
  // Skip covered waypoints before generating elbows, so their approach
  // corners never enter the displayed route. Keep the stored controls intact.
  const covers = (bounds: Box2d | undefined, point: Vec2) => bounds &&
    point.x > bounds.minX + EPSILON && point.x < bounds.maxX - EPSILON &&
    point.y > bounds.minY + EPSILON && point.y < bounds.maxY - EPSILON;
  const controls = points.flatMap(({ x, y, kind }, control) =>
    kind === 'waypoint' && (covers(fromBounds, { x, y }) || covers(toBounds, { x, y }))
      ? [] : [{ x, y, control }]);
  if (!controls.length) return null;

  const route: RoutePoint[] = [start];
  const next = [...controls, end];
  next.forEach((point, index) => {
    const previous = route[route.length - 1]!;
    const last = index === controls.length;
    if (last && toBounds) {
      route.push(...routeOutsideAnchor(point, previous, toEdge, toBounds).reverse());
    } else if (index === 0 && fromBounds) {
      route.push(...routeOutsideAnchor(previous, point, fromEdge, fromBounds));
    } else if (!near(previous.x, point.x) && !near(previous.y, point.y)) {
      const following = next[index + 1];
      const axis = last ? (edgeAxis(toEdge) === 'x' ? 'y' : 'x')
        : index === 0 ? edgeAxis(fromEdge)
          : following && segmentAxis(point, following) === 'x' ? 'x' : 'y';
      route.push(axis === 'x' ? { x: point.x, y: previous.y } : { x: previous.x, y: point.y });
    }
    route.push(point);
  });
  return simplifyOrthoRoute(route, point => point.control !== undefined && points[point.control]?.kind === 'waypoint');
}

export function simplifyOrthoRoute<T extends Vec2>(route: T[], keep: (point: T) => boolean = () => false): T[] {
  const points: T[] = [];
  for (const point of route) {
    const previous = points.at(-1);
    if (previous && near(previous.x, point.x) && near(previous.y, point.y) && !keep(previous)) {
      points.pop();
    } else if (previous && near(previous.x, point.x) && near(previous.y, point.y) && !keep(point)) {
      continue;
    }
    while (points.length >= 2) {
      const a = points.at(-2)!, b = points.at(-1)!;
      if (keep(b) || !((near(a.x, b.x) && near(b.x, point.x)) ||
        (near(a.y, b.y) && near(b.y, point.y)))) break;
      points.pop();
    }
    points.push(point);
  }
  return points;
}

function getEditRoute(editor: GlideEditor, arrow: ArrowShape): RoutePoint[] {
  const route = resolveArrowRoute(editor, arrow);
  return simplifyOrthoRoute(route.orthoPoints ?? route.localPoints.map(local => ({
    x: local.x + arrow.x, y: local.y + arrow.y,
  })), point => isWaypoint(arrow, point));
}

function isWaypoint(arrow: ArrowShape, point: RoutePoint): boolean {
  return point.control !== undefined && arrow.props.manualRoute?.[point.control]?.kind === 'waypoint';
}

export interface OrthoHandle {
  id: string;
  point: Vec2;
  moveAxis?: Axis;
}

type RouteHandle = OrthoHandle & { segment?: [Vec2, Vec2] };

function routeHandles(arrow: ArrowShape, route: RoutePoint[]): RouteHandle[] {
  const handles: RouteHandle[] = [];
  for (let index = 0; index < route.length - 1; index++) {
    const a = route[index]!, b = route[index + 1]!;
    const axis = segmentAxis(a, b);
    if (!axis) continue;
    const moveAxis = axis === 'x' ? 'y' : 'x';
    handles.push({
      id: `ortho-segment-${moveAxis}-${index}`,
      point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      moveAxis,
      segment: [a, b],
    });
  }
  const waypoints = (arrow.props.manualRoute ?? []).flatMap((point, index) =>
    point.kind === 'waypoint' ? [{ id: `ortho-waypoint-${index}`, point }] : [],
  );
  return [...waypoints, ...handles];
}

/** Find the closest clear position to the midpoint along the visible segment. */
function placeSegmentHandle(start: Vec2, end: Vec2, occupied: readonly Vec2[], spacing: number): Vec2 | undefined {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const dx = (end.x - start.x) / length;
  const dy = (end.y - start.y) / length;
  const middle = length / 2;
  const candidates = [middle];
  for (const point of occupied) {
    const x = point.x - start.x;
    const y = point.y - start.y;
    const across = x * dy - y * dx;
    if (Math.abs(across) >= spacing) continue;
    const center = x * dx + y * dy;
    const clearance = Math.sqrt(spacing ** 2 - across ** 2) + EPSILON;
    candidates.push(center - clearance, center + clearance);
  }
  // Keep the 14px pill within the segment when shifting it away from the midpoint.
  const inset = spacing * 7 / MIN_HANDLE_SPACING;
  for (const distance of candidates.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))) {
    if (distance < inset || distance > length - inset) continue;
    const point = { x: start.x + dx * distance, y: start.y + dy * distance };
    if (occupied.every(p => Math.hypot(p.x - point.x, p.y - point.y) >= spacing)) return point;
  }
}

export function getOrthoHandles(editor: GlideEditor, arrow: ArrowShape): OrthoHandle[] {
  if (arrow.props.routeStyle !== 'ortho' || editor.isShapeEffectivelyLocked(arrow.id as ShapeId)) return [];
  const route = simplifyOrthoRoute(getEditRoute(editor, arrow));
  const toPage = (point: Vec2) => editor.parentToPage(arrow.parentId, point);
  const occupied = [route[0], route.at(-1)].filter((p): p is RoutePoint => !!p).map(toPage);
  const spacing = MIN_HANDLE_SPACING / editor.camera.signal.peek().z;
  const result: OrthoHandle[] = [];
  for (const { segment, ...handle } of routeHandles(arrow, route)) {
    let point: Vec2 | undefined = toPage(handle.point);
    const midpoint = point;
    if (occupied.some(p => Math.hypot(midpoint.x - p.x, midpoint.y - p.y) < spacing)) {
      if (!segment || !result.some(p => !p.moveAxis && Math.hypot(midpoint.x - p.point.x, midpoint.y - p.point.y) < spacing)) continue;
      point = placeSegmentHandle(toPage(segment[0]), toPage(segment[1]), occupied, spacing);
      if (!point) continue;
    }
    occupied.push(point);
    result.push({ ...handle, point });
  }
  return result;
}

function closestSegment(route: RoutePoint[], point: Vec2): Hit | undefined {
  let nearest: Hit | undefined;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]!, b = route[i + 1]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    const projected = { x: a.x + t * dx, y: a.y + t * dy };
    const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
    if (!nearest || distance < nearest.distance) nearest = { segment: i, point: projected, distance };
  }
  return nearest;
}

function toControls(arrow: ArrowShape, points: RoutePoint[]): OrthoRoutePoint[] {
  return points.map(({ x, y, control }) => ({
    x, y, kind: control === undefined ? 'bend' : arrow.props.manualRoute?.[control]?.kind ?? 'bend',
  }));
}

/** Drop manual bends that disappeared from the route when an endpoint was moved. */
export function pruneOrthoRouteAfterReconnect(editor: GlideEditor, arrow: ArrowShape): OrthoRoutePoint[] | null | undefined {
  const controls = arrow.props.manualRoute;
  if (arrow.props.routeStyle !== 'ortho' || !controls?.length) return undefined;

  const route = getEditRoute(editor, arrow);
  const visible = new Set(route.map(point => point.control));
  const retained = controls.filter((point, index) => point.kind === 'waypoint' || visible.has(index));
  if (retained.length === controls.length) return undefined;

  const matchesRoute = (manualRoute: OrthoRoutePoint[] | null) => {
    const candidate = getEditRoute(editor, { ...arrow, props: { ...arrow.props, manualRoute } });
    return candidate.length === route.length && candidate.every((point, index) =>
      near(point.x, route[index]!.x) && near(point.y, route[index]!.y));
  };
  if (matchesRoute(retained.length ? retained : null)) return retained.length ? retained : null;

  // Removing a control can change which corner a generated elbow uses.
  const explicit = toControls(arrow, route.filter((point, index) =>
    isWaypoint(arrow, point) || (index > 0 && index < route.length - 1)));
  if (explicit.length) return explicit;

  const start = route[0]!;
  const end = route.at(-1)!;
  return [{ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, kind: 'bend' }];
}

export function getOrthoRouteMenu(editor: GlideEditor, arrow: ArrowShape, page: Vec2) {
  if (arrow.props.routeStyle !== 'ortho' || editor.isShapeEffectivelyLocked(arrow.id as ShapeId)) return null;
  const route = getEditRoute(editor, arrow);
  const point = editor.pageToParent(arrow.parentId, page);
  const tolerance = 8 / editor.camera.signal.peek().z;
  const controls = arrow.props.manualRoute ?? [];
  const waypoint = controls.findIndex(p => p.kind === 'waypoint' && Math.hypot(p.x - point.x, p.y - point.y) <= tolerance);
  const hit = closestSegment(route, point);
  if (waypoint < 0 && (!hit || hit.distance > tolerance)) return null;

  let add: OrthoRoutePoint[] | undefined;
  if (waypoint < 0 && hit && route.every((point, index) => index === 0 ||
    near(route[index - 1]!.x, point.x) || near(route[index - 1]!.y, point.y))
    && [route[0]!, route.at(-1)!].every(p => Math.hypot(p.x - hit.point.x, p.y - hit.point.y) > tolerance)) {
    add = toControls(arrow, route.slice(1, -1));
    const existing = add.findIndex(p => near(p.x, hit.point.x) && near(p.y, hit.point.y));
    if (existing >= 0) add[existing] = { ...hit.point, kind: 'waypoint' };
    else add.splice(hit.segment, 0, { ...hit.point, kind: 'waypoint' });
  }
  const remaining = controls.filter((_, i) => i !== waypoint);
  return {
    add,
    remove: waypoint < 0 ? undefined : remaining.some(p => p.kind !== 'bend') ? remaining : null,
    canReset: controls.length > 0,
  };
}

export function getOrthoDrag(editor: GlideEditor, arrow: ArrowShape, id: string) {
  if (arrow.props.routeStyle !== 'ortho' || editor.isShapeEffectivelyLocked(arrow.id as ShapeId)) return null;
  const route = getEditRoute(editor, arrow);
  const segments = simplifyOrthoRoute(route);
  const handle = routeHandles(arrow, segments).find(handle => handle.id === id);
  if (!handle) return null;
  const index = Number(id.slice(id.lastIndexOf('-') + 1));
  const visibleControls = new Set(route.map(point => point.control));
  const hiddenWaypoints = (arrow.props.manualRoute ?? []).flatMap((point, control) =>
    point.kind === 'waypoint' && !visibleControls.has(control) ? [{ point, control }] : []);
  return (delta: Vec2): OrthoRoutePoint[] | null | undefined => {
    const axis = handle.moveAxis;
    if (!axis) {
      if (near(delta.x, 0) && near(delta.y, 0)) return arrow.props.manualRoute;
      return arrow.props.manualRoute?.map((p, i) =>
        i === index ? { ...p, x: p.x + delta.x, y: p.y + delta.y } : p,
      );
    }
    if (near(delta[axis], 0)) return arrow.props.manualRoute;
    const a = segments[index]!, b = segments[index + 1]!;
    const firstIndex = route.indexOf(a), lastIndex = route.indexOf(b);
    const position = a[axis] + delta[axis];
    const snapDistance = SEGMENT_SNAP_DISTANCE / editor.camera.signal.peek().z;
    const candidates = [segments[index - 2], segments[index + 3]].filter((point): point is RoutePoint =>
      point !== undefined && !near(point[axis], a[axis]));
    let snapped = position;
    let distance = snapDistance;
    for (const point of candidates) {
      const gap = Math.abs(point[axis] - position);
      if (gap >= distance) continue;
      snapped = point[axis];
      distance = gap;
    }
    const offset = snapped - a[axis];
    if (near(offset, 0)) return arrow.props.manualRoute;
    const shifted = (p: Vec2): Vec2 => ({ ...p, [axis]: p[axis] + offset });
    type EditedPoint = OrthoRoutePoint & { control?: number };
    const controls: EditedPoint[] = toControls(arrow, route.slice(1, -1)).map((p, i) => {
      const control = route[i + 1]!.control;
      const moved = i + 1 >= firstIndex && i + 1 <= lastIndex
        ? { ...p, ...shifted(p), kind: p.kind === 'waypoint' ? 'waypoint' : 'segment' }
        : p;
      return { ...moved, ...(control !== undefined ? { control } : {}) };
    });

    // Keep a short run in the original direction at each attached or free endpoint.
    const lead = (endpoint: Vec2, toward: Vec2): OrthoRoutePoint => ({
      x: endpoint.x + (toward.x - endpoint.x) * 0.18,
      y: endpoint.y + (toward.y - endpoint.y) * 0.18,
      kind: 'segment',
    });
    if (index === 0) {
      const first = lead(a, b);
      controls.unshift(first, { ...shifted(first), kind: 'segment' });
    }
    if (index === segments.length - 2) {
      const last = lead(b, a);
      controls.push({ ...shifted(last), kind: 'segment' }, last);
    }
    const points: EditedPoint[] = [
      { ...route[0]!, kind: 'bend' }, ...controls, { ...route.at(-1)!, kind: 'bend' },
    ];
    const edited = simplifyOrthoRoute(points, point => point.kind === 'waypoint');
    // Put each hidden waypoint back in its original control order. Within
    // that gap, attach it to the nearest leg of the newly edited route.
    const inserts = new Map<number, OrthoRoutePoint[]>();
    let firstLeg = 0;
    for (const { point, control } of hiddenWaypoints) {
      const next = edited.findIndex(vertex => vertex.control !== undefined && vertex.control > control);
      const end = next < 0 ? edited.length - 1 : next;
      const previous = edited.findLastIndex(vertex => vertex.control !== undefined && vertex.control < control);
      firstLeg = Math.max(firstLeg, previous);
      const hit = closestSegment(edited.slice(firstLeg, end + 1), point);
      firstLeg += hit?.segment ?? 0;
      const waypoints = inserts.get(firstLeg) ?? [];
      waypoints.push(point);
      inserts.set(firstLeg, waypoints);
    }
    const inner = edited.flatMap(({ x, y, kind }, index) => [
      ...(index > 0 && index < edited.length - 1 ? [{ x, y, kind }] : []),
      ...(inserts.get(index) ?? []),
    ]);
    if (inner.length > 0) return inner;
    // Clear the manual route when the merged straight line matches the automatic route.
    const automatic = getEditRoute(editor, { ...arrow, props: { ...arrow.props, manualRoute: null } });
    if (automatic.length <= 2) return null;
    return [{ x: (a.x + b.x) / 2 + (axis === 'x' ? offset : 0),
      y: (a.y + b.y) / 2 + (axis === 'y' ? offset : 0), kind: 'segment' }];
  };
}
