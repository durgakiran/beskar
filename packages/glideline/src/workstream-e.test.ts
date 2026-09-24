import { describe, expect, it, vi } from 'vitest';
import { createEditor, getHistoryManagerForTesting, getMutableStoreForTesting } from './editor';
import { HistoryConflictError } from './history';
import { InteractionConflictError } from './interaction';
import { BoxUtil } from './shapes/BoxUtil';
import { sid, type AnyRecord } from './types';
import type { GlidePlugin } from './editor';
import { StoreFatalIntegrityError } from './store';

const BoxPlugin: GlidePlugin = { id: 'box', shapes: [BoxUtil as any] };
const makeEditor = () => createEditor({ plugins: [BoxPlugin] });

function box(id: string, x = 0, y = 0) {
  return {
    id: sid(id),
    type: 'box',
    x,
    y,
    index: 'a1',
    rotation: 0,
    meta: {},
    props: { ...new BoxUtil().getDefaultProps() },
  };
}

describe('Workstream E — selective collaboration-safe history', () => {
  it('undoes only locally changed paths and preserves unrelated remote fields', () => {
    const editor = makeEditor();
    const id = editor.createShape(box('selective'));
    getHistoryManagerForTesting(editor).clear();
    editor.updateShape(id, { x: 100 });

    getMutableStoreForTesting(editor).transact({ origin: 'remote', history: 'ignore' }, tx => {
      tx.update(id, record => ({ ...record, y: 75 }));
    });

    expect(editor.undo().status).toBe('applied');
    expect(editor.getShape(id)?.x).toBe(0);
    expect(editor.getShape(id)?.y).toBe(75);
  });

  it('reports a typed conflict and leaves records and stacks untouched on same-field remote edits', () => {
    const editor = makeEditor();
    const id = editor.createShape(box('conflict'));
    getHistoryManagerForTesting(editor).clear();
    editor.updateShape(id, { x: 100 });
    const entry = editor.history.undoStack[0];

    getMutableStoreForTesting(editor).transact({ origin: 'remote', history: 'ignore' }, tx => {
      tx.update(id, record => ({ ...record, x: 250 }));
    });

    const result = editor.undo();
    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') expect(result.error).toBeInstanceOf(HistoryConflictError);
    expect(editor.getShape(id)?.x).toBe(250);
    expect(editor.history.undoStack).toEqual([entry]);
    expect(editor.history.redoStack).toHaveLength(0);
  });

  it('does not record remote commits in the local user history', () => {
    const editor = makeEditor();
    const id = editor.createShape(box('remote'));
    getHistoryManagerForTesting(editor).clear();
    getMutableStoreForTesting(editor).transact({ origin: 'remote', history: 'record' }, tx => {
      tx.update(id, record => ({ ...record, x: 20 }));
    });
    expect(editor.history.undoStack).toHaveLength(0);
  });

  it('detects delete/recreate ID reuse even when the recreated record is byte-identical', () => {
    const editor = makeEditor();
    const id = editor.createShape(box('reused'));
    const snapshot = editor.store.get(id)!;
    getMutableStoreForTesting(editor).transact({ origin: 'remote', history: 'ignore' }, tx => tx.remove(id));
    getMutableStoreForTesting(editor).transact({ origin: 'remote', history: 'ignore' }, tx => tx.insert(snapshot as any));

    const result = editor.undo();
    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') {
      expect(result.error.conflicts).toContainEqual({ id, path: '', reason: 'generation-changed' });
    }
    expect(editor.store.get(id)).toBeDefined();
  });

  it('protects redo with the same field preconditions as undo', () => {
    const editor = makeEditor();
    const id = editor.createShape(box('redo-conflict'));
    getHistoryManagerForTesting(editor).clear();
    editor.updateShape(id, { x: 100 });
    expect(editor.undo().status).toBe('applied');
    getMutableStoreForTesting(editor).transact({ origin: 'remote', history: 'ignore' }, tx => {
      tx.update(id, record => ({ ...record, x: 50 }));
    });

    expect(editor.redo().status).toBe('conflict');
    expect(editor.store.get(id)?.['x']).toBe(50);
    expect(editor.history.redoStack).toHaveLength(1);
  });

  it('prepares history before publication so a later participant can abort both', () => {
    const editor = makeEditor();
    const id = editor.createShape(box('participant'));
    getHistoryManagerForTesting(editor).clear();
    getMutableStoreForTesting(editor).participateInCommits(() => {
      throw new Error('participant rejected');
    });

    expect(() => editor.updateShape(id, { x: 10 })).toThrow('participant rejected');
    expect(editor.store.get(id)?.['x']).toBe(0);
    expect(editor.history.undoStack).toHaveLength(0);
  });

  it('rolls back prepared history and enters a fatal state if publication violates its contract', () => {
    const editor = makeEditor();
    const id = editor.createShape(box('fatal'));
    getHistoryManagerForTesting(editor).clear();
    getMutableStoreForTesting(editor).participateInCommits(() => ({
      publish: () => { throw new Error('publication failed'); },
    }));

    expect(() => editor.updateShape(id, { x: 10 })).toThrow(StoreFatalIntegrityError);
    expect(editor.store.get(id)?.['x']).toBe(0);
    expect(editor.history.undoStack).toHaveLength(0);
    expect(() => editor.updateShape(id, { x: 20 })).toThrow(StoreFatalIntegrityError);
  });
});

describe('Workstream E — commands and transient interaction overlay', () => {
  it('publishes stable command metadata with a durable editor mutation', () => {
    const editor = makeEditor();
    const listener = vi.fn();
    editor.store.listen(listener);
    const id = editor.createShape(box('command'));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      label: 'Create Shape',
      commandId: 'shape.create',
      affectedIds: [id],
      origin: 'user',
      history: 'record',
    });
  });

  it('keeps live previews out of canonical records, serialization, listeners, and history', () => {
    const editor = makeEditor();
    const id = editor.createShape(box('preview'));
    getHistoryManagerForTesting(editor).clear();
    const listener = vi.fn();
    editor.store.listen(listener);

    editor.beginHistoryPreview();
    editor.batch('Move Preview', () => editor.updateShape(id, { x: 80 }), { history: 'ignore' });

    expect(editor.getShape(id)?.x).toBe(80);
    expect(editor.getShapeSignal(id).peek()?.['x']).toBe(80);
    expect(editor.store.get(id)?.['x']).toBe(0);
    expect((editor.serialize().records.find(record => record.id === id) as AnyRecord | undefined)?.['x']).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    expect(editor.history.undoStack).toHaveLength(0);

    editor.cancelHistoryPreview();
    expect(editor.getShape(id)?.x).toBe(0);
  });

  it('commits many preview ticks as one canonical change and one history entry', () => {
    const editor = makeEditor();
    const id = editor.createShape(box('commit'));
    getHistoryManagerForTesting(editor).clear();
    const listener = vi.fn();
    editor.store.listen(listener);

    editor.beginHistoryPreview();
    editor.batch('Move Preview', () => editor.updateShape(id, { x: 40 }), { history: 'ignore' });
    editor.batch('Move Preview', () => editor.updateShape(id, { x: 90 }), { history: 'ignore' });
    editor.recordHistoryPreview('Move Shapes', new Map());

    expect(listener).toHaveBeenCalledTimes(1);
    expect(editor.store.get(id)?.['x']).toBe(90);
    expect(editor.history.undoStack).toHaveLength(1);
    expect(editor.history.undoStack[0]?.commandId).toBe('interaction.move.shapes');
    editor.undo();
    expect(editor.getShape(id)?.x).toBe(0);
  });

  it('keeps a conflicted overlay recoverable until the caller cancels it', () => {
    const editor = makeEditor();
    const id = editor.createShape(box('preview-conflict'));
    getHistoryManagerForTesting(editor).clear();
    editor.beginHistoryPreview();
    editor.batch('Move Preview', () => editor.updateShape(id, { x: 80 }), { history: 'ignore' });
    getMutableStoreForTesting(editor).transact({ origin: 'remote', history: 'ignore' }, tx => {
      tx.update(id, record => ({ ...record, x: 60 }));
    });

    expect(() => editor.recordHistoryPreview('Move Shapes', new Map())).toThrow(InteractionConflictError);
    expect(editor.interactions.active).toBe(true);
    expect(editor.getShape(id)?.x).toBe(80);
    expect(editor.store.get(id)?.['x']).toBe(60);
    editor.cancelHistoryPreview();
    expect(editor.getShape(id)?.x).toBe(60);
  });
});
