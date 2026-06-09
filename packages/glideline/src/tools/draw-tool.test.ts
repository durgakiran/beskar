import { describe, it, expect } from 'vitest';
import { createEditor } from '../editor';
import { FreehandUtil } from '../shapes/FreehandUtil';
import { DrawTool } from './DrawTool';
import type { GlidePlugin } from '../editor';

const FreehandPlugin: GlidePlugin = { id: 'freehand', shapes: [FreehandUtil as any] };
const makeEditor = () => {
  const e = createEditor({ plugins: [FreehandPlugin], tools: [DrawTool] });
  e.setCurrentTool('draw');
  return e;
};

function shapeCount(editor: ReturnType<typeof makeEditor>): number {
  return editor.getShapesInBox({ minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 }).length;
}

function pd(editor: ReturnType<typeof makeEditor>, x: number, y: number) {
  editor.dispatchEvent({ type: 'pointerDown', point: { x, y }, shiftKey: false, target: 'canvas' });
}
function pm(editor: ReturnType<typeof makeEditor>, x: number, y: number) {
  editor.dispatchEvent({ type: 'pointerMove', point: { x, y } });
}
function pu(editor: ReturnType<typeof makeEditor>, x: number, y: number) {
  editor.dispatchEvent({ type: 'pointerUp', point: { x, y } });
}

describe('DrawTool FSM', () => {
  it('stays active in draw tool after drawing a stroke', () => {
    const editor = makeEditor();
    
    expect(editor.currentToolId.value).toBe('draw');

    pd(editor, 100, 100);
    pm(editor, 110, 110);
    pm(editor, 120, 120);
    pu(editor, 120, 120);

    // Stroke committed
    expect(shapeCount(editor)).toBe(1);

    // Current tool should still be draw!
    expect(editor.currentToolId.value).toBe('draw');
  });
});
