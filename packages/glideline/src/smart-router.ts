import { makeBox, type Box2d, type EdgeName, type GlideShape, type ShapeId, type Vec2 } from './types';
import type { GlideEditor } from './editor';
import type { ArrowShape } from './shapes/ArrowUtil';
import { computeElbowPath, parseElbowPoints } from './elbow-router';

const OBSTACLE_PADDING = 12;
const DEFAULT_ROUTE_BUDGET_MS = 12;
const PARALLEL_ROUTE_SEPARATION = 6;
const SEARCH_EXPANSIONS = [64, 192, 384, 768, Number.POSITIVE_INFINITY] as const;
const MAX_GRID_NODES = 25_000;
const EPSILON = 1e-6;

export interface SmartRoutingSnapshot {
  dirty: boolean;
  layoutRevision: number;
  lastBuiltRevision: number;
  buildCount: number;
  obstacleCount: number;
}

export interface SmartRouteResolution {
  points: Vec2[];
  basePoints: Vec2[];
  baseSignature: string;
  didFallback: boolean;
  elapsedMs: number;
  offset: number;
  fallbackReason?: string;
}

interface SmartObstacle {
  id: ShapeId;
  bounds: Box2d;
  expanded: Box2d;
}

interface CachedRoute {
  layoutRevision: number;
  routeKey: string;
  basePoints: Vec2[];
  baseSignature: string;
}

interface BaseSmartRouteInput {
  arrow: ArrowShape;
  startWorld: Vec2;
  endWorld: Vec2;
  fromEdge: EdgeName;
  toEdge: EdgeName;
  fromShapeId: ShapeId | null;
  toShapeId: ShapeId | null;
  deadline: number;
  now: () => number;
}

interface BaseSmartRouteResult {
  points: Vec2[];
  baseSignature: string;
}

interface HeapEntry {
  priority: number;
  state: number;
}

class MinHeap {
  private _items: HeapEntry[] = [];

  get size(): number {
    return this._items.length;
  }

  push(item: HeapEntry): void {
    this._items.push(item);
    this._bubbleUp(this._items.length - 1);
  }

  pop(): HeapEntry | undefined {
    if (this._items.length === 0) return undefined;
    const root = this._items[0]!;
    const tail = this._items.pop()!;
    if (this._items.length > 0) {
      this._items[0] = tail;
      this._bubbleDown(0);
    }
    return root;
  }

  private _bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this._items[parent]!.priority <= this._items[index]!.priority) break;
      [this._items[parent], this._items[index]] = [this._items[index]!, this._items[parent]!];
      index = parent;
    }
  }

  private _bubbleDown(index: number): void {
    const length = this._items.length;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (left < length && this._items[left]!.priority < this._items[smallest]!.priority) {
        smallest = left;
      }
      if (right < length && this._items[right]!.priority < this._items[smallest]!.priority) {
        smallest = right;
      }
      if (smallest === index) break;

      [this._items[smallest], this._items[index]] = [this._items[index]!, this._items[smallest]!];
      index = smallest;
    }
  }
}

export class SmartRouterCache {
  private _dirty = true;
  private _layoutRevision = 0;
  private _lastBuiltRevision = -1;
  private _buildCount = 0;
  private _obstacles: SmartObstacle[] = [];
  private _routeCache = new Map<string, CachedRoute>();

  markDirty(): void {
    this._dirty = true;
    this._layoutRevision += 1;
    this._routeCache.clear();
  }

  getSnapshot(): SmartRoutingSnapshot {
    return {
      dirty: this._dirty,
      layoutRevision: this._layoutRevision,
      lastBuiltRevision: this._lastBuiltRevision,
      buildCount: this._buildCount,
      obstacleCount: this._obstacles.length,
    };
  }

  resolve(
    editor: GlideEditor,
    args: {
      arrow: ArrowShape;
      startWorld: Vec2;
      endWorld: Vec2;
      fromEdge: EdgeName;
      toEdge: EdgeName;
      fromShapeId: ShapeId | null;
      toShapeId: ShapeId | null;
      now?: () => number;
      budgetMs?: number;
    },
  ): SmartRouteResolution {
    const now = args.now ?? defaultNow;
    const budgetMs = args.budgetMs ?? DEFAULT_ROUTE_BUDGET_MS;
    const startedAt = now();
    const deadline = startedAt + budgetMs;

    if (!this._ensureBuilt(editor, deadline, now)) {
      return this._fallback(editor, args, now() - startedAt, 'ovg-timeout');
    }

    const baseRoute = this._getOrComputeBaseRoute({
      arrow: args.arrow,
      startWorld: args.startWorld,
      endWorld: args.endWorld,
      fromEdge: args.fromEdge,
      toEdge: args.toEdge,
      fromShapeId: args.fromShapeId,
      toShapeId: args.toShapeId,
      deadline,
      now,
    });

    if (!baseRoute) {
      return this._fallback(editor, args, now() - startedAt, 'route-timeout');
    }

    const offset = this._getParallelOffset(editor, args.arrow, baseRoute, deadline, now);
    const nudgedPoints = offset === 0
      ? baseRoute.points
      : offsetOrthogonalPolyline(baseRoute.points, offset);

    return {
      points: nudgedPoints,
      basePoints: baseRoute.points,
      baseSignature: baseRoute.baseSignature,
      didFallback: false,
      elapsedMs: now() - startedAt,
      offset,
    };
  }

  private _ensureBuilt(editor: GlideEditor, deadline: number, now: () => number): boolean {
    if (!this._dirty) return true;

    const nextObstacles: SmartObstacle[] = [];
    const shapes = editor.getShapes();

    for (const shape of shapes) {
      if (now() > deadline) return false;
      if (shape.type === 'arrow') continue;

      const bounds = getWorldBounds(editor, shape);
      nextObstacles.push({
        id: shape.id,
        bounds,
        expanded: expandBox(bounds, OBSTACLE_PADDING),
      });
    }

    this._obstacles = nextObstacles;
    this._dirty = false;
    this._lastBuiltRevision = this._layoutRevision;
    this._buildCount += 1;
    this._routeCache.clear();
    return true;
  }

  private _getParallelOffset(
    editor: GlideEditor,
    arrow: ArrowShape,
    current: BaseSmartRouteResult,
    deadline: number,
    now: () => number,
  ): number {
    const group = [arrow.id as string];
    const smartArrows = editor.getShapes(true).filter(shape =>
      shape.type === 'arrow' &&
      shape.id !== arrow.id &&
      (shape as ArrowShape).props.routeStyle === 'smart',
    ) as ArrowShape[];

    for (const other of smartArrows) {
      if (now() > deadline) break;
      const otherBase = this._getOrComputeBaseRoute({
        arrow: other,
        startWorld: {
          x: other.x + other.props.start.point.x,
          y: other.y + other.props.start.point.y,
        },
        endWorld: {
          x: other.x + other.props.end.point.x,
          y: other.y + other.props.end.point.y,
        },
        fromEdge: getArrowBindingEdge(editor, other.id as ShapeId, 'start', 'right'),
        toEdge: getArrowBindingEdge(editor, other.id as ShapeId, 'end', 'left'),
        fromShapeId: other.props.start.boundShapeId,
        toShapeId: other.props.end.boundShapeId,
        deadline,
        now,
      });
      if (!otherBase) continue;
      if (otherBase.baseSignature === current.baseSignature) {
        group.push(other.id as string);
      }
    }

    group.sort();
    const index = group.indexOf(arrow.id as string);
    return (index - (group.length - 1) / 2) * PARALLEL_ROUTE_SEPARATION;
  }

  private _getOrComputeBaseRoute(input: BaseSmartRouteInput): BaseSmartRouteResult | null {
    const routeKey = getRouteCacheKey(input.arrow);
    const cached = this._routeCache.get(input.arrow.id as string);
    if (
      cached &&
      cached.layoutRevision === this._layoutRevision &&
      cached.routeKey === routeKey
    ) {
      return { points: cached.basePoints, baseSignature: cached.baseSignature };
    }

    const excluded = new Set<string>();
    if (input.fromShapeId) excluded.add(input.fromShapeId);
    if (input.toShapeId) excluded.add(input.toShapeId);
    const routeBox = makeBox(
      Math.min(input.startWorld.x, input.endWorld.x),
      Math.min(input.startWorld.y, input.endWorld.y),
      Math.abs(input.endWorld.x - input.startWorld.x),
      Math.abs(input.endWorld.y - input.startWorld.y),
    );

    for (const expansion of SEARCH_EXPANSIONS) {
      if (input.now() > input.deadline) return null;

      const searchArea = Number.isFinite(expansion)
        ? expandBox(routeBox, expansion)
        : null;

      const candidates = this._obstacles.filter(obstacle => {
        if (excluded.has(obstacle.id)) return false;
        return !searchArea || boxesIntersect(obstacle.expanded, searchArea);
      });
      const routeObstacles = candidates.map(candidate =>
        relaxObstaclePadding(candidate, input.startWorld, input.endWorld),
      );

      const points = computeOrthogonalRoute({
        start: input.startWorld,
        end: input.endWorld,
        obstacles: routeObstacles,
        deadline: input.deadline,
        now: input.now,
      });

      if (points) {
        const simplified = simplifyCollinear(points);
        const baseSignature = routeSignature(simplified);
        this._routeCache.set(input.arrow.id as string, {
          layoutRevision: this._layoutRevision,
          routeKey,
          basePoints: simplified,
          baseSignature,
        });
        return { points: simplified, baseSignature };
      }
    }

    return null;
  }

  private _fallback(
    editor: GlideEditor,
    args: {
      arrow: ArrowShape;
      startWorld: Vec2;
      endWorld: Vec2;
      fromEdge: EdgeName;
      toEdge: EdgeName;
      fromShapeId: ShapeId | null;
      toShapeId: ShapeId | null;
    },
    elapsedMs: number,
    fallbackReason: string,
  ): SmartRouteResolution {
    const points = getFallbackElbowPoints(editor, args.arrow, args.startWorld, args.endWorld, args.fromEdge, args.toEdge);
    return {
      points,
      basePoints: points,
      baseSignature: routeSignature(points),
      didFallback: true,
      elapsedMs,
      offset: 0,
      fallbackReason,
    };
  }
}

export function getWorldBounds(editor: GlideEditor, shape: GlideShape): Box2d {
  return editor.transforms.getWorldBounds(shape.id as ShapeId);
}

export function getArrowBindingEdge(
  editor: GlideEditor,
  arrowId: ShapeId,
  terminal: 'start' | 'end',
  fallback: EdgeName,
): EdgeName {
  const bindings = editor.getBindingsFromShape(arrowId);
  const binding = bindings.find(item => (item as any).props.terminal === terminal) as any;
  return binding?.props?.fromEdge ?? fallback;
}

export function getFallbackElbowPoints(
  editor: GlideEditor,
  arrow: ArrowShape,
  startWorld: Vec2,
  endWorld: Vec2,
  fromEdge: EdgeName,
  toEdge: EdgeName,
): Vec2[] {
  const fromShape = arrow.props.start.boundShapeId ? editor.getShape(arrow.props.start.boundShapeId) : null;
  const toShape = arrow.props.end.boundShapeId ? editor.getShape(arrow.props.end.boundShapeId) : null;

  if (!fromShape || !toShape) {
    return [startWorld, endWorld];
  }

  const fromBoundsWorld = getWorldBounds(editor, fromShape as any);
  const toBoundsWorld = getWorldBounds(editor, toShape as any);
  return computeFallbackLocalElbowPoints(
    { ...arrow, x: 0, y: 0 },
    fromBoundsWorld,
    toBoundsWorld,
    fromEdge,
    toEdge,
  );
}

export function computeFallbackLocalElbowPoints(
  arrow: ArrowShape,
  fromBoundsWorld: Box2d,
  toBoundsWorld: Box2d,
  fromEdge: EdgeName,
  toEdge: EdgeName,
): Vec2[] {
  const fromBounds = {
    ...fromBoundsWorld,
    x: fromBoundsWorld.minX - arrow.x,
    y: fromBoundsWorld.minY - arrow.y,
    minX: fromBoundsWorld.minX - arrow.x,
    minY: fromBoundsWorld.minY - arrow.y,
    maxX: fromBoundsWorld.maxX - arrow.x,
    maxY: fromBoundsWorld.maxY - arrow.y,
  };
  const toBounds = {
    ...toBoundsWorld,
    x: toBoundsWorld.minX - arrow.x,
    y: toBoundsWorld.minY - arrow.y,
    minX: toBoundsWorld.minX - arrow.x,
    minY: toBoundsWorld.minY - arrow.y,
    maxX: toBoundsWorld.maxX - arrow.x,
    maxY: toBoundsWorld.maxY - arrow.y,
  };

  return parseElbowPoints(computeElbowPath(fromBounds, toBounds, fromEdge, toEdge, arrow.props.bend));
}

export function offsetOrthogonalPolyline(points: Vec2[], offset: number): Vec2[] {
  if (offset === 0 || points.length < 2) return points;

  const segments: Array<
    | { axis: 'h'; y: number; x1: number; x2: number }
    | { axis: 'v'; x: number; y1: number; y2: number }
  > = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (Math.abs(a.x - b.x) < EPSILON) {
      segments.push({ axis: 'v' as const, x: a.x + offset, y1: a.y, y2: b.y });
    } else {
      segments.push({ axis: 'h' as const, y: a.y + offset, x1: a.x, x2: b.x });
    }
  }

  const result: Vec2[] = [points[0]!];
  const first = segments[0]!;
  if (first.axis === 'h') {
    result.push({ x: points[0]!.x, y: first.y });
  } else {
    result.push({ x: first.x, y: points[0]!.y });
  }

  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]!;
    const next = segments[i]!;
    if (prev.axis === 'h' && next.axis === 'v') {
      result.push({ x: next.x, y: prev.y });
    } else if (prev.axis === 'v' && next.axis === 'h') {
      result.push({ x: prev.x, y: next.y });
    }
  }

  const last = segments[segments.length - 1]!;
  if (last.axis === 'h') {
    result.push({ x: points[points.length - 1]!.x, y: last.y });
  } else {
    result.push({ x: last.x, y: points[points.length - 1]!.y });
  }
  result.push(points[points.length - 1]!);

  return simplifyCollinear(result);
}

export function routeSignature(points: Vec2[]): string {
  return points.map(point => `${round(point.x)}:${round(point.y)}`).join('|');
}

function relaxObstaclePadding(obstacle: SmartObstacle, start: Vec2, end: Vec2): Box2d {
  const startInsidePadding = pointInsideBoxInterior(start, obstacle.expanded) && !pointInsideBoxInterior(start, obstacle.bounds);
  const endInsidePadding = pointInsideBoxInterior(end, obstacle.expanded) && !pointInsideBoxInterior(end, obstacle.bounds);
  return startInsidePadding || endInsidePadding ? obstacle.bounds : obstacle.expanded;
}

export function simplifyCollinear(points: Vec2[]): Vec2[] {
  if (points.length <= 2) return points.slice();

  const simplified: Vec2[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = simplified[simplified.length - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;
    const horizontal = Math.abs(prev.y - curr.y) < EPSILON && Math.abs(curr.y - next.y) < EPSILON;
    const vertical = Math.abs(prev.x - curr.x) < EPSILON && Math.abs(curr.x - next.x) < EPSILON;
    if (!horizontal && !vertical) {
      simplified.push(curr);
    }
  }
  simplified.push(points[points.length - 1]!);
  return simplified;
}

function computeOrthogonalRoute(args: {
  start: Vec2;
  end: Vec2;
  obstacles: Box2d[];
  deadline: number;
  now: () => number;
}): Vec2[] | null {
  const start = { x: round(args.start.x), y: round(args.start.y) };
  const end = { x: round(args.end.x), y: round(args.end.y) };
  const xs = uniqueSorted([start.x, end.x, ...args.obstacles.flatMap(box => [box.minX, box.maxX])]);
  const ys = uniqueSorted([start.y, end.y, ...args.obstacles.flatMap(box => [box.minY, box.maxY])]);
  const nodeCount = xs.length * ys.length;
  if (nodeCount === 0 || nodeCount > MAX_GRID_NODES) {
    return null;
  }

  const blocked = new Uint8Array(nodeCount);
  for (let yi = 0; yi < ys.length; yi++) {
    for (let xi = 0; xi < xs.length; xi++) {
      if (args.now() > args.deadline) return null;
      const point = { x: xs[xi]!, y: ys[yi]! };
      if (args.obstacles.some(obstacle => pointInsideBoxInterior(point, obstacle))) {
        blocked[yi * xs.length + xi] = 1;
      }
    }
  }

  const xIndex = new Map<number, number>(xs.map((x, index) => [x, index]));
  const yIndex = new Map<number, number>(ys.map((y, index) => [y, index]));
  const startX = xIndex.get(start.x);
  const startY = yIndex.get(start.y);
  const endX = xIndex.get(end.x);
  const endY = yIndex.get(end.y);
  if (
    startX === undefined || startY === undefined ||
    endX === undefined || endY === undefined
  ) {
    return null;
  }

  const startNode = startY * xs.length + startX;
  const endNode = endY * xs.length + endX;
  if (blocked[startNode] || blocked[endNode]) return null;

  const adjacency: number[][] = Array.from({ length: nodeCount }, () => []);
  for (let yi = 0; yi < ys.length; yi++) {
    let previousNode = -1;
    for (let xi = 0; xi < xs.length; xi++) {
      const node = yi * xs.length + xi;
      if (blocked[node]) continue;
      if (previousNode >= 0) {
        const a = nodeToPoint(previousNode, xs, ys);
        const b = nodeToPoint(node, xs, ys);
        if (segmentClear(a, b, args.obstacles)) {
          adjacency[previousNode]!.push(node);
          adjacency[node]!.push(previousNode);
        }
      }
      previousNode = node;
    }
  }
  for (let xi = 0; xi < xs.length; xi++) {
    let previousNode = -1;
    for (let yi = 0; yi < ys.length; yi++) {
      const node = yi * xs.length + xi;
      if (blocked[node]) continue;
      if (previousNode >= 0) {
        const a = nodeToPoint(previousNode, xs, ys);
        const b = nodeToPoint(node, xs, ys);
        if (segmentClear(a, b, args.obstacles)) {
          adjacency[previousNode]!.push(node);
          adjacency[node]!.push(previousNode);
        }
      }
      previousNode = node;
    }
  }

  const stateCount = nodeCount * 3;
  const gScore = new Float64Array(stateCount);
  const cameFrom = new Int32Array(stateCount);
  const closed = new Uint8Array(stateCount);
  gScore.fill(Number.POSITIVE_INFINITY);
  cameFrom.fill(-1);

  const heap = new MinHeap();
  const startState = encodeState(startNode, 0);
  gScore[startState] = 0;
  heap.push({ state: startState, priority: manhattan(start, end) });

  while (heap.size > 0) {
    if (args.now() > args.deadline) return null;
    const current = heap.pop()!;
    if (closed[current.state]) continue;
    closed[current.state] = 1;

    const currentNode = decodeNode(current.state);
    const currentAxis = decodeAxis(current.state);
    if (currentNode === endNode) {
      return reconstructPath(current.state, cameFrom, xs, ys);
    }

    const currentPoint = nodeToPoint(currentNode, xs, ys);
    for (const neighbor of adjacency[currentNode]!) {
      const neighborPoint = nodeToPoint(neighbor, xs, ys);
      const nextAxis = Math.abs(currentPoint.x - neighborPoint.x) < EPSILON ? 2 : 1;
      const bendPenalty = currentAxis !== 0 && currentAxis !== nextAxis ? 2 : 0;
      const tentative = (gScore[current.state] ?? Infinity) + manhattan(currentPoint, neighborPoint) + bendPenalty;
      const neighborState = encodeState(neighbor, nextAxis);
      if (tentative >= (gScore[neighborState] ?? Infinity)) continue;

      gScore[neighborState] = tentative;
      cameFrom[neighborState] = current.state;
      heap.push({
        state: neighborState,
        priority: tentative + manhattan(neighborPoint, end),
      });
    }
  }

  return null;
}

function reconstructPath(state: number, cameFrom: Int32Array, xs: number[], ys: number[]): Vec2[] {
  const points: Vec2[] = [];
  let cursor = state;
  while (cursor >= 0) {
    points.push(nodeToPoint(decodeNode(cursor), xs, ys));
    cursor = cameFrom[cursor] ?? -1;
  }
  return points.reverse();
}

function nodeToPoint(node: number, xs: number[], ys: number[]): Vec2 {
  const xIndex = node % xs.length;
  const yIndex = Math.floor(node / xs.length);
  return { x: xs[xIndex]!, y: ys[yIndex]! };
}

function encodeState(node: number, axis: number): number {
  return node * 3 + axis;
}

function decodeNode(state: number): number {
  return Math.floor(state / 3);
}

function decodeAxis(state: number): number {
  return state % 3;
}

function uniqueSorted(values: number[]): number[] {
  return Array.from(new Set(values.map(round))).sort((a, b) => a - b);
}

function expandBox(box: Box2d, padding: number): Box2d {
  return makeBox(box.minX - padding, box.minY - padding, box.w + padding * 2, box.h + padding * 2);
}

function boxesIntersect(a: Box2d, b: Box2d): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function pointInsideBoxInterior(point: Vec2, box: Box2d): boolean {
  return (
    point.x > box.minX + EPSILON &&
    point.x < box.maxX - EPSILON &&
    point.y > box.minY + EPSILON &&
    point.y < box.maxY - EPSILON
  );
}

function segmentClear(a: Vec2, b: Vec2, obstacles: Box2d[]): boolean {
  return !obstacles.some(obstacle => segmentIntersectsBoxInterior(a, b, obstacle));
}

function segmentIntersectsBoxInterior(a: Vec2, b: Vec2, box: Box2d): boolean {
  if (Math.abs(a.x - b.x) < EPSILON) {
    if (a.x <= box.minX + EPSILON || a.x >= box.maxX - EPSILON) return false;
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    return Math.max(minY, box.minY + EPSILON) < Math.min(maxY, box.maxY - EPSILON);
  }

  if (Math.abs(a.y - b.y) < EPSILON) {
    if (a.y <= box.minY + EPSILON || a.y >= box.maxY - EPSILON) return false;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    return Math.max(minX, box.minX + EPSILON) < Math.min(maxX, box.maxX - EPSILON);
  }

  return false;
}

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function getRouteCacheKey(arrow: ArrowShape): string {
  const { start, end, bend, routeStyle } = arrow.props;
  return [
    routeStyle,
    bend,
    arrow.x,
    arrow.y,
    start.boundShapeId ?? '',
    end.boundShapeId ?? '',
    start.point.x,
    start.point.y,
    end.point.x,
    end.point.y,
  ].join('|');
}
