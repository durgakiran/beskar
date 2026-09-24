import { describe, expect, it, vi } from 'vitest';
import { createEditor, getMutableStoreForTesting, type GlidePlugin } from './editor';
import {
  createMutationCapability,
  MutationPermissionError,
  type MutationPolicy,
} from './mutation-policy';
import { BoxUtil } from './shapes/BoxUtil';
import { sid } from './types';

export const BoxPlugin: GlidePlugin = {
  id: 'box',
  shapes: [BoxUtil as any],
};

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
  }
}

function createTestEditor(mutationPolicy?: MutationPolicy) {
  return createEditor({
    plugins: [BoxPlugin],
    ...(mutationPolicy ? { mutationPolicy } : {})
  })
}

describe("MutationPolicy", () => {
  it("allow local commands when no policy is supplied", () => {
    const editor = createTestEditor();
    const id = editor.createShape(box('allowed'));

    expect(editor.getShape(id)).toBeDefined();

  });

  it('rejects a denied local command without changing the store', () => {
    const authorize = vi.fn(() => 'deny' as const);
    const editor = createTestEditor({ authorize });
    const listener = vi.fn();
    const stopListening = editor.store.listen(listener);

    const beforeRevision = editor.store.revision;
    const beforeDocument = editor.serialize();

    expect(() => {
      editor.createShape(box('denied'));
    }).toThrow(MutationPermissionError);

    expect(authorize).toHaveBeenCalledWith({
      origin: 'local-user',
      command: 'shape.create',
      affectedIds: [sid('denied')],
    });

    expect(editor.store.revision).toBe(beforeRevision);
    expect(editor.serialize()).toEqual(beforeDocument);
    expect(editor.getShape(sid('denied'))).toBeUndefined();
    expect(editor.history.undoStack).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();

    stopListening();
  });

  it('provides an empty affectedIds array when a command does not declare IDs', () => {
    const authorize = vi.fn(() => 'allow' as const);
    const editor = createTestEditor({ authorize });

    editor.batch('Empty command', () => { });

    expect(authorize).toHaveBeenCalledWith({
      origin: 'local-user',
      command: 'command.empty.command',
      affectedIds: [],
    });
  });

  it('rejects undo without changing records or history stacks', () => {
    let readOnly = false;

    const editor = createTestEditor({
      authorize: () => readOnly ? 'deny' : 'allow',
    });

    const id = editor.createShape(box('undo-denied'));
    const beforeRevision = editor.store.revision;
    const beforeDocument = editor.serialize();
    const beforeUndoStack = editor.history.undoStack;
    const beforeRedoStack = editor.history.redoStack;

    readOnly = true;

    expect(() => editor.undo()).toThrow(MutationPermissionError);

    expect(editor.store.revision).toBe(beforeRevision);
    expect(editor.serialize()).toEqual(beforeDocument);
    expect(editor.getShape(id)).toBeDefined();
    expect(editor.history.undoStack).toEqual(beforeUndoStack);
    expect(editor.history.redoStack).toEqual(beforeRedoStack);
  });


  it('rejects redo without changing records or history stacks', () => {
    let readOnly = false;

    const editor = createTestEditor({
      authorize: () => readOnly ? 'deny' : 'allow',
    });

    const id = editor.createShape(box('redo-denied'));
    expect(editor.undo().status).toBe('applied');
    expect(editor.getShape(id)).toBeUndefined();

    const beforeRevision = editor.store.revision;
    const beforeDocument = editor.serialize();
    const beforeUndoStack = editor.history.undoStack;
    const beforeRedoStack = editor.history.redoStack;

    readOnly = true;

    expect(() => editor.redo()).toThrow(MutationPermissionError);

    expect(editor.store.revision).toBe(beforeRevision);
    expect(editor.serialize()).toEqual(beforeDocument);
    expect(editor.getShape(id)).toBeUndefined();
    expect(editor.history.undoStack).toEqual(beforeUndoStack);
    expect(editor.history.redoStack).toEqual(beforeRedoStack);
  });

  it('exposes runtime read-only store and history facades', () => {
    const editor = createTestEditor();

    expect(() => (editor.store as any).put([box('direct-store')]))
      .toThrow(MutationPermissionError);
    expect(() => (editor.store as any).transact(
      { origin: 'remote' },
      () => undefined,
    )).toThrow(MutationPermissionError);
    expect(() => (editor.history as any).undo())
      .toThrow(MutationPermissionError);

    expect(editor.serialize().records.filter(record => record.kind === 'shape')).toHaveLength(0);
  });

  it('does not trust a caller merely because it claims a remote origin', () => {
    let readOnly = false;
    const editor = createTestEditor({
      authorize: request => !readOnly || request.origin === 'remote' || request.origin === 'load'
        ? 'allow'
        : 'deny',
    });
    readOnly = true;

    expect(() => getMutableStoreForTesting(editor).transact(
      { origin: 'remote', commandId: 'forged.remote' },
      tx => tx.insert(box('forged')),
    )).toThrow(MutationPermissionError);
    expect(editor.getShape(sid('forged'))).toBeUndefined();
  });

  it('rejects an unregistered capability even when ordinary local edits are allowed', () => {
    const editor = createTestEditor();
    const unregistered = createMutationCapability();

    expect(() => editor.transactWithCapability(
      unregistered,
      { origin: 'remote', commandId: 'unregistered.remote' },
      tx => tx.insert(box('unregistered')),
    )).toThrow(MutationPermissionError);
    expect(editor.getShape(sid('unregistered'))).toBeUndefined();
  });

  it('allows a registered remote capability while local mutations are denied', () => {
    const remoteCapability = createMutationCapability();
    const policy: MutationPolicy = {
      authorize: request => request.origin === 'remote' || request.origin === 'load'
        ? 'allow'
        : 'deny',
    };
    const editor = createEditor({
      plugins: [BoxPlugin],
      mutationPolicy: policy,
      trustedMutationCapabilities: [{
        capability: remoteCapability,
        origins: ['remote'],
      }],
    });

    expect(() => editor.createShape(box('local-denied')))
      .toThrow(MutationPermissionError);

    editor.transactWithCapability(
      remoteCapability,
      {
        origin: 'remote',
        commandId: 'collaboration.apply-update',
        affectedIds: [sid('remote-allowed')],
        history: 'ignore',
      },
      tx => tx.insert(box('remote-allowed')),
    );

    expect(editor.getShape(sid('remote-allowed'))).toBeDefined();
    expect(editor.history.undoStack).toHaveLength(0);
  });

  it('allows trusted document replacement in viewer mode', () => {
    const editor = createTestEditor({
      authorize: request => request.origin === 'load' ? 'allow' : 'deny',
    });

    editor.replaceDocument({
      schema: { storeVersion: 2, shapes: { box: 0 }, bindings: {} },
      records: [{ ...box('loaded'), kind: 'shape', schemaVersion: 0 }],
    });

    expect(editor.getShape(sid('loaded'))).toBeDefined();
  });

  it('rejects an interaction commit after permission is downgraded', () => {
    let readOnly = false;
    const editor = createTestEditor({
      authorize: () => readOnly ? 'deny' : 'allow',
    });
    const id = editor.createShape(box('downgrade'));
    editor.beginHistoryPreview();
    editor.batch('Move Preview', () => editor.updateShape(id, { x: 80 }), {
      history: 'ignore',
    });

    readOnly = true;

    expect(() => editor.recordHistoryPreview('Move Shapes', new Map()))
      .toThrow(MutationPermissionError);
    expect(editor.interactions.active).toBe(true);
    expect(getMutableStoreForTesting(editor).get(id)?.['x']).toBe(0);

    editor.cancelHistoryPreview();
    expect(editor.getShape(id)?.x).toBe(0);
  });
})
