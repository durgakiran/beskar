/**
 * Unit tests: SelectTool FSM (Story 3.2)
 * Covers: T3.2-01 through T3.2-07
 */

import { describe, it, expect } from 'vitest';
import { createEditor, getMutableStoreForTesting } from '../editor';
import { BoxUtil } from '../shapes/BoxUtil';
import { sid } from '../types';
import type { GlidePlugin } from '../editor';
import type { GlideEvent } from '../state-node';

const BoxPlugin: GlidePlugin = { id: 'box', shapes: [BoxUtil as any] };
const makeEditor = () => {
  const e = createEditor({ plugins: [BoxPlugin] });
  e.setCurrentTool('select');
  return e;
};

function boxShape(id: string, x = 0, y = 0, w = 100, h = 80) {
  return {
    id: sid(id), type: 'box', x, y,
    index: 'a1', rotation: 0, meta: {},
    props: { ...new BoxUtil().getDefaultProps(), w, h, cornerRadius: 0, color: '#fff', label: '' },
  };
}

/** Hit test helpers — dispatch events to simulate pointer interaction */
function pointerDown(e: ReturnType<typeof makeEditor>, x: number, y: number, opts: { shiftKey?: boolean; shapeId?: string } = {}): void {
  const shape = opts.shapeId ? e.getShape(sid(opts.shapeId)) : undefined;
  const ev: GlideEvent = {
    type: 'pointerDown',
    point: { x, y },
    shiftKey: opts.shiftKey ?? false,
    target: shape ? 'shape' : 'canvas',
    shapeId: shape ? (sid(opts.shapeId!) as any) : undefined,
  };
  e.dispatchEvent(ev);
}

function pointerMove(e: ReturnType<typeof makeEditor>, x: number, y: number): void {
  e.dispatchEvent({ type: 'pointerMove', point: { x, y } });
}

function pointerUp(e: ReturnType<typeof makeEditor>, x: number, y: number): void {
  e.dispatchEvent({ type: 'pointerUp', point: { x, y } });
}

function pointerDownHandle(
  e: ReturnType<typeof makeEditor>,
  x: number,
  y: number,
  handleId: string,
): void {
  e.dispatchEvent({
    type: 'pointerDown',
    point: { x, y },
    shiftKey: false,
    target: 'handle',
    handleId,
  });
}

function keyDown(e: ReturnType<typeof makeEditor>, key: string): void {
  e.dispatchEvent({ type: 'keyDown', key });
}

// ─────────────────────────────────────────────────────────────
// T3.2-01: Click selects shape
// ─────────────────────────────────────────────────────────────

describe('T3.2-01: click selects shape', () => {
  it('pointerDown + pointerUp on shape → selected', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([boxShape('s1', 0, 0)]);

    pointerDown(editor, 50, 40, { shapeId: 's1' });
    pointerUp(editor, 50, 40);

    expect(editor.getSelectedShapeIds()).toContain(sid('s1'));
  });
});

// ─────────────────────────────────────────────────────────────
// T3.2-02: Click canvas deselects all
// ─────────────────────────────────────────────────────────────

describe('T3.2-02: click canvas deselects', () => {
  it('pointerDown on empty canvas → selection empty', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([boxShape('s2', 0, 0)]);
    editor.setSelectedShapeIds([sid('s2')]);

    pointerDown(editor, 500, 500); // no shapeId → canvas
    pointerUp(editor, 500, 500);

    expect(editor.getSelectedShapeIds()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// T3.2-03: Shift-click adds to selection
// ─────────────────────────────────────────────────────────────

describe('T3.2-03: shift-click adds to selection', () => {
  it('A selected; shift+click B → [A, B]', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([boxShape('a', 0, 0), boxShape('b', 200, 0)]);
    editor.setSelectedShapeIds([sid('a')]);

    pointerDown(editor, 250, 40, { shapeId: 'b', shiftKey: true });
    pointerUp(editor, 250, 40);

    const sel = editor.getSelectedShapeIds();
    expect(sel).toContain(sid('a'));
    expect(sel).toContain(sid('b'));
  });
});

// ─────────────────────────────────────────────────────────────
// T3.2-04: Drag translates shape
// ─────────────────────────────────────────────────────────────

describe('T3.2-04: drag translates shape', () => {
  it('pointerDown → move +50px → pointerUp: x increases by 50', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([boxShape('drag1', 100, 100)]);
    editor.setSelectedShapeIds([sid('drag1')]);

    pointerDown(editor, 150, 150, { shapeId: 'drag1' });
    pointerMove(editor, 160, 150); // cross threshold
    pointerMove(editor, 200, 150); // +50 from origin
    pointerUp(editor, 200, 150);

    const shape = editor.getShape(sid('drag1'))!;
    expect(shape.x).toBe(150); // 100 + 50
  });

  it('undo restores every selected shape instead of undoing the last creation', () => {
    const editor = makeEditor();
    editor.batch('Create first', () => editor.createShape(boxShape('drag-a', 100, 100)));
    editor.batch('Create second', () => editor.createShape(boxShape('drag-b', 300, 100)));
    editor.setSelectedShapeIds([sid('drag-a'), sid('drag-b')]);

    pointerDown(editor, 150, 150, { shapeId: 'drag-a' });
    pointerMove(editor, 170, 170); // enter Dragging and publish a preview
    pointerMove(editor, 210, 190);
    pointerUp(editor, 210, 190);

    expect(editor.getShape(sid('drag-a'))).toMatchObject({ x: 160, y: 140 });
    expect(editor.getShape(sid('drag-b'))).toMatchObject({ x: 360, y: 140 });
    const undoStack = editor.history.undoStack;
    expect(undoStack[undoStack.length - 1]?.label).toBe('Move Shapes');

    editor.undo();

    expect(editor.getShape(sid('drag-a'))).toMatchObject({ x: 100, y: 100 });
    expect(editor.getShape(sid('drag-b'))).toMatchObject({ x: 300, y: 100 });
  });
});

// ─────────────────────────────────────────────────────────────
// T3.2-05: Escape during drag restores positions
// ─────────────────────────────────────────────────────────────

describe('T3.2-05: escape cancels drag', () => {
  it('shape x unchanged from original after Escape', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([boxShape('esc1', 100, 100)]);
    editor.setSelectedShapeIds([sid('esc1')]);

    pointerDown(editor, 150, 150, { shapeId: 'esc1' });
    pointerMove(editor, 160, 150); // cross threshold
    pointerMove(editor, 200, 150); // moved +50
    keyDown(editor, 'Escape');

    const shape = editor.getShape(sid('esc1'))!;
    expect(shape.x).toBe(100); // original x
  });
});

// ─────────────────────────────────────────────────────────────
// T3.2-06: Marquee selects intersecting shapes
// ─────────────────────────────────────────────────────────────

describe('T3.2-06: marquee selects intersecting', () => {
  it('marquee over A and B but not C', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([
      boxShape('ma', 10, 10, 50, 50),
      boxShape('mb', 80, 10, 50, 50),
      boxShape('mc', 500, 500, 50, 50),
    ]);

    // Draw marquee from (0,0) to (200,100) — covers A and B
    pointerDown(editor, 0, 0);        // canvas click
    pointerMove(editor, 20, 10);      // cross threshold
    pointerMove(editor, 200, 100);
    pointerUp(editor, 200, 100);

    const sel = editor.getSelectedShapeIds();
    expect(sel).toContain(sid('ma'));
    expect(sel).toContain(sid('mb'));
    expect(sel).not.toContain(sid('mc'));
  });
});

// ─────────────────────────────────────────────────────────────
// T3.2-07: Drag threshold — 2px move doesn't start drag
// ─────────────────────────────────────────────────────────────

describe('T3.2-07: drag threshold 4px', () => {
  it('2px move stays in PointingShape, no drag initiated', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([boxShape('thr1', 100, 100)]);
    editor.setSelectedShapeIds([sid('thr1')]);

    const origX = editor.getShape(sid('thr1'))!.x;

    pointerDown(editor, 150, 150, { shapeId: 'thr1' });
    pointerMove(editor, 152, 150); // only 2px — under threshold
    pointerUp(editor, 152, 150);

    // Shape should not have moved
    expect(editor.getShape(sid('thr1'))!.x).toBe(origX);

    // Active child should have been pointing shape before up, now idle
    const tool = editor.getCurrentTool();
    expect((tool.current.constructor as any).id).toBe('idle');
  });
});

// ─────────────────────────────────────────────────────────────
// T3.2-08: Escape deselects — common behaviour across states
// ─────────────────────────────────────────────────────────────

describe('T3.2-08: Escape deselects (common across states)', () => {
  it('Escape in Idle clears selection', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([boxShape('esc-idle', 0, 0)]);
    editor.setSelectedShapeIds([sid('esc-idle')]);

    keyDown(editor, 'Escape');

    expect(editor.getSelectedShapeIds()).toEqual([]);
    expect((editor.getCurrentTool().current.constructor as any).id).toBe('idle');
  });

  it('Escape after marquee selection deselects all', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([boxShape('esc-mq1', 10, 10, 50, 50), boxShape('esc-mq2', 80, 10, 50, 50)]);

    // Draw marquee to select both
    pointerDown(editor, 0, 0);
    pointerMove(editor, 20, 10); // cross threshold
    pointerMove(editor, 200, 100);
    pointerUp(editor, 200, 100);
    expect(editor.getSelectedShapeIds().length).toBe(2);

    // Escape should deselect
    keyDown(editor, 'Escape');
    expect(editor.getSelectedShapeIds()).toEqual([]);
  });

  it('Escape in PointingShape (before drag) deselects and returns to Idle', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([boxShape('esc-ps', 100, 100)]);

    pointerDown(editor, 150, 150, { shapeId: 'esc-ps' });
    // No move (still in PointingShape)
    keyDown(editor, 'Escape');

    expect(editor.getSelectedShapeIds()).toEqual([]);
    expect((editor.getCurrentTool().current.constructor as any).id).toBe('idle');
  });

  it('Escape during drag restores positions (NOT deselect — Dragging owns Escape)', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([boxShape('esc-drag', 100, 100)]);
    editor.setSelectedShapeIds([sid('esc-drag')]);

    pointerDown(editor, 150, 150, { shapeId: 'esc-drag' });
    pointerMove(editor, 160, 150); // cross threshold → Dragging
    pointerMove(editor, 200, 150);
    keyDown(editor, 'Escape'); // handled by Dragging — does NOT bubble

    // Positions restored, shape still there
    expect(editor.getShape(sid('esc-drag'))!.x).toBe(100);
    // Selection not cleared (Dragging Escape only restores positions)
  });
});

describe('interactive transform history', () => {
  it('undo restores a resized shape when pointer-up repeats the final preview', () => {
    const editor = makeEditor();
    editor.batch('Create', () => editor.createShape(boxShape('resize-history', 0, 0)));
    editor.setSelectedShapeIds([sid('resize-history')]);

    pointerDownHandle(editor, 100, 80, 'se');
    pointerMove(editor, 150, 120);
    pointerUp(editor, 150, 120);

    expect(editor.getShape(sid('resize-history'))?.props).toMatchObject({ w: 150, h: 120 });
    expect(editor.history.undoStack[editor.history.undoStack.length - 1]?.label).toBe('Resize Shapes');

    editor.undo();

    expect(editor.getShape(sid('resize-history'))).toMatchObject({
      x: 0,
      y: 0,
      props: { w: 100, h: 80 },
    });
  });

  it('undo restores rotation when pointer-up repeats the final preview', () => {
    const editor = makeEditor();
    editor.batch('Create', () => editor.createShape(boxShape('rotate-history', 0, 0)));
    editor.setSelectedShapeIds([sid('rotate-history')]);

    pointerDownHandle(editor, 50, -20, 'rotate');
    pointerMove(editor, 110, 40);
    pointerUp(editor, 110, 40);

    expect(editor.getShape(sid('rotate-history'))?.rotation).toBeCloseTo(Math.PI / 2);
    expect(editor.history.undoStack[editor.history.undoStack.length - 1]?.label).toBe('Rotate Shapes');

    editor.undo();

    expect(editor.getShape(sid('rotate-history'))).toMatchObject({ x: 0, y: 0, rotation: 0 });
  });
});
