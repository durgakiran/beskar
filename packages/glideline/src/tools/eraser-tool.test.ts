// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createEditor } from '../editor.js';
import { BoxUtil } from '../shapes/BoxUtil.js';
import { FreehandPlugin, type FreehandShape } from '../shapes/FreehandUtil.js';
import { GroupUtil } from '../shapes/GroupUtil.js';
import { EraserTool, PartialEraserTool, WholeStrokeEraserTool } from './EraserTool.js';
import { AreaEraserTool } from './AreaEraserTool.js';
import { getAreaEraseCuts, getAreaEraseMaskPaths } from '../area-erase-mask.js';
import type { ShapeId, Vec2 } from '../types.js';

function createBoard() {
  return createEditor({
    plugins: [FreehandPlugin, { id: 'test-shapes', shapes: [BoxUtil, GroupUtil] }],
    tools: [EraserTool, WholeStrokeEraserTool, PartialEraserTool, AreaEraserTool],
  });
}

type Editor = ReturnType<typeof createBoard>;

function stroke(editor: Editor, y: number, parentId?: ShapeId): ShapeId {
  return editor.createShape({
    type: 'freehand',
    x: 0, y,
    ...(parentId ? { parentId } : {}),
    props: {
      points: [{ x: 0, y, pressure: 0.2 }, { x: 100, y, pressure: 0.8 }],
      color: 'blue', strokeWidth: 'thick', pressureSensitive: true, isComplete: true,
    },
  });
}

function press(editor: Editor, point: Vec2) {
  editor.dispatchEvent({ type: 'pointerDown', point, target: 'canvas', shiftKey: false });
}

function release(editor: Editor, point: Vec2) {
  editor.dispatchEvent({ type: 'pointerUp', point });
}

describe('Erase area', () => {
  it('can erase the outer lines of a wrapped label on an unfilled shape', () => {
    const measure = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      const editor = createBoard();
      const label = 'Alpha bravo charlie delta echo foxtrot';
      const id = editor.createShape({
        type: 'box', x: 0, y: 0, props: { w: 122, h: 150, fillStyle: 'none', label },
      });
      editor.setCurrentTool('area-eraser');
      for (const [index, y] of [43, 107].entries()) {
        press(editor, { x: 61, y });
        expect(editor.areaErasePreviews.peek().has(id)).toBe(true);
        release(editor, { x: 61, y });
        expect(getAreaEraseCuts(editor.getShape(id)!)).toHaveLength(index + 1);
      }
      expect(editor.getShape(id)?.props.label).toBe(label);
    } finally {
      measure.mockRestore();
    }
  });

  it('previews a cut in the topmost painted shape and saves it as one undo step', () => {
    const editor = createBoard();
    const behind = editor.createShape({ type: 'box', x: 0, y: 0, props: { fillStyle: 'solid' } });
    const front = editor.createShape({ type: 'box', x: 0, y: 0, props: { fillStyle: 'solid' } });
    const original = editor.getShape(front)!;
    editor.setCurrentTool('area-eraser');
    press(editor, { x: 30, y: 30 });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 80, y: 30 } });
    expect([...editor.areaErasePreviews.peek().keys()]).toEqual([front]);
    expect(getAreaEraseCuts(editor.getShape(front)!)).toEqual([]);
    release(editor, { x: 80, y: 30 });
    expect(editor.areaErasePreviews.peek().size).toBe(0);
    expect(getAreaEraseCuts(editor.getShape(behind)!)).toEqual([]);
    const erased = editor.getShape(front)!;
    expect(erased.props).toEqual(original.props);
    expect(getAreaEraseCuts(erased)).toHaveLength(1);
    expect(editor.exportToSvg([front])).toContain('mask="url(#area-erase-0)"');

    const reopened = createBoard();
    reopened.deserialize(JSON.parse(JSON.stringify(editor.serialize())));
    expect(getAreaEraseCuts(reopened.getShape(front)!)).toEqual(getAreaEraseCuts(erased));
    const paths = () => getAreaEraseMaskPaths(getAreaEraseCuts(reopened.getShape(front)!), reopened.getShapeLocalBounds(front));
    const beforeResize = paths()[0]!;
    reopened.updateShape(front, { x: 50, rotation: Math.PI / 2, props: { ...erased.props, w: 200 } });
    expect(paths()[0]!.d).toBe(beforeResize.d);
    expect(paths()[0]!.transform).not.toBe(beforeResize.transform);

    editor.undo();
    expect(editor.getShape(front)).toEqual(original);
    editor.redo();
    expect(editor.getShape(front)).toEqual(erased);
  });

  it('cuts through previously erased areas on a later gesture and respects locked content', () => {
    const editor = createBoard();
    const behind = editor.createShape({ type: 'box', x: 0, y: 0, props: { fillStyle: 'solid' } });
    const front = editor.createShape({ type: 'box', x: 0, y: 0, props: { fillStyle: 'solid' } });
    editor.setCurrentTool('area-eraser');
    const point = { x: 40, y: 40 };
    press(editor, point);
    release(editor, point);
    press(editor, point);
    expect([...editor.areaErasePreviews.peek().keys()]).toEqual([behind]);
    editor.dispatchEvent({ type: 'keyDown', key: 'Escape', shiftKey: false });
    expect(editor.areaErasePreviews.peek().size).toBe(0);
    expect(getAreaEraseCuts(editor.getShape(behind)!)).toEqual([]);
    expect(getAreaEraseCuts(editor.getShape(front)!)).toHaveLength(1);

    editor.setLocked([front], true);
    press(editor, { x: 65, y: 40 });
    release(editor, { x: 65, y: 40 });
    expect(getAreaEraseCuts(editor.getShape(behind)!)).toEqual([]);
    expect(getAreaEraseCuts(editor.getShape(front)!)).toHaveLength(1);
  });

  it('preserves an area cut at the same position after splitting a freehand stroke', () => {
    const editor = createBoard();
    const id = stroke(editor, 30);
    editor.setCurrentTool('area-eraser');
    press(editor, { x: 30, y: 30 });
    release(editor, { x: 30, y: 30 });
    const getCutPosition = () => {
      const cut = getAreaEraseCuts(editor.getShape(id)!)[0]!;
      const bounds = editor.getShapeLocalBounds(id);
      return editor.localToPage(id, { x: bounds.minX + cut.matrix.e * bounds.w, y: bounds.minY + cut.matrix.f });
    };
    expect(getCutPosition()).toEqual({ x: 30, y: 30 });

    editor.setCurrentTool('partial-eraser');
    press(editor, { x: 75, y: 30 });
    release(editor, { x: 75, y: 30 });
    expect(editor.getShapes()).toHaveLength(2);
    expect(getCutPosition().x).toBeCloseTo(30);
    expect(getCutPosition().y).toBeCloseTo(30);
  });
});

describe('freehand erasers', () => {
  it('erases a shape and a stroke together in All elements mode', () => {
    const editor = createBoard();
    const box = editor.createShape({ type: 'box', x: 0, y: 0 });
    const ink = stroke(editor, 25);
    const locked = editor.createShape({ type: 'box', x: 0, y: 0, isLocked: true });
    editor.setCurrentTool('eraser');
    press(editor, { x: 30, y: -20 });
    release(editor, { x: 30, y: 170 });
    expect(editor.getShapes().map(shape => shape.id)).toEqual([locked]);
    editor.undo();
    expect(editor.getShapes().map(shape => shape.id)).toEqual(expect.arrayContaining([locked, box, ink]));
  });

  it('erases only touched editable strokes, preserves their group, and undoes the drag together', () => {
    const editor = createBoard();
    const group = editor.createShape({ type: 'group', x: 0, y: 0 });
    const grouped = stroke(editor, 30, group);
    const second = stroke(editor, 50);
    const untouched = stroke(editor, 130);
    const locked = stroke(editor, 70);
    editor.setLocked([locked], true);
    const box = editor.createShape({ type: 'box', x: 0, y: 0 });
    editor.setCurrentTool('whole-stroke-eraser');

    press(editor, { x: 50, y: 0 });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 50, y: 60 } });
    expect(editor.erasingShapeIds.peek()).toEqual(new Set([grouped, second]));
    release(editor, { x: 50, y: 90 });

    expect(editor.getShapes().map(shape => shape.id)).toEqual(expect.arrayContaining([group, box, locked, untouched]));
    expect(editor.getShape(grouped)).toBeUndefined();
    expect(editor.getShape(second)).toBeUndefined();
    expect(editor.getChildren(group)).toHaveLength(0);
    expect(editor.erasingShapeIds.peek().size).toBe(0);
    editor.undo();
    expect(editor.getShape(grouped)?.parentId).toBe(group);
    expect(editor.getShape(second)).toBeDefined();
  });

  it('splits the middle of a rotated stroke in its group, preserving its layer and original pressure samples', () => {
    const editor = createBoard();
    const group = editor.createShape({ type: 'group', x: 200, y: 50 });
    const id = stroke(editor, 0, group);
    editor.updateShape(id, { rotation: Math.PI / 2 });
    const boxId = editor.createShape({ type: 'box', x: 0, y: 0, parentId: group });
    const original = editor.getShape<FreehandShape>(id)!;
    editor.setCurrentTool('partial-eraser');

    // A fast sweep crosses the stroke between pointer events.
    press(editor, { x: 220, y: 50 });
    release(editor, { x: 280, y: 50 });

    const children = editor.getShapes(true).filter(shape => shape.parentId === group);
    expect(children.map(shape => shape.type)).toEqual(['freehand', 'freehand', 'box']);
    expect(children[0]!.id).toBe(id);
    expect(children[2]!.id).toBe(boxId);
    const first = children[0] as FreehandShape;
    const second = children[1] as FreehandShape;
    expect(first.props).toMatchObject({ color: 'blue', strokeWidth: 'thick', pressureSensitive: true });
    expect(second.props).toMatchObject({ color: 'blue', strokeWidth: 'thick', pressureSensitive: true });
    expect(first.props.points[0]).toMatchObject({ x: 50, y: -50, pressure: 0.2 });
    expect(second.props.points[1]).toMatchObject({ x: 50, y: 50, pressure: 0.8 });
    expect(first.props.points[1]!.y).toBeLessThan(-8);
    expect(second.props.points[0]!.y).toBeGreaterThan(8);

    editor.undo();
    expect(editor.getShape(id)).toEqual(original);
    expect(editor.getShape(second.id as ShapeId)).toBeUndefined();
  });

  it('trims a stroke end, cancels without edits, and can erase the entire remaining stroke', () => {
    const editor = createBoard();
    const id = stroke(editor, 0);
    editor.setCurrentTool('partial-eraser');

    press(editor, { x: 0, y: 0 });
    release(editor, { x: 0, y: 0 });
    expect(editor.getShapes()).toHaveLength(1);
    const trimmed = editor.getShape<FreehandShape>(id)!;
    expect(trimmed.props.points[0]!.x).toBeGreaterThan(8);
    expect(trimmed.props.points[1]!.x).toBe(100);

    press(editor, { x: 0, y: 0 });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 100, y: 0 } });
    editor.dispatchEvent({ type: 'keyDown', key: 'Escape' });
    expect(editor.getShape(id)).toEqual(trimmed);

    press(editor, { x: 0, y: 0 });
    release(editor, { x: 100, y: 0 });
    expect(editor.getShape(id)).toBeUndefined();
    editor.undo();
    expect(editor.getShape(id)).toEqual(trimmed);
  });

  it('persists already visible cuts when pointer capture is interrupted', () => {
    const editor = createBoard();
    const id = stroke(editor, 40);
    const original = editor.getShape(id);
    editor.setCurrentTool('partial-eraser');
    press(editor, { x: 30, y: 0 });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 30, y: 80 } });
    expect(editor.partialErasePreviews.peek().get(id)?.fragments).toHaveLength(2);
    editor.dispatchEvent({ type: 'pointerCancel', reason: 'interrupted' });
    expect(editor.getShapes()).toHaveLength(2);
    expect(editor.partialErasePreviews.peek().size).toBe(0);
    editor.undo();
    expect(editor.getShapes()).toEqual([original]);
  });

  it('preserves all three pieces when one gesture cuts the same stroke twice', () => {
    const editor = createBoard();
    const id = stroke(editor, 40);
    editor.setCurrentTool('partial-eraser');
    press(editor, { x: 30, y: 0 });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 30, y: 80 } });
    expect(editor.partialErasePreviews.peek().get(id)?.fragments).toHaveLength(2);
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 70, y: 80 } });
    release(editor, { x: 70, y: 0 });
    expect(editor.partialErasePreviews.peek().size).toBe(0);
    expect(editor.getShapes(true).map(shape => shape.x)).toEqual([0, 39.75, 79.75]);
    editor.undo();
    expect(editor.getShapes().map(shape => shape.id)).toEqual([id]);
  });

  it('does not commit a preview over a stroke changed during the gesture', () => {
    const editor = createBoard();
    const id = stroke(editor, 40);
    editor.setCurrentTool('partial-eraser');
    press(editor, { x: 50, y: 0 });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 50, y: 80 } });
    expect(editor.partialErasePreviews.peek().get(id)?.fragments).toHaveLength(2);

    editor.updateShape<FreehandShape>(id, {
      props: { ...editor.getShape<FreehandShape>(id)!.props, color: 'red' },
    });
    release(editor, { x: 50, y: 80 });
    expect(editor.getShapes()).toHaveLength(1);
    expect(editor.getShape(id)?.props).toMatchObject({ color: 'red', points: [
      { x: 0, y: 40, pressure: 0.2 }, { x: 100, y: 40, pressure: 0.8 },
    ] });
    expect(editor.partialErasePreviews.peek().size).toBe(0);
  });
});
