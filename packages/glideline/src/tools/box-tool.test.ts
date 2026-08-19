/**
 * Unit tests: BoxTool FSM (Story 3.3)
 * Covers: T3.3-01 through T3.3-06
 */

import { describe, it, expect } from 'vitest';
import { createEditor } from '../editor';
import { BoxUtil } from '../shapes/BoxUtil';
import type { GlidePlugin } from '../editor';

const BoxPlugin: GlidePlugin = { id: 'box', shapes: [BoxUtil as any] };
const makeEditor = () => {
  const e = createEditor({ plugins: [BoxPlugin] });
  e.setCurrentTool('box');
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
function esc(editor: ReturnType<typeof makeEditor>) {
  editor.dispatchEvent({ type: 'keyDown', key: 'Escape' });
}

// ─────────────────────────────────────────────────────────────
// T3.3-01: No shape created on pointerDown only (no drag)
// ─────────────────────────────────────────────────────────────

describe('T3.3-01: no shape on pointerDown+Up without move', () => {
  it('store count unchanged', () => {
    const editor = makeEditor();
    const before = shapeCount(editor);
    pd(editor, 100, 100);
    pu(editor, 100, 100); // no move
    expect(shapeCount(editor)).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────
// T3.3-02: Preview created on drag >4px
// ─────────────────────────────────────────────────────────────

describe('T3.3-02: preview created on drag', () => {
  it('store count +1 after move >4px', () => {
    const editor = makeEditor();
    const before = shapeCount(editor);
    pd(editor, 100, 100);
    pm(editor, 120, 100); // 20px — crosses threshold
    expect(shapeCount(editor)).toBe(before + 1);
    expect(editor.serialize().records.filter(record => record.kind === 'shape')).toHaveLength(0);
    // Cleanup
    esc(editor);
  });
});

// ─────────────────────────────────────────────────────────────
// T3.3-03: Preview size updates on move
// ─────────────────────────────────────────────────────────────

describe('T3.3-03: preview size matches move', () => {
  it('w=100, h=60 after move to origin+(100,60)', () => {
    const editor = makeEditor();
    pd(editor, 50, 50);
    pm(editor, 80, 60);  // cross threshold
    pm(editor, 150, 110); // origin+(100,60)

    const shapes = editor.getShapesInBox({ minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 });
    expect(shapes.length).toBe(1);
    const props = (shapes[0] as any).props;
    expect(props.w).toBe(100);
    expect(props.h).toBe(60);
    esc(editor);
  });
});

// ─────────────────────────────────────────────────────────────
// T3.3-04: Commit on pointerUp — shape remains, state → Idle
// ─────────────────────────────────────────────────────────────

describe('T3.3-04: commit on pointerUp', () => {
  it('shape stays in store, tool back to idle', () => {
    const editor = makeEditor();
    pd(editor, 0, 0);
    pm(editor, 10, 0);
    pm(editor, 80, 60);
    pu(editor, 80, 60);

    expect(shapeCount(editor)).toBe(1);
    const leaf = editor.getCurrentTool().current;
    expect((leaf.constructor as any).id).toBe('idle');
  });
});

// ─────────────────────────────────────────────────────────────
// T3.3-05: Escape during Drawing deletes preview
// ─────────────────────────────────────────────────────────────

describe('T3.3-05: escape deletes preview', () => {
  it('store count back to original after Escape', () => {
    const editor = makeEditor();
    const before = shapeCount(editor);
    pd(editor, 0, 0);
    pm(editor, 10, 0); // cross threshold
    pm(editor, 100, 80);
    esc(editor);
    expect(shapeCount(editor)).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────
// T3.3-06: Committed shape is a single undo entry
// ─────────────────────────────────────────────────────────────

describe('T3.3-06: single undo entry for drawn box', () => {
  it('one undo removes the committed shape', () => {
    const editor = makeEditor();
    pd(editor, 0, 0);
    pm(editor, 10, 0);
    pm(editor, 100, 80);
    pu(editor, 100, 80);

    expect(shapeCount(editor)).toBe(1);
    editor.undo();
    expect(shapeCount(editor)).toBe(0);
  });
});
