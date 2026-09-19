import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GlideEditor, createEditor } from '../../editor';
import type { GlidePlugin } from '../../editor';
import { SelectTool } from '../SelectTool';
import { ShapeUtil } from '../../shapes/ShapeUtil';
import { Geometry2d, Rectangle2d } from '../../geometry';
import { GroupUtil } from '../../shapes/GroupUtil';
import { ArrowUtil, type ArrowShape } from '../../shapes/ArrowUtil';
import { TextUtil } from '../../shapes/TextUtil';

class MockBoxUtil extends ShapeUtil<any> {
  static type = 'box';
  getDefaultProps() { return { w: 100, h: 100 }; }
  getGeometry(s: any): Geometry2d {
    return new Rectangle2d(0, 0, s.props.w, s.props.h);
  }
}
class MockRasterUtil extends MockBoxUtil {
  static type = 'raster-image';
  override getDefaultProps() { return { w: 100, h: 100, aspectLocked: true }; }
}
class MockSvgUtil extends MockBoxUtil {
  static type = 'sanitized-svg';
  override getDefaultProps() { return { w: 100, h: 100, aspectLocked: true }; }
}
class EastOnlyBoxUtil extends MockBoxUtil {
  static type = 'east-only-box';
  override getResizeHandles() { return ['e'] as const; }
}
const BoxPlugin: GlidePlugin = {
  id: 'box',
  shapes: [MockBoxUtil as any, MockRasterUtil as any, MockSvgUtil as any, EastOnlyBoxUtil as any, GroupUtil as any, ArrowUtil as any, TextUtil as any],
};

function pointerDownHandle(editor: GlideEditor, point: { x: number; y: number }, handleId: string) {
  editor.dispatchEvent({ type: 'pointerDown', point, shiftKey: false, target: 'handle', handleId });
}

function pointerMove(editor: GlideEditor, point: { x: number; y: number }, modifiers: { shiftKey?: boolean; altKey?: boolean } = {}) {
  editor.dispatchEvent({ type: 'pointerMove', point, ...modifiers });
}

function pointerUp(editor: GlideEditor, point: { x: number; y: number }, modifiers: { shiftKey?: boolean; altKey?: boolean } = {}) {
  editor.dispatchEvent({ type: 'pointerUp', point, ...modifiers });
}

describe('SelectTool DraggingResize', () => {
  let editor: GlideEditor;

  beforeEach(() => {
    editor = createEditor({ plugins: [BoxPlugin], tools: [SelectTool] });
    editor.setCurrentTool('select');
  });

  it('resizes a single box', () => {
    const id = editor.createShape({ type: 'box', x: 10, y: 10, props: { w: 100, h: 50 }, id: 'shape:box1' as any });
    editor.setSelectedShapeIds([id]);

    editor.dispatchEvent({
      type: 'pointerDown',
      point: { x: 110, y: 60 },
      shiftKey: false,
      target: 'handle',
      handleId: 'se'
    });

    // We are now in draggingResize
    const tool = editor.getCurrentTool() as any;
    expect(tool.current.constructor.name).toBe('DraggingResize');

    editor.dispatchEvent({
      type: 'pointerMove',
      point: { x: 120, y: 80 } // dx=10, dy=20
    });

    const shape = editor.getShape(id)!;
    expect(shape.x).toBe(10);
    expect(shape.y).toBe(10);
    expect(shape.props.w).toBe(110); // 100 + 10
    expect(shape.props.h).toBe(70);  // 50 + 20
  });

  it('scales standalone text proportionally from a side handle', () => {
    const id = editor.createShape({
      type: 'text', x: 10, y: 20,
      props: { text: 'No wrapping', w: 100, h: 20, scale: 1, sizeMode: 'auto' },
    });
    editor.setSelectedShapeIds([id]);

    pointerDownHandle(editor, { x: 110, y: 30 }, 'e');
    pointerMove(editor, { x: 210, y: 30 });

    expect(editor.getShape(id)).toMatchObject({
      x: 10,
      y: 10,
      props: { w: 200, h: 40, scale: 2, sizeMode: 'auto' },
    });
  });

  it('proportionally scales multiple shapes', () => {
    const id1 = editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 10, h: 10 }, id: 'shape:box1' as any });
    const id2 = editor.createShape({ type: 'box', x: 20, y: 20, props: { w: 20, h: 20 }, id: 'shape:box2' as any });
    
    editor.setSelectedShapeIds([id1, id2]);
    // group bounds: minX:0, minY:0, maxX:40, maxY:40. w:40, h:40

    editor.dispatchEvent({
      type: 'pointerDown',
      point: { x: 40, y: 40 },
      shiftKey: false,
      target: 'handle',
      handleId: 'se'
    });

    // resize group from 40x40 to 80x80 (scale by 2)
    editor.dispatchEvent({
      type: 'pointerMove',
      point: { x: 80, y: 80 } // dx=40, dy=40
    });

    const s1 = editor.getShape(id1)!;
    const s2 = editor.getShape(id2)!;

    // s1 was at 0,0 10x10. It should scale to 0,0 20x20
    expect(s1.x).toBe(0);
    expect(s1.y).toBe(0);
    expect(s1.props.w).toBe(20);
    expect(s1.props.h).toBe(20);

    // s2 was at 20,20 20x20. It should scale to 40,40 40x40
    expect(s2.x).toBe(40);
    expect(s2.y).toBe(40);
    expect(s2.props.w).toBe(40);
    expect(s2.props.h).toBe(40);
  });

  it.each([
    ['nw', { x: 10, y: 20 }, { x: -10, y: 10, w: 120, h: 60 }],
    ['n', { x: 60, y: 20 }, { x: 10, y: 10, w: 100, h: 60 }],
    ['ne', { x: 110, y: 20 }, { x: 10, y: 10, w: 120, h: 60 }],
    ['e', { x: 110, y: 45 }, { x: 10, y: 20, w: 120, h: 50 }],
    ['se', { x: 110, y: 70 }, { x: 10, y: 20, w: 120, h: 60 }],
    ['s', { x: 60, y: 70 }, { x: 10, y: 20, w: 100, h: 60 }],
    ['sw', { x: 10, y: 70 }, { x: -10, y: 20, w: 120, h: 60 }],
    ['w', { x: 10, y: 45 }, { x: -10, y: 20, w: 120, h: 50 }],
  ] as const)('keeps the opposite anchor fixed when dragging the %s handle', (handle, origin, expected) => {
    const id = editor.createShape({ type: 'box', x: 10, y: 20, props: { w: 100, h: 50 } });
    editor.setSelectedShapeIds([id]);
    const cursor = {
      x: origin.x + (handle.includes('w') ? -20 : handle.includes('e') ? 20 : 0),
      y: origin.y + (handle.includes('n') ? -10 : handle.includes('s') ? 10 : 0),
    };

    pointerDownHandle(editor, origin, handle);
    pointerMove(editor, cursor);

    expect(editor.getShape(id)).toMatchObject({
      x: expected.x,
      y: expected.y,
      props: { w: expected.w, h: expected.h },
    });
  });

  it.each([
    ['raster-image', true, false, 300, 150],
    ['raster-image', true, true, 300, 120],
    ['raster-image', false, false, 300, 120],
    ['raster-image', false, true, 300, 150],
    ['sanitized-svg', true, false, 300, 150],
    ['box', undefined, true, 300, 150],
  ] as const)('applies persisted and temporary aspect semantics for %s', (type, aspectLocked, shiftKey, w, h) => {
    const id = editor.createShape({
      type,
      x: 0,
      y: 0,
      props: { w: 200, h: 100, ...(aspectLocked === undefined ? {} : { aspectLocked }) },
    });
    editor.setSelectedShapeIds([id]);

    pointerDownHandle(editor, { x: 200, y: 100 }, 'se');
    pointerMove(editor, { x: 300, y: 120 }, { shiftKey });

    expect(editor.getShape(id)?.props).toMatchObject({ w, h });
  });

  it.each([
    ['e', { x: 300, y: 50 }, { w: 300, h: 150 }],
    ['s', { x: 100, y: 150 }, { w: 300, h: 150 }],
  ] as const)('honors a generic shape aspect lock from its %s side handle', (handle, cursor, expected) => {
    const id = editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 200, h: 100 } });
    editor.updateShape(id, { meta: { aspectLocked: true } });
    editor.setSelectedShapeIds([id]);

    pointerDownHandle(editor, { x: 200, y: 50 }, handle);
    pointerMove(editor, cursor);

    expect(editor.getShape(id)?.props).toMatchObject(expected);
  });

  it('preserves locked asset ratios in a mixed multi-selection', () => {
    const raster = editor.createShape({
      type: 'raster-image', x: 0, y: 0, props: { w: 100, h: 50, aspectLocked: true },
    });
    const box = editor.createShape({ type: 'box', x: 200, y: 0, props: { w: 100, h: 50 } });
    editor.setSelectedShapeIds([raster, box]);

    pointerDownHandle(editor, { x: 300, y: 50 }, 'se');
    pointerMove(editor, { x: 400, y: 60 });

    const resizedRaster = editor.getShape(raster)!;
    expect(resizedRaster.props.w / resizedRaster.props.h).toBeCloseTo(2);
    expect(editor.getShape(box)?.props.w).toBeCloseTo(400 / 3);
    expect(editor.getShape(box)?.props.h).toBeCloseTo(200 / 3);
  });

  it('uses Shift to constrain a multi-selection containing an explicitly unlocked asset', () => {
    const raster = editor.createShape({
      type: 'raster-image', x: 0, y: 0, props: { w: 100, h: 50, aspectLocked: false },
    });
    const box = editor.createShape({ type: 'box', x: 200, y: 0, props: { w: 100, h: 50 } });
    editor.setSelectedShapeIds([raster, box]);

    pointerDownHandle(editor, { x: 300, y: 50 }, 'se');
    pointerMove(editor, { x: 400, y: 60 }, { shiftKey: true });

    const resizedRaster = editor.getShape(raster)!;
    expect(resizedRaster.props.w / resizedRaster.props.h).toBeCloseTo(2);
  });

  it('reapplies aspect ratio after dimension snapping and Alt disables snapping', () => {
    const id = editor.createShape({
      type: 'raster-image', x: 0, y: 0, props: { w: 200, h: 100, aspectLocked: true },
    });
    editor.setSelectedShapeIds([id]);
    const snapDimensions = vi.spyOn(editor.snapping, 'snapDimensions')
      .mockReturnValue({ width: 180, height: 120 });

    pointerDownHandle(editor, { x: 200, y: 100 }, 'se');
    pointerMove(editor, { x: 260, y: 140 }, { altKey: true });

    expect(snapDimensions).toHaveBeenCalledWith(
      editor, id, 280, 140, { width: true, height: true }, true,
    );
    expect(editor.getShape(id)?.props).toMatchObject({ w: 240, h: 120 });

    snapDimensions.mockReturnValue({ width: 300, height: 100 });
    pointerMove(editor, { x: 260, y: 140 });
    expect(editor.getShape(id)?.props).toMatchObject({ w: 300, h: 150 });
  });

  it('clamps a collapsed northwest resize and restores the snapshot on Escape', () => {
    const id = editor.createShape({ type: 'box', x: 10, y: 20, props: { w: 100, h: 50 } });
    editor.setSelectedShapeIds([id]);

    pointerDownHandle(editor, { x: 10, y: 20 }, 'nw');
    pointerMove(editor, { x: 200, y: 200 });
    expect(editor.getShape(id)).toMatchObject({ x: 106, y: 66, props: { w: 4, h: 4 } });

    editor.dispatchEvent({ type: 'keyDown', key: 'Escape' });
    expect(editor.getShape(id)).toMatchObject({ x: 10, y: 20, props: { w: 100, h: 50 } });
    expect((editor.getCurrentTool().current.constructor as typeof SelectTool).id).toBe('idle');
  });

  it('commits pointer-up geometry as one undoable resize', () => {
    const id = editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 100, h: 50 } });
    editor.setSelectedShapeIds([id]);

    pointerDownHandle(editor, { x: 100, y: 50 }, 'se');
    pointerMove(editor, { x: 120, y: 60 });
    pointerUp(editor, { x: 140, y: 70 });

    expect(editor.getShape(id)?.props).toMatchObject({ w: 140, h: 70 });
    expect(editor.history.undoStack.at(-1)?.label).toBe('Resize Shapes');
    editor.undo();
    expect(editor.getShape(id)?.props).toMatchObject({ w: 100, h: 50 });
  });

  it('respects util-owned handle availability', () => {
    const id = editor.createShape({ type: 'east-only-box', x: 0, y: 0, props: { w: 100, h: 50 } });
    editor.setSelectedShapeIds([id]);

    pointerDownHandle(editor, { x: 100, y: 50 }, 'se');

    expect((editor.getCurrentTool().current.constructor as typeof SelectTool).id).toBe('idle');
    expect(editor.getShape(id)?.props).toMatchObject({ w: 100, h: 50 });
  });

  it('scales grouped descendants uniformly and Escape restores them', () => {
    const raster = editor.createShape({
      type: 'raster-image', x: 0, y: 0, props: { w: 100, h: 50, aspectLocked: true },
    });
    const box = editor.createShape({ type: 'box', x: 150, y: 50, props: { w: 50, h: 50 } });
    const group = editor.groupShapes([raster, box]);
    editor.setSelectedShapeIds([group]);
    const beforeRaster = structuredClone(editor.getShape(raster)!);
    const beforeBox = structuredClone(editor.getShape(box)!);
    const bounds = editor.getShapeWorldBounds(editor.getShape(group)!);

    pointerDownHandle(editor, { x: bounds.maxX, y: bounds.maxY }, 'se');
    pointerMove(editor, { x: bounds.maxX + bounds.w, y: bounds.maxY + bounds.h });

    expect(editor.getShape(raster)!.props.w / editor.getShape(raster)!.props.h).toBeCloseTo(2);
    expect(editor.getShape(raster)?.props.w).toBeCloseTo(beforeRaster.props.w * 2);
    expect(editor.getShape(box)?.props.w).toBeCloseTo(beforeBox.props.w * 2);

    editor.dispatchEvent({ type: 'keyDown', key: 'Escape' });
    expect(editor.getShape(raster)).toMatchObject(beforeRaster);
    expect(editor.getShape(box)).toMatchObject(beforeBox);
  });

  it.each([
    ['nw', { x: 0, y: 0 }, { x: -20, y: -10 }, 120, 70],
    ['n', { x: 50, y: 0 }, { x: 50, y: -10 }, 100, 70],
    ['ne', { x: 100, y: 0 }, { x: 120, y: -10 }, 120, 70],
    ['e', { x: 100, y: 30 }, { x: 120, y: 30 }, 120, 60],
    ['se', { x: 100, y: 60 }, { x: 120, y: 70 }, 120, 70],
    ['s', { x: 50, y: 60 }, { x: 50, y: 70 }, 100, 70],
    ['sw', { x: 0, y: 60 }, { x: -20, y: 70 }, 120, 70],
    ['w', { x: 0, y: 30 }, { x: -20, y: 30 }, 120, 60],
  ] as const)('maps every selected shape through a multi-selection %s resize', (handle, origin, cursor, expectedW, expectedH) => {
    const first = editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 20, h: 20 } });
    const second = editor.createShape({ type: 'box', x: 80, y: 40, props: { w: 20, h: 20 } });
    editor.setSelectedShapeIds([first, second]);

    pointerDownHandle(editor, origin, handle);
    pointerMove(editor, cursor);

    const bounds = [first, second].map(id => editor.getShapeWorldBounds(editor.getShape(id)!));
    expect(Math.max(...bounds.map(box => box.maxX)) - Math.min(...bounds.map(box => box.minX))).toBeCloseTo(expectedW);
    expect(Math.max(...bounds.map(box => box.maxY)) - Math.min(...bounds.map(box => box.minY))).toBeCloseTo(expectedH);
  });

  it('clamps a collapsed multi-selection at the northwest anchor', () => {
    const first = editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 20, h: 20 } });
    const second = editor.createShape({ type: 'box', x: 80, y: 40, props: { w: 20, h: 20 } });
    editor.setSelectedShapeIds([first, second]);

    pointerDownHandle(editor, { x: 0, y: 0 }, 'nw');
    pointerMove(editor, { x: 200, y: 200 });

    const bounds = [first, second].map(id => editor.getShapeWorldBounds(editor.getShape(id)!));
    expect(Math.max(...bounds.map(box => box.maxX)) - Math.min(...bounds.map(box => box.minX))).toBeLessThan(5);
    expect(Math.max(...bounds.map(box => box.maxY)) - Math.min(...bounds.map(box => box.minY))).toBeLessThan(5);
  });

  it('uses the vertical delta and northwest anchor for constrained multi-resize', () => {
    const raster = editor.createShape({
      type: 'raster-image', x: 0, y: 0, props: { w: 100, h: 50, aspectLocked: true },
    });
    const box = editor.createShape({ type: 'box', x: 200, y: 50, props: { w: 100, h: 50 } });
    editor.setSelectedShapeIds([raster, box]);

    pointerDownHandle(editor, { x: 0, y: 0 }, 'nw');
    pointerMove(editor, { x: -10, y: -100 });

    const resized = editor.getShape(raster)!;
    expect(resized.props.w / resized.props.h).toBeCloseTo(2);
    const bounds = [raster, box].map(id => editor.getShapeWorldBounds(editor.getShape(id)!));
    expect(Math.max(...bounds.map(item => item.maxX))).toBeCloseTo(300);
    expect(Math.max(...bounds.map(item => item.maxY))).toBeCloseTo(100);
  });

  it.each(['nw', 'ne', 'sw'] as const)('uniformly resizes a group from its %s corner', handle => {
    const first = editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 40, h: 20 } });
    const second = editor.createShape({ type: 'box', x: 80, y: 40, props: { w: 20, h: 20 } });
    const group = editor.groupShapes([first, second]);
    editor.setSelectedShapeIds([group]);
    const initial = editor.getShapeWorldBounds(editor.getShape(group)!);
    const origin = {
      x: handle.includes('w') ? initial.minX : initial.maxX,
      y: handle.includes('n') ? initial.minY : initial.maxY,
    };
    const cursor = {
      x: origin.x + (handle.includes('w') ? -initial.w : initial.w),
      y: origin.y + (handle.includes('n') ? -initial.h : initial.h),
    };

    pointerDownHandle(editor, origin, handle);
    pointerMove(editor, cursor);
    pointerUp(editor, cursor);

    const resized = editor.getShapeWorldBounds(editor.getShape(group)!);
    expect(resized.w).toBeCloseTo(initial.w * 2);
    expect(resized.h).toBeCloseTo(initial.h * 2);
    expect(editor.history.undoStack.at(-1)?.label).toBe('Resize Shapes');
  });

  it('scales arrow endpoints inside a resized group', () => {
    const box = editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 40, h: 40 } });
    const arrow = editor.createShape<ArrowShape>({
      type: 'arrow', x: 60, y: 20,
      props: {
        ...new ArrowUtil().getDefaultProps(),
        start: { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: 0, y: 0 } },
        end: { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: 40, y: 0 } },
      },
    });
    const group = editor.groupShapes([box, arrow]);
    editor.setSelectedShapeIds([group]);
    const initial = editor.getShapeWorldBounds(editor.getShape(group)!);

    pointerDownHandle(editor, { x: initial.maxX, y: initial.maxY }, 'se');
    pointerMove(editor, { x: initial.maxX + initial.w, y: initial.maxY + initial.h });

    const resizedArrow = editor.getShape<ArrowShape>(arrow)!;
    expect(resizedArrow.props.start.point).toEqual({ x: 0, y: 0 });
    expect(resizedArrow.props.end.point.x).toBeCloseTo(80);
    expect(resizedArrow.rotation).toBe(0);
  });

  it('resizes descendants of a nested group in depth order', () => {
    const childA = editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 20, h: 20 } });
    const childB = editor.createShape({ type: 'box', x: 40, y: 0, props: { w: 20, h: 20 } });
    const inner = editor.groupShapes([childA, childB]);
    const outerBox = editor.createShape({ type: 'box', x: 100, y: 40, props: { w: 20, h: 20 } });
    const outer = editor.groupShapes([inner, outerBox]);
    editor.setSelectedShapeIds([outer]);
    const initial = editor.getShapeWorldBounds(editor.getShape(outer)!);

    pointerDownHandle(editor, { x: initial.maxX, y: initial.maxY }, 'se');
    pointerMove(editor, { x: initial.maxX + initial.w, y: initial.maxY + initial.h });

    expect(editor.getShape(childA)?.props).toMatchObject({ w: 40, h: 40 });
    expect(editor.getShape(childB)?.props).toMatchObject({ w: 40, h: 40 });
    expect(editor.getShape(inner)?.type).toBe('group');
  });

  it.each([
    ['e', { x: 200, y: 50 }, { x: 300, y: 50 }, 300, 150],
    ['n', { x: 100, y: 0 }, { x: 100, y: -50 }, 300, 150],
  ] as const)('constrains a locked asset resized from its %s side', (handle, origin, cursor, w, h) => {
    const id = editor.createShape({
      type: 'raster-image', x: 0, y: 0,
      props: { w: 200, h: 100, aspectLocked: true },
    });
    editor.setSelectedShapeIds([id]);

    pointerDownHandle(editor, origin, handle);
    editor.dispatchEvent({ type: 'keyDown', key: 'Shift' });
    pointerMove(editor, cursor);
    pointerUp(editor, cursor);

    expect(editor.getShape(id)?.props).toMatchObject({ w, h });
  });

  it('keeps a zero-size multi-selection finite and unchanged', () => {
    const first = editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 0, h: 0 } });
    const second = editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 0, h: 0 } });
    editor.setSelectedShapeIds([first, second]);

    pointerDownHandle(editor, { x: 0, y: 0 }, 'se');
    pointerMove(editor, { x: 20, y: 20 });

    expect(editor.getShape(first)?.props).toMatchObject({ w: 0, h: 0 });
    expect(editor.getShape(second)?.props).toMatchObject({ w: 0, h: 0 });
  });
});
