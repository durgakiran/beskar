import { avoidRotatedOrthoTerminal, resolveManualOrthoPoints, simplifyOrthoRoute } from './ortho-editing.js';
import { computeArcPath } from './arc-router.js';
import { interpolate } from './connection-anchors.js';
import type { GlideEditor } from './editor.js';
import { computeFallbackLocalElbowPoints, routeAroundConnectorTerminals } from './smart-router.js';
import type { ArrowRouteStyle, ArrowShape } from './shapes/ArrowUtil.js';
import { directionToEdge } from './transform.js';
import { makeBox, type Box2d, type EdgeName, type PageId, type ShapeId, type Vec2 } from './types.js';

const CURVE_SAMPLE_STEPS = 24;

function facingEdge(point: Vec2, toward: Vec2, horizontal: boolean): EdgeName {
  return horizontal
    ? toward.x >= point.x ? 'right' : 'left'
    : toward.y >= point.y ? 'bottom' : 'top';
}

function getShapeBoundsInParent(editor: GlideEditor, id: ShapeId, parentId: PageId | ShapeId): Box2d {
  const bounds = editor.getShapeLocalBounds(id);
  const points = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ].map(point => editor.pageToParent(parentId,
    editor.localToPage(id, point)));
  const minX = Math.min(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y));
  const maxX = Math.max(...points.map(point => point.x));
  const maxY = Math.max(...points.map(point => point.y));
  return makeBox(minX, minY, maxX - minX, maxY - minY);
}

export interface ArrowRouteResult {
  routeStyle: ArrowRouteStyle;
  renderKind: 'curve' | 'polyline';
  path: string;
  localPoints: Vec2[];
  worldPoints: Vec2[];
  didFallback?: boolean;
  fallbackReason?: string;
  routeTimeMs?: number;
  offset?: number;
  curveControls?: [Vec2, Vec2];
  /** Parent-space route including the vertices used by the route editor. */
  orthoPoints?: NonNullable<ReturnType<typeof resolveManualOrthoPoints>>;
}

export function resolveArrowRoute(
  editor: GlideEditor,
  shape: ArrowShape,
  opts?: { now?: () => number; budgetMs?: number },
): ArrowRouteResult {
  const { start, end, routeStyle, bend } = shape.props;
  const toPage = (point: Vec2) => editor.localToPage(shape.id as any, point);
  const startWorld = toPage(start.point);
  const endWorld = toPage(end.point);
  const fromShape = start.boundShapeId ? editor.getShape(start.boundShapeId) : undefined;
  const toShape = end.boundShapeId ? editor.getShape(end.boundShapeId) : undefined;
  const startNormal = fromShape && editor.transforms.getConnectionNormal(fromShape.id, startWorld);
  const endNormal = toShape && editor.transforms.getConnectionNormal(toShape.id, endWorld);
  const inParentDirection = (normal: Vec2) => editor.transforms.pageDeltaToParent(shape.parentId, normal);

  if (routeStyle === 'curve') {
    const curveControls = getCurveControls(start.point, end.point, bend,
      startNormal && inParentDirection(startNormal), endNormal && inParentDirection(endNormal));
    const localPoints = curveControls
      ? sampleCubicPoints(start.point, end.point, curveControls)
      : sampleCurvePoints(start.point, end.point, bend);
    return {
      routeStyle,
      renderKind: 'curve',
      path: curveControls
        ? `M ${start.point.x} ${start.point.y} C ${curveControls.map(p => `${p.x} ${p.y}`).join(' ')} ${end.point.x} ${end.point.y}`
        : computeArcPath(start.point, end.point, bend),
      localPoints,
      worldPoints: localPoints.map(toPage),
      ...(curveControls && { curveControls }),
    };
  }

  const routingEdge = (normal: Vec2) => directionToEdge(routeStyle === 'ortho' ? inParentDirection(normal) : normal);
  let fromEdge: EdgeName = startNormal ? routingEdge(startNormal) : 'right';
  let toEdge: EdgeName = endNormal ? routingEdge(endNormal) : 'left';

  if (routeStyle === 'ortho') {
    const horizontal = fromShape ? fromEdge === 'left' || fromEdge === 'right'
      : toShape ? toEdge === 'left' || toEdge === 'right'
        : Math.abs(end.point.x - start.point.x) >= Math.abs(end.point.y - start.point.y);
    const sameAxisPosition = horizontal ? start.point.x === end.point.x : start.point.y === end.point.y;
    if (!fromShape) fromEdge = toShape && sameAxisPosition
      ? toEdge : facingEdge(start.point, end.point, horizontal);
    if (!toShape) toEdge = fromShape && sameAxisPosition
      ? fromEdge : facingEdge(end.point, start.point, horizontal);
  }

  const inParent = (point: Vec2) => ({ x: point.x + shape.x, y: point.y + shape.y });
  const inLocal = (point: Vec2) => ({ x: point.x - shape.x, y: point.y - shape.y });
  const fromBounds = fromShape && routeStyle === 'ortho' && getShapeBoundsInParent(editor, fromShape.id, shape.parentId);
  const toBounds = toShape && routeStyle === 'ortho' && getShapeBoundsInParent(editor, toShape.id, shape.parentId);
  const parentMatrix = routeStyle === 'ortho' ? editor.transforms.getParentWorldTransform(shape.parentId) : undefined;
  const relativeRotation = (id: ShapeId) => {
    const matrix = editor.getWorldTransform(id);
    return Math.atan2(matrix.b, matrix.a) - Math.atan2(parentMatrix!.b, parentMatrix!.a);
  };
  const protectStart = !!fromBounds && Math.abs(Math.sin(relativeRotation(fromShape!.id) / 2)) > 1e-6;
  const protectEnd = !!toBounds && Math.abs(Math.sin(relativeRotation(toShape!.id) / 2)) > 1e-6;
  const protectAnchors = <T extends Vec2>(points: T[], keep?: (point: T | Vec2) => boolean) => {
    let route: (T | Vec2)[] = points;
    if (protectStart) route = avoidRotatedOrthoTerminal(route, fromEdge, fromBounds);
    if (protectEnd) route = avoidRotatedOrthoTerminal([...route].reverse(), toEdge, toBounds).reverse();
    return protectStart || protectEnd ? simplifyOrthoRoute(route, keep) : route;
  };

  if (routeStyle === 'ortho' && shape.props.manualRoute?.length) {
    const manualRoute = shape.props.manualRoute;
    const points = resolveManualOrthoPoints(
      inParent(start.point), inParent(end.point), shape.props.manualRoute, fromEdge, toEdge,
      fromBounds || undefined, toBounds || undefined,
    );
    if (points) {
      const keepWaypoint = (point: (typeof points)[number]) =>
        point.control !== undefined && manualRoute[point.control]?.kind === 'waypoint';
      let orthoPoints = protectAnchors(points, keepWaypoint);
      if (fromBounds && toBounds && !protectStart && !protectEnd) {
        const repaired = routeAroundConnectorTerminals(orthoPoints, fromBounds, toBounds, fromEdge, toEdge, true);
        if (repaired !== orthoPoints) orthoPoints = simplifyOrthoRoute(repaired, keepWaypoint);
      }
      const localPoints = orthoPoints.map(inLocal);
      return { routeStyle, renderKind: 'polyline', path: pointsToPath(localPoints), localPoints,
        worldPoints: localPoints.map(toPage), orthoPoints };
    }
  }

  if (routeStyle === 'smart') {
    const smartArgs: Parameters<GlideEditor['resolveSmartRouteForArrow']>[1] = {
      startWorld,
      endWorld,
      fromEdge,
      toEdge,
      fromShapeId: start.boundShapeId,
      toShapeId: end.boundShapeId,
      ...(opts?.now ? { now: opts.now } : {}),
      ...(opts?.budgetMs !== undefined ? { budgetMs: opts.budgetMs } : {}),
    };
    const smart = editor.resolveSmartRouteForArrow(shape, smartArgs);

    const localPoints = smart.points.map(point => editor.pageToLocal(shape.id as any, point));

    const result: ArrowRouteResult = {
      routeStyle,
      renderKind: 'polyline',
      path: pointsToPath(localPoints),
      localPoints,
      worldPoints: smart.points,
      ...(smart.didFallback ? { didFallback: true } : {}),
      ...(smart.fallbackReason ? { fallbackReason: smart.fallbackReason } : {}),
      ...(smart.elapsedMs !== undefined ? { routeTimeMs: smart.elapsedMs } : {}),
      ...(smart.offset !== undefined ? { offset: smart.offset } : {}),
    };
    return result;
  }

  const aligned = fromEdge === 'left' || fromEdge === 'right'
    ? start.point.y === end.point.y : start.point.x === end.point.x;
  const coincident = start.point.x === end.point.x && start.point.y === end.point.y;
  const startBounds = fromBounds || makeBox(shape.x + start.point.x, shape.y + start.point.y, 0, 0);
  const endBounds = toBounds || makeBox(shape.x + end.point.x, shape.y + end.point.y, 0, 0);
  const points = (!fromShape || !toShape) && (coincident || (aligned && fromEdge !== toEdge))
    ? [start.point, end.point] : computeFallbackLocalElbowPoints(shape, startBounds, endBounds, fromEdge, toEdge);
  let localPoints = protectStart || protectEnd ? protectAnchors(points.map(inParent)).map(inLocal) : points;
  if ((fromBounds || toBounds) && !protectStart && !protectEnd) {
    const parentPoints = localPoints.map(inParent);
    const repaired = routeAroundConnectorTerminals(parentPoints, startBounds, endBounds, fromEdge, toEdge);
    if (repaired !== parentPoints) localPoints = repaired.map(inLocal);
  }
  const worldPoints = localPoints.map(toPage);

  return {
    routeStyle,
    renderKind: 'polyline',
    path: pointsToPath(localPoints),
    localPoints,
    worldPoints,
  };
}

export function getArrowBendHandlePoint(
  editor: GlideEditor,
  shape: ArrowShape,
): Vec2 | null {
  if (shape.props.routeStyle === 'smart') {
    return null;
  }

  if (shape.props.routeStyle === 'curve') {
    const dx = shape.props.end.point.x - shape.props.start.point.x;
    const dy = shape.props.end.point.y - shape.props.start.point.y;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-9) {
      return editor.localToPage(shape.id as any, {
        x: (shape.props.start.point.x + shape.props.end.point.x) / 2,
        y: (shape.props.start.point.y + shape.props.end.point.y) / 2,
      });
    }

    const mx = (shape.props.start.point.x + shape.props.end.point.x) / 2;
    const my = (shape.props.start.point.y + shape.props.end.point.y) / 2;
    const perpX = dy / chord;
    const perpY = -dx / chord;
    const offset = chord * shape.props.bend;

    return editor.localToPage(shape.id as any, {
      x: mx + perpX * offset,
      y: my + perpY * offset,
    });
  }

  const resolved = resolveArrowRoute(editor, shape);
  return polylineMidpoint(resolved.worldPoints);
}

function getCurveControls(
  start: Vec2, end: Vec2, bend: number, startNormal?: Vec2, endNormal?: Vec2,
): [Vec2, Vec2] | undefined {
  if (!startNormal && !endNormal) return;
  const dx = end.x - start.x, dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return;
  const quadraticControl = {
    x: (start.x + end.x) / 2 + dy * bend,
    y: (start.y + end.y) / 2 - dx * bend,
  };
  // Start from the equivalent cubic so each terminal can be adjusted independently.
  const first = interpolate(start, quadraticControl, 2 / 3);
  const second = interpolate(end, quadraticControl, 2 / 3);
  const adjust = (anchor: Vec2, control: Vec2, normal?: Vec2) => {
    if (!normal) return control;
    const x = control.x - anchor.x, y = control.y - anchor.y;
    const outward = x * normal.x + y * normal.y;
    const sideways = Math.abs(x * normal.y - y * normal.x);
    const correction = Math.max(chord * 0.12, sideways) - outward;
    return correction > 0
      ? { x: control.x + correction * normal.x, y: control.y + correction * normal.y }
      : control;
  };
  const startControl = adjust(start, first, startNormal);
  const endControl = adjust(end, second, endNormal);
  if (startControl !== first || endControl !== second) return [startControl, endControl];
}

function sampleCubicPoints(start: Vec2, end: Vec2, [first, second]: [Vec2, Vec2]): Vec2[] {
  return Array.from({ length: CURVE_SAMPLE_STEPS + 1 }, (_, i) => {
    const t = i / CURVE_SAMPLE_STEPS;
    const mt = 1 - t;
    return {
      x: mt ** 3 * start.x + 3 * mt * mt * t * first.x + 3 * mt * t * t * second.x + t ** 3 * end.x,
      y: mt ** 3 * start.y + 3 * mt * mt * t * first.y + 3 * mt * t * t * second.y + t ** 3 * end.y,
    };
  });
}

export function sampleCurvePoints(start: Vec2, end: Vec2, bend: number, steps = CURVE_SAMPLE_STEPS): Vec2[] {
  if (Math.abs(bend) < 1e-9) return [start, end];

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return [start, end];

  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const perpX = dy / chord;
  const perpY = -dx / chord;
  const offset = chord * bend;
  const control = {
    x: mx + perpX * offset,
    y: my + perpY * offset,
  };

  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    points.push({
      x: mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
      y: mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
    });
  }
  return points;
}

export function pointsToPath(points: Vec2[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return [`M ${first!.x} ${first!.y}`, ...rest.map(point => `L ${point.x} ${point.y}`)].join(' ');
}

function polylineMidpoint(points: Vec2[]): Vec2 | null {
  if (points.length < 2) return points[0] ?? null;

  let totalLength = 0;
  const segmentLengths: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const length = Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
    segmentLengths.push(length);
    totalLength += length;
  }

  if (totalLength < 1e-9) {
    return points[0] ?? null;
  }

  let traversed = 0;
  const halfway = totalLength / 2;
  for (let i = 0; i < points.length - 1; i++) {
    const segmentLength = segmentLengths[i]!;
    if (traversed + segmentLength >= halfway) {
      const start = points[i]!;
      const end = points[i + 1]!;
      const t = (halfway - traversed) / segmentLength;
      return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      };
    }
    traversed += segmentLength;
  }

  return points[points.length - 1] ?? null;
}
