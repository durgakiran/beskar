// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { createEditor, type GlidePlugin } from './editor';
import { BoxUtil } from './shapes/BoxUtil';
import { FrameUtil } from './shapes/FrameUtil';
import { GroupUtil } from './shapes/GroupUtil';
import { sid, type ShapeId } from './types';

const plugin: GlidePlugin = { id: 'arrange', shapes: [BoxUtil as any, FrameUtil as any, GroupUtil as any] };
const makeEditor = () => createEditor({ plugins: [plugin] });

function box(editor: ReturnType<typeof makeEditor>, id: string, x: number, y: number, w = 60, h = 40, parentId?: ShapeId) {
  return editor.createShape({ id: sid(id), type: 'box', x, y, ...(parentId ? { parentId } : {}), props: { w, h } });
}

describe('arrange and precision commands', () => {
  it('aligns nested shapes in page space as one undoable command', () => {
    const editor = makeEditor();
    const frame = editor.createShape({ type: 'frame', x: 200, y: 100, rotation: Math.PI / 6, props: { w: 300, h: 200 } });
    const nested = box(editor, 'shape:nested', 30, 20, 60, 40, frame);
    const root = box(editor, 'shape:root', 40, 260);
    const before = editor.getShape(nested)!;

    editor.alignShapes([nested, root], 'left');
    expect(editor.getShapeVisualWorldBounds(nested).minX)
      .toBeCloseTo(editor.getShapeVisualWorldBounds(root).minX, 7);

    editor.undo();
    expect(editor.getShape(nested)).toMatchObject({ x: before.x, y: before.y });
  });

  it('distributes unequal shapes using equal page-space gaps', () => {
    const editor = makeEditor();
    const first = box(editor, 'shape:first', 0, 0, 40, 40);
    const middle = box(editor, 'shape:middle', 110, 0, 80, 40);
    const last = box(editor, 'shape:last', 300, 0, 60, 40);
    editor.distributeShapes([first, middle, last], 'horizontal', 'gaps');
    const boxes = [first, middle, last].map(id => editor.getShapeVisualWorldBounds(id));
    expect(boxes[1]!.minX - boxes[0]!.maxX).toBeCloseTo(boxes[2]!.minX - boxes[1]!.maxX, 7);
  });

  it('matches intrinsic size while preserving each shape center', () => {
    const editor = makeEditor();
    const first = box(editor, 'shape:first', 20, 30, 50, 30);
    const reference = box(editor, 'shape:reference', 220, 120, 120, 80);
    editor.updateShape(first, { rotation: Math.PI / 5 });
    const before = editor.localToPage(first, { x: 25, y: 15 });

    editor.matchShapeSizes([first, reference], 'both');

    expect(editor.getShapeLocalBounds(first)).toMatchObject({ w: 120, h: 80 });
    const after = editor.localToPage(first, { x: 60, y: 40 });
    expect(after.x).toBeCloseTo(before.x, 7);
    expect(after.y).toBeCloseTo(before.y, 7);
  });

  it('flips an arrangement and keeps subtree geometry owned by its selected group', () => {
    const editor = makeEditor();
    const first = box(editor, 'shape:first', 20, 20);
    const second = box(editor, 'shape:second', 120, 20);
    const group = editor.groupShapes([first, second]);
    const other = box(editor, 'shape:other', 400, 20);
    const childOffset = editor.getShape(second)!.x - editor.getShape(first)!.x;

    editor.flipShapes([group, first, other], 'horizontal');

    expect(editor.getShape(second)!.x - editor.getShape(first)!.x).toBeCloseTo(childOffset, 7);
    expect(editor.getShapeVisualWorldBounds(group).minX).toBeGreaterThan(editor.getShapeVisualWorldBounds(other).minX);
  });

  it('supports page-space nudging and precise geometry', () => {
    const editor = makeEditor();
    const id = box(editor, 'shape:box', 40, 50, 60, 40);
    const before = editor.getShapeVisualWorldBounds(id);
    editor.nudgeShapes([id], { x: 10, y: -4 });
    expect(editor.getShapeVisualWorldBounds(id).minX).toBeCloseTo(before.minX + 10, 7);
    expect(editor.getShapeVisualWorldBounds(id).minY).toBeCloseTo(before.minY - 4, 7);

    editor.setShapePrecision(id, { x: 100, y: 120 });
    expect(editor.getShapeVisualWorldBounds(id)).toMatchObject({ minX: 100, minY: 120 });
    editor.setShapePrecision(id, { w: 150, lockAspect: true });
    expect(editor.getShapeLocalBounds(id).w).toBeCloseTo(150, 7);
    expect(editor.getShapeLocalBounds(id).h).toBeCloseTo(100, 7);
    editor.setShapePrecision(id, { rotation: Math.PI / 2 });
    expect(editor.getShape(id)!.rotation).toBeCloseTo(Math.PI / 2, 7);
  });
});
