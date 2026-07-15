import { describe, expect, it } from 'vitest';
import { createEditor } from './editor';
import { BoxUtil } from './shapes/BoxUtil';
import { ArrowPlugin, type ArrowShape, type ArrowRouteStyle } from './shapes/ArrowUtil';
import { BoxTool } from './tools/BoxTool';
import { SelectTool } from './tools/SelectTool';
import { sid, type Box2d, type ShapeId, type Vec2 } from './types';
import { buildArrowBindingRecord, buildArrowShapeRecord, resolveConnectionTerminal } from './arrow-records';
import { resolveArrowRoute } from './arrow-routing';

const BoxPlugin = { id: 'box', shapes: [BoxUtil as any] };

function makeEditor() {
  return createEditor({
    plugins: [BoxPlugin, ArrowPlugin],
    tools: [SelectTool, BoxTool],
  });
}

function createBox(
  editor: ReturnType<typeof makeEditor>,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label = '',
): ShapeId {
  const shapeId = sid(id);
  editor.createShape({
    id: shapeId,
    type: 'box',
    x,
    y,
    index: `a-${id}`,
    rotation: 0,
    meta: {},
    props: {
      ...new BoxUtil().getDefaultProps(),
      w,
      h,
      label,
    },
  });
  return shapeId;
}

function createBoundArrow(
  editor: ReturnType<typeof makeEditor>,
  id: string,
  fromId: ShapeId,
  toId: ShapeId,
  routeStyle: ArrowRouteStyle = 'smart',
): ArrowShape {
  const fromBounds = editor.getShapeWorldBounds(fromId);
  const toBounds = editor.getShapeWorldBounds(toId);
  const fromCenter = centerOf(fromBounds);
  const toCenter = centerOf(toBounds);
  const start = resolveConnectionTerminal(editor, fromId, toCenter);
  const end = resolveConnectionTerminal(editor, toId, fromCenter);
  if (!start || !end) {
    throw new Error('Failed to resolve connection terminals');
  }

  const arrowId = sid(id);
  const arrow = buildArrowShapeRecord({
    id: arrowId,
    startWorld: start.point,
    endWorld: end.point,
    routeStyle,
    index: `z-${id}`,
  });
  arrow.props.start = {
    boundShapeId: fromId,
    normalizedAnchor: start.normalizedAnchor,
    point: { x: 0, y: 0 },
  };
  arrow.props.end = {
    boundShapeId: toId,
    normalizedAnchor: end.normalizedAnchor,
    point: { x: end.point.x - start.point.x, y: end.point.y - start.point.y },
  };

  editor.createShape(arrow as any);
  editor.createBinding(buildArrowBindingRecord({
    id: `bind-${id}-start`,
    fromId: arrowId,
    toId: fromId,
    terminal: 'start',
    normalizedAnchor: start.normalizedAnchor,
  }));
  editor.createBinding(buildArrowBindingRecord({
    id: `bind-${id}-end`,
    fromId: arrowId,
    toId: toId,
    terminal: 'end',
    normalizedAnchor: end.normalizedAnchor,
  }));
  editor.updateShape(fromId, { x: editor.getShape(fromId)!.x });
  editor.updateShape(toId, { x: editor.getShape(toId)!.x });

  return editor.getShape<ArrowShape>(arrowId)!;
}

function centerOf(box: Box2d): Vec2 {
  return {
    x: box.minX + box.w / 2,
    y: box.minY + box.h / 2,
  };
}

function segmentIntersectsBoxInterior(a: Vec2, b: Vec2, box: Box2d): boolean {
  const epsilon = 1e-6;
  if (Math.abs(a.x - b.x) < epsilon) {
    if (a.x <= box.minX + epsilon || a.x >= box.maxX - epsilon) return false;
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    return Math.max(minY, box.minY + epsilon) < Math.min(maxY, box.maxY - epsilon);
  }

  if (Math.abs(a.y - b.y) < epsilon) {
    if (a.y <= box.minY + epsilon || a.y >= box.maxY - epsilon) return false;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    return Math.max(minX, box.minX + epsilon) < Math.min(maxX, box.maxX - epsilon);
  }

  return false;
}

function routeIntersectsBoxInterior(points: Vec2[], box: Box2d): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentIntersectsBoxInterior(points[i]!, points[i + 1]!, box)) {
      return true;
    }
  }
  return false;
}

describe('Phase 6 smart routing', () => {
  it('T6.1-01: smart route avoids obstacles', () => {
    const editor = makeEditor();
    const fromId = createBox(editor, 'box:a', 40, 140, 120, 80, 'A');
    const obstacleId = createBox(editor, 'box:obstacle', 240, 110, 120, 140, 'B');
    const toId = createBox(editor, 'box:c', 460, 140, 120, 80, 'C');
    const arrow = createBoundArrow(editor, 'shape:smart-route', fromId, toId, 'smart');

    const route = resolveArrowRoute(editor, arrow);
    const obstacleBounds = editor.getShapeWorldBounds(obstacleId);

    expect(route.renderKind).toBe('polyline');
    expect(routeIntersectsBoxInterior(route.worldPoints, obstacleBounds)).toBe(false);
  });

  it('T6.1-02: marks the OVG dirty on non-arrow changes and rebuilds on demand', () => {
    const editor = makeEditor();
    const fromId = createBox(editor, 'box:dirty-a', 40, 140, 120, 80);
    createBox(editor, 'box:dirty-b', 240, 110, 120, 140);
    const toId = createBox(editor, 'box:dirty-c', 460, 140, 120, 80);
    const arrow = createBoundArrow(editor, 'shape:dirty-route', fromId, toId, 'smart');
    // Same-value updates are store no-ops, so build the lazy route explicitly.
    resolveArrowRoute(editor, arrow);
    const initialSnapshot = editor.getSmartRoutingSnapshot();
    expect(initialSnapshot.dirty).toBe(false);
    expect(initialSnapshot.buildCount).toBeGreaterThanOrEqual(1);

    editor.updateShape(fromId, { x: 80 });
    const dirtySnapshot = editor.getSmartRoutingSnapshot();
    expect(dirtySnapshot.layoutRevision).toBeGreaterThan(initialSnapshot.layoutRevision);

    resolveArrowRoute(editor, editor.getShape<ArrowShape>(sid('shape:dirty-route'))!);
    const rebuiltSnapshot = editor.getSmartRoutingSnapshot();
    expect(rebuiltSnapshot.dirty).toBe(false);
    expect(rebuiltSnapshot.buildCount).toBeGreaterThanOrEqual(initialSnapshot.buildCount);
  });

  it('T6.1-03: nudges parallel routes apart by at least 6px', () => {
    const editor = makeEditor();
    const fromId = createBox(editor, 'box:nudge-a', 40, 140, 120, 80);
    const toId = createBox(editor, 'box:nudge-b', 460, 140, 120, 80);

    const arrowA = createBoundArrow(editor, 'shape:nudge-a', fromId, toId, 'smart');
    const arrowB = createBoundArrow(editor, 'shape:nudge-b', fromId, toId, 'smart');

    const routeA = resolveArrowRoute(editor, arrowA);
    const routeB = resolveArrowRoute(editor, arrowB);

    expect(routeA.offset).toBeDefined();
    expect(routeB.offset).toBeDefined();
    expect(Math.abs((routeA.offset ?? 0) - (routeB.offset ?? 0))).toBeGreaterThanOrEqual(6);
  });

  it('T6.1-04: computes cached routes under 8ms at 500 shapes', () => {
    const editor = makeEditor();

    for (let row = 0; row < 20; row++) {
      for (let col = 0; col < 25; col++) {
        createBox(editor, `box:grid-${row}-${col}`, col * 80, row * 60, 48, 32);
      }
    }

    const fromId = createBox(editor, 'box:perf-a', -160, 260, 96, 64);
    const toId = createBox(editor, 'box:perf-b', 2120, 260, 96, 64);
    const arrow = createBoundArrow(editor, 'shape:perf-route', fromId, toId, 'smart');

    resolveArrowRoute(editor, arrow);

    const started = performance.now();
    const route = resolveArrowRoute(editor, arrow);
    const elapsed = performance.now() - started;

    expect(route.didFallback).not.toBe(true);
    expect(elapsed).toBeLessThan(8);
  });

  it('T6.1-05: falls back to elbow routing when the budget is exhausted', () => {
    const editor = makeEditor();
    const fromId = createBox(editor, 'box:timeout-a', 40, 140, 120, 80);
    createBox(editor, 'box:timeout-b', 240, 110, 120, 140);
    const toId = createBox(editor, 'box:timeout-c', 460, 140, 120, 80);
    const arrow = createBoundArrow(editor, 'shape:timeout-route', fromId, toId, 'smart');
    createBox(editor, 'box:timeout-extra', 660, 80, 80, 80);

    let tick = 0;
    const route = resolveArrowRoute(editor, arrow, {
      now: () => {
        tick += 7;
        return tick;
      },
      budgetMs: 12,
    });

    expect(route.didFallback).toBe(true);
    expect(route.fallbackReason).toMatch(/timeout/);
  });

  it('T6.1-06: smart-route cache rebuilds do not change curve routing', () => {
    const editor = makeEditor();
    const curveFrom = createBox(editor, 'box:curve-a', 40, 340, 120, 80);
    const curveTo = createBox(editor, 'box:curve-b', 460, 340, 120, 80);
    const smartFrom = createBox(editor, 'box:smart-a', 40, 140, 120, 80);
    createBox(editor, 'box:smart-obstacle', 240, 110, 120, 140);
    const smartTo = createBox(editor, 'box:smart-c', 460, 140, 120, 80);

    const curveArrow = createBoundArrow(editor, 'shape:curve-route', curveFrom, curveTo, 'curve');
    const smartArrow = createBoundArrow(editor, 'shape:smart-cache-route', smartFrom, smartTo, 'smart');

    const before = resolveArrowRoute(editor, curveArrow).path;
    resolveArrowRoute(editor, smartArrow);
    editor.updateShape(smartFrom, { x: 80 });
    resolveArrowRoute(editor, editor.getShape<ArrowShape>(sid('shape:smart-cache-route'))!);
    const after = resolveArrowRoute(editor, curveArrow).path;

    expect(after).toBe(before);
  });

  it('T6.1-07: avoids obstacles when the target sits inside another shape padding zone', () => {
    const editor = makeEditor();
    const fromId = createBox(editor, 'box:padding-from', 120, 560, 120, 100);
    const obstacleId = createBox(editor, 'box:padding-obstacle', 300, 340, 220, 220);
    const toId = createBox(editor, 'box:padding-target', 350, 250, 120, 80);
    const arrow = createBoundArrow(editor, 'shape:padding-route', fromId, toId, 'smart');

    const route = resolveArrowRoute(editor, arrow);
    const obstacleBounds = editor.getShapeWorldBounds(obstacleId);

    expect(route.didFallback).not.toBe(true);
    expect(route.renderKind).toBe('polyline');
    expect(routeIntersectsBoxInterior(route.worldPoints, obstacleBounds)).toBe(false);
  });

  it('T6.1-08: avoids fallback when bound anchors have fractional coordinates', () => {
    const editor = makeEditor();
    const obstacleId = createBox(editor, 'box:fractional-obstacle', 470, 141, 180, 180);
    const fromId = createBox(editor, 'box:fractional-from', 180, 376, 100, 80);
    const toId = createBox(editor, 'box:fractional-to', 489.8578605647359, 7.318804302490776, 117.0390625, 76.6796875);
    const arrow = createBoundArrow(editor, 'shape:fractional-route', fromId, toId, 'smart');

    const route = resolveArrowRoute(editor, arrow);
    const obstacleBounds = editor.getShapeWorldBounds(obstacleId);

    expect(route.didFallback).not.toBe(true);
    expect(route.renderKind).toBe('polyline');
    expect(routeIntersectsBoxInterior(route.worldPoints, obstacleBounds)).toBe(false);
  });
});
