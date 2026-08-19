import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEditor } from './editor';
import { BoxUtil } from './shapes/BoxUtil';
import { ArrowPlugin } from './shapes/ArrowUtil';
import { BoxTool } from './tools/BoxTool';
import { SelectTool } from './tools/SelectTool';
import { sid, type ShapeId } from './types';
import { createCanvasToolServer } from './mcp';

const BoxPlugin = { id: 'box', shapes: [BoxUtil as any] };

function makeEditor() {
  return createEditor({
    plugins: [BoxPlugin, ArrowPlugin],
    tools: [SelectTool, BoxTool],
  });
}

function createBox(editor: ReturnType<typeof makeEditor>, id: string, x: number, y: number): ShapeId {
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
      w: 120,
      h: 80,
      label: id,
    },
  });
  return shapeId;
}

describe('Phase Infinity MCP tool server', () => {
  it('T∞.2-01: create_shape creates a validated shape record', async () => {
    const editor = makeEditor();
    const server = createCanvasToolServer(editor);

    const result = await server.callTool('create_shape', {
      type: 'box',
      x: 100,
      y: 100,
      props: { w: 140, h: 90, label: 'Created by MCP' },
    });

    expect(result).toEqual(expect.objectContaining({ id: expect.any(String) }));
    const shape = editor.getShape((result as { id: ShapeId }).id)!;
    expect(shape.type).toBe('box');
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
  });

  it('T∞.2-02: AI-created shapes are one local undo command', async () => {
    const editor = makeEditor();
    const server = createCanvasToolServer(editor);

    const result = await server.callTool('create_shape', { type: 'box', x: 60, y: 80 }) as { id: ShapeId };
    expect(editor.history.undoStack[editor.history.undoStack.length - 1]?.label).toBe('AI: Create Shape');
    editor.undo();

    expect(editor.getShape(result.id)).toBeUndefined();
  });

  it('T∞.2-03: invalid params return a structured error instead of throwing', async () => {
    const editor = makeEditor();
    const server = createCanvasToolServer(editor);

    const result = await server.callTool('create_shape', { type: 123 });

    expect(result).toEqual(expect.objectContaining({
      error: expect.any(String),
      issues: expect.any(Array),
    }));
  });

  it('T∞.2-04: create_connection creates an arrow and binding records', async () => {
    const editor = makeEditor();
    const server = createCanvasToolServer(editor);
    const fromId = createBox(editor, 'shape:from', 20, 20);
    const toId = createBox(editor, 'shape:to', 280, 20);

    const result = await server.callTool('create_connection', {
      fromId,
      toId,
      routeStyle: 'smart',
    }) as { id: ShapeId };

    const arrow = editor.getShape(result.id)!;
    expect(arrow.type).toBe('arrow');
    expect(editor.getBindingsToShape(toId)).toHaveLength(1);
    expect(editor.getBindingsFromShape(result.id)).toHaveLength(2);
  });

  it('T∞.2-05: get_canvas_state returns the editor AI context', async () => {
    const editor = makeEditor();
    const server = createCanvasToolServer(editor);
    createBox(editor, 'shape:a', 20, 20);
    createBox(editor, 'shape:b', 280, 20);

    const result = await server.callTool('get_canvas_state', {});

    expect(result).toEqual(editor.getAIContext());
  });

  it('exposes hierarchy-aware arrange and precision tools', async () => {
    const editor = makeEditor();
    const server = createCanvasToolServer(editor);
    const first = createBox(editor, 'shape:arrange-a', 20, 20);
    const second = createBox(editor, 'shape:arrange-b', 280, 100);

    expect(await server.callTool('arrange_shapes', {
      shapeIds: [first, second], operation: 'align-top',
    })).toEqual({ ok: true });
    expect(editor.getShapeVisualWorldBounds(first).minY)
      .toBeCloseTo(editor.getShapeVisualWorldBounds(second).minY, 7);

    expect(await server.callTool('set_shape_geometry', { id: first, x: 160, y: 140 }))
      .toEqual({ ok: true });
    expect(editor.getShapeVisualWorldBounds(first).minX).toBeCloseTo(160, 7);
    expect(editor.getShapeVisualWorldBounds(first).minY).toBeCloseTo(140, 7);
  });

  it('T∞.2-06: tool manifest is generated from Zod and round-trips as JSON Schema', () => {
    const editor = makeEditor();
    const server = createCanvasToolServer(editor);

    const manifest = server.generateToolManifest();

    expect(manifest.map(tool => tool.name)).toEqual([
      'create_shape',
      'update_shape',
      'delete_shapes',
      'create_connection',
      'get_canvas_state',
      'create_diagram',
      'layout_shapes',
      'arrange_shapes',
      'set_shape_geometry',
      'reparent_shapes',
      'get_canvas_image',
    ]);
    for (const tool of manifest) {
      expect(() => z.fromJSONSchema(tool.inputSchema as any)).not.toThrow();
    }
  });

  it('supports update_shape and delete_shapes tool flows', async () => {
    const editor = makeEditor();
    const server = createCanvasToolServer(editor);
    const created = await server.callTool('create_shape', { type: 'box', x: 20, y: 20 }) as { id: ShapeId };

    const updated = await server.callTool('update_shape', {
      id: created.id,
      x: 180,
      y: 60,
      props: { label: 'Updated' },
    });
    const deleted = await server.callTool('delete_shapes', { ids: [created.id] });

    expect(updated).toEqual({ ok: true });
    expect(deleted).toEqual({ deleted: 1 });
    expect(editor.getShape(created.id)).toBeUndefined();

    expect(editor.history.undoStack[editor.history.undoStack.length - 1]?.label).toBe('AI: Delete Shapes');
    editor.undo();
    expect(editor.getShape(created.id)).toMatchObject({ x: 180, y: 60 });
    editor.undo();
    expect(editor.getShape(created.id)).toMatchObject({ x: 20, y: 20 });
  });
});
