// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { createEditor, type GlidePlugin } from './editor';
import { BoxUtil } from './shapes/BoxUtil';
import { ArrowPlugin, type ArrowShape } from './shapes/ArrowUtil';
import { buildArrowShapeRecord } from './arrow-records';
import { bid, sid, type AnyRecord, type Box2d, type Vec2 } from './types';

const BoxPlugin: GlidePlugin = { id: 'box', shapes: [BoxUtil as any] };

function editorWithBoxes() {
  const editor = createEditor({ plugins: [BoxPlugin] });
  editor.setCurrentTool('select');
  return editor;
}

function closeToPoint(actual: Vec2, expected: Vec2, precision = 8) {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
}

function contains(bounds: Box2d, point: Vec2): boolean {
  return point.x >= bounds.minX - 1e-8 && point.x <= bounds.maxX + 1e-8
    && point.y >= bounds.minY - 1e-8 && point.y <= bounds.maxY + 1e-8;
}

describe('canonical transform service', () => {
  it('round-trips points across varied flat rotated transforms', () => {
    const editor = editorWithBoxes();
    const shape = editor.createShape({
      id: sid('shape:roundtrip'), type: 'box', x: 155, y: 95,
      rotation: -Math.PI / 7, props: { w: 90, h: 55 },
    });

    for (let index = 0; index < 100; index++) {
      const local = { x: (index * 37) % 97 - 10, y: (index * 53) % 83 - 15 };
      closeToPoint(editor.pageToLocal(shape, editor.localToPage(shape, local)), local);
    }
  });

  it('returns transformed bounds containing every world outline point', () => {
    const editor = editorWithBoxes();
    const id = editor.createShape({
      id: sid('shape:rotated'), type: 'box', x: 100, y: 70,
      rotation: Math.PI / 4, props: { w: 120, h: 80 },
    });
    const bounds = editor.getShapeWorldBounds(id);
    const outline = editor.transforms.getWorldOutline(id);

    expect(outline.every(point => contains(bounds, point))).toBe(true);
  });

  it('uses transformed RBush bounds and inverse-transformed precise hits', () => {
    const editor = editorWithBoxes();
    const id = editor.createShape({
      id: sid('shape:hit'), type: 'box', x: 100, y: 100,
      rotation: Math.PI / 4, props: { w: 100, h: 60 },
    });
    const visibleCorner = editor.localToPage(id, { x: 2, y: 2 });
    expect(editor.getShapesAtPoint(visibleCorner).map(shape => shape.id)).toContain(id);

    const bounds = editor.getShapeWorldBounds(id);
    const outsideOutline = { x: bounds.minX + 1, y: bounds.minY + 1 };
    expect(editor.getShapesAtPoint(outsideOutline).map(shape => shape.id)).not.toContain(id);

    const region = {
      ...visibleCorner,
      minX: visibleCorner.x - 1,
      minY: visibleCorner.y - 1,
      maxX: visibleCorner.x + 1,
      maxY: visibleCorner.y + 1,
    };
    expect(editor.getShapesInBox(region).map(shape => shape.id)).toContain(id);
  });

  it('transforms normalized connector anchors with the target', () => {
    const editor = editorWithBoxes();
    const id = editor.createShape({
      id: sid('shape:anchor'), type: 'box', x: 40, y: 30,
      rotation: Math.PI / 2, props: { w: 100, h: 60 },
    });
    const expected = editor.localToPage(id, { x: 100, y: 30 });
    closeToPoint(editor.transforms.normalizedAnchorToPage(id, { x: 1, y: 0.5 }), expected);
  });

  it('exports the same world matrix and transformed view bounds', () => {
    const editor = editorWithBoxes();
    const id = editor.createShape({
      id: sid('shape:export'), type: 'box', x: 75, y: 45,
      rotation: Math.PI / 6, props: { w: 110, h: 70 },
    });
    const matrix = editor.getWorldTransform(id);
    const svg = editor.exportToSvg([id]);
    expect(svg).toContain(`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`);
    const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1]?.split(' ').map(Number);
    const bounds = editor.getShapeVisualWorldBounds(id);
    expect(viewBox).toBeDefined();
    expect(viewBox![0]).toBeCloseTo(bounds.minX);
    expect(viewBox![1]).toBeCloseTo(bounds.minY);
    expect(viewBox![2]).toBeCloseTo(bounds.w);
    expect(viewBox![3]).toBeCloseTo(bounds.h);
  });

  it('keeps the opposite page-space handle fixed during rotated resize', () => {
    const editor = editorWithBoxes();
    const id = editor.createShape({
      id: sid('shape:resize'), type: 'box', x: 80, y: 50,
      rotation: Math.PI / 4, props: { w: 100, h: 60 },
    });
    editor.setSelectedShapeIds([id]);
    const fixedBefore = editor.localToPage(id, { x: 0, y: 0 });
    const start = editor.localToPage(id, { x: 100, y: 60 });
    const end = editor.localToPage(id, { x: 140, y: 90 });

    editor.dispatchEvent({ type: 'pointerDown', point: start, shiftKey: false, target: 'handle', handleId: 'se' });
    editor.dispatchEvent({ type: 'pointerMove', point: end });

    const resized = editor.getShape(id)!;
    expect((resized.props as any).w).toBeCloseTo(140);
    expect((resized.props as any).h).toBeCloseTo(90);
    closeToPoint(editor.localToPage(id, { x: 0, y: 0 }), fixedBefore);
  });
});

describe('arrow rotation invariant', () => {
  it('moves a bound terminal during an interactive target rotation', () => {
    const editor = createEditor({ plugins: [BoxPlugin, ArrowPlugin] });
    editor.setCurrentTool('select');
    const box = editor.createShape({
      id: sid('shape:bound-box'), type: 'box', x: 100, y: 100,
      props: { w: 200, h: 100 },
    });
    const arrowId = editor.createShape(buildArrowShapeRecord({
      id: sid('shape:bound-arrow'),
      startWorld: { x: 0, y: 0 },
      endWorld: { x: 200, y: 100 },
    }) as any);
    editor.createBinding({
      id: bid('binding:rotated-target'),
      type: 'arrow',
      fromId: arrowId,
      toId: box,
      props: {
        terminal: 'end',
        normalizedAnchor: { x: 0.5, y: 0 },
        fromEdge: 'top',
      },
      meta: {},
    } as AnyRecord);
    editor.setSelectedShapeIds([box]);
    const versionValues: number[] = [];
    const unsubscribe = editor.getDocumentVersionSignal().subscribe(value => versionValues.push(value));
    const notificationsBeforeRotation = versionValues.length;

    editor.dispatchEvent({
      type: 'pointerDown', point: { x: 200, y: 50 },
      shiftKey: false, target: 'handle', handleId: 'rotate',
    });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 300, y: 150 } });

    const arrow = editor.getShape<ArrowShape>(arrowId)!;
    closeToPoint(editor.localToPage(arrowId, arrow.props.end.point), { x: 250, y: 150 });
    expect((editor.getBinding(bid('binding:rotated-target'))!.props as any).fromEdge).toBe('right');
    expect(versionValues.length).toBeGreaterThan(notificationsBeforeRotation);
    unsubscribe();
  });

  it('folds legacy record rotation into points during store-v4 migration', () => {
    const editor = createEditor({ plugins: [BoxPlugin, ArrowPlugin] });
    editor.replaceDocument({
      schema: { storeVersion: 3, shapes: { arrow: 5 }, bindings: {} },
      records: [{
        id: 'shape:arrow', kind: 'shape', type: 'arrow', schemaVersion: 5,
        x: 10, y: 20, index: 'o000000000000000000000001', rotation: Math.PI / 2, meta: {},
        props: {
          start: { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: 0, y: 0 } },
          end: { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: 100, y: 0 } },
          routeStyle: 'curve', bend: 0, arrowheadStart: 'none', arrowheadEnd: 'arrow',
          color: 'black', opacity: 1, strokeStyle: 'solid', strokeWidth: 'medium',
        },
      }],
    });
    const arrow = editor.getShape<ArrowShape>(sid('shape:arrow'))!;
    expect(arrow.rotation).toBe(0);
    expect(arrow.props.end.point.x).toBeCloseTo(0);
    expect(arrow.props.end.point.y).toBeCloseTo(100);
  });

  it('rejects non-zero arrow record rotation at the editor boundary', () => {
    const editor = createEditor({ plugins: [ArrowPlugin] });
    expect(() => editor.createShape({
      id: sid('shape:arrow'), type: 'arrow', x: 0, y: 0, rotation: 1,
    })).toThrow('path points');
  });

  it('rotates arrow points once during multi-selection rotation', () => {
    const editor = createEditor({ plugins: [BoxPlugin, ArrowPlugin] });
    editor.setCurrentTool('select');
    const box = editor.createShape({
      id: sid('shape:box'), type: 'box', x: 0, y: 0, props: { w: 60, h: 60 },
    });
    const arrowId = editor.createShape(buildArrowShapeRecord({
      id: sid('shape:arrow'), startWorld: { x: 100, y: 20 }, endWorld: { x: 180, y: 20 },
    }) as any);
    editor.setSelectedShapeIds([box, arrowId]);
    const bounds = [editor.getShapeWorldBounds(box), editor.getShapeWorldBounds(arrowId)];
    const center = {
      x: (Math.min(...bounds.map(item => item.minX)) + Math.max(...bounds.map(item => item.maxX))) / 2,
      y: (Math.min(...bounds.map(item => item.minY)) + Math.max(...bounds.map(item => item.maxY))) / 2,
    };
    const originalStart = editor.localToPage(arrowId, { x: 0, y: 0 });
    const originalEnd = editor.localToPage(arrowId, { x: 80, y: 0 });
    const rotateQuarterTurn = (point: Vec2): Vec2 => ({
      x: center.x - (point.y - center.y),
      y: center.y + (point.x - center.x),
    });

    editor.dispatchEvent({
      type: 'pointerDown', point: { x: center.x, y: center.y - 100 },
      shiftKey: false, target: 'handle', handleId: 'rotate',
    });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: center.x + 100, y: center.y } });

    const arrow = editor.getShape<ArrowShape>(arrowId)!;
    expect(arrow.rotation).toBe(0);
    closeToPoint(editor.localToPage(arrowId, arrow.props.start.point), rotateQuarterTurn(originalStart));
    closeToPoint(editor.localToPage(arrowId, arrow.props.end.point), rotateQuarterTurn(originalEnd));
  });
});
