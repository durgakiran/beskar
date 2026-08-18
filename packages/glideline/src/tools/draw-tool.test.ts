import { describe, it, expect } from 'vitest';
import { createEditor } from '../editor';
import { FreehandUtil, pressureStrokePath } from '../shapes/FreehandUtil';
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

function pd(editor: ReturnType<typeof makeEditor>, x: number, y: number, pressure?: number, pointerType?: string) {
  editor.dispatchEvent({ type: 'pointerDown', point: { x, y }, shiftKey: false, target: 'canvas', pressure, pointerType });
}
function pm(editor: ReturnType<typeof makeEditor>, x: number, y: number, pressure?: number, pointerType?: string) {
  editor.dispatchEvent({ type: 'pointerMove', point: { x, y }, pressure, pointerType });
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

  it('stores real stylus pressure when pressure mode is active', () => {
    const editor = makeEditor();
    editor.activeStyles.value = { ...editor.activeStyles.peek(), pressureSensitive: true };

    pd(editor, 10, 10, 0.2, 'pen');
    pm(editor, 20, 20, 0.8, 'pen');
    pm(editor, 30, 25, 0.4, 'pen');
    pu(editor, 30, 25);

    const shape = editor.getShapesInBox({ minX: 0, minY: 0, maxX: 100, maxY: 100 })[0]!;
    expect(shape.props).toMatchObject({
      pressureSensitive: true,
      simulatePressure: false,
      points: [
        { x: 10, y: 10, pressure: 0.2 },
        { x: 20, y: 20, pressure: 0.8 },
        { x: 30, y: 25, pressure: 0.4 },
      ],
    });
  });

  it('simulates pressure for mouse-drawn pressure strokes', () => {
    const editor = makeEditor();
    editor.activeStyles.value = { ...editor.activeStyles.peek(), pressureSensitive: true };

    pd(editor, 10, 10, 0.5, 'mouse');
    pm(editor, 20, 20, 0.5, 'mouse');
    pu(editor, 20, 20);

    const shape = editor.getShapesInBox({ minX: 0, minY: 0, maxX: 100, maxY: 100 })[0]!;
    expect(shape.props).toMatchObject({ pressureSensitive: true, simulatePressure: true });
  });

  it('creates a closed variable-width outline', () => {
    const path = pressureStrokePath([
      [0, 0, 0.15],
      [10, 5, 0.9],
      [20, 0, 0.3],
    ], 8, false);

    expect(path).toMatch(/^M /);
    expect(path).toMatch(/ Z$/);
  });
});
