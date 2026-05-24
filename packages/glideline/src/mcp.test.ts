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
  it('T∞.2-01: create_shape creates a validated shape record', () => {
    const editor = makeEditor();
    const server = createCanvasToolServer(editor);

    const result = server.callTool('create_shape', {
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

  it('T∞.2-02: AI-created shapes bypass the local undo stack', () => {
    const editor = makeEditor();
    const server = createCanvasToolServer(editor);

    const result = server.callTool('create_shape', { type: 'box', x: 60, y: 80 }) as { id: ShapeId };
    editor.undo();

    expect(editor.getShape(result.id)).toBeDefined();
  });

  it('T∞.2-03: invalid params return a structured error instead of throwing', () => {
    const editor = makeEditor();
    const server = createCanvasToolServer(editor);

    const result = server.callTool('create_shape', { type: 123 });

    expect(result).toEqual(expect.objectContaining({
      error: expect.stringMatching(/string/i),
      issues: expect.any(Array),
    }));
  });

  it('T∞.2-04: create_connection creates an arrow and binding records', () => {
    const editor = makeEditor();
    const server = createCanvasToolServer(editor);
    const fromId = createBox(editor, 'shape:from', 20, 20);
    const toId = createBox(editor, 'shape:to', 280, 20);

    const result = server.callTool('create_connection', {
      fromId,
      toId,
      routeStyle: 'smart',
    }) as { id: ShapeId };

    const arrow = editor.getShape(result.id)!;
    expect(arrow.type).toBe('arrow');
    expect(editor.getBindingsToShape(toId)).toHaveLength(1);
    expect(editor.getBindingsFromShape(result.id)).toHaveLength(2);
  });

  it('T∞.2-05: get_canvas_state returns the editor AI context', () => {
    const editor = makeEditor();
    const server = createCanvasToolServer(editor);
    createBox(editor, 'shape:a', 20, 20);
    createBox(editor, 'shape:b', 280, 20);

    const result = server.callTool('get_canvas_state', {});

    expect(result).toEqual(editor.getAIContext());
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
    ]);
    for (const tool of manifest) {
      expect(() => z.fromJSONSchema(tool.inputSchema as object)).not.toThrow();
    }
  });

  it('supports update_shape and delete_shapes tool flows', () => {
    const editor = makeEditor();
    const server = createCanvasToolServer(editor);
    const created = server.callTool('create_shape', { type: 'box', x: 20, y: 20 }) as { id: ShapeId };

    const updated = server.callTool('update_shape', {
      id: created.id,
      x: 180,
      y: 60,
      props: { label: 'Updated' },
    });
    const deleted = server.callTool('delete_shapes', { ids: [created.id] });

    expect(updated).toEqual({ ok: true });
    expect(deleted).toEqual({ deleted: 1 });
    expect(editor.getShape(created.id)).toBeUndefined();
  });
});
