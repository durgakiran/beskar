// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { createEditor, type GlidePlugin } from './editor';
import { BoxUtil } from './shapes/BoxUtil';
import { FrameUtil } from './shapes/FrameUtil';
import { GroupUtil } from './shapes/GroupUtil';
import { FrameTool } from './tools/FrameTool';
import { SelectTool } from './tools/SelectTool';
import { sid, type ShapeId, type Vec2 } from './types';

const plugin: GlidePlugin = { id: 'hierarchy', shapes: [BoxUtil as any, FrameUtil as any, GroupUtil as any] };
const makeEditor = () => createEditor({ plugins: [plugin] });

function box(editor: ReturnType<typeof makeEditor>, id: string, x: number, y: number, parentId?: ShapeId) {
  return editor.createShape({ id: sid(id), type: 'box', x, y, ...(parentId ? { parentId } : {}), props: { w: 60, h: 40 } });
}

function worldCorners(editor: ReturnType<typeof makeEditor>, id: ShapeId): Vec2[] {
  return [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 }]
    .map(point => editor.localToPage(id, point));
}

function expectPoints(actual: Vec2[], expected: Vec2[]) {
  actual.forEach((point, index) => {
    expect(point.x).toBeCloseTo(expected[index]!.x, 7);
    expect(point.y).toBeCloseTo(expected[index]!.y, 7);
  });
}

describe('hierarchy commands', () => {
  it('groups and ungroups rotated siblings without moving them, one undo step each', () => {
    const editor = makeEditor();
    const first = box(editor, 'shape:first', 80, 60);
    const second = box(editor, 'shape:second', 220, 130);
    editor.updateShape(first, { rotation: Math.PI / 5 });
    const before = new Map([[first, worldCorners(editor, first)], [second, worldCorners(editor, second)]]);

    const group = editor.groupShapes([first, second]);
    expect(editor.getShape(group)?.type).toBe('group');
    expect(editor.getShape(first)?.parentId).toBe(group);
    expectPoints(worldCorners(editor, first), before.get(first)!);
    expectPoints(worldCorners(editor, second), before.get(second)!);

    editor.undo();
    expect(editor.getShape(group)).toBeUndefined();
    expectPoints(worldCorners(editor, first), before.get(first)!);

    editor.redo();
    editor.ungroupShapes([group]);
    expect(editor.getShape(group)).toBeUndefined();
    expectPoints(worldCorners(editor, first), before.get(first)!);
    expectPoints(worldCorners(editor, second), before.get(second)!);
  });

  it('rejects incompatible grouping without changing the document', () => {
    const editor = makeEditor();
    const frame = editor.createShape({ type: 'frame', x: 0, y: 0, props: { w: 200, h: 120 } });
    const child = box(editor, 'shape:child', 10, 10, frame);
    const root = box(editor, 'shape:root', 300, 20);
    const before = editor.serialize();
    expect(() => editor.groupShapes([child, root])).toThrow('siblings');
    expect(editor.serialize()).toEqual(before);
  });

  it('removes a frame while preserving direct child world geometry', () => {
    const editor = makeEditor();
    const frame = editor.createShape({ type: 'frame', x: 120, y: 80, rotation: Math.PI / 4, props: { w: 240, h: 160 } });
    const child = box(editor, 'shape:child', 30, 20, frame);
    const before = worldCorners(editor, child);

    editor.removeFramesKeepContent([frame]);

    expect(editor.getShape(frame)).toBeUndefined();
    expect(editor.getShape(child)?.parentId).toBe(editor.getDefaultPageId());
    expectPoints(worldCorners(editor, child), before);
  });

  it('copies and pastes a complete group hierarchy', () => {
    const editor = makeEditor();
    const first = box(editor, 'shape:first', 20, 20);
    const second = box(editor, 'shape:second', 100, 20);
    const group = editor.groupShapes([first, second]);
    editor.copy([group]);
    const [copy] = editor.paste({ x: 300, y: 200 });
    const copiedChildren = editor.getChildren(copy!);
    expect(editor.getShape(copy!)?.type).toBe('group');
    expect(copiedChildren).toHaveLength(2);
    expect(copiedChildren.every(child => child.parentId === copy)).toBe(true);
  });

  it('inherits lock and visibility and excludes hidden descendants from hit tests and export', () => {
    const editor = makeEditor();
    const frame = editor.createShape({ type: 'frame', x: 50, y: 50, props: { w: 200, h: 120 } });
    const child = box(editor, 'shape:child', 20, 20, frame);
    editor.setLocked([frame], true);
    expect(editor.isShapeEffectivelyLocked(child)).toBe(true);
    expect(editor.getSelectableShapeId(child)).toBe(child);
    editor.setSelectedShapeIds([frame]);
    expect(editor.getSelectedShapeIds()).toEqual([frame]);
    expect(() => editor.updateShape(child, { x: 30 })).toThrow('locked');

    editor.setLocked([frame], false);
    editor.setHidden([frame], true);
    expect(editor.isShapeEffectivelyHidden(child)).toBe(true);
    expect(editor.getShapesAtPoint(editor.localToPage(child, { x: 10, y: 10 })).map(shape => shape.id)).not.toContain(child);
    expect(editor.exportToSvg([frame])).not.toContain('shape:child');
  });

  it('clips hit testing outside a clipping frame', () => {
    const editor = makeEditor();
    const frame = editor.createShape({ type: 'frame', x: 50, y: 50, props: { w: 100, h: 100, clipContent: true } });
    const child = box(editor, 'shape:child', 80, 30, frame);
    expect(editor.getShapesAtPoint({ x: 140, y: 90 }).map(shape => shape.id)).toContain(child);
    expect(editor.getShapesAtPoint({ x: 170, y: 90 }).map(shape => shape.id)).not.toContain(child);
  });

  it('uses explicit group drill-in selection context', () => {
    const editor = makeEditor();
    const first = box(editor, 'shape:first', 20, 20);
    const second = box(editor, 'shape:second', 100, 20);
    const group = editor.groupShapes([first, second]);
    expect(editor.getSelectableShapeId(first)).toBe(group);
    expect(editor.enterGroup(group)).toBe(true);
    expect(editor.getSelectableShapeId(first)).toBe(first);
    expect(editor.exitGroup()).toBe(true);
    expect(editor.focusedGroupId.peek()).toBeNull();
  });

  it('selects the outer group when a child receives a single click', () => {
    const editor = createEditor({ plugins: [plugin], tools: [SelectTool] });
    editor.setCurrentTool('select');
    const first = box(editor, 'shape:first', 20, 20);
    const second = box(editor, 'shape:second', 120, 20);
    const group = editor.groupShapes([first, second]);
    editor.setSelectedShapeIds([]);

    const point = editor.localToPage(first, { x: 30, y: 20 });
    editor.dispatchEvent({ type: 'pointerDown', point, target: 'shape', shapeId: first, shiftKey: false });
    editor.dispatchEvent({ type: 'pointerUp', point, shiftKey: false });

    expect(editor.getSelectedShapeIds()).toEqual([group]);
  });

  it('keeps group selection geometry stable across repeated rotations', () => {
    const editor = makeEditor();
    const first = box(editor, 'shape:first', 20, 20);
    const second = box(editor, 'shape:second', 140, 80);
    editor.updateShape(second, { rotation: Math.PI / 6 });
    const group = editor.groupShapes([first, second]);
    const initial = editor.getShapeLocalBounds(group);

    for (const rotation of [Math.PI / 6, Math.PI / 3, Math.PI, Math.PI * 1.75, 0]) {
      editor.updateShape(group, { rotation });
      const bounds = editor.getShapeLocalBounds(group);
      expect(bounds.x).toBeCloseTo(initial.x, 7);
      expect(bounds.y).toBeCloseTo(initial.y, 7);
      expect(bounds.w).toBeCloseTo(initial.w, 7);
      expect(bounds.h).toBeCloseTo(initial.h, 7);
    }
  });

  it('captures a dropped shape into a frame and undoes movement and reparenting together', () => {
    const editor = createEditor({ plugins: [plugin], tools: [SelectTool] });
    editor.setCurrentTool('select');
    const frame = editor.createShape({ type: 'frame', x: 300, y: 100, props: { w: 240, h: 160 } });
    const child = box(editor, 'shape:child', 20, 20);
    const before = worldCorners(editor, child);
    editor.setSelectedShapeIds([child]);
    editor.dispatchEvent({ type: 'pointerDown', point: { x: 30, y: 30 }, target: 'shape', shapeId: child, shiftKey: false });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 360, y: 150 } });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 360, y: 150 } });

    expect(editor.getShape(child)?.parentId).toBe(frame);
    editor.undo();
    expect(editor.getShape(child)?.parentId).toBe(editor.getDefaultPageId());
    expectPoints(worldCorners(editor, child), before);
  });

  it('creates frames through the frame tool', () => {
    const editor = createEditor({ plugins: [plugin], tools: [SelectTool, FrameTool] });
    editor.setCurrentTool('frame');
    editor.dispatchEvent({ type: 'pointerDown', point: { x: 40, y: 50 }, target: 'canvas', shiftKey: false });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 240, y: 170 } });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 240, y: 170 } });
    const frame = editor.getShapes().find(shape => shape.type === 'frame');
    expect(frame).toMatchObject({
      x: 40,
      y: 50,
      props: expect.objectContaining({ w: 200, h: 120, label: 'Frame', color: '#313244', clipContent: false }),
    });
  });

  it('resizes group descendants through their shape resize contracts', () => {
    const editor = createEditor({ plugins: [plugin], tools: [SelectTool] });
    editor.setCurrentTool('select');
    const first = box(editor, 'shape:first', 20, 20);
    const second = box(editor, 'shape:second', 100, 60);
    const group = editor.groupShapes([first, second]);
    const before = editor.getShapeWorldBounds(group);
    editor.setSelectedShapeIds([group]);
    editor.dispatchEvent({ type: 'pointerDown', point: { x: before.maxX, y: before.maxY }, target: 'handle', handleId: 'se', shiftKey: false });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: before.maxX + 80, y: before.maxY + 40 } });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: before.maxX + 80, y: before.maxY + 40 } });
    const after = editor.getShapeWorldBounds(group);
    expect(after.w).toBeGreaterThan(before.w);
    expect(after.h).toBeGreaterThan(before.h);
    expect((editor.getShape(first)!.props as any).w).toBeGreaterThan(60);
  });

  it('resizes rotated groups proportionally from corner handles', () => {
    const editor = createEditor({ plugins: [plugin], tools: [SelectTool] });
    editor.setCurrentTool('select');
    const first = box(editor, 'shape:first', 20, 20);
    const second = box(editor, 'shape:second', 140, 80);
    const group = editor.groupShapes([first, second]);
    editor.updateShape(group, { rotation: Math.PI / 5 });
    const groupBefore = editor.getShapeLocalBounds(group);
    const firstBefore = editor.getShape(first)!;
    const handle = editor.localToPage(group, {
      x: groupBefore.maxX,
      y: groupBefore.maxY,
    });
    const cursor = editor.localToPage(group, {
      x: groupBefore.maxX + 100,
      y: groupBefore.maxY + 50,
    });

    editor.dispatchEvent({ type: 'pointerDown', point: handle, target: 'handle', handleId: 'se', shiftKey: false });
    editor.dispatchEvent({ type: 'pointerMove', point: cursor });
    editor.dispatchEvent({ type: 'pointerUp', point: cursor });

    const groupAfter = editor.getShapeLocalBounds(group);
    const firstAfter = editor.getShape(first)!;
    const widthScale = groupAfter.w / groupBefore.w;
    const heightScale = groupAfter.h / groupBefore.h;
    expect(widthScale).toBeCloseTo(heightScale, 7);
    expect((firstAfter.props as any).w / (firstAfter.props as any).h)
      .toBeCloseTo((firstBefore.props as any).w / (firstBefore.props as any).h, 7);
    expect(firstAfter.rotation).toBeCloseTo(firstBefore.rotation, 7);
  });

  it('ignores side resize handles for groups', () => {
    const editor = createEditor({ plugins: [plugin], tools: [SelectTool] });
    editor.setCurrentTool('select');
    const first = box(editor, 'shape:first', 20, 20);
    const second = box(editor, 'shape:second', 140, 80);
    const group = editor.groupShapes([first, second]);
    const before = editor.getShapes();
    const bounds = editor.getShapeWorldBounds(group);
    editor.setSelectedShapeIds([group]);

    editor.dispatchEvent({ type: 'pointerDown', point: { x: bounds.maxX, y: bounds.minY + bounds.h / 2 }, target: 'handle', handleId: 'e', shiftKey: false });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: bounds.maxX - 100, y: bounds.minY + bounds.h / 2 } });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: bounds.maxX - 100, y: bounds.minY + bounds.h / 2 } });

    expect(editor.getShapes()).toEqual(before);
    expect(editor.getShapeUtil('group').getResizeHandles(editor.getShape(group) as any))
      .toEqual(['nw', 'ne', 'se', 'sw']);
  });

  it('resizes frames without scaling their children', () => {
    const editor = createEditor({ plugins: [plugin], tools: [SelectTool] });
    editor.setCurrentTool('select');
    const frame = editor.createShape({ type: 'frame', x: 100, y: 100, props: { w: 200, h: 120 } });
    const child = box(editor, 'shape:child', 20, 20, frame);
    const childBefore = worldCorners(editor, child);
    editor.setSelectedShapeIds([frame]);
    editor.dispatchEvent({ type: 'pointerDown', point: { x: 300, y: 220 }, target: 'handle', handleId: 'se', shiftKey: false });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 380, y: 280 } });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 380, y: 280 } });
    expect((editor.getShape(frame)!.props as any).w).toBeCloseTo(280);
    expectPoints(worldCorners(editor, child), childBefore);
  });
});
