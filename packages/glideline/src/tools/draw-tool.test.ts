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
function pc(editor: ReturnType<typeof makeEditor>) {
  editor.dispatchEvent({ type: 'pointerCancel' });
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

  it('includes a final pointerUp sample when no pointerMove was delivered', () => {
    const editor = makeEditor();

    pd(editor, 100, 100);
    pu(editor, 140, 120);

    const shape = editor.getShapesInBox({ minX: 0, minY: 0, maxX: 200, maxY: 200 })[0]!;
    expect(shape.props.points).toEqual([
      { x: 100, y: 100, pressure: 0.5 },
      { x: 140, y: 120, pressure: 0.5 },
    ]);
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

  it('keeps coalesced bends and pressure at high zoom and ends at the release point', () => {
    const editor = makeEditor();
    editor.camera.setCamera({ z: 4 });
    pd(editor, 10, 10, 0.2, 'pen');
    const samples = [
      { x: 10.5, y: 11, pressure: 0.7 },
      { x: 11, y: 10, pressure: 0.4 },
    ];
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 11, y: 10 }, pressure: 0.4, samples });
    pu(editor, 11.1, 10);

    const [shape] = editor.getShapesInBox({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(shape!.props.points).toEqual([
      { x: 10, y: 10, pressure: 0.2 }, ...samples, { x: 11.1, y: 10, pressure: 0.5 },
    ]);
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

  it('commits the stroke drawn so far on pointerCancel instead of discarding it', () => {
    const editor = makeEditor();

    pd(editor, 100, 100);
    pm(editor, 110, 110);
    pm(editor, 120, 120);
    pc(editor);

    // A browser/OS-initiated cancel (e.g. trackpad gesture disambiguation)
    // should keep the drawn stroke, not throw it away like Escape does.
    expect(shapeCount(editor)).toBe(1);
    expect(editor.currentToolId.value).toBe('draw');

    const shape = editor.getShapesInBox({ minX: 0, minY: 0, maxX: 200, maxY: 200 })[0]!;
    expect(shape.props.points).toEqual([
      { x: 100, y: 100, pressure: 0.5 },
      { x: 110, y: 110, pressure: 0.5 },
      { x: 120, y: 120, pressure: 0.5 },
    ]);
  });

  it('discards a stationary tap interrupted by pointerCancel', () => {
    const editor = makeEditor();

    pd(editor, 100, 100);
    pc(editor);

    expect(shapeCount(editor)).toBe(0);
  });

  it('commits a tap as a single selectable dot', () => {
    const editor = makeEditor();
    pd(editor, 10, 20);
    pu(editor, 10, 20);
    const shape = editor.getTopShapeAtPoint({ x: 10, y: 20 });
    expect(shape?.props.points).toEqual([{ x: 10, y: 20, pressure: 0.5 }]);
    expect(shape?.props.isComplete).toBe(true);
    editor.undo();
    expect(shapeCount(editor)).toBe(0);
    editor.redo();
    expect(editor.getTopShapeAtPoint({ x: 10, y: 20 })?.id).toBe(shape?.id);
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
