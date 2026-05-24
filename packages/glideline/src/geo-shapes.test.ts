import { describe, it, expect } from 'vitest';
import { Polygon2d } from './geometry';
import { TriangleUtil, GeoShapePlugin } from './shapes/GeoShapeUtil';
import { createEditor } from './editor';
import { SelectTool } from './tools/SelectTool';
import { TriangleTool } from './tools/GeoShapeTools';
import { sid } from './types';

describe('Polygon2d', () => {
  it('hit tests inside and outside a triangle', () => {
    const polygon = new Polygon2d([
      { x: 50, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);

    expect(polygon.hitTestPoint({ x: 50, y: 60 })).toBe(true);
    expect(polygon.hitTestPoint({ x: 50, y: 110 })).toBe(false);
  });
});

describe('TriangleUtil', () => {
  it('returns local geometry for a triangle shape', () => {
    const util = new TriangleUtil();
    const shape = {
      id: sid('triangle:1'),
      type: 'triangle',
      x: 100,
      y: 50,
      index: 'a1',
      rotation: 0,
      meta: {},
      props: { ...util.getDefaultProps(), w: 120, h: 90 },
    };

    const bounds = util.getGeometry(shape).getBounds();
    expect(bounds.minX).toBe(0);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxX).toBe(120);
    expect(bounds.maxY).toBe(90);
  });
});

describe('TriangleTool', () => {
  it('creates a triangle shape by drag', () => {
    const editor = createEditor({
      plugins: [GeoShapePlugin],
      tools: [SelectTool, TriangleTool],
    });

    editor.setCurrentTool('triangle');
    editor.dispatchEvent({ type: 'pointerDown', point: { x: 10, y: 20 }, shiftKey: false, target: 'canvas' });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 90, y: 100 } });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 90, y: 100 } });

    const shapes = editor.getShapes();
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.type).toBe('triangle');
    expect((shapes[0]?.props as any).w).toBe(80);
    expect((shapes[0]?.props as any).h).toBe(80);
  });
});
