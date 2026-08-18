import { describe, expect, it } from 'vitest';
import { createGlideboardEditorInstance } from './editor';

function createBoxRecord(id: string, x: number, y: number) {
  return {
    id,
    type: 'box',
    x,
    y,
    index: 'a0001',
    rotation: 0,
    props: {
      w: 120,
      h: 80,
      label: '',
    },
    meta: {},
  };
}

describe('createGlideboardEditorInstance', () => {
  it('registers the interactive drawing tools used by the UI', () => {
    const editor = createGlideboardEditorInstance();

    editor.setCurrentTool('box');
    expect(editor.currentToolId.peek()).toBe('box');

    editor.setCurrentTool('arrow');
    expect(editor.currentToolId.peek()).toBe('arrow');

    editor.setCurrentTool('asset');
    expect(editor.currentToolId.peek()).toBe('asset');
  });

  it('creates a bound arrow connection when dragged between two boxes', () => {
    const editor = createGlideboardEditorInstance();

    editor.createShape(createBoxRecord('box:a', 40, 120) as any);
    editor.createShape(createBoxRecord('box:b', 320, 120) as any);
    editor.setCurrentTool('arrow');

    editor.dispatchEvent({
      type: 'pointerDown',
      point: { x: 152, y: 160 },
      shiftKey: false,
      target: 'shape',
      shapeId: 'box:a',
    } as any);

    expect(editor.bindingPreview.peek()).toMatchObject({
      terminal: 'start',
      targetId: 'box:a',
    });

    editor.dispatchEvent({ type: 'pointerMove', point: { x: 328, y: 160 } } as any);
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 328, y: 160 } } as any);

    expect(editor.getAIContext().connections).toEqual([
      expect.objectContaining({
        fromId: 'box:a',
        toId: 'box:b',
        routeStyle: 'ortho',
      }),
    ]);
  });
});
