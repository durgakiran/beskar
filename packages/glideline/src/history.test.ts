/**
 * Unit tests: HistoryManager (Story 3.4)
 * Covers: T3.4-01 through T3.4-06
 */

import { describe, it, expect } from 'vitest';
import { createEditor, getHistoryManagerForTesting, getMutableStoreForTesting } from './editor';
import { BoxUtil } from './shapes/BoxUtil';
import { BindingUtil } from './shapes/ShapeUtil';
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

describe('editor mutation history defaults', () => {
  it('records direct create, update, and delete commands', () => {
    const editor = makeEditor();

    editor.createShape(boxShape('direct', 10, 20));
    expect(editor.history.undoStack[editor.history.undoStack.length - 1]?.label).toBe('Create Shape');

    editor.updateShape(sid('direct'), { x: 90 });
    expect(editor.history.undoStack[editor.history.undoStack.length - 1]?.label).toBe('Update Shape');

    editor.deleteShapes([sid('direct')]);
    expect(editor.history.undoStack[editor.history.undoStack.length - 1]?.label).toBe('Delete Shapes');

    editor.undo();
    expect(editor.getShape(sid('direct'))?.x).toBe(90);
    editor.undo();
    expect(editor.getShape(sid('direct'))?.x).toBe(10);
    editor.undo();
    expect(editor.getShape(sid('direct'))).toBeUndefined();
  });

  it('records the legacy batch callback form instead of silently ignoring it', () => {
    const editor = makeEditor();

    editor.batch(() => editor.createShape(boxShape('generic-batch')));

    expect(editor.history.undoStack).toHaveLength(1);
    expect(editor.history.undoStack[0]?.label).toBe('Batch');
    editor.undo();
    expect(editor.getShape(sid('generic-batch'))).toBeUndefined();
  });

  it('records direct low-level store mutations by default', () => {
    const editor = makeEditor();

    getMutableStoreForTesting(editor).put([boxShape('direct-store')]);

    expect(editor.history.undoStack).toHaveLength(1);
    expect(editor.history.undoStack[0]?.label).toBe('Store Change');
    editor.undo();
    expect(editor.getShape(sid('direct-store'))).toBeUndefined();
  });
});

describe('immutable history snapshots', () => {
  it('cannot mutate a stored before/after record', () => {
    const editor = makeEditor();
    editor.batch('Create immutable', () => editor.createShape(boxShape('immutable', 10, 20)));
    const entry = editor.history.undoStack[0]!;
    const after = entry.after.get('immutable')!;
    expect(Object.isFrozen(after)).toBe(true);
    expect(() => { (after as any).x = 999; }).toThrow();
    expect(editor.getShape(sid('immutable'))?.x).toBe(10);
  });
});

describe('editor lifecycle atomicity', () => {
  it('aborts the target update when a binding lifecycle hook throws', () => {
    class ThrowingBindingUtil extends BindingUtil<any> {
      static readonly type = 'throwing-binding';
      getDefaultProps() { return {}; }
      override onAfterChangeToShape() { throw new Error('hook failed'); }
    }
    const editor = createEditor({
      plugins: [{
        id: 'throwing-lifecycle',
        shapes: [BoxUtil as any],
        bindings: [ThrowingBindingUtil as any],
      }],
    });
    editor.createShape(boxShape('source'));
    editor.createShape(boxShape('target'));
    editor.createBinding({
      id: 'throwing:1',
      type: 'throwing-binding',
      fromId: sid('source'),
      toId: sid('target'),
      props: {},
      meta: {},
    });
    const revision = editor.store.revision;

    expect(() => editor.updateShape(sid('target'), { x: 100 })).toThrow('hook failed');
    expect(editor.getShape(sid('target'))?.x).toBe(0);
    expect(editor.store.revision).toBe(revision);
  });

  it('records indirect binding-hook changes made during an ignored live preview', () => {
    class TrackingBindingUtil extends BindingUtil<any> {
      static readonly type = 'tracking-binding';
      getDefaultProps() { return {}; }
      override onAfterChangeToShape(binding: any) {
        const target = this.editor.getShape(binding.toId)!;
        this.editor.updateShape(binding.fromId, {
          meta: { anchorX: target.x },
        } as any);
      }
    }
    const editor = createEditor({
      plugins: [{
        id: 'tracking-lifecycle',
        shapes: [BoxUtil as any],
        bindings: [TrackingBindingUtil as any],
      }],
    });
    editor.createShape(boxShape('source'));
    editor.createShape(boxShape('target'));
    editor.createBinding({
      id: 'tracking:1',
      type: 'tracking-binding',
      fromId: sid('source'),
      toId: sid('target'),
      props: {},
      meta: {},
    });
    getHistoryManagerForTesting(editor).clear();

    const targetBefore = editor.store.get('target')!;
    editor.beginHistoryPreview();
    editor.batch('Move Preview', () => {
      editor.updateShape(sid('target'), { x: 100 });
    }, { history: 'ignore' });
    editor.recordHistoryPreview(
      'Move Shapes',
      new Map([['target', targetBefore as any]]),
    );

    expect(editor.history.undoStack[0]?.after.has('source')).toBe(true);
    expect(editor.getShape(sid('source'))?.meta['anchorX']).toBe(100);

    editor.undo();
    expect(editor.getShape(sid('target'))?.x).toBe(0);
    expect(editor.getShape(sid('source'))?.meta['anchorX']).toBeUndefined();

    editor.redo();
    expect(editor.getShape(sid('target'))?.x).toBe(100);
    expect(editor.getShape(sid('source'))?.meta['anchorX']).toBe(100);
  });
});
