/**
 * Unit tests: HistoryManager (Story 3.4)
 * Covers: T3.4-01 through T3.4-06
 */

import { describe, it, expect } from 'vitest';
import { createEditor } from './editor';
import { BoxUtil } from './shapes/BoxUtil';
import { sid } from './types';
import type { GlidePlugin } from './editor';

const BoxPlugin: GlidePlugin = { id: 'box', shapes: [BoxUtil as any] };
const makeEditor = () => createEditor({ plugins: [BoxPlugin] });

function boxShape(id: string, x = 0, y = 0) {
  return {
    id: sid(id), type: 'box', x, y,
    index: 'a1', rotation: 0, meta: {},
    props: { ...new BoxUtil().getDefaultProps() },
  };
}

// ─────────────────────────────────────────────────────────────
// T3.4-01: undo removes created shape
// ─────────────────────────────────────────────────────────────

describe('T3.4-01: undo removes created shape', () => {
  it('shape absent from store after undo', () => {
    const editor = makeEditor();
    editor.batch('Create', () => {
      editor.createShape(boxShape('b1'));
    });
    expect(editor.getShape(sid('b1'))).toBeDefined();
    editor.undo();
    expect(editor.getShape(sid('b1'))).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// T3.4-02: redo re-creates shape with identical props
// ─────────────────────────────────────────────────────────────

describe('T3.4-02: redo re-creates shape', () => {
  it('shape back in store with same props after redo', () => {
    const editor = makeEditor();
    editor.batch('Create', () => {
      editor.createShape(boxShape('b2', 10, 20));
    });
    editor.undo();
    editor.redo();
    const shape = editor.getShape(sid('b2'));
    expect(shape).toBeDefined();
    expect(shape!.x).toBe(10);
    expect(shape!.y).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────
// T3.4-03: batch groups N mutations into 1 undo entry
// ─────────────────────────────────────────────────────────────

describe('T3.4-03: batch = single undo entry', () => {
  it('undo once restores both shapes', () => {
    const editor = makeEditor();
    // Create both shapes first (separately so they exist)
    editor.batch('Create A', () => editor.createShape(boxShape('a', 0, 0)));
    editor.batch('Create B', () => editor.createShape(boxShape('b', 0, 0)));

    // Move both in one batch
    editor.batch('Move Both', () => {
      editor.updateShape(sid('a'), { x: 100 });
      editor.updateShape(sid('b'), { x: 200 });
    });

    expect(editor.getShape(sid('a'))!.x).toBe(100);
    expect(editor.getShape(sid('b'))!.x).toBe(200);

    editor.undo(); // undo the move batch only
    expect(editor.getShape(sid('a'))!.x).toBe(0);
    expect(editor.getShape(sid('b'))!.x).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// T3.4-04: history:'ignore' mutations are not undoable
// ─────────────────────────────────────────────────────────────

describe('T3.4-04: history:ignore not undoable', () => {
  it('undo does not reverse an ignored mutation', () => {
    const editor = makeEditor();
    editor.run(() => {
      editor.createShape(boxShape('ai1'));
    }, { history: 'ignore' });

    expect(editor.getShape(sid('ai1'))).toBeDefined();
    editor.undo(); // nothing on stack
    // Shape must still be there
    expect(editor.getShape(sid('ai1'))).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// T3.4-05: undo on empty stack is a no-op
// ─────────────────────────────────────────────────────────────

describe('T3.4-05: empty undo stack no-op', () => {
  it('does not throw on empty stack', () => {
    const editor = makeEditor();
    expect(() => editor.undo()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// T3.4-06: undo stack capped at 100
// ─────────────────────────────────────────────────────────────

describe('T3.4-06: stack capped at 100', () => {
  it('undoStack.length === 100 after 101 mutations', () => {
    const editor = makeEditor();
    for (let i = 0; i < 101; i++) {
      editor.batch(`op-${i}`, () => {
        editor.createShape(boxShape(`cap${i}`, i, 0));
      });
    }
    expect(editor.history.undoStack.length).toBe(100);
  });
});

describe('editor.run()', () => {
  it('records history by default', () => {
    const editor = makeEditor();

    editor.run(() => {
      editor.createShape(boxShape('run1', 40, 50));
    });

    expect(editor.getShape(sid('run1'))).toBeDefined();
    expect(editor.history.undoStack).toHaveLength(1);

    editor.undo();
    expect(editor.getShape(sid('run1'))).toBeUndefined();
  });
});
