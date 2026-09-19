// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { createEditor, type GlidePlugin } from './editor';
import { BoxUtil } from './shapes/BoxUtil';
import { FrameUtil } from './shapes/FrameUtil';
import { ArrowPlugin, type ArrowShape } from './shapes/ArrowUtil';
import { buildArrowShapeRecord } from './arrow-records';
import {
  applyMatrixToPoint,
  multiplyMatrices,
  rotationMatrix,
  translationMatrix,
} from './transform';
import { sid, type ShapeId, type Vec2 } from './types';

const HierarchyPlugin: GlidePlugin = {
  id: 'hierarchy',
  shapes: [BoxUtil as any, FrameUtil as any],
};

function createHierarchyEditor(withArrows = false) {
  const editor = createEditor({ plugins: withArrows ? [HierarchyPlugin, ArrowPlugin] : [HierarchyPlugin] });
  editor.setCurrentTool('select');
  return editor;
}

function closeToPoint(actual: Vec2, expected: Vec2, precision = 8) {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
}

function corners(editor: ReturnType<typeof createHierarchyEditor>, id: ShapeId): Vec2[] {
  const bounds = editor.transforms.getLocalGeometry(id).getBounds();
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ].map(point => editor.localToPage(id, point));
}

describe('nested parent-local transforms', () => {
  it('composes ancestor translation and rotation', () => {
    const editor = createHierarchyEditor();
    const frame = editor.createShape({
      id: sid('shape:frame'), type: 'frame', x: 100, y: 50,
      rotation: Math.PI / 2, props: { w: 200, h: 100 },
    });
    const child = editor.createShape({
      id: sid('shape:child'), type: 'box', parentId: frame,
      x: 20, y: 10, rotation: Math.PI / 4, props: { w: 40, h: 20 },
    });

    const parent = multiplyMatrices(
      translationMatrix(100, 50),
      multiplyMatrices(translationMatrix(100, 50), multiplyMatrices(
        rotationMatrix(Math.PI / 2), translationMatrix(-100, -50),
      )),
    );
    const childLocal = multiplyMatrices(
      translationMatrix(20, 10),
      multiplyMatrices(translationMatrix(20, 10), multiplyMatrices(
        rotationMatrix(Math.PI / 4), translationMatrix(-20, -10),
      )),
    );
    closeToPoint(
      editor.localToPage(child, { x: 0, y: 0 }),
      applyMatrixToPoint(multiplyMatrices(parent, childLocal), { x: 0, y: 0 }),
    );
  });

  it('reparents atomically while preserving world geometry and supports undo', () => {
    const editor = createHierarchyEditor();
    const frame = editor.createShape({
      id: sid('shape:frame'), type: 'frame', x: 200, y: 100,
      rotation: Math.PI / 3, props: { w: 240, h: 160 },
    });
    const child = editor.createShape({
      id: sid('shape:child'), type: 'box', x: 40, y: 70,
      rotation: -Math.PI / 5, props: { w: 80, h: 50 },
    });
    const before = corners(editor, child);

    editor.reparentShapes([child], frame);
    expect(editor.getShape(child)?.parentId).toBe(frame);
    corners(editor, child).forEach((point, index) => closeToPoint(point, before[index]!));

    editor.undo();
    expect(editor.getShape(child)?.parentId).toBe(editor.getDefaultPageId());
    corners(editor, child).forEach((point, index) => closeToPoint(point, before[index]!));
  });

  it('moves a child in page axes under a rotated parent', () => {
    const editor = createHierarchyEditor();
    const frame = editor.createShape({
      type: 'frame', x: 100, y: 100, rotation: Math.PI / 2, props: { w: 200, h: 100 },
    });
    const child = editor.createShape({
      type: 'box', parentId: frame, x: 20, y: 30, props: { w: 40, h: 40 },
    });
    const before = editor.localToPage(child, { x: 0, y: 0 });
    editor.setSelectedShapeIds([child]);
    editor.dispatchEvent({ type: 'pointerDown', point: before, target: 'shape', shapeId: child, shiftKey: false });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: before.x + 30, y: before.y + 10 } });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: before.x + 30, y: before.y + 10 } });
    closeToPoint(editor.localToPage(child, { x: 0, y: 0 }), { x: before.x + 30, y: before.y + 10 });
  });

  it('refreshes descendant spatial bounds when an ancestor moves', () => {
    const editor = createHierarchyEditor();
    const frame = editor.createShape({ type: 'frame', x: 0, y: 0, props: { w: 200, h: 100 } });
    const child = editor.createShape({
      type: 'box', parentId: frame, x: 20, y: 20, props: { w: 40, h: 30 },
    });
    expect(editor.getShapesAtPoint({ x: 30, y: 30 }).map(shape => shape.id)).toContain(child);

    editor.updateShape(frame, { x: 300 });

    expect(editor.getShapesAtPoint({ x: 30, y: 30 }).map(shape => shape.id)).not.toContain(child);
    expect(editor.getShapesAtPoint({ x: 330, y: 30 }).map(shape => shape.id)).toContain(child);
  });

  it('preserves nested arrow endpoints when reparenting', () => {
    const editor = createHierarchyEditor(true);
    const frame = editor.createShape({
      type: 'frame', x: 200, y: 100, rotation: Math.PI / 4, props: { w: 200, h: 120 },
    });
    const arrowId = editor.createShape(buildArrowShapeRecord({
      id: sid('shape:arrow'), startWorld: { x: 20, y: 30 }, endWorld: { x: 180, y: 90 },
    }) as any);
    const before = editor.getShape<ArrowShape>(arrowId)!;
    const start = editor.localToPage(arrowId, before.props.start.point);
    const end = editor.localToPage(arrowId, before.props.end.point);

    editor.reparentShapes([arrowId], frame);

    const after = editor.getShape<ArrowShape>(arrowId)!;
    closeToPoint(editor.localToPage(arrowId, after.props.start.point), start);
    closeToPoint(editor.localToPage(arrowId, after.props.end.point), end);
  });

  it('migrates v5 nested coordinates without moving box or arrow geometry', () => {
    const editor = createHierarchyEditor(true);
    const arrow = buildArrowShapeRecord({
      id: sid('shape:arrow'), startWorld: { x: 300, y: 200 }, endWorld: { x: 380, y: 240 },
    }) as any;
    editor.replaceDocument({
      schema: { storeVersion: 5, shapes: { frame: 2, box: 0, arrow: 6 }, bindings: {} },
      records: [
        { id: 'page:p', kind: 'page', type: 'page', schemaVersion: 0, name: 'P', index: 'a1', meta: {} },
        {
          id: 'shape:frame', kind: 'shape', type: 'frame', schemaVersion: 2,
          parentId: 'page:p', isLocked: false, isHidden: false,
          x: 100, y: 50, rotation: Math.PI / 2, index: 'a1', meta: {},
          props: { w: 200, h: 100, label: 'Frame', color: '#000', clipContent: false },
        },
        {
          id: 'shape:box', kind: 'shape', type: 'box', schemaVersion: 0,
          parentId: 'shape:frame', isLocked: false, isHidden: false,
          x: 300, y: 200, rotation: Math.PI / 4, index: 'a1', meta: {},
          props: { ...new BoxUtil().getDefaultProps(), w: 80, h: 40 },
        },
        { ...arrow, kind: 'shape', schemaVersion: 6, parentId: 'shape:frame', isLocked: false, isHidden: false },
      ],
    });

    const box = sid('shape:box');
    const expectedBox = multiplyMatrices(
      translationMatrix(300, 200),
      multiplyMatrices(translationMatrix(40, 20), multiplyMatrices(
        rotationMatrix(Math.PI / 4), translationMatrix(-40, -20),
      )),
    );
    closeToPoint(editor.localToPage(box, { x: 0, y: 0 }), applyMatrixToPoint(expectedBox, { x: 0, y: 0 }));
    const migratedArrow = editor.getShape<ArrowShape>(sid('shape:arrow'))!;
    closeToPoint(editor.localToPage(migratedArrow.id, migratedArrow.props.start.point), { x: 300, y: 200 });
    closeToPoint(editor.localToPage(migratedArrow.id, migratedArrow.props.end.point), { x: 380, y: 240 });
  });
});
