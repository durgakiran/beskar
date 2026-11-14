import { describe, expect, it } from 'vitest';
import { createEditor } from './editor.js';
import { ArrowPlugin, type ArrowShape } from './shapes/ArrowUtil.js';
import { BoxUtil } from './shapes/BoxUtil.js';
import { EllipsePlugin } from './shapes/EllipseUtil.js';
import { FrameUtil } from './shapes/FrameUtil.js';
import { GroupUtil } from './shapes/GroupUtil.js';
import { FreehandPlugin } from './shapes/FreehandUtil.js';
import { GeoShapePlugin, P1ShapesPlugin } from './shapes/GeoShapeUtil.js';
import { SanitizedAssetPlugin } from './shapes/SanitizedSvgUtil.js';
import { StickyNotePlugin } from './shapes/StickyNoteUtil.js';
import { TextUtil } from './shapes/TextUtil.js';
import { ShapeUtil } from './shapes/ShapeUtil.js';
import { Rectangle2d } from './geometry/index.js';
import { ArrowTool } from './tools/ArrowTool.js';
import { SelectTool } from './tools/SelectTool.js';
import { resolveArrowRoute } from './arrow-routing.js';
import { buildArrowBindingRecord, buildArrowShapeRecord } from './arrow-records.js';
import { type AnyRecord, type ShapeId, type Vec2 } from './types.js';

class ConsumerShape extends ShapeUtil {
  static override readonly type = 'consumer-shape';
  getDefaultProps() { return {}; }
  getGeometry() { return new Rectangle2d(10, 20, 100, 50); }
}

function setup() {
  const editor = createEditor({
    plugins: [
      ArrowPlugin, EllipsePlugin, GeoShapePlugin, P1ShapesPlugin, SanitizedAssetPlugin,
      StickyNotePlugin, FreehandPlugin,
      { id: 'anchor-test-shapes', shapes: [BoxUtil, FrameUtil, GroupUtil, TextUtil, ConsumerShape] as any },
    ],
    tools: [SelectTool, ArrowTool],
  });

  function shape(type: string, x = 0, y = 0, props: AnyRecord = {}) {
    if (type === 'raster-image' || type === 'sanitized-svg') {
      const assetId = `asset:${type}`;
      const raster = type === 'raster-image';
      const result = editor.importRecords([{
        id: assetId, type, kind: 'asset', schemaVersion: 1, meta: {},
        props: {
          hash: 'a'.repeat(64), byteLength: 128, width: 100, height: 50,
          mimeType: raster ? 'image/png' : 'image/svg+xml',
          ...(!raster ? {
            sanitizerVersion: 1, viewBox: [0, 0, 100, 50],
            paths: [{ d: 'M 10 10 L 30 10 L 30 30 Z', fill: '#123456', stroke: 'none' }],
          } : {}),
        },
      }]);
      props = { ...props, assetId: result.idMap[assetId] ?? assetId };
    }
    return editor.createShape({ type, x, y, props });
  }

  return { editor, shape };
}

describe('connector binding points', () => {
  it.each([
    ['box', 16], ['rounded-rect', 16], ['ellipse', 8], ['triangle', 6], ['diamond', 8],
    ['hexagon', 12], ['star', 10], ['parallelogram', 16], ['chevron', 12], ['document', 12],
    ['cylinder', 12], ['note', 10], ['callout', 8], ['sticky-note', 8], ['frame', 16],
    ['text', 4], ['freehand', 0], ['group', 0], ['arrow', 0], ['raster-image', 8],
    ['sanitized-svg', 8], ['consumer-shape', 8],
  ] as const)('provides %s with %i distinct points', (type, count) => {
    const { editor, shape } = setup();
    const id = shape(type);
    const points = editor.transforms.getConnectionAnchors(id);
    expect(new Set(points.map(p => JSON.stringify(p.point))).size).toBe(count);
  });

  it('shows the inner point before pointer down and routes from it through an enclosing rectangle', () => {
    const { editor, shape } = setup();
    const outer = shape('box', 0, 0, { w: 400, h: 320 });
    const inner = shape('box', 100, 100, { w: 100, h: 80 });
    editor.setCurrentTool('arrow');

    const nearInner = { x: 125, y: 94 };
    editor.dispatchEvent({ type: 'pointerMove', point: nearInner });
    expect(editor.bindingPreview.peek()).toMatchObject({
      terminal: 'start', targetId: inner, point: { x: 125, y: 100 },
    });

    editor.dispatchEvent({ type: 'pointerDown', point: nearInner, target: 'shape', shapeId: outer, shiftKey: false });
    const nearOuter = { x: 398, y: 80 };
    editor.dispatchEvent({ type: 'pointerMove', point: nearOuter });
    expect(editor.bindingPreview.peek()).toMatchObject({
      terminal: 'end', targetId: outer, point: { x: 400, y: 80 },
      sourceCandidate: { targetId: inner, point: { x: 125, y: 100 } },
    });
    editor.dispatchEvent({ type: 'pointerUp', point: nearOuter });

    const arrow = editor.getShape<ArrowShape>(editor.getSelectedShapeIds()[0]!)!;
    expect(editor.getBindingsFromShape(arrow.id as ShapeId).map(b => b.toId)).toEqual([inner, outer]);
    expect(resolveArrowRoute(editor, arrow).worldPoints).toEqual([
      { x: 125, y: 100 }, { x: 125, y: 80 }, { x: 400, y: 80 },
    ]);
    expect(editor.bindingPreview.peek()).toBeNull();
  });

  it('uses a screen-space snap radius at different zooms', () => {
    const { editor, shape } = setup();
    const id = shape('box', 100, 100, { w: 100, h: 80 });
    editor.setCurrentTool('arrow');

    for (const z of [0.5, 1, 2]) {
      editor.camera.setCamera({ z });
      editor.dispatchEvent({ type: 'pointerMove', point: { x: 150, y: 100 - 10 / z } });
      expect(editor.bindingPreview.peek()?.targetId).toBe(id);
      editor.dispatchEvent({ type: 'pointerMove', point: { x: 150, y: 100 - 14 / z } });
      expect(editor.bindingPreview.peek()).toBeNull();
    }
  });

  it('follows a rounded corner during resize, after commit, and after reloading the binding', () => {
    const { editor, shape } = setup();
    const id = shape('rounded-rect', 100, 100, { w: 100, h: 80 });
    const target = shape('box', 500, 100, { w: 80, h: 80 });
    const radius = (h: number) => h * 0.15 * (1 - Math.SQRT1_2);
    editor.setCurrentTool('arrow');
    const corner = { x: 200 - radius(80), y: 100 + radius(80) };
    editor.dispatchEvent({ type: 'pointerDown', point: corner, target: 'shape', shapeId: id, shiftKey: false });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 500, y: 140 } });

    const arrowId = editor.getSelectedShapeIds()[0]!;
    const binding = () => editor.getBindingsFromShape(arrowId).find(b => b.props.terminal === 'start')!;
    expect(binding().props).toMatchObject({ anchorMode: 'geometry', normalizedAnchor: { x: 1, y: 0 } });
    expect(editor.getShape<ArrowShape>(arrowId)!.props.end.boundShapeId).toBe(target);

    function checkPosition(w: number, h: number) {
      const expected = { x: 100 + w - radius(h), y: 100 + radius(h) };
      const arrow = editor.getShape<ArrowShape>(arrowId)!;
      const point = resolveArrowRoute(editor, arrow).worldPoints[0]!;
      expect(point.x).toBeCloseTo(expected.x);
      expect(point.y).toBeCloseTo(expected.y);
      return expected;
    }

    editor.setSelectedShapeIds([id]);
    editor.dispatchEvent({ type: 'pointerDown', point: { x: 200, y: 180 }, target: 'handle', handleId: 'se', shiftKey: false });
    for (const [w, h] of [[130, 90], [165, 105], [200, 120]] as const) {
      editor.dispatchEvent({ type: 'pointerMove', point: { x: 100 + w, y: 100 + h }, altKey: true });
      checkPosition(w, h);
    }
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 300, y: 220 }, altKey: true });
    const committed = checkPosition(200, 120);
    editor.setCurrentTool('arrow');
    editor.dispatchEvent({ type: 'pointerMove', point: committed });
    expect(editor.bindingPreview.peek()).toMatchObject({ targetId: id, point: committed });

    editor.replaceDocument(JSON.parse(JSON.stringify(editor.serialize())));
    editor.updateShape(id, { props: { w: 250, h: 140 } });
    checkPosition(250, 140);
  });

  it('keeps legacy bounds coordinates on the same rounded shape', () => {
    const { editor, shape } = setup();
    const target = shape('rounded-rect', 100, 100, { w: 100, h: 80 });
    const arrowId = editor.createShapeId('arrow');
    editor.createShape(buildArrowShapeRecord({ id: arrowId, startWorld: { x: 0, y: 0 }, endWorld: { x: 200, y: 100 } }) as unknown as AnyRecord);
    editor.createBinding(buildArrowBindingRecord({ fromId: arrowId, toId: target, terminal: 'end', normalizedAnchor: { x: 1, y: 0 } }));
    editor.updateShape(target, { props: { w: 200, h: 120 } });
    expect(editor.getShape<ArrowShape>(arrowId)!.props.end.point).toEqual({ x: 300, y: 100 });
  });

  it('projects ellipse diagonals and keeps concave star anchors on rotated vertices', () => {
    const { editor, shape } = setup();
    const ellipse = shape('ellipse', 0, 0, { w: 200, h: 100 });
    const diagonal = editor.transforms.getConnectionAnchors(ellipse).find(a => a.normalizedAnchor.x === 1 && a.normalizedAnchor.y === 0)!;
    expect(diagonal.point.x).toBeCloseTo(100 + 100 * Math.SQRT1_2);
    expect(diagonal.point.y).toBeCloseTo(50 - 50 * Math.SQRT1_2);

    const star = shape('star', 100, 200, { w: 100, h: 220 });
    editor.updateShape(star, { rotation: Math.PI / 4 });
    const vertices = editor.getShapeLocalOutline(star).map(p => editor.localToPage(star, p));
    for (const anchor of editor.transforms.getConnectionAnchors(star)) {
      expect(vertices.some((v: Vec2) => Math.hypot(v.x - anchor.point.x, v.y - anchor.point.y) < 1e-8)).toBe(true);
    }
  });
});
