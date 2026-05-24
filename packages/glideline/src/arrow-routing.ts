import { computeArcPath } from './arc-router';
import type { GlideEditor } from './editor';
import { computeFallbackLocalElbowPoints, getArrowBindingEdge } from './smart-router';
import type { ArrowRouteStyle, ArrowShape } from './shapes/ArrowUtil';
import type { Vec2 } from './types';

const CURVE_SAMPLE_STEPS = 24;

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
}

export function resolveArrowRoute(
  editor: GlideEditor,
  shape: ArrowShape,
  opts?: { now?: () => number; budgetMs?: number },
): ArrowRouteResult {
  const { start, end, routeStyle, bend } = shape.props;
  const startWorld = { x: shape.x + start.point.x, y: shape.y + start.point.y };
  const endWorld = { x: shape.x + end.point.x, y: shape.y + end.point.y };

  if (routeStyle === 'curve') {
    const localPoints = sampleCurvePoints(start.point, end.point, bend);
    return {
      routeStyle,
      renderKind: 'curve',
      path: computeArcPath(start.point, end.point, bend),
      localPoints,
      worldPoints: localPoints.map(point => ({ x: shape.x + point.x, y: shape.y + point.y })),
    };
  }

  const fromEdge = getArrowBindingEdge(editor, shape.id as any, 'start', 'right');
  const toEdge = getArrowBindingEdge(editor, shape.id as any, 'end', 'left');

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

    const localPoints = smart.points.map(point => ({
      x: point.x - shape.x,
      y: point.y - shape.y,
    }));

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

  if (!start.boundShapeId || !end.boundShapeId) {
    const localPoints = [start.point, end.point];
    return {
      routeStyle,
      renderKind: 'polyline',
      path: pointsToPath(localPoints),
      localPoints,
      worldPoints: localPoints.map(point => ({ x: shape.x + point.x, y: shape.y + point.y })),
    };
  }

  const fromShape = editor.getShape(start.boundShapeId);
  const toShape = editor.getShape(end.boundShapeId);
  if (!fromShape || !toShape) {
    const localPoints = [start.point, end.point];
    return {
      routeStyle,
      renderKind: 'polyline',
      path: pointsToPath(localPoints),
      localPoints,
      worldPoints: localPoints.map(point => ({ x: shape.x + point.x, y: shape.y + point.y })),
    };
  }

  const localPoints = computeFallbackLocalElbowPoints(
    shape,
    editor.getShapeWorldBounds(fromShape.id as any),
    editor.getShapeWorldBounds(toShape.id as any),
    fromEdge,
    toEdge,
  );

  return {
    routeStyle,
    renderKind: 'polyline',
    path: pointsToPath(localPoints),
    localPoints,
    worldPoints: localPoints.map(point => ({ x: shape.x + point.x, y: shape.y + point.y })),
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
      return {
        x: shape.x + (shape.props.start.point.x + shape.props.end.point.x) / 2,
        y: shape.y + (shape.props.start.point.y + shape.props.end.point.y) / 2,
      };
    }

    const mx = (shape.props.start.point.x + shape.props.end.point.x) / 2;
    const my = (shape.props.start.point.y + shape.props.end.point.y) / 2;
    const perpX = dy / chord;
    const perpY = -dx / chord;
    const offset = chord * shape.props.bend;

    return {
      x: shape.x + mx + perpX * offset,
      y: shape.y + my + perpY * offset,
    };
  }

  const resolved = resolveArrowRoute(editor, shape);
  return polylineMidpoint(resolved.worldPoints);
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
