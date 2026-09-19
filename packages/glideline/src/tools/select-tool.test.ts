/**
 * Unit tests: SelectTool FSM (Story 3.2)
 * Covers: T3.2-01 through T3.2-07
 */

import { describe, it, expect, vi } from 'vitest';
import { createEditor, getMutableStoreForTesting } from '../editor';
import { BoxUtil } from '../shapes/BoxUtil';
import { FrameUtil } from '../shapes/FrameUtil';
import { GroupUtil } from '../shapes/GroupUtil';
import { sid } from '../types';
import type { GlidePlugin } from '../editor';
import type { GlideEvent } from '../state-node';

const BoxPlugin: GlidePlugin = { id: 'box', shapes: [BoxUtil as any, FrameUtil as any, GroupUtil as any] };
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

function pointerMove(e: ReturnType<typeof makeEditor>, x: number, y: number, modifiers: { shiftKey?: boolean; altKey?: boolean } = {}): void {
  e.dispatchEvent({ type: 'pointerMove', point: { x, y }, ...modifiers });
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

describe('selection and dragging state-machine behavior', () => {
  it('toggles an already-selected shape off with shift-click', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([boxShape('toggle', 0, 0)]);
    editor.setSelectedShapeIds([sid('toggle')]);

    pointerDown(editor, 50, 40, { shapeId: 'toggle', shiftKey: true });
    pointerUp(editor, 50, 40);

    expect(editor.getSelectedShapeIds()).toEqual([]);
  });

  it('starts a drag from empty space inside a multi-selection bounds', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([
      boxShape('bounds-a', 0, 0, 40, 40),
      boxShape('bounds-b', 160, 0, 40, 40),
    ]);
    editor.setSelectedShapeIds([sid('bounds-a'), sid('bounds-b')]);

    pointerDown(editor, 100, 20);
    pointerMove(editor, 110, 30);
    pointerMove(editor, 130, 50);
    pointerUp(editor, 130, 50);

    expect(editor.getShape(sid('bounds-a'))).toMatchObject({ x: 30, y: 30 });
    expect(editor.getShape(sid('bounds-b'))).toMatchObject({ x: 190, y: 30 });
  });

  it('duplicates the full selection before an Alt-drag', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([
      boxShape('copy-a', 0, 0, 40, 40),
      boxShape('copy-b', 80, 0, 40, 40),
    ]);
    editor.setSelectedShapeIds([sid('copy-a'), sid('copy-b')]);

    pointerDown(editor, 20, 20, { shapeId: 'copy-a' });
    pointerMove(editor, 30, 30, { altKey: true });
    pointerMove(editor, 50, 50, { altKey: true });
    pointerUp(editor, 50, 50);

    const copies = editor.getSelectedShapeIds();
    expect(copies).toHaveLength(2);
    expect(copies).not.toContain(sid('copy-a'));
    expect(editor.getShape(sid('copy-a'))).toMatchObject({ x: 0, y: 0 });
    expect(copies.map(id => editor.getShape(id)?.x).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([30, 110]);
  });

  it.each([
    ['x', 50, 12, 50, 0],
    ['y', 12, 50, 0, 50],
  ] as const)('locks a Shift-drag to the dominant %s axis', (_axis, dx, dy, expectedX, expectedY) => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([boxShape(`axis-${_axis}`, 100, 100)]);
    editor.setSelectedShapeIds([sid(`axis-${_axis}`)]);

    pointerDown(editor, 150, 140, { shapeId: `axis-${_axis}` });
    pointerMove(editor, 155, 145, { shiftKey: true });
    pointerMove(editor, 150 + dx, 140 + dy, { shiftKey: true });
    pointerUp(editor, 150 + dx, 140 + dy);

    expect(editor.getShape(sid(`axis-${_axis}`))).toMatchObject({
      x: 100 + expectedX,
      y: 100 + expectedY,
    });
  });

  it('releases an established axis constraint when Shift is released', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([boxShape('axis-release', 100, 100)]);
    editor.setSelectedShapeIds([sid('axis-release')]);

    pointerDown(editor, 150, 140, { shapeId: 'axis-release' });
    pointerMove(editor, 160, 142, { shiftKey: true });
    pointerMove(editor, 180, 170);
    pointerUp(editor, 180, 170);

    expect(editor.getShape(sid('axis-release'))).toMatchObject({ x: 130, y: 130 });
  });

  it('does not begin dragging when every selected shape is locked', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([boxShape('locked-drag', 0, 0)]);
    editor.setLocked([sid('locked-drag')], true);
    editor.setSelectedShapeIds([sid('locked-drag')]);

    pointerDown(editor, 50, 40, { shapeId: 'locked-drag' });
    pointerMove(editor, 80, 80);

    expect(editor.getShape(sid('locked-drag'))).toMatchObject({ x: 0, y: 0 });
    expect((editor.getCurrentTool().current.constructor as any).id).toBe('pointingShape');
  });

  it('captures a dropped shape into a frame and releases it when dragged out', () => {
    const editor = makeEditor();
    const frame = editor.createShape({ id: sid('drop-frame'), type: 'frame', x: 200, y: 100, props: { w: 240, h: 180 } });
    getMutableStoreForTesting(editor).put([boxShape('drop-child', 0, 0, 40, 40)]);
    editor.setSelectedShapeIds([sid('drop-child')]);

    pointerDown(editor, 20, 20, { shapeId: 'drop-child' });
    pointerMove(editor, 30, 30);
    pointerMove(editor, 260, 160);
    pointerUp(editor, 260, 160);
    expect(editor.getShape(sid('drop-child'))?.parentId).toBe(frame);

    const inside = editor.localToPage(sid('drop-child'), { x: 20, y: 20 });
    pointerDown(editor, inside.x, inside.y, { shapeId: 'drop-child' });
    pointerMove(editor, inside.x + 10, inside.y + 10);
    pointerMove(editor, 600, 500);
    pointerUp(editor, 600, 500);

    expect(editor.getShape(sid('drop-child'))?.parentId).not.toBe(frame);
  });

  it('does not capture a drop into a locked frame', () => {
    const editor = makeEditor();
    const frame = editor.createShape({ id: sid('locked-frame'), type: 'frame', x: 200, y: 100, props: { w: 240, h: 180 } });
    getMutableStoreForTesting(editor).put([boxShape('locked-frame-child', 0, 0, 40, 40)]);
    editor.setLocked([frame], true);
    editor.setSelectedShapeIds([sid('locked-frame-child')]);

    pointerDown(editor, 20, 20, { shapeId: 'locked-frame-child' });
    pointerMove(editor, 30, 30);
    pointerMove(editor, 260, 160);
    pointerUp(editor, 260, 160);

    expect(editor.getShape(sid('locked-frame-child'))?.parentId).not.toBe(frame);
  });

  it('double-clicks into a group and Escape exits that group before clearing selection', () => {
    const editor = makeEditor();
    const first = editor.createShape(boxShape('group-first', 0, 0));
    const second = editor.createShape(boxShape('group-second', 140, 0));
    const group = editor.groupShapes([first, second]);

    editor.dispatchEvent({ type: 'doubleClick', point: { x: 50, y: 40 }, shapeId: group });
    expect(editor.focusedGroupId.peek()).toBe(group);
    editor.setSelectedShapeIds([first]);

    keyDown(editor, 'Escape');

    expect(editor.focusedGroupId.peek()).toBeNull();
    expect(editor.getSelectedShapeIds()).toEqual([group]);
  });

  it('double-clicks an editable box label into text editing', () => {
    const editor = makeEditor();
    const id = editor.createShape({
      type: 'box', x: 0, y: 0,
      props: { ...new BoxUtil().getDefaultProps(), w: 100, h: 80, label: 'Edit me' },
    });
    expect(editor.getShapeUtil('box').canEditLabel(editor.getShape(id)! as any)).toBe(true);
    expect(editor.getSelectableShapeId(id)).toBe(id);
    expect((editor.getCurrentTool().current.constructor as any).id).toBe('idle');

    editor.dispatchEvent({ type: 'doubleClick', point: { x: 50, y: 40 }, shapeId: id });

    expect(editor.editingShapeId.peek()).toBe(id);
  });

  it('ignores canvas and missing-shape double-clicks', () => {
    const editor = makeEditor();

    editor.dispatchEvent({ type: 'doubleClick', point: { x: 10, y: 10 } });
    editor.dispatchEvent({ type: 'doubleClick', point: { x: 10, y: 10 }, shapeId: sid('missing-double-click') });

    expect(editor.editingShapeId.peek()).toBeNull();
    expect((editor.getCurrentTool().current.constructor as any).id).toBe('idle');
  });

  it('selects an unselected shape when a shift-drag begins', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([
      boxShape('shift-drag-a', 0, 0),
      boxShape('shift-drag-b', 200, 0),
    ]);
    editor.setSelectedShapeIds([sid('shift-drag-a')]);

    pointerDown(editor, 250, 40, { shapeId: 'shift-drag-b', shiftKey: true });
    pointerMove(editor, 260, 50);
    pointerMove(editor, 280, 70);
    pointerUp(editor, 280, 70);

    expect(editor.getSelectedShapeIds()).toEqual([sid('shift-drag-b')]);
    expect(editor.getShape(sid('shift-drag-b'))).toMatchObject({ x: 230, y: 30 });
  });

  it('records a focused group child and its parent in drag history', () => {
    const editor = makeEditor();
    const first = editor.createShape(boxShape('group-drag-a', 0, 0));
    const second = editor.createShape(boxShape('group-drag-b', 140, 0));
    const group = editor.groupShapes([first, second]);
    editor.enterGroup(group);
    editor.setSelectedShapeIds([first]);
    const before = structuredClone(editor.getShape(first)!);
    const point = editor.localToPage(first, { x: 50, y: 40 });

    editor.dispatchEvent({ type: 'pointerDown', point, target: 'shape', shapeId: first, shiftKey: false });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: point.x + 10, y: point.y + 10 } });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: point.x + 30, y: point.y + 20 } });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: point.x + 30, y: point.y + 20 } });

    expect(editor.getShape(first)).not.toMatchObject({ x: before.x, y: before.y });
    editor.undo();
    expect(editor.getShape(first)).toMatchObject({ x: before.x, y: before.y });
    expect(editor.getShape(group)?.type).toBe('group');
  });

  it('keeps axis undecided for a tiny Shift move, then reuses the chosen axis', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([boxShape('axis-stages', 100, 100)]);
    editor.setSelectedShapeIds([sid('axis-stages')]);

    pointerDown(editor, 150, 140, { shapeId: 'axis-stages' });
    pointerMove(editor, 155, 145);
    pointerMove(editor, 151, 141, { shiftKey: true });
    pointerMove(editor, 170, 145, { shiftKey: true });
    pointerMove(editor, 190, 180, { shiftKey: true });
    pointerUp(editor, 190, 180);

    expect(editor.getShape(sid('axis-stages'))).toMatchObject({ x: 140, y: 100 });
  });

  it('tolerates a selected shape being deleted during its drag preview', () => {
    const editor = makeEditor();
    const id = editor.createShape(boxShape('deleted-drag', 100, 100));
    editor.setSelectedShapeIds([id]);

    editor.dispatchEvent({ type: 'pointerDown', point: { x: 150, y: 140 }, target: 'shape', shapeId: id, shiftKey: false });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 160, y: 150 } });
    editor.deleteShapes([id]);
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 180, y: 170 } });
    editor.dispatchEvent({ type: 'keyDown', key: 'Shift' });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 180, y: 170 } });

    expect(editor.getShape(id)).toBeUndefined();
    expect((editor.getCurrentTool().current.constructor as any).id).toBe('idle');
  });

  it('keeps a canvas press in pointing state below the marquee threshold', () => {
    const editor = makeEditor();
    pointerDown(editor, 0, 0);
    pointerMove(editor, 2, 2);
    expect((editor.getCurrentTool().current.constructor as any).id).toBe('pointingCanvas');
    pointerUp(editor, 2, 2);
    expect((editor.getCurrentTool().current.constructor as any).id).toBe('idle');
  });

  it('treats a stale pointer event for a hidden shape as a canvas press', () => {
    const editor = makeEditor();
    const id = editor.createShape(boxShape('hidden-pointer', 0, 0));
    editor.setHidden([id], true);

    editor.dispatchEvent({
      type: 'pointerDown', point: { x: 50, y: 40 },
      target: 'shape', shapeId: id, shiftKey: false,
    });

    expect((editor.getCurrentTool().current.constructor as any).id).toBe('pointingCanvas');
    pointerUp(editor, 50, 40);
    expect(editor.getSelectedShapeIds()).toEqual([]);
  });

  it('moves only the ancestor when selection input redundantly contains its child', () => {
    const editor = makeEditor();
    const first = editor.createShape(boxShape('redundant-child-a', 0, 0));
    const second = editor.createShape(boxShape('redundant-child-b', 140, 0));
    const group = editor.groupShapes([first, second]);
    const childBefore = structuredClone(editor.getShape(first)!);
    const groupBefore = structuredClone(editor.getShape(group)!);
    vi.spyOn(editor, 'getSelectedShapeIds').mockReturnValue([group, first]);

    const point = editor.localToPage(first, { x: 50, y: 40 });
    editor.dispatchEvent({ type: 'pointerDown', point, target: 'shape', shapeId: group, shiftKey: false });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: point.x + 10, y: point.y + 10 } });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: point.x + 30, y: point.y + 20 } });

    expect(editor.getShape(group)?.x).not.toBe(groupBefore.x);
    expect(editor.getShape(first)).toMatchObject({ x: childBefore.x, y: childBefore.y });
  });
});
