import * as Y from 'yjs';
import { createSvgPathShape, MutationPermissionError, type GlideDocument } from '@durgakiran/glideline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlideboardController } from './GlideboardController';

function createBoxRecord(id: string, x: number, y: number, index = 'a0001') {
  return {
    id,
    type: 'box',
    x,
    y,
    index,
    rotation: 0,
    props: {
      w: 120,
      h: 80,
      label: id,
    },
    meta: {},
  };
}

function getRecordIds(document: GlideDocument): string[] {
  return document.records.map(record => String(record.id)).sort();
}

function createDocument(id: string): GlideDocument {
  return {
    schema: { storeVersion: 2, shapes: { box: 0 }, bindings: {} },
    records: [{
      ...createBoxRecord(id, 10, 20),
      kind: 'shape',
      schemaVersion: 0,
    }],
  };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(resolvePromise => {
    resolve = () => resolvePromise();
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GlideboardController', () => {
  it('requires initial durability disposition and schedules unsaved seeds', async () => {
    expect(() => new GlideboardController({
      sessionKey: 'missing-disposition',
      initialDocument: createDocument('shape:seed'),
    })).toThrow('initialDocumentDisposition is required');

    vi.useFakeTimers();
    const controller = new GlideboardController({
      sessionKey: 'unsaved-seed',
      initialDocument: createDocument('shape:seed'),
      initialDocumentDisposition: { kind: 'new-unsaved-seed' },
    });
    const save = vi.fn();
    try {
      controller.configureDocumentChanges(save, 20);
      controller.startDocumentChangeTracking();
      await vi.advanceTimersByTimeAsync(25);
      expect(save).toHaveBeenCalledTimes(1);
    } finally {
      controller.dispose();
    }
  });

  it('isolates editor state and board-local settings between controllers', () => {
    const controllerA = new GlideboardController({ sessionKey: 'board-a' });
    const controllerB = new GlideboardController({ sessionKey: 'board-b' });

    try {
      expect(controllerA.editor).not.toBe(controllerB.editor);
      expect(controllerA.editor.store).not.toBe(controllerB.editor.store);
      expect(controllerA.editor.camera).not.toBe(controllerB.editor.camera);

      controllerA.editor.batch('Create A', () => {
        controllerA.editor.createShape(createBoxRecord('shape:a', 40, 80) as any);
      });
      controllerA.editor.camera.setCamera({ x: 120, y: 240, z: 2 });
      controllerA.editor.setSelectedShapeIds(['shape:a' as any]);
      controllerA.editor.copy(['shape:a' as any]);
      controllerA.setCurrentTool('box');
      controllerA.setArrowRouteStyle('smart');
      controllerA.setConnectorPreset('double-arrow');
      controllerA.isCanvasDraggingRef.current = true;
      controllerA.deferredToolRestoreRef.current = 'box';

      expect(getRecordIds(controllerA.editor.serialize())).toEqual(['shape:a']);
      expect(controllerA.editor.camera.getCamera()).toEqual({ x: 120, y: 240, z: 2 });
      expect(controllerA.editor.getSelectedShapeIds()).toEqual(['shape:a']);
      expect(controllerA.editor.history.undoStack).toHaveLength(1);
      expect(controllerA.editor.currentToolId.peek()).toBe('box');
      expect(controllerA.arrowRouteStyleSignal.peek()).toBe('smart');
      expect(controllerA.arrowPresetSignal.peek()).toBe('double-arrow');
      expect(controllerA.arrowheadStartSignal.peek()).toBe('arrow');
      expect(controllerA.arrowheadEndSignal.peek()).toBe('arrow');
      expect(controllerA.isCanvasDraggingRef.current).toBe(true);
      expect(controllerA.deferredToolRestoreRef.current).toBe('box');

      expect(controllerB.editor.serialize().records).toEqual([]);
      expect(controllerB.editor.camera.getCamera()).toEqual({ x: 0, y: 0, z: 1 });
      expect(controllerB.editor.getSelectedShapeIds()).toEqual([]);
      expect(controllerB.editor.history.undoStack).toHaveLength(0);
      expect(controllerB.editor.currentToolId.peek()).toBe('select');
      expect(controllerB.arrowRouteStyleSignal.peek()).toBe('curve');
      expect(controllerB.arrowPresetSignal.peek()).toBe('arrow');
      expect(controllerB.arrowheadStartSignal.peek()).toBe('none');
      expect(controllerB.arrowheadEndSignal.peek()).toBe('arrow');
      expect(controllerB.isCanvasDraggingRef.current).toBe(false);
      expect(controllerB.deferredToolRestoreRef.current).toBeNull();
      expect(controllerB.editor.paste()).toEqual([]);
    } finally {
      controllerA.dispose();
      controllerB.dispose();
    }
  });

  it('keeps custom schemas and tools scoped to their controller', () => {
    const pluginA = createSvgPathShape({
      type: 'custom-a',
      defaultSize: { w: 40, h: 40 },
      getPathD: (w, h) => `M 0 0 L ${w} ${h}`,
    }).plugin;
    const pluginB = createSvgPathShape({
      type: 'custom-b',
      defaultSize: { w: 40, h: 40 },
      getPathD: (w, h) => `M ${w} 0 L 0 ${h}`,
    }).plugin;
    const controllerA = new GlideboardController({ sessionKey: 'custom-a', customShapes: [pluginA] });
    const controllerB = new GlideboardController({ sessionKey: 'custom-b', customShapes: [pluginB] });

    try {
      controllerA.setCurrentTool('custom-a');
      controllerB.setCurrentTool('custom-b');
      expect(controllerA.editor.currentToolId.peek()).toBe('custom-a');
      expect(controllerB.editor.currentToolId.peek()).toBe('custom-b');
      expect(() => controllerA.setCurrentTool('custom-b')).toThrow('unknown tool');
      expect(() => controllerB.setCurrentTool('custom-a')).toThrow('unknown tool');
    } finally {
      controllerA.dispose();
      controllerB.dispose();
    }
  });

  it('records clearing the document as one undo command', () => {
    const controller = new GlideboardController({ sessionKey: 'clear-history' });

    try {
      controller.editor.createShape(createBoxRecord('shape:clear-a', 10, 20) as any);
      controller.editor.createShape(createBoxRecord('shape:clear-b', 30, 40) as any);

      controller.clearDocument();

      expect(controller.editor.serialize().records).toHaveLength(0);
      const undoStack = controller.editor.history.undoStack;
      expect(undoStack[undoStack.length - 1]?.label).toBe('Clear Document');
      controller.editor.undo();
      expect(getRecordIds(controller.editor.serialize())).toEqual(['shape:clear-a', 'shape:clear-b']);
    } finally {
      controller.dispose();
    }
  });

  it('atomically replaces a document and clears document-scoped session state', () => {
    const controller = new GlideboardController({ sessionKey: 'replace-document' });
    try {
      controller.editor.createShape(createBoxRecord('shape:old', 10, 20) as any);
      controller.editor.setSelectedShapeIds(['shape:old' as any]);
      controller.editor.copy(['shape:old' as any]);
      controller.editor.camera.setCamera({ x: 50, y: 70, z: 2 });
      controller.setCurrentTool('box');
      controller.setArrowRouteStyle('smart');
      controller.setConnectorPreset('double-arrow');
      controller.isCanvasDraggingRef.current = true;
      controller.deferredToolRestoreRef.current = 'box';

      const report = controller.replaceDocument({
        schema: { storeVersion: 2, shapes: { box: 0 }, bindings: {} },
        records: [{
          ...createBoxRecord('shape:new', 100, 200),
          kind: 'shape',
          schemaVersion: 0,
        }],
      });

      expect(report.recordCount).toBe(1);
      expect(getRecordIds(controller.editor.serialize())).toEqual(['shape:new']);
      expect(controller.editor.getSelectedShapeIds()).toEqual([]);
      expect(controller.editor.history.undoStack).toHaveLength(0);
      expect(controller.editor.history.redoStack).toHaveLength(0);
      expect(controller.editor.paste()).toEqual([]);
      expect(controller.editor.camera.getCamera()).toEqual({ x: 0, y: 0, z: 1 });
      expect(controller.editor.currentToolId.peek()).toBe('select');
      expect(controller.arrowRouteStyleSignal.peek()).toBe('curve');
      expect(controller.arrowPresetSignal.peek()).toBe('arrow');
      expect(controller.isCanvasDraggingRef.current).toBe(false);
      expect(controller.deferredToolRestoreRef.current).toBeNull();
    } finally {
      controller.dispose();
    }
  });

  it('debounces document callbacks independently without emitting an initial snapshot', async () => {
    vi.useFakeTimers();
    const controllerA = new GlideboardController({ sessionKey: 'board-a' });
    const controllerB = new GlideboardController({ sessionKey: 'board-b' });
    const onDocumentChangeA = vi.fn((_document: GlideDocument) => { });
    const onDocumentChangeB = vi.fn((_document: GlideDocument) => { });

    try {
      controllerA.configureDocumentChanges(onDocumentChangeA, 50);
      controllerB.configureDocumentChanges(onDocumentChangeB, 50);
      controllerA.startDocumentChangeTracking();
      controllerB.startDocumentChangeTracking();

      await vi.advanceTimersByTimeAsync(500);
      expect(onDocumentChangeA).not.toHaveBeenCalled();
      expect(onDocumentChangeB).not.toHaveBeenCalled();

      controllerA.editor.createShape(createBoxRecord('shape:a', 10, 20) as any);
      controllerB.editor.createShape(createBoxRecord('shape:b', 30, 40) as any);

      await vi.advanceTimersByTimeAsync(49);
      expect(onDocumentChangeA).not.toHaveBeenCalled();
      expect(onDocumentChangeB).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(onDocumentChangeA).toHaveBeenCalledTimes(1);
      expect(onDocumentChangeB).toHaveBeenCalledTimes(1);
      expect(getRecordIds(onDocumentChangeA.mock.calls[0]![0])).toEqual(['shape:a']);
      expect(getRecordIds(onDocumentChangeB.mock.calls[0]![0])).toEqual(['shape:b']);
    } finally {
      controllerA.dispose();
      controllerB.dispose();
    }
  });

  it('does not mark the document dirty for ephemeral preview changes', async () => {
    vi.useFakeTimers();
    const controller = new GlideboardController({ sessionKey: 'ephemeral-preview' });
    const onDocumentChange = vi.fn((_document: GlideDocument) => { });

    try {
      controller.configureDocumentChanges(onDocumentChange, 25);
      controller.startDocumentChangeTracking();
      controller.editor.batch('Preview', () => {
        controller.editor.createShape(createBoxRecord('shape:preview', 10, 20) as any);
      }, { history: 'ignore', scope: 'ephemeral' });

      await vi.advanceTimersByTimeAsync(100);

      expect(onDocumentChange).not.toHaveBeenCalled();
      expect(controller.editor.getShape('shape:preview' as any)).toBeDefined();
      expect(controller.editor.serialize().records).toHaveLength(0);

      controller.editor.createShape(createBoxRecord('shape:final', 30, 40) as any);
      await vi.advanceTimersByTimeAsync(25);

      expect(onDocumentChange).toHaveBeenCalledTimes(1);
      expect(getRecordIds(onDocumentChange.mock.calls[0]![0])).toEqual(['shape:final']);
    } finally {
      controller.dispose();
    }
  });

  it('uses the latest callback without restarting a pending debounce', async () => {
    vi.useFakeTimers();
    const controller = new GlideboardController({ sessionKey: 'live-callback' });
    const firstCallback = vi.fn((_document: GlideDocument) => { });
    const latestCallback = vi.fn((_document: GlideDocument) => { });

    try {
      controller.configureDocumentChanges(firstCallback, 50);
      controller.startDocumentChangeTracking();
      controller.editor.createShape(createBoxRecord('shape:callback', 10, 20) as any);

      await vi.advanceTimersByTimeAsync(25);
      controller.configureDocumentChanges(latestCallback, 50);
      await vi.advanceTimersByTimeAsync(24);

      expect(firstCallback).not.toHaveBeenCalled();
      expect(latestCallback).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(firstCallback).not.toHaveBeenCalled();
      expect(latestCallback).toHaveBeenCalledTimes(1);
      expect(getRecordIds(latestCallback.mock.calls[0]![0])).toEqual(['shape:callback']);
    } finally {
      controller.dispose();
    }
  });

  it('does not create a duplicate save when the callback changes during an in-flight save', async () => {
    vi.useFakeTimers();
    const controller = new GlideboardController({ sessionKey: 'in-flight-callback' });
    const firstSave = createDeferred();
    const firstCallback = vi.fn(async (_document: GlideDocument) => {
      await firstSave.promise;
    });
    const latestCallback = vi.fn((_document: GlideDocument) => { });

    try {
      controller.configureDocumentChanges(firstCallback, 10);
      controller.startDocumentChangeTracking();
      controller.editor.createShape(createBoxRecord('shape:first', 10, 20) as any);

      await vi.advanceTimersByTimeAsync(10);
      expect(firstCallback).toHaveBeenCalledTimes(1);

      controller.configureDocumentChanges(latestCallback, 10);
      firstSave.resolve();
      await firstCallback.mock.results[0]!.value;
      await vi.advanceTimersByTimeAsync(1_000);

      expect(latestCallback).not.toHaveBeenCalled();

      controller.editor.createShape(createBoxRecord('shape:second', 30, 40, 'a0002') as any);
      await vi.advanceTimersByTimeAsync(10);

      expect(latestCallback).toHaveBeenCalledTimes(1);
      expect(getRecordIds(latestCallback.mock.calls[0]![0])).toEqual([
        'shape:first',
        'shape:second',
      ]);
    } finally {
      firstSave.resolve();
      controller.dispose();
    }
  });

  it('serializes slow saves and flush waits for the latest snapshot', async () => {
    vi.useFakeTimers();
    const controller = new GlideboardController({ sessionKey: 'serialized-saves' });
    const firstSave = createDeferred();
    const secondSave = createDeferred();
    const secondSaveStarted = createDeferred();
    const snapshots: string[][] = [];
    let activeCallbacks = 0;
    let maxActiveCallbacks = 0;

    const onDocumentChange = vi.fn(async (document: GlideDocument) => {
      snapshots.push(getRecordIds(document));
      const callNumber = snapshots.length;
      activeCallbacks += 1;
      maxActiveCallbacks = Math.max(maxActiveCallbacks, activeCallbacks);
      if (callNumber === 2) secondSaveStarted.resolve();
      try {
        await (callNumber === 1 ? firstSave.promise : secondSave.promise);
      } finally {
        activeCallbacks -= 1;
      }
    });

    try {
      controller.configureDocumentChanges(onDocumentChange, 10);
      controller.startDocumentChangeTracking();
      controller.editor.createShape(createBoxRecord('shape:first', 10, 20) as any);

      await vi.advanceTimersByTimeAsync(10);
      expect(onDocumentChange).toHaveBeenCalledTimes(1);
      expect(snapshots).toEqual([['shape:first']]);
      expect(activeCallbacks).toBe(1);

      controller.editor.createShape(createBoxRecord('shape:second', 30, 40, 'a0002') as any);
      let flushFinished = false;
      const flushPromise = controller.flush().then(() => {
        flushFinished = true;
      });

      await Promise.resolve();
      expect(flushFinished).toBe(false);
      expect(onDocumentChange).toHaveBeenCalledTimes(1);

      firstSave.resolve();
      await secondSaveStarted.promise;

      expect(onDocumentChange).toHaveBeenCalledTimes(2);
      expect(snapshots).toEqual([
        ['shape:first'],
        ['shape:first', 'shape:second'],
      ]);
      expect(maxActiveCallbacks).toBe(1);
      expect(activeCallbacks).toBe(1);
      expect(flushFinished).toBe(false);

      secondSave.resolve();
      await flushPromise;

      expect(flushFinished).toBe(true);
      expect(activeCallbacks).toBe(0);
      expect(maxActiveCallbacks).toBe(1);
    } finally {
      firstSave.resolve();
      secondSave.resolve();
      controller.dispose();
    }
  });

  it('saves dirty state when a document callback is configured later', async () => {
    vi.useFakeTimers();
    const controller = new GlideboardController({ sessionKey: 'late-callback' });
    const onDocumentChange = vi.fn((_document: GlideDocument) => { });

    try {
      controller.startDocumentChangeTracking();
      controller.editor.createShape(createBoxRecord('shape:before-callback', 10, 20) as any);

      expect(vi.getTimerCount()).toBe(0);
      controller.configureDocumentChanges(onDocumentChange, 25);
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(25);

      expect(onDocumentChange).toHaveBeenCalledTimes(1);
      expect(getRecordIds(onDocumentChange.mock.calls[0]![0])).toEqual(['shape:before-callback']);
    } finally {
      controller.dispose();
    }
  });

  it('retries rejected automatic saves until one succeeds', async () => {
    vi.useFakeTimers();
    const controller = new GlideboardController({ sessionKey: 'retry-save' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { });
    let attempt = 0;
    const snapshots: string[][] = [];
    const onDocumentChange = vi.fn(async (document: GlideDocument) => {
      attempt += 1;
      snapshots.push(getRecordIds(document));
      if (attempt < 3) throw new Error(`save attempt ${attempt} failed`);
    });

    try {
      controller.configureDocumentChanges(onDocumentChange, 10);
      controller.startDocumentChangeTracking();
      controller.editor.createShape(createBoxRecord('shape:retry', 10, 20) as any);

      await vi.advanceTimersByTimeAsync(10);
      expect(onDocumentChange).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(99);
      expect(onDocumentChange).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(onDocumentChange).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(199);
      expect(onDocumentChange).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(onDocumentChange).toHaveBeenCalledTimes(3);
      expect(snapshots).toEqual([
        ['shape:retry'],
        ['shape:retry'],
        ['shape:retry'],
      ]);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(onDocumentChange).toHaveBeenCalledTimes(3);
      expect(consoleError).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
      controller.dispose();
    }
  });

  it('cancels only the disposed controller pending document callback', async () => {
    vi.useFakeTimers();
    const controllerA = new GlideboardController({ sessionKey: 'board-a' });
    const controllerB = new GlideboardController({ sessionKey: 'board-b' });
    const onDocumentChangeA = vi.fn((_document: GlideDocument) => { });
    const onDocumentChangeB = vi.fn((_document: GlideDocument) => { });

    try {
      controllerA.configureDocumentChanges(onDocumentChangeA, 50);
      controllerB.configureDocumentChanges(onDocumentChangeB, 50);
      controllerA.startDocumentChangeTracking();
      controllerB.startDocumentChangeTracking();

      controllerA.editor.createShape(createBoxRecord('shape:a', 10, 20) as any);
      controllerB.editor.createShape(createBoxRecord('shape:b', 30, 40) as any);
      controllerA.dispose();

      await vi.advanceTimersByTimeAsync(50);
      expect(onDocumentChangeA).not.toHaveBeenCalled();
      expect(onDocumentChangeB).toHaveBeenCalledTimes(1);
      expect(getRecordIds(onDocumentChangeB.mock.calls[0]![0])).toEqual(['shape:b']);
    } finally {
      controllerA.dispose();
      controllerB.dispose();
    }
  });

  it('can flush a dirty snapshot while disposing', async () => {
    vi.useFakeTimers();
    const controller = new GlideboardController({ sessionKey: 'flush-on-dispose' });
    const onDocumentChange = vi.fn((_document: GlideDocument) => { });

    controller.configureDocumentChanges(onDocumentChange, 1_000);
    controller.startDocumentChangeTracking();
    controller.editor.createShape(createBoxRecord('shape:flush', 10, 20) as any);

    await controller.dispose({ pendingSave: 'flush' });

    expect(onDocumentChange).toHaveBeenCalledTimes(1);
    expect(getRecordIds(onDocumentChange.mock.calls[0]![0])).toEqual(['shape:flush']);
  });

  it('aborts an abort-aware in-flight save when disposal cancels it', async () => {
    vi.useFakeTimers();
    const controller = new GlideboardController({ sessionKey: 'cancel-in-flight' });
    let saveSignal: AbortSignal | null = null;
    const onDocumentChange = vi.fn((_document: GlideDocument, context: { signal: AbortSignal }) => {
      saveSignal = context.signal;
      return new Promise<void>(resolve => {
        context.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    });

    controller.configureDocumentChanges(onDocumentChange, 10);
    controller.startDocumentChangeTracking();
    controller.editor.createShape(createBoxRecord('shape:cancel', 10, 20) as any);
    await vi.advanceTimersByTimeAsync(10);

    expect(onDocumentChange).toHaveBeenCalledTimes(1);
    const inFlightSave = onDocumentChange.mock.results[0]!.value;
    void controller.dispose();

    expect(saveSignal).not.toBeNull();
    expect((saveSignal as AbortSignal | null)?.aborted).toBe(true);
    await inFlightSave;
  });

  it('detaches collaboration for one controller without affecting another', () => {
    const controllerA = new GlideboardController({ sessionKey: 'board-a' });
    const controllerB = new GlideboardController({ sessionKey: 'board-b' });
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const awarenessA = {
      clientID: 1,
      setLocalStateField: vi.fn(),
      getStates: () => new Map<number, unknown>(),
      on: vi.fn(),
      off: vi.fn(),
    };
    const awarenessB = {
      clientID: 2,
      setLocalStateField: vi.fn(),
      getStates: () => new Map<number, unknown>(),
      on: vi.fn(),
      off: vi.fn(),
    };

    try {
      controllerA.attachCollaboration({
        doc: docA,
        provider: { awareness: awarenessA },
        user: { id: 'user-a', name: 'A', color: '#f00' },
      });
      controllerB.attachCollaboration({
        doc: docB,
        provider: { awareness: awarenessB },
        user: { id: 'user-b', name: 'B', color: '#00f' },
      });

      controllerA.editor.createShape(createBoxRecord('shape:a', 10, 20) as any);
      controllerB.editor.createShape(createBoxRecord('shape:b', 30, 40) as any);

      expect(controllerA.awarenessSignal.peek()).toBe(awarenessA);
      expect(controllerB.awarenessSignal.peek()).toBe(awarenessB);
      expect(docA.getMap('glideboard-records-v2').size).toBe(1);
      expect(docB.getMap('glideboard-records-v2').size).toBe(1);

      controllerA.dispose();

      expect(controllerA.awarenessSignal.peek()).toBeNull();
      expect(awarenessA.setLocalStateField).toHaveBeenLastCalledWith('user', null);
      expect(controllerB.awarenessSignal.peek()).toBe(awarenessB);
      expect(awarenessB.setLocalStateField).toHaveBeenCalledTimes(1);

      controllerB.editor.createShape(createBoxRecord('shape:b2', 50, 60, 'a0002') as any);
      expect(docA.getMap('glideboard-records-v2').size).toBe(1);
      expect(docB.getMap('glideboard-records-v2').size).toBe(2);
    } finally {
      controllerA.dispose();
      controllerB.dispose();
      docA.destroy();
      docB.destroy();
    }
  });

  it('rejects an awareness provider shared by multiple boards', () => {
    const controllerA = new GlideboardController({ sessionKey: 'presence-a' });
    const controllerB = new GlideboardController({ sessionKey: 'presence-b' });
    const awareness = {
      clientID: 1,
      setLocalStateField: vi.fn(),
      getStates: () => new Map<number, unknown>(),
      on: vi.fn(),
      off: vi.fn(),
    };

    try {
      controllerA.attachPresence(
        { awareness },
        { id: 'user-a', name: 'A', color: '#f00' },
      );
      expect(() => controllerB.attachPresence(
        { awareness },
        { id: 'user-b', name: 'B', color: '#00f' },
      )).toThrow('cannot be shared by multiple boards');

      expect(awareness.setLocalStateField).toHaveBeenCalledTimes(1);
      expect(controllerA.awarenessSignal.peek()).toBe(awareness);
      expect(controllerB.awarenessSignal.peek()).toBeNull();

      controllerA.dispose();
      expect(awareness.setLocalStateField).toHaveBeenNthCalledWith(2, 'cursor', null);
      expect(awareness.setLocalStateField).toHaveBeenNthCalledWith(3, 'user', null);
    } finally {
      controllerA.dispose();
      controllerB.dispose();
    }
  });
  it('updates mutation permission when switching between edit and view modes', () => {
    const controller = new GlideboardController({
      sessionKey: 'mutation-policy-transition',
    });

    try {
      const id = controller.editor.createShape(
        createBoxRecord('shape:existing', 10, 20) as any,
      );

      expect(controller.editor.currentToolId.peek()).toBe('select');

      controller.setReadOnly(true);

      expect(controller.readOnlySignal.peek()).toBe(true);
      expect(controller.editor.currentToolId.peek()).toBe('hand');

      const beforeRevision = controller.editor.store.revision;
      const beforeDocument = controller.editor.serialize();

      expect(() => {
        controller.editor.createShape(
          createBoxRecord('shape:denied', 30, 40) as any,
        );
      }).toThrow(MutationPermissionError);

      expect(() => controller.editor.undo())
        .toThrow(MutationPermissionError);

      expect(controller.editor.store.revision).toBe(beforeRevision);
      expect(controller.editor.serialize()).toEqual(beforeDocument);

      controller.setReadOnly(false);

      expect(controller.readOnlySignal.peek()).toBe(false);
      expect(controller.editor.currentToolId.peek()).toBe('select');

      expect(() => {
        controller.editor.updateShape(id, { x: 100 });
      }).not.toThrow();

      expect(controller.editor.getShape(id)?.x).toBe(100);
    } finally {
      void controller.dispose();
    }
  });

  it('starts with local mutations denied when initially read-only', () => {
    const controller = new GlideboardController({
      sessionKey: 'initially-read-only',
      readOnly: true,
    });

    try {
      expect(controller.readOnlySignal.peek()).toBe(true);
      expect(controller.editor.currentToolId.peek()).toBe('hand');

      expect(() => {
        controller.editor.createShape(
          createBoxRecord('shape:denied', 10, 20) as any,
        );
      }).toThrow(MutationPermissionError);
    } finally {
      void controller.dispose();
    }
  });

  it('rejects every exposed local durable mutation path in viewer mode', async () => {
    const controller = new GlideboardController({
      sessionKey: 'viewer-mutation-matrix',
    });
    const debugKey = '__glideboardViewerPolicyTest';
    const detachDebug = controller.attachDebugApi(debugKey);

    try {
      const firstId = controller.editor.createShape(
        createBoxRecord('shape:first', 10, 20) as any,
      );
      controller.editor.createShape(
        createBoxRecord('shape:redo', 30, 40, 'a0002') as any,
      );
      controller.editor.copy([firstId]);
      expect(controller.editor.undo().status).toBe('applied');

      controller.setReadOnly(true);

      const beforeRevision = controller.editor.store.revision;
      const beforeDocument = controller.editor.serialize();
      const beforeUndo = controller.editor.history.undoStack;
      const beforeRedo = controller.editor.history.redoStack;
      const listener = vi.fn();
      const stopListening = controller.editor.store.listen(listener);

      const attempts: Array<() => unknown> = [
        () => controller.editor.createShape(createBoxRecord('shape:create', 50, 60) as any),
        () => controller.editor.updateShape(firstId, { x: 100 }),
        () => controller.editor.deleteShapes([firstId]),
        () => controller.editor.batch('Style change', () => {
          controller.editor.updateShape(firstId, { props: { color: 'red' } } as any);
        }),
        () => controller.editor.paste(),
        () => controller.editor.duplicateShapes([firstId], { x: 20, y: 20 }),
        () => controller.editor.reorderShapes([firstId], 'front'),
        () => controller.editor.undo(),
        () => controller.editor.redo(),
        () => controller.editor.batch('Text commit', () => {
          controller.editor.updateShape(firstId, { props: { label: 'Denied' } } as any);
        }),
        () => controller.editor.run(() => {
          controller.editor.createShape(createBoxRecord('shape:run', 70, 80) as any);
        }),
        () => controller.editor.importRecords([
          createBoxRecord('shape:import', 90, 100) as any,
        ]),
        () => controller.clearDocument(),
        () => controller.setCurrentTool('box'),
        () => (controller.editor.store as any).remove([firstId]),
        () => (controller.editor.store as any).transact(
          { origin: 'remote', commandId: 'forged.remote' },
          () => undefined,
        ),
        () => (controller.editor.history as any).undo(),
      ];

      for (const attempt of attempts) {
        expect(attempt).toThrow(MutationPermissionError);
      }

      const debugApi = (window as any)[debugKey];
      expect(() => debugApi.reset()).toThrow(MutationPermissionError);
      const mcpResult = await debugApi.callTool('create_shape', {
        type: 'box',
        x: 120,
        y: 140,
      });
      expect(mcpResult).toMatchObject({
        code: 'MUTATION_PERMISSION_DENIED',
      });

      expect(() => {
        controller.editor.setSelectedShapeIds([firstId]);
        controller.editor.camera.setCamera({ x: 25, y: 35, z: 1.5 });
        controller.editor.copy([firstId]);
        controller.editor.serialize();
      }).not.toThrow();
      expect(controller.editor.getSelectedShapeIds()).toEqual([firstId]);

      expect(controller.editor.store.revision).toBe(beforeRevision);
      expect(controller.editor.serialize()).toEqual(beforeDocument);
      expect(controller.editor.history.undoStack).toEqual(beforeUndo);
      expect(controller.editor.history.redoStack).toEqual(beforeRedo);
      expect(listener).not.toHaveBeenCalled();

      stopListening();
    } finally {
      detachDebug();
      void controller.dispose();
    }
  });

  it('continues applying trusted remote updates in viewer mode', async () => {
    const editorController = new GlideboardController({ sessionKey: 'remote-editor' });
    const viewerController = new GlideboardController({
      sessionKey: 'remote-viewer',
      readOnly: true,
    });
    const editorDoc = new Y.Doc();
    const viewerDoc = new Y.Doc();

    editorDoc.on('update', (update, origin) => {
      if (origin !== viewerDoc) Y.applyUpdate(viewerDoc, update, editorDoc);
    });
    viewerDoc.on('update', (update, origin) => {
      if (origin !== editorDoc) Y.applyUpdate(editorDoc, update, viewerDoc);
    });

    try {
      editorController.attachCollaboration({ doc: editorDoc });
      viewerController.attachCollaboration({ doc: viewerDoc });

      editorController.editor.createShape(
        createBoxRecord('shape:remote', 200, 240) as any,
      );
      await Promise.resolve();

      expect(viewerController.readOnlySignal.peek()).toBe(true);
      expect(viewerController.editor.getShape('shape:remote' as any)).toMatchObject({
        x: 200,
        y: 240,
      });
      expect(viewerController.editor.history.undoStack).toHaveLength(0);
    } finally {
      void editorController.dispose();
      void viewerController.dispose();
      editorDoc.destroy();
      viewerDoc.destroy();
    }
  });

  it('blocks local durable commands behind a close fence until release', () => {
    const controller = new GlideboardController({ sessionKey: 'close-fence' });
    try {
      const fence = controller.acquireMutationFence('close');
      expect(controller.mutationFenceDepthSignal.peek()).toBe(1);
      expect(() => controller.editor.createShape(
        createBoxRecord('shape:blocked', 10, 20) as any,
      )).toThrow(MutationPermissionError);
      expect(controller.editor.serialize().records).toHaveLength(0);

      fence.release();
      fence.release();
      expect(controller.mutationFenceDepthSignal.peek()).toBe(0);
      controller.editor.createShape(createBoxRecord('shape:allowed', 10, 20) as any);
      expect(controller.editor.getShape('shape:allowed' as any)).toBeDefined();
    } finally {
      void controller.dispose();
    }
  });

  it('retains a recoverable text draft when an active edit is cancelled for close', async () => {
    const controller = new GlideboardController({ sessionKey: 'cancel-edit-for-close' });
    try {
      const id = controller.editor.createShape(createBoxRecord('shape:text-draft', 10, 20) as any);
      controller.editor.startEditing(id);
      const canvas = document.createElement('div');
      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      editable.textContent = 'Unsaved local draft';
      canvas.appendChild(editable);
      controller.setCanvasElement(canvas);

      await controller.settleActiveEdit('cancel');

      expect(controller.editor.editingShapeId.peek()).toBeNull();
      expect(controller.recoverableTextDraftSignal.peek()).toEqual({
        shapeId: id,
        text: 'Unsaved local draft',
      });
    } finally {
      void controller.dispose();
    }
  });

  it('discards gesture previews, retains a text draft, and releases capture on downgrade', () => {
    const controller = new GlideboardController({ sessionKey: 'viewer-downgrade-cleanup' });

    try {
      const id = controller.editor.createShape(
        createBoxRecord('shape:downgrade', 10, 20) as any,
      );
      controller.editor.interactions.begin();
      controller.editor.interactions.runPreview(() => {
        controller.editor.updateShape(id, { x: 300 });
      });
      controller.editor.startEditing(id);

      const canvas = document.createElement('div');
      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      editable.textContent = 'Recover this text';
      canvas.appendChild(editable);
      const releasePointerCapture = vi.fn();
      Object.assign(canvas, {
        hasPointerCapture: (pointerId: number) => pointerId === 7,
        releasePointerCapture,
      });
      controller.setCanvasElement(canvas);
      controller.activePointerIdRef.current = 7;

      expect(controller.editor.getShape(id)?.x).toBe(300);
      expect(controller.editor.store.get(id)?.['x']).toBe(10);

      controller.setReadOnly(true);

      expect(controller.editor.interactions.active).toBe(false);
      expect(controller.editor.getShape(id)?.x).toBe(10);
      expect(controller.editor.editingShapeId.peek()).toBeNull();
      expect(controller.recoverableTextDraftSignal.peek()).toEqual({
        shapeId: id,
        text: 'Recover this text',
      });
      expect(releasePointerCapture).toHaveBeenCalledWith(7);
      expect(controller.activePointerIdRef.current).toBeNull();
      expect(controller.editor.currentToolId.peek()).toBe('hand');
    } finally {
      void controller.dispose();
    }
  });
});
