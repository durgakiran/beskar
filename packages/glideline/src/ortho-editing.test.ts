import { describe, expect, it } from 'vitest';
import { createEditor } from './editor.js';
import { getOrthoHandles, getOrthoRouteMenu } from './ortho-editing.js';
import { resolveArrowRoute } from './arrow-routing.js';
import { buildArrowBindingRecord, buildArrowShapeRecord } from './arrow-records.js';
import { ArrowPlugin, type ArrowShape } from './shapes/ArrowUtil.js';
import { BoxUtil } from './shapes/BoxUtil.js';
import { GroupUtil } from './shapes/GroupUtil.js';
import { LinePlugin, type LineShape } from './shapes/LineUtil.js';
import { LineTool } from './tools/LineTool.js';
import { SelectTool } from './tools/SelectTool.js';
import type { AnyRecord, Vec2 } from './types.js';

function setup(vertical = false) {
  const editor = createEditor({ plugins: [ArrowPlugin, { id: 'boxes', shapes: [BoxUtil, GroupUtil] }], tools: [SelectTool] });
  const start = { x: 100, y: 100 };
  const end = vertical ? { x: 100, y: 360 } : { x: 360, y: 100 };
  const id = editor.createShapeId('arrow');
  editor.createShape(buildArrowShapeRecord({ id, startWorld: start, endWorld: end }) as unknown as AnyRecord);
  editor.setSelectedShapeIds([id]);
  const arrow = () => editor.getShape<ArrowShape>(id)!;
  const path = () => resolveArrowRoute(editor, arrow()).worldPoints;
  const down = (handle: ReturnType<typeof getOrthoHandles>[number]) => editor.dispatchEvent({
    type: 'pointerDown', point: handle.point, target: 'handle', handleId: handle.id, shiftKey: false,
  });
  return { editor, id, start, end, arrow, path, down };
}

describe('manual Ortho route editing', () => {
  it('bypasses a covered waypoint without extending the route past the target', () => {
    const { editor, id, arrow, path, down } = setup();
    const source = editor.createShape({ type: 'box', x: 20, y: 60, props: { w: 80, h: 80 } });
    const target = editor.createShape({ type: 'box', x: 360, y: 60, props: { w: 80, h: 80 } });
    editor.createBinding(buildArrowBindingRecord({ fromId: id, toId: source, terminal: 'start',
      normalizedAnchor: { x: 1, y: 0.5 } }));
    editor.createBinding(buildArrowBindingRecord({ fromId: id, toId: target, terminal: 'end',
      normalizedAnchor: { x: 0, y: 0.5 } }));
    const manualRoute = [{ x: 300, y: 100, kind: 'waypoint' }] as const;
    editor.updateShape<ArrowShape>(id, { props: { ...arrow().props, manualRoute: [...manualRoute] } });

    editor.updateShape(target, { x: 260 });
    const bypass = path();
    expect(bypass[0]).toEqual({ x: 100, y: 100 });
    expect(bypass.at(-1)).toEqual({ x: 260, y: 100 });
    expect(bypass.every((point, index) => point.y === 100 &&
      (index === 0 || point.x >= bypass[index - 1]!.x))).toBe(true);
    expect(arrow().props.manualRoute).toEqual(manualRoute);

    editor.updateShape(target, { x: 360 });
    expect(resolveArrowRoute(editor, arrow()).orthoPoints).toContainEqual({ x: 300, y: 100, control: 0 });
    expect(path().at(-1)).toEqual({ x: 360, y: 100 });

    editor.updateShape(target, { x: 260 });
    const handle = getOrthoHandles(editor, arrow()).find(handle => handle.moveAxis === 'y')!;
    const dragged = { x: handle.point.x, y: 200 };
    down(handle);
    editor.dispatchEvent({ type: 'pointerMove', point: dragged });
    editor.dispatchEvent({ type: 'pointerUp', point: dragged });
    expect(arrow().props.manualRoute?.filter(point => point.kind === 'waypoint')).toEqual(manualRoute);
    expect(path()).toContainEqual({ x: 128.8, y: 200 });

    editor.updateShape(target, { x: 360 });
    expect(path()).toContainEqual({ x: 300, y: 100 });
    expect(path()).toContainEqual({ x: 128.8, y: 200 });
    expect(getOrthoHandles(editor, arrow()).find(handle => handle.id.startsWith('ortho-waypoint-'))?.point)
      .toEqual({ x: 300, y: 100 });
  });

  it('routes around both rectangles when their facing anchors switch sides', () => {
    const { editor, id, arrow, path } = setup();
    const source = editor.createShape({ type: 'box', x: 20, y: 60, props: { w: 80, h: 80 } });
    const target = editor.createShape({ type: 'box', x: 360, y: 60, props: { w: 80, h: 80 } });
    editor.createBinding(buildArrowBindingRecord({ fromId: id, toId: source, terminal: 'start',
      normalizedAnchor: { x: 1, y: 0.5 } }));
    editor.createBinding(buildArrowBindingRecord({ fromId: id, toId: target, terminal: 'end',
      normalizedAnchor: { x: 0, y: 0.5 } }));
    editor.updateShape(target, { x: -90.12345, y: 170.23456 });
    const route = path();
    expect(route[0]).toEqual({ x: 100, y: 100 });
    expect(route.at(-1)!.x).toBeCloseTo(-90.12345);
    expect(route.at(-1)!.y).toBeCloseTo(210.23456);
    expect(route[1]!.x).toBeGreaterThan(100);
    expect(route.at(-2)!.x).toBeLessThan(-90.12345);
    expect(arrow().props.end.boundShapeId).toBe(target);
    for (let index = 1; index < route.length; index++) {
      const a = route[index - 1]!, b = route[index]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
      for (const shape of [source, target]) {
        const box = editor.getShapeWorldBounds(shape);
        const epsilon = 1e-6;
        const crosses = Math.max(a.x, b.x) > box.minX + epsilon && Math.min(a.x, b.x) < box.maxX - epsilon &&
          Math.max(a.y, b.y) > box.minY + epsilon && Math.min(a.y, b.y) < box.maxY - epsilon;
        expect(crosses).toBe(false);
      }
    }
  });

  it('keeps the clear parts of a manual detour when a rectangle moves to the other side', () => {
    const { editor, id, arrow, path } = setup();
    const source = editor.createShape({ type: 'box', x: 20, y: 60, props: { w: 80, h: 80 } });
    const target = editor.createShape({ type: 'box', x: 360, y: 60, props: { w: 80, h: 80 } });
    const startAnchor = { x: 1, y: 0.5 };
    const endAnchor = { x: 0, y: 0.5 };
    editor.createBinding(buildArrowBindingRecord({ fromId: id, toId: source, terminal: 'start',
      normalizedAnchor: startAnchor }));
    editor.createBinding(buildArrowBindingRecord({ fromId: id, toId: target, terminal: 'end',
      normalizedAnchor: endAnchor }));
    // Update both positions so the editor resolves the initial binding edges.
    editor.updateShape(source, { x: 20, y: 61 });
    editor.updateShape(source, { x: 20, y: 60 });
    editor.updateShape(target, { x: 360, y: 61 });
    editor.updateShape(target, { x: 360, y: 60 });
    const manualRoute = [
      { x: 140, y: 100, kind: 'segment' },
      { x: 140, y: 160, kind: 'segment' },
      { x: 250, y: 160, kind: 'waypoint' },
      { x: 320, y: 160, kind: 'segment' },
      { x: 320, y: 100, kind: 'segment' },
    ] as const;
    editor.updateShape<ArrowShape>(id, { props: { ...arrow().props, manualRoute: [...manualRoute] } });
    const original = path();

    editor.updateShape(target, { x: -140, y: 179 });
    const route = path();
    expect(route.slice(0, 5)).toEqual(original.slice(0, 5));
    expect(route).toContainEqual({ x: 250, y: 160 });
    expect(route.at(-1)).toEqual({ x: -140, y: 219 });
    expect(editor.getBindingsFromShape(id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ toId: source, props: expect.objectContaining({ terminal: 'start', normalizedAnchor: startAnchor }) }),
      expect.objectContaining({ toId: target, props: expect.objectContaining({ terminal: 'end', normalizedAnchor: endAnchor }) }),
    ]));
    expect(arrow().props.manualRoute).toEqual(manualRoute);
    for (const [index, b] of route.slice(1).entries()) {
      const a = route[index]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
      for (const shape of [source, target]) {
        const box = editor.getShapeWorldBounds(shape);
        expect(Math.max(a.x, b.x) > box.minX && Math.min(a.x, b.x) < box.maxX &&
          Math.max(a.y, b.y) > box.minY && Math.min(a.y, b.y) < box.maxY).toBe(false);
      }
    }

    editor.updateShape(target, { x: 360, y: 60 });
    expect(path()).toEqual(original);
  });

  it('approaches a reconnected bottom anchor from outside the target', () => {
    const { editor, id, arrow, end, path } = setup();
    const target = editor.createShape({ type: 'box', x: 360, y: 60, props: { w: 100, h: 80 } });
    editor.createBinding(buildArrowBindingRecord({ fromId: id, toId: target, terminal: 'end',
      normalizedAnchor: { x: 0, y: 0.5 } }));
    editor.updateShape<ArrowShape>(id, { props: { ...arrow().props, manualRoute: [
      { x: 160, y: 100, kind: 'segment' }, { x: 160, y: 185, kind: 'segment' },
      { x: 320, y: 185, kind: 'segment' }, { x: 320, y: 100, kind: 'segment' },
    ] } });
    const bottom = { x: 410, y: 140 };
    editor.dispatchEvent({ type: 'pointerDown', point: end, target: 'handle', handleId: 'end', shiftKey: false });
    editor.dispatchEvent({ type: 'pointerMove', point: bottom });
    const assertApproach = () => {
      const route = path();
      expect(route.at(-1)).toEqual(bottom);
      expect(route.at(-2)!.x).toBe(bottom.x);
      expect(route.at(-2)!.y).toBeGreaterThan(bottom.y);
      expect(route.slice(1).every((point, index) => {
        const previous = route[index]!;
        if (point.x === previous.x) {
          return point.x <= 360 || point.x >= 460 || Math.max(point.y, previous.y) <= 60 || Math.min(point.y, previous.y) >= 140;
        }
        return point.y === previous.y && (point.y <= 60 || point.y >= 140 ||
          Math.max(point.x, previous.x) <= 360 || Math.min(point.x, previous.x) >= 460);
      })).toBe(true);
    };
    assertApproach();
    editor.dispatchEvent({ type: 'pointerUp', point: bottom });
    expect(arrow().props.end.boundShapeId).toBe(target);
    assertApproach();

    // Rotate the target into the original detour. The bottom anchor follows
    // the shape, and the connector bypasses the rotated rectangle.
    const angle = Math.PI / 4;
    editor.updateShape(target, { rotation: angle });
    const rotated = path();
    const anchor = rotated.at(-1)!;
    expect(anchor.x).toBeCloseTo(410 - 40 * Math.sin(angle));
    expect(anchor.y).toBeCloseTo(100 + 40 * Math.cos(angle));
    for (let index = 1; index < rotated.length; index++) {
      const a = rotated[index - 1]!;
      const b = rotated[index]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
      for (let sample = 0; sample <= 100; sample++) {
        const dx = a.x + (b.x - a.x) * sample / 100 - 410;
        const dy = a.y + (b.y - a.y) * sample / 100 - 100;
        const x = dx * Math.cos(angle) + dy * Math.sin(angle);
        const y = -dx * Math.sin(angle) + dy * Math.cos(angle);
        expect(Math.abs(x) < 50 - 1e-6 && Math.abs(y) < 40 - 1e-6).toBe(false);
      }
    }
  });

  it('prunes collapsed bends when reconnecting and restores them on undo', () => {
    const { editor, id, arrow, end, path } = setup();
    const target = editor.createShape({ type: 'box', x: 420, y: 120, props: { w: 80, h: 60 } });
    const manualRoute = [
      { x: 150, y: 100 }, { x: 150, y: 150 }, { x: 300, y: 150 }, { x: 300, y: 100 },
    ].map(point => ({ ...point, kind: 'segment' as const }));
    editor.updateShape<ArrowShape>(id, { props: { ...arrow().props, manualRoute } });
    editor.dispatchEvent({ type: 'pointerDown', point: end, target: 'handle', handleId: 'end', shiftKey: false });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 420, y: 150 } });
    const preview = path();
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 420, y: 150 } });
    expect(path()).toEqual(preview);
    expect(arrow().props.end.boundShapeId).toBe(target);
    expect(arrow().props.manualRoute).toEqual(manualRoute.slice(0, 2));

    editor.undo();
    expect(arrow().props.end.boundShapeId).toBeNull();
    expect(arrow().props.manualRoute).toEqual(manualRoute);
    editor.redo();
    editor.replaceDocument(JSON.parse(JSON.stringify(editor.serialize())));
    editor.updateShape(target, { y: 240 });
    expect(path()).toEqual([
      { x: 100, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 270 }, { x: 420, y: 270 },
    ]);
  });

  it.each(['start', 'end', 'neither'] as const)('routes diagonally offset free endpoints with only right angles (%s bound)', bound => {
    const { editor, id, arrow, path } = setup();
    editor.updateShape<ArrowShape>(id, { props: { ...arrow().props,
      end: { ...arrow().props.end, point: { x: 260, y: 170 } },
    } });
    if (bound !== 'neither') {
      const target = editor.createShape({ type: 'box', x: bound === 'start' ? 60 : 320,
        y: bound === 'start' ? 40 : 260, props: { w: 80, h: 60 } });
      editor.createBinding(buildArrowBindingRecord({ fromId: id, toId: target, terminal: bound,
        normalizedAnchor: { x: 0.5, y: 1 } }));
      editor.updateShape(target, { y: bound === 'start' ? 45 : 265 });
    }
    const points = path();
    expect(points.length).toBeGreaterThan(2);
    expect(points[0]).toEqual(editor.localToPage(id, arrow().props.start.point));
    expect(points.at(-1)).toEqual(editor.localToPage(id, arrow().props.end.point));
    expect(points.slice(1).every((p, index) => p.x === points[index]!.x || p.y === points[index]!.y)).toBe(true);
    expect(getOrthoHandles(editor, arrow()).some(handle => handle.moveAxis)).toBe(true);
  });

  it.each([false, true])('drags a straight connector with fixed endpoints (vertical: %s)', vertical => {
    const { editor, start, end, arrow, path, down } = setup(vertical);
    const handle = getOrthoHandles(editor, arrow())[0]!;
    const pointer = { x: handle.point.x + 45, y: handle.point.y + 32 };
    down(handle);
    editor.dispatchEvent({ type: 'pointerMove', point: pointer });
    const preview = path();
    expect(preview).toHaveLength(6);
    expect(preview[0]).toEqual(start);
    expect(preview.at(-1)).toEqual(end);
    expect(preview[2]![vertical ? 'x' : 'y']).toBe(pointer[vertical ? 'x' : 'y']);
    editor.dispatchEvent({ type: 'pointerUp', point: pointer });
    expect(path()).toEqual(preview);
    editor.undo();
    expect(path()).toEqual([start, end]);
    editor.redo();
    expect(path()).toEqual(preview);
    editor.replaceDocument(JSON.parse(JSON.stringify(editor.serialize())));
    expect(path()).toEqual(preview);
  });

  it('inserts, moves and removes a waypoint without changing endpoint bindings', () => {
    const { editor, id, arrow, start, end, path, down } = setup();
    const midpoint = { x: 220, y: start.y };
    const add = getOrthoRouteMenu(editor, arrow(), midpoint)!.add!;
    editor.updateShape<ArrowShape>(id, { props: { ...arrow().props, manualRoute: add } });
    expect(path()).toEqual([start, midpoint, end]);
    const waypoint = getOrthoHandles(editor, arrow()).find(h => !h.moveAxis)!;
    const point = { x: midpoint.x + 20, y: midpoint.y + 45 };
    down(waypoint);
    editor.dispatchEvent({ type: 'pointerMove', point });
    expect(path()).toContainEqual(point);
    editor.dispatchEvent({ type: 'keyDown', key: 'Escape' });
    expect(path()).toEqual([start, midpoint, end]);
    down(waypoint);
    editor.dispatchEvent({ type: 'pointerUp', point });
    expect(getOrthoRouteMenu(editor, arrow(), point)?.remove).toBeNull();
  });

  it.each([100, 165])('adds a second waypoint without promoting generated bends (first waypoint y: %s)', y => {
    const { editor, id, arrow, path } = setup();
    const source = editor.createShape({ type: 'box', x: 20, y: 60, props: { w: 80, h: 80 } });
    const target = editor.createShape({ type: 'box', x: 360, y: 60, props: { w: 80, h: 80 } });
    editor.createBinding(buildArrowBindingRecord({ fromId: id, toId: source, terminal: 'start',
      normalizedAnchor: { x: 1, y: 0.5 } }));
    editor.createBinding(buildArrowBindingRecord({ fromId: id, toId: target, terminal: 'end',
      normalizedAnchor: { x: 0, y: 0.5 } }));
    editor.updateShape(source, { y: 59 });
    editor.updateShape(source, { y: 60 });
    editor.updateShape(target, { y: 59 });
    editor.updateShape(target, { y: 60 });
    const first = { x: 220, y, kind: 'waypoint' } as const;
    const second = { x: 160, y: 100, kind: 'waypoint' } as const;
    editor.updateShape<ArrowShape>(id, { props: { ...arrow().props, manualRoute: [first] } });

    const add = getOrthoRouteMenu(editor, arrow(), second)?.add;
    expect(add?.filter(point => point.kind === 'waypoint')).toEqual([second, first]);
    editor.updateShape<ArrowShape>(id, { props: { ...arrow().props, manualRoute: add! } });
    expect(path()).toContainEqual({ x: first.x, y: first.y });
    expect(getOrthoRouteMenu(editor, arrow(), { x: first.x, y: 100 })?.remove)
      .toEqual(y === 100 ? [second] : undefined);
    const remaining = getOrthoRouteMenu(editor, arrow(), first)?.remove;
    expect(remaining?.filter(point => point.kind === 'waypoint')).toEqual([second]);
  });

  it.each([false, true])('merges a collapsed detour into one draggable segment (vertical: %s)', vertical => {
    const { editor, id, arrow, start, end, path, down } = setup(vertical);
    const axis = vertical ? 'x' : 'y';
    const handle = getOrthoHandles(editor, arrow())[0]!;
    down(handle);
    editor.dispatchEvent({ type: 'pointerUp', point: { ...handle.point, [axis]: start[axis] + 60 } });
    const detour = path();
    const offsetHandle = getOrthoHandles(editor, arrow()).find(h => h.point[axis] === start[axis] + 60 && h.moveAxis === axis)!;
    down(offsetHandle);
    editor.dispatchEvent({ type: 'pointerUp', point: { ...offsetHandle.point, [axis]: start[axis] + 1 } });
    expect(path()).toEqual([start, end]);
    expect(getOrthoHandles(editor, arrow())).toEqual([handle]);
    expect(arrow().props.manualRoute).toBeNull();
    editor.undo();
    expect(path()).toEqual(detour);
    editor.redo();
    down(getOrthoHandles(editor, arrow())[0]!);
    editor.dispatchEvent({ type: 'pointerUp', point: { ...handle.point, [axis]: start[axis] - 55 } });
    expect(path()).toContainEqual(expect.objectContaining({ [axis]: start[axis] - 55 }));

    // The waypoint and the merged run have independent grips.
    const waypoint = { ...handle.point, kind: 'waypoint' as const };
    editor.updateShape<ArrowShape>(id, { props: { ...arrow().props, manualRoute: [waypoint] } });
    const controls = getOrthoHandles(editor, arrow());
    expect(controls).toContainEqual({ id: 'ortho-waypoint-0', point: handle.point });
    const segment = controls.find(h => h.moveAxis);
    expect(segment?.moveAxis).toBe(axis);
    expect(segment?.point[axis]).toBe(waypoint[axis]);
    expect(Math.hypot(segment!.point.x - waypoint.x, segment!.point.y - waypoint.y)).toBeGreaterThanOrEqual(17);
    down(segment!);
    editor.dispatchEvent({ type: 'pointerUp', point: { ...segment!.point, [axis]: start[axis] + 45 } });
    expect(arrow().props.manualRoute).toContainEqual({ ...waypoint, [axis]: start[axis] + 45 });
    editor.undo();
    const square = getOrthoHandles(editor, arrow()).find(h => !h.moveAxis)!;
    down(square);
    editor.dispatchEvent({ type: 'pointerUp', point: { x: square.point.x + 25, y: square.point.y + 30 } });
    expect(arrow().props.manualRoute).toEqual([{ x: waypoint.x + 25, y: waypoint.y + 30, kind: 'waypoint' }]);
  });

  it.each(['start', 'end'] as const)('moves the %s leg of a bound elbow without adding a waypoint', terminal => {
    const { editor, id, arrow, path, down } = setup();
    const source = editor.createShape({ type: 'box', x: 20, y: 70, props: { w: 80, h: 60 } });
    const target = editor.createShape({ type: 'box', x: 320, y: 290, props: { w: 80, h: 60 } });
    editor.createBinding(buildArrowBindingRecord({ fromId: id, toId: source, terminal: 'start', normalizedAnchor: { x: 1, y: 0.5 } }));
    editor.createBinding(buildArrowBindingRecord({ fromId: id, toId: target, terminal: 'end', normalizedAnchor: { x: 0.5, y: 0 } }));
    editor.updateShape(target, { y: 300 });
    const before = path();
    const handles = getOrthoHandles(editor, arrow());
    const handle = terminal === 'start' ? handles[0]! : handles.at(-1)!;
    const axis = terminal === 'start' ? 'y' : 'x';
    expect(handle.moveAxis).toBe(axis);
    const point = { ...handle.point, [axis]: handle.point[axis] + 40 };
    down(handle);
    editor.dispatchEvent({ type: 'pointerUp', point });
    const after = path();
    expect(after[0]).toEqual(before[0]);
    expect(after.at(-1)).toEqual(before.at(-1));
    expect(after.filter(p => p[axis] === point[axis])).toHaveLength(2);
    expect(arrow().props.manualRoute?.every(p => p.kind !== 'waypoint')).toBe(true);
    editor.undo();
    expect(path()).toEqual(before);
  });

  it('keeps the detour in place through an endpoint move and carries it with its group', () => {
    const { editor, id, arrow, end, path } = setup();
    const source = editor.createShape({ type: 'box', x: 20, y: 70, props: { w: 80, h: 60 } });
    editor.createBinding(buildArrowBindingRecord({ fromId: id, toId: source, terminal: 'start', normalizedAnchor: { x: 1, y: 0.5 } }));
    const detour: Vec2[] = [{ x: 200, y: 100 }, { x: 200, y: 180 }, { x: 300, y: 180 }, { x: 300, y: 100 }];
    editor.updateShape<ArrowShape>(id, { props: {
      ...arrow().props, manualRoute: detour.map(p => ({ ...p, kind: 'segment' })),
    } });
    editor.updateShape(source, { x: 40 });
    expect(path()).toEqual([{ x: 120, y: 100 }, ...detour, end]);
    const before = path();
    const group = editor.groupShapes([source, id]);
    expect(path()).toEqual(before);
    editor.updateShape(group, { x: editor.getShape(group)!.x + 50 });
    const translated = before.map(p => ({ ...p, x: p.x + 50 }));
    expect(path()).toEqual(translated);
    editor.ungroupShapes([group]);
    expect(path()).toEqual(translated);
  });
});

it('draws and edits a separate straight line without binding its endpoints', () => {
  const editor = createEditor({
    plugins: [LinePlugin, { id: 'boxes', shapes: [BoxUtil] }], tools: [SelectTool, LineTool],
  });
  const box = editor.createShape({ type: 'box', x: 60, y: 70, props: { w: 80, h: 60 } });
  editor.setCurrentTool('line');
  const start = { x: 140, y: 100 };
  const end = { x: 360, y: 220 };
  editor.dispatchEvent({ type: 'pointerDown', point: start, target: 'shape', shapeId: box, shiftKey: false });
  editor.dispatchEvent({ type: 'pointerUp', point: end });
  const [id] = editor.getSelectedShapeIds();
  const line = () => editor.getShape<LineShape>(id!)!;
  expect(line().type).toBe('line');
  expect(editor.getBindingsFromShape(id!)).toEqual([]);
  expect(editor.transforms.getConnectionAnchors(id!)).toEqual([]);
  expect(editor.transforms.getWorldOutline(id!)).toEqual([start, end]);

  editor.dispatchEvent({ type: 'pointerDown', point: end, target: 'handle', handleId: 'end', shiftKey: false });
  editor.dispatchEvent({ type: 'pointerUp', point: { x: 260, y: 280 } });
  expect(editor.transforms.getWorldOutline(id!)).toEqual([start, { x: 260, y: 280 }]);
  editor.undo();
  expect(editor.transforms.getWorldOutline(id!)).toEqual([start, end]);
  editor.replaceDocument(JSON.parse(JSON.stringify(editor.serialize())));
  expect(editor.transforms.getWorldOutline(id!)).toEqual([start, end]);
});
