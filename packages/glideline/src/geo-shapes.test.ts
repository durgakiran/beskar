import { describe, it, expect } from 'vitest';
import { Polygon2d } from './geometry';
import {
  TriangleUtil, GeoShapePlugin,
  RoundedRectUtil, ParallelogramUtil, ChevronUtil,
  DocumentUtil, CylinderUtil, NoteUtil, CalloutUtil,
  P1ShapesPlugin,
} from './shapes/GeoShapeUtil';
import { createEditor } from './editor';
import { SelectTool } from './tools/SelectTool';
import {
  TriangleTool, RoundedRectTool, ParallelogramTool, ChevronTool,
  DocumentTool, CylinderTool, NoteTool, CalloutTool,
} from './tools/GeoShapeTools';
import { sid } from './types';
import type { GlideShape } from './types';
import { createSvgPathShape } from './shapes/createSvgPathShape';

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

function makeTestShape<P extends Record<string, unknown>>(
  util: { new(): { getDefaultProps(): P } },
  type: string,
  overrides: Partial<P> = {},
): GlideShape<P> {
  const inst = new util();
  return {
    id: sid(`${type}-test`), type,
    x: 0, y: 0, index: 'a1', rotation: 0, meta: {},
    props: { ...inst.getDefaultProps(), ...overrides },
  } as any;
}

const P1_UTILS: Array<{ Util: any; type: string }> = [
  { Util: RoundedRectUtil, type: 'rounded-rect' },
  { Util: ParallelogramUtil, type: 'parallelogram' },
  { Util: ChevronUtil, type: 'chevron' },
  { Util: DocumentUtil, type: 'document' },
  { Util: CylinderUtil, type: 'cylinder' },
  { Util: NoteUtil, type: 'note' },
  { Util: CalloutUtil, type: 'callout' },
];

describe('P1 shapes', () => {
  for (const { Util, type } of P1_UTILS) {
    it(`${type}: returns expected geometry and label props`, () => {
      const util = new Util();
      const shape = makeTestShape(Util, type, { w: 120, h: 80 });
      const bounds = util.getGeometry(shape).getBounds();
      expect(bounds.w).toBe(120);
      expect(bounds.h).toBe(80);
      expect(util.getLabelProps(shape)).not.toBeNull();
    });
  }
});

describe('P1 shape tools', () => {
  const tools: Array<{ Tool: any; type: string }> = [
    { Tool: RoundedRectTool, type: 'rounded-rect' },
    { Tool: ParallelogramTool, type: 'parallelogram' },
    { Tool: ChevronTool, type: 'chevron' },
    { Tool: DocumentTool, type: 'document' },
    { Tool: CylinderTool, type: 'cylinder' },
    { Tool: NoteTool, type: 'note' },
    { Tool: CalloutTool, type: 'callout' },
  ];

  for (const { Tool, type } of tools) {
    it(`${type}: drag creates the expected shape`, () => {
      const editor = createEditor({ plugins: [P1ShapesPlugin], tools: [SelectTool, Tool] });
      editor.setCurrentTool(type);
      editor.dispatchEvent({ type: 'pointerDown', point: { x: 10, y: 20 }, shiftKey: false, target: 'canvas' });
      editor.dispatchEvent({ type: 'pointerMove', point: { x: 90, y: 100 } });
      editor.dispatchEvent({ type: 'pointerUp', point: { x: 90, y: 100 } });
      const shapes = editor.getShapes();
      expect(shapes).toHaveLength(1);
      expect(shapes[0]?.type).toBe(type);
      expect((shapes[0]?.props as any).w).toBe(80);
      expect((shapes[0]?.props as any).h).toBe(80);
    });
  }
});

describe('createSvgPathShape factory', () => {
  it('creates a working plugin, util, and tool', () => {
    const { util: UtilClass, tool: ToolClass, plugin } = createSvgPathShape({
      type: 'test-custom',
      defaultSize: { w: 100, h: 60 },
      getPathD: (w, h) => `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`,
    });
    expect(plugin.id).toBe('custom-shape-test-custom');
    expect((UtilClass as any).type).toBe('test-custom');
    expect((ToolClass as any).id).toBe('test-custom');
    const util = new (UtilClass as any)();
    const shape = makeTestShape(UtilClass as any, 'test-custom');
    const bounds = util.getGeometry(shape).getBounds();
    expect(bounds.w).toBe(100);
    expect(bounds.h).toBe(60);
    expect(util.getLabelProps(shape)).not.toBeNull();

    const editor = createEditor({ plugins: [plugin], tools: [SelectTool] });
    editor.setCurrentTool('test-custom');
    editor.dispatchEvent({ type: 'pointerDown', point: { x: 5, y: 10 }, shiftKey: false, target: 'canvas' });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 105, y: 70 } });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 105, y: 70 } });
    expect(editor.getShapes()[0]?.type).toBe('test-custom');
  });
});
