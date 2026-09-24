// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { createEditor } from './editor';
import { BoxUtil } from './shapes/BoxUtil';
import { ArrowPlugin } from './shapes/ArrowUtil';
import { BoxTool } from './tools/BoxTool';
import { SelectTool } from './tools/SelectTool';
import { sid, type ShapeId } from './types';
import { buildArrowBindingRecord, buildArrowShapeRecord, resolveConnectionTerminal } from './arrow-records';

const BoxPlugin = { id: 'box', shapes: [BoxUtil as any] };

function makeEditor() {
  return createEditor({
    plugins: [BoxPlugin, ArrowPlugin],
    tools: [SelectTool, BoxTool],
    viewport: { width: 220, height: 180 },
  });
}

function createBox(
  editor: ReturnType<typeof makeEditor>,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label = '',
): ShapeId {
  const shapeId = sid(id);
  editor.createShape({
    id: shapeId,
    type: 'box',
    x,
    y,
    index: `a-${id}`,
    rotation: 0,
    meta: {},
    props: {
      ...new BoxUtil().getDefaultProps(),
      w,
      h,
      label,
    },
  });
  return shapeId;
}

function createConnection(
  editor: ReturnType<typeof makeEditor>,
  id: string,
  fromId: ShapeId,
  toId: ShapeId,
): ShapeId {
  const fromBounds = editor.getShapeWorldBounds(fromId);
  const toBounds = editor.getShapeWorldBounds(toId);
  const start = resolveConnectionTerminal(editor, fromId, {
    x: toBounds.minX + toBounds.w / 2,
    y: toBounds.minY + toBounds.h / 2,
  });
  const end = resolveConnectionTerminal(editor, toId, {
    x: fromBounds.minX + fromBounds.w / 2,
    y: fromBounds.minY + fromBounds.h / 2,
  });
  if (!start || !end) {
    throw new Error('Failed to resolve connection terminals');
  }

  const arrowId = sid(id);
  const arrow = buildArrowShapeRecord({
    id: arrowId,
    startWorld: start.point,
    endWorld: end.point,
    routeStyle: 'smart',
    index: `z-${id}`,
  });
  arrow.props.start = {
    boundShapeId: fromId,
    normalizedAnchor: start.normalizedAnchor,
    point: { x: 0, y: 0 },
  };
  arrow.props.end = {
    boundShapeId: toId,
    normalizedAnchor: end.normalizedAnchor,
    point: { x: end.point.x - start.point.x, y: end.point.y - start.point.y },
  };

  editor.createShape(arrow as any);
  editor.createBinding(buildArrowBindingRecord({
    id: `bind-${id}-start`,
    fromId: arrowId,
    toId: fromId,
    terminal: 'start',
    normalizedAnchor: start.normalizedAnchor,
  }));
  editor.createBinding(buildArrowBindingRecord({
    id: `bind-${id}-end`,
    fromId: arrowId,
    toId: toId,
    terminal: 'end',
    normalizedAnchor: end.normalizedAnchor,
  }));

  return arrowId;
}

describe('Phase Infinity AI context', () => {
  it('T∞.1-01: returns plain shape entries with bounds metadata', () => {
    const editor = makeEditor();
    createBox(editor, 'shape:box-1', 20, 20, 100, 60, 'First');
    createBox(editor, 'shape:box-2', 180, 20, 80, 50, 'Second');
    createBox(editor, 'shape:box-3', 20, 120, 120, 70, 'Third');

    const context = editor.getAIContext();

    expect(context.shapes).toHaveLength(3);
    expect(context.shapes[0]).toEqual(expect.objectContaining({
      id: expect.any(String),
      type: 'box',
      x: expect.any(Number),
      y: expect.any(Number),
      w: expect.any(Number),
      h: expect.any(Number),
      rotation: expect.any(Number),
    }));
  });

  it('T∞.1-02: returns connection entries for bound arrows', () => {
    const editor = makeEditor();
    const fromId = createBox(editor, 'shape:source', 20, 20, 100, 60, 'Source');
    const toId = createBox(editor, 'shape:target', 180, 20, 100, 60, 'Target');
    const arrowId = createConnection(editor, 'shape:connection', fromId, toId);

    const context = editor.getAIContext();

    expect(context.shapes.every(shape => shape.type !== 'arrow')).toBe(true);
    expect(context.connections).toEqual([
      expect.objectContaining({
        id: arrowId,
        fromId,
        toId,
        routeStyle: 'smart',
      }),
    ]);
  });

  it('T∞.1-03: filters shapes to the current viewport when requested', () => {
    const editor = makeEditor();
    createBox(editor, 'shape:visible-1', 20, 20, 100, 60);
    createBox(editor, 'shape:visible-2', 100, 100, 60, 60);
    createBox(editor, 'shape:hidden', 420, 420, 100, 60);

    const context = editor.getAIContext({ viewport: true });

    expect(context.shapes.map(shape => shape.id)).toEqual([
      sid('shape:visible-1'),
      sid('shape:visible-2'),
    ]);
  });

  it('T∞.1-04: serializes to plain JSON without signals or DOM nodes', () => {
    const editor = makeEditor();
    const fromId = createBox(editor, 'shape:json-a', 20, 20, 100, 60, 'Alpha');
    const toId = createBox(editor, 'shape:json-b', 180, 20, 100, 60, 'Beta');
    createConnection(editor, 'shape:json-connection', fromId, toId);

    const context = editor.getAIContext();
    const roundTripped = JSON.parse(JSON.stringify(context));

    expect(roundTripped).toEqual(context);
  });

  it('T∞.1-05: takeScreenshot returns a base64 data URL', async () => {
    const editor = makeEditor();
    vi.spyOn(editor, 'exportRegionToPng').mockResolvedValue(new Blob(['png'], { type: 'image/png' }));

    const screenshot = await editor.takeScreenshot();

    expect(screenshot.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('T∞.1-06: includes the current viewport bounds in the output', () => {
    const editor = makeEditor();
    createBox(editor, 'shape:viewport', 20, 20, 100, 60);

    const context = editor.getAIContext();

    expect(context.viewport).toEqual(editor.getViewportBounds());
  });
});
