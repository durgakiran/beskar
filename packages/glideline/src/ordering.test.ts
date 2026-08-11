// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { createEditor, type GlidePlugin } from './editor';
import {
  compareSiblingOrder,
  generateOrderKeysBetween,
  generateRebalancedOrderKeys,
  getCanonicalShapeIds,
  isCanonicalOrderKey,
} from './ordering';
import { BoxUtil } from './shapes/BoxUtil';
import { sid, type AnyRecord, type GlideShape, type ShapeId } from './types';

class ContainerBoxUtil extends BoxUtil {
  static override readonly type = 'container-box';
  static override readonly canContainChildren = true;
}

const BoxPlugin: GlidePlugin = { id: 'box', shapes: [BoxUtil as any, ContainerBoxUtil as any] };

function makeEditor() {
  return createEditor({ plugins: [BoxPlugin] });
}

function createBox(
  editor: ReturnType<typeof makeEditor>,
  id: string,
  x = 0,
  extra: AnyRecord = {},
): ShapeId {
  return editor.createShape({ id: sid(id), type: 'box', x, y: 0, ...extra });
}

describe('canonical fractional order keys', () => {
  it('generates deterministic, canonical keys strictly between bounds', () => {
    const [lower, upper] = generateRebalancedOrderKeys(2);
    const first = generateOrderKeysBetween(lower!, upper!, 3);
    const second = generateOrderKeysBetween(lower!, upper!, 3);

    expect(first).toEqual(second);
    expect(first.every(isCanonicalOrderKey)).toBe(true);
    expect([lower, ...first, upper]).toEqual([...[lower, ...first, upper]].sort());
  });

  it('uses shape id as the deterministic tie-break for equal sibling keys', () => {
    const index = generateRebalancedOrderKeys(1)[0]!;
    const left = { id: sid('shape:b'), index } as GlideShape;
    const right = { id: sid('shape:a'), index } as GlideShape;

    expect(compareSiblingOrder(left, right)).toBeGreaterThan(0);
    expect(getCanonicalShapeIds([left, right])).toEqual([sid('shape:a'), sid('shape:b')]);
    expect(getCanonicalShapeIds([right, left])).toEqual([sid('shape:a'), sid('shape:b')]);
  });
});

describe('GlideEditor canonical ordering', () => {
  it('uses one order for paint, spatial hit results, and SVG export', () => {
    const editor = makeEditor();
    const a = createBox(editor, 'shape:a', 0);
    const b = createBox(editor, 'shape:b', 10);
    const c = createBox(editor, 'shape:c', 20);

    expect(editor.getOrderedShapeIds()).toEqual([a, b, c]);
    expect(editor.getShapesAtPoint({ x: 50, y: 20 }).map(shape => shape.id)).toEqual([a, b, c]);
    expect(editor.getTopShapeAtPoint({ x: 50, y: 20 })?.id).toBe(c);
    expect(editor.getTopShapeAtPoint({ x: 50, y: 20 }, shape => shape.id !== c)?.id).toBe(b);

    editor.updateShape(b, { x: 11 }); // force an RBush remove/reinsert
    expect(editor.getShapesAtPoint({ x: 50, y: 20 }).map(shape => shape.id)).toEqual([a, b, c]);

    const svg = editor.exportToSvg([c, a, b]);
    expect(svg.indexOf('matrix(1 0 0 1 0 0)')).toBeLessThan(svg.indexOf('matrix(1 0 0 1 11 0)'));
    expect(svg.indexOf('matrix(1 0 0 1 11 0)')).toBeLessThan(svg.indexOf('matrix(1 0 0 1 20 0)'));
    const regionSvg = editor.exportRegionToSvg({
      x: 0, y: 0, w: 200, h: 200, minX: 0, minY: 0, maxX: 200, maxY: 200,
    });
    expect(regionSvg.indexOf('matrix(1 0 0 1 0 0)')).toBeLessThan(regionSvg.indexOf('matrix(1 0 0 1 11 0)'));
    expect(regionSvg.indexOf('matrix(1 0 0 1 11 0)')).toBeLessThan(regionSvg.indexOf('matrix(1 0 0 1 20 0)'));
  });

  it('moves a selected shape without rewriting unaffected sibling keys', () => {
    const editor = makeEditor();
    const a = createBox(editor, 'shape:a');
    const b = createBox(editor, 'shape:b');
    const c = createBox(editor, 'shape:c');
    const d = createBox(editor, 'shape:d');
    const before = new Map(editor.getShapes().map(shape => [shape.id, shape.index]));
    const changedIds: string[][] = [];
    editor.store.listen(change => changedIds.push(change.deltas.map(delta => delta.id)));

    editor.reorderShapes([b], 'forward');

    expect(editor.getOrderedShapeIds()).toEqual([a, c, b, d]);
    expect(changedIds[changedIds.length - 1]).toEqual([b]);
    expect(editor.getShape(a)?.index).toBe(before.get(a));
    expect(editor.getShape(c)?.index).toBe(before.get(c));
    expect(editor.getShape(d)?.index).toBe(before.get(d));
  });

  it('orders children within their parent and keeps reorders parent-local', () => {
    const editor = makeEditor();
    const parent = editor.createShape({ id: sid('shape:parent'), type: 'container-box', x: 0, y: 0 });
    const rootSibling = createBox(editor, 'shape:root-sibling');
    const first = createBox(editor, 'shape:first', 0, { parentId: parent });
    const second = createBox(editor, 'shape:second', 0, { parentId: parent });
    const rootIndex = editor.getShape(rootSibling)?.index;

    expect(editor.getOrderedShapeIds()).toEqual([parent, first, second, rootSibling]);
    editor.reorderShapes([second], 'back');

    expect(editor.getOrderedChildIds(parent)).toEqual([second, first]);
    expect(editor.getShape(rootSibling)?.index).toBe(rootIndex);
    expect(editor.getOrderedShapeIds()).toEqual([parent, second, first, rootSibling]);
  });

  it('owns index writes and rejects direct index mutation', () => {
    const editor = makeEditor();
    const shape = createBox(editor, 'shape:managed', 0, { index: 'caller-value' });

    expect(isCanonicalOrderKey(editor.getShape(shape)?.index)).toBe(true);
    expect(() => editor.updateShape(shape, { index: 'caller-value' } as any)).toThrow('managed by reorderShapes');
  });
});
