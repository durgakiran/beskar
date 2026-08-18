import * as Y from 'yjs';
import {
  aid,
  AssetPlacementTool,
  createSvgPathShape,
  MutationPermissionError,
  type GlideDocument,
} from '@durgakiran/glideline';
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
  return document.records
    .filter(record => record.kind !== 'page')
    .map(record => String(record.id))
    .sort();
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

function createPng(width: number, height: number): Uint8Array {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(png.buffer).setUint32(16, width);
  new DataView(png.buffer).setUint32(20, height);
  return png;
}

function successfulAssetPersistence() {
  return {
    token: '11111111-1111-4111-8111-111111111111',
    stage: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GlideboardController', () => {
  it('configures and activates the registered generic asset placement tool', async () => {
    const controller = new GlideboardController({ sessionKey: 'asset-placement' });
    const hash = 'c'.repeat(64);
    const rollback = vi.fn();
    try {
      controller.configureAssetPlacement({
        selection: {
          itemId: 'vendor:mark',
          mediaType: 'svg',
          width: 100,
          height: 50,
          provenance: {
            providerId: 'vendor',
            itemId: 'vendor:mark',
            sourceLibraryId: 'brand-kit',
            sourceVersion: '1.0.0',
            license: 'MIT',
          },
        },
        materializer: async () => ({
          asset: {
            id: aid(`asset:sha256:${hash}`),
            kind: 'asset',
            type: 'sanitized-svg',
            schemaVersion: 1,
            props: {
              hash,
              mimeType: 'image/svg+xml',
              sanitizerVersion: 1,
              byteLength: 8,
              width: 100,
              height: 50,
              viewBox: [0, 0, 100, 50],
              paths: [{ d: 'M0 0 L100 50' }],
            },
            meta: {},
          },
          contentHash: hash,
          rollback,
        }),
      });

      expect(controller.editor.currentToolId.peek()).toBe('asset');
      const shapeId = await (controller.editor.getCurrentTool() as AssetPlacementTool)
        .place({ x: 10, y: 20, w: 100, h: 50 });
      expect(controller.editor.getShape(shapeId!)).toMatchObject({ type: 'sanitized-svg' });
      expect(rollback).not.toHaveBeenCalled();
    } finally {
      void controller.dispose();
    }
  });

  it('exposes generic asset placement configuration through the debug API', () => {
    const controller = new GlideboardController({ sessionKey: 'asset-placement-debug' });
    const debugKey = '__glideboardAssetPlacementTest';
    const detachDebug = controller.attachDebugApi(debugKey);
    const config = {
      selection: {
        itemId: 'vendor:mark',
        mediaType: 'svg' as const,
        width: 100,
        height: 50,
        provenance: {
          providerId: 'vendor',
          itemId: 'vendor:mark',
          sourceLibraryId: 'brand-kit',
          sourceVersion: '1.0.0',
          license: 'MIT',
        },
      },
      materializer: async () => { throw new Error('not used'); },
    };

    try {
      const debugApi = (window as Window & Record<string, unknown>)[debugKey] as {
        configureAssetPlacement(config: typeof config): void;
      };
      debugApi.configureAssetPlacement(config);

      expect(controller.editor.currentToolId.peek()).toBe('asset');
    } finally {
      detachDebug();
      void controller.dispose();
    }
  });

  it('exposes deterministic record and history evidence through the debug API', () => {
    const controller = new GlideboardController({ sessionKey: 'acceptance-debug' });
    const debugKey = '__glideboardAcceptanceTest';
    const detachDebug = controller.attachDebugApi(debugKey);

    try {
      const id = controller.editor.createShape(createBoxRecord('shape:debug', 10, 20) as any);
      const debugApi = (window as any)[debugKey];
      expect(debugApi.getAcceptanceState()).toMatchObject({
        shapeCount: 1,
        assetCount: 0,
        history: { undoDepth: 1, redoDepth: 0 },
      });

      expect(debugApi.duplicateShapes([id], { x: 20, y: 20 })).toHaveLength(1);
      expect(debugApi.getAcceptanceState()).toMatchObject({
        shapeCount: 2,
        history: { undoDepth: 2, redoDepth: 0 },
      });
      expect(debugApi.undo()).toMatchObject({ status: 'applied' });
      expect(debugApi.getAcceptanceState()).toMatchObject({
        shapeCount: 1,
        history: { undoDepth: 1, redoDepth: 1 },
      });
      expect(debugApi.redo()).toMatchObject({ status: 'applied' });
      expect(debugApi.getAcceptanceState()).toMatchObject({
        shapeCount: 2,
        history: { undoDepth: 2, redoDepth: 0 },
      });
    } finally {
      detachDebug();
      void controller.dispose();
    }
  });

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
      expect(controllerA.editor.getSelectedShapeIds()).toEqual([]);
      expect(controllerA.editor.history.undoStack).toHaveLength(1);
      expect(controllerA.editor.currentToolId.peek()).toBe('box');
      expect(controllerA.arrowRouteStyleSignal.peek()).toBe('smart');
      expect(controllerA.arrowPresetSignal.peek()).toBe('double-arrow');
      expect(controllerA.arrowheadStartSignal.peek()).toBe('arrow');
      expect(controllerA.arrowheadEndSignal.peek()).toBe('arrow');
      expect(controllerA.isCanvasDraggingRef.current).toBe(true);
      expect(controllerA.deferredToolRestoreRef.current).toBe('box');

      expect(controllerB.editor.serialize().records.filter(record => record.kind !== 'page')).toEqual([]);
      expect(controllerB.editor.camera.getCamera()).toEqual({ x: 0, y: 0, z: 1 });
      expect(controllerB.editor.getSelectedShapeIds()).toEqual([]);
      expect(controllerB.editor.history.undoStack).toHaveLength(0);
      expect(controllerB.editor.currentToolId.peek()).toBe('select');
      expect(controllerB.arrowRouteStyleSignal.peek()).toBe('ortho');
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

      expect(controller.editor.serialize().records.filter(record => record.kind !== 'page')).toHaveLength(0);
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

      expect(report.recordCount).toBe(2);
      expect(getRecordIds(controller.editor.serialize())).toEqual(['shape:new']);
      expect(controller.editor.getSelectedShapeIds()).toEqual([]);
      expect(controller.editor.history.undoStack).toHaveLength(0);
      expect(controller.editor.history.redoStack).toHaveLength(0);
      expect(controller.editor.paste()).toEqual([]);
      expect(controller.editor.camera.getCamera()).toEqual({ x: 0, y: 0, z: 1 });
      expect(controller.editor.currentToolId.peek()).toBe('select');
      expect(controller.arrowRouteStyleSignal.peek()).toBe('ortho');
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
      expect(controller.editor.serialize().records.filter(record => record.kind !== 'page')).toHaveLength(0);

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

  it('aborts and settles imports before the final disposal flush', async () => {
    const persistStarted = createDeferred();
    const order: string[] = [];
    const commit = vi.fn(async () => { order.push('commit'); });
    const rollback = vi.fn(async () => { order.push('rollback'); });
    const controller = new GlideboardController({
      sessionKey: 'flush-after-import-settlement',
      assetStorage: {
        prepare: async () => ({
          token: '11111111-1111-4111-8111-111111111111', commit, rollback,
          stage: async (_bytes, signal) => {
            persistStarted.resolve();
            await new Promise<void>(resolve => {
              signal.addEventListener('abort', () => resolve(), { once: true });
            });
          },
        }),
        resolve: () => null,
      },
    });
    const onDocumentChange = vi.fn((_document: GlideDocument) => { order.push('save'); });
    controller.configureDocumentChanges(onDocumentChange, 1_000);
    controller.startDocumentChangeTracking();
    controller.editor.createShape(createBoxRecord('shape:flush-before-import', 10, 20) as any);
    const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng(8, 8) });
    const rejected = expect(task.result).rejects.toMatchObject({ name: 'AbortError' });
    await persistStarted.promise;

    await controller.dispose({ pendingSave: 'flush' });
    await rejected;

    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledOnce();
    expect(order).toEqual(['rollback', 'save']);
    expect(getRecordIds(onDocumentChange.mock.calls[0]![0])).toEqual(['shape:flush-before-import']);
    expect(controller.editor.serialize().records.filter(record => record.kind === 'asset')).toEqual([]);
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
      expect(docA.getMap('glideboard-records-v2').size).toBe(2);
      expect(docB.getMap('glideboard-records-v2').size).toBe(2);

      controllerA.dispose();

      expect(controllerA.awarenessSignal.peek()).toBeNull();
      expect(awarenessA.setLocalStateField).toHaveBeenCalledWith('user', null);
      expect(awarenessA.setLocalStateField).toHaveBeenLastCalledWith('pageId', null);
      expect(controllerB.awarenessSignal.peek()).toBe(awarenessB);
      expect(awarenessB.setLocalStateField).toHaveBeenCalledTimes(2);

      controllerB.editor.createShape(createBoxRecord('shape:b2', 50, 60, 'a0002') as any);
      expect(docA.getMap('glideboard-records-v2').size).toBe(2);
      expect(docB.getMap('glideboard-records-v2').size).toBe(3);
    } finally {
      controllerA.dispose();
      controllerB.dispose();
      docA.destroy();
      docB.destroy();
    }
  });

  it('reuses one Y.Doc for per-shape rich text and garbage-collects deleted fragments', () => {
    const first = new GlideboardController({ sessionKey: 'rich-text-first' });
    const second = new GlideboardController({ sessionKey: 'rich-text-second' });
    const firstDoc = new Y.Doc();
    const secondDoc = new Y.Doc();
    firstDoc.on('update', (update, origin) => {
      if (origin !== secondDoc) Y.applyUpdate(secondDoc, update, firstDoc);
    });
    secondDoc.on('update', (update, origin) => {
      if (origin !== firstDoc) Y.applyUpdate(firstDoc, update, secondDoc);
    });
    try {
      first.attachCollaboration({ doc: firstDoc });
      second.attachCollaboration({ doc: secondDoc });
      const shapeId = first.editor.createShape({ type: 'text', x: 10, y: 20, props: { text: 'Shared' } } as any);
      expect(first.getCanvasTextCollaboration(shapeId, { create: false })).toBeUndefined();
      const firstBinding = first.getCanvasTextCollaboration(shapeId)!;
      expect(first.getCanvasTextCollaboration(shapeId)!.fragment).toBe(firstBinding.fragment);

      const paragraph = new Y.XmlElement('paragraph');
      const content = new Y.XmlText();
      content.insert(0, 'Shared');
      paragraph.insert(0, [content]);
      (firstBinding.fragment as Y.XmlFragment).insert(0, [paragraph]);

      const secondBinding = second.getCanvasTextCollaboration(shapeId)!;
      expect((secondBinding.fragment as Y.XmlFragment).toJSON()).toBe((firstBinding.fragment as Y.XmlFragment).toJSON());

      first.editor.deleteShapes([shapeId]);
      expect(firstDoc.getMap('glideboard-rich-text-fragments-v1').has(shapeId)).toBe(false);
      expect(secondDoc.getMap('glideboard-rich-text-fragments-v1').has(shapeId)).toBe(false);
    } finally {
      void first.dispose();
      void second.dispose();
      firstDoc.destroy();
      secondDoc.destroy();
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

      expect(awareness.setLocalStateField).toHaveBeenCalledTimes(2);
      expect(controllerA.awarenessSignal.peek()).toBe(awareness);
      expect(controllerB.awarenessSignal.peek()).toBeNull();

      controllerA.dispose();
      expect(awareness.setLocalStateField).toHaveBeenNthCalledWith(3, 'canvasCursor', null);
      expect(awareness.setLocalStateField).toHaveBeenNthCalledWith(4, 'user', null);
      expect(awareness.setLocalStateField).toHaveBeenNthCalledWith(5, 'pageId', null);
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
      expect(controller.editor.serialize().records.filter(record => record.kind !== 'page')).toHaveLength(0);

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
      controller.editor.updateEditingDraft('Unsaved local draft');

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
      controller.editor.updateEditingDraft('Recover this text');

      const canvas = document.createElement('div');
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

  it('imports untrusted SVG as canonical asset data and an engine-rendered shape', async () => {
    const controller = new GlideboardController({ sessionKey: 'safe-svg-import' });
    try {
      const source = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20">
          <path d="M0 0 L40 0 L40 20 L0 20 Z" fill="#123456"/>
        </svg>
      `;
      const id = await controller.importSvg(source, { x: 25, y: 50 });
      await controller.importSvg(source, { x: 100, y: 100 });
      const shape = controller.editor.getShape(id)!;
      const asset = controller.editor.store.get(shape.props['assetId'] as string)!;

      expect(shape.type).toBe('sanitized-svg');
      expect(shape.x).toBe(25);
      expect(shape.y).toBe(50);
      expect(asset['type']).toBe('sanitized-svg');
      expect(JSON.stringify(asset)).not.toContain('<svg');
      expect(JSON.stringify(asset)).not.toContain('xmlns');
      expect(controller.editor.getShapeUtil(shape).toSvg(shape).querySelectorAll('path')).toHaveLength(1);
      expect(controller.editor.serialize().records.filter(record => record.kind === 'asset')).toHaveLength(1);
    } finally {
      void controller.dispose();
    }
  });

  it('persists validated raster bytes before inserting immutable asset records', async () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set([0x49, 0x48, 0x44, 0x52], 12);
    new DataView(png.buffer).setUint32(16, 16);
    new DataView(png.buffer).setUint32(20, 8);
    const persistence = successfulAssetPersistence();
    const prepare = vi.fn(async () => persistence);
    const controller = new GlideboardController({
      sessionKey: 'safe-raster-import',
      assetStorage: {
        prepare,
        resolve: asset => `https://media.example.test/${asset.props['hash']}`,
      },
    });
    try {
      const id = await controller.importRaster(png, 'image/png', { x: 10, y: 20 });
      const shape = controller.editor.getShape(id)!;
      const asset = controller.editor.store.get(shape.props['assetId'] as string)!;
      expect(prepare).toHaveBeenCalledOnce();
      expect(persistence.stage).toHaveBeenCalledOnce();
      expect(persistence.commit).toHaveBeenCalledOnce();
      expect(asset['props']).not.toHaveProperty('src');
      expect(asset['props']).not.toHaveProperty('bytes');
      expect(controller.editor.getShapeUtil(shape).toSvg(shape).querySelector('image')?.getAttribute('href'))
        .toMatch(/^https:\/\/media\.example\.test\//);
    } finally {
      void controller.dispose();
    }
  });

  it('does not create a raster record when host persistence fails', async () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set([0x49, 0x48, 0x44, 0x52], 12);
    new DataView(png.buffer).setUint32(16, 2);
    new DataView(png.buffer).setUint32(20, 2);
    const controller = new GlideboardController({
      sessionKey: 'failed-raster-import',
      assetStorage: {
        prepare: async () => { throw new Error('storage unavailable'); },
        resolve: () => null,
      },
    });
    try {
      await expect(controller.importRaster(png, 'image/png')).rejects.toThrow('storage unavailable');
      expect(controller.editor.serialize().records.filter(record => record.kind !== 'page')).toHaveLength(0);
    } finally {
      void controller.dispose();
    }
  });

  it('exposes stable queued, uploading, progress, and complete import job state', async () => {
    const persisted = createDeferred();
    let reportProgress: ((progress: number) => void) | undefined;
    const stage = vi.fn(async (
      _bytes: Uint8Array,
      _signal: AbortSignal,
      progress?: (value: number) => void,
    ) => {
      reportProgress = progress;
      await persisted.promise;
    });
    const controller = new GlideboardController({
      sessionKey: 'asset-job-progress',
      assetStorage: { prepare: async () => ({ ...successfulAssetPersistence(), stage }), resolve: () => null },
    });
    try {
      const task = controller.queueAssetImport({
        kind: 'raster',
        bytes: createPng(32, 16),
        declaredMimeType: 'image/png',
        name: 'diagram.png',
      });
      expect(controller.getAssetImportJob(task.id)).toMatchObject({
        id: task.id,
        name: 'diagram.png',
        status: 'queued',
        progress: 0,
        attempt: 1,
      });

      await vi.waitFor(() => expect(stage).toHaveBeenCalledOnce());
      expect(controller.getAssetImportJob(task.id)?.status).toBe('uploading');
      reportProgress?.(0.4);
      expect(controller.getAssetImportJob(task.id)?.progress).toBe(0.4);
      reportProgress?.(0.2);
      expect(controller.getAssetImportJob(task.id)?.progress).toBe(0.4);

      persisted.resolve();
      const shapeId = await task.result;
      expect(controller.getAssetImportJob(task.id)).toMatchObject({
        status: 'complete',
        progress: 1,
        shapeId,
      });
      expect(controller.assetImportJobsSignal.peek()).toHaveLength(1);
    } finally {
      persisted.resolve();
      void controller.dispose();
    }
  });

  it('cancels imports without reporting cancellation as an error', async () => {
    const stage = vi.fn(async (_bytes: Uint8Array, signal: AbortSignal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')),
          { once: true });
      });
    });
    const controller = new GlideboardController({
      sessionKey: 'asset-job-cancel',
      assetStorage: { prepare: async () => ({ ...successfulAssetPersistence(), stage }), resolve: () => null },
    });
    try {
      const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng(8, 8) });
      const rejected = expect(task.result).rejects.toMatchObject({ name: 'AbortError' });
      await vi.waitFor(() => expect(stage).toHaveBeenCalledOnce());

      expect(controller.cancelAssetImport(task.id)).toBe(true);
      await rejected;
      expect(controller.getAssetImportJob(task.id)).toMatchObject({ status: 'cancelled' });
      expect(controller.getAssetImportJob(task.id)?.error).toBeUndefined();
      expect(controller.editor.serialize().records.filter(record => record.kind !== 'page')).toEqual([]);
      expect(controller.dismissAssetImport(task.id)).toBe(true);
      expect(controller.assetImportJobsSignal.peek()).toEqual([]);
    } finally {
      void controller.dispose();
    }
  });

  it('fences a commit response that arrives after cancellation and compensates it', async () => {
    const commitStarted = createDeferred();
    const releaseCommit = createDeferred();
    const rollback = vi.fn(async () => {});
    const controller = new GlideboardController({
      sessionKey: 'asset-job-cancel-late-commit',
      assetStorage: {
        prepare: async () => ({
          token: '33333333-3333-4333-8333-333333333333',
          stage: async () => {},
          commit: async () => {
            commitStarted.resolve();
            await releaseCommit.promise;
          },
          rollback,
        }),
        resolve: () => null,
      },
    });
    try {
      const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng(8, 8) });
      const rejected = expect(task.result).rejects.toMatchObject({ name: 'AbortError' });
      await commitStarted.promise;
      expect(controller.cancelAssetImport(task.id)).toBe(true);
      releaseCommit.resolve();
      await rejected;
      expect(rollback).toHaveBeenCalledOnce();
      expect(controller.getAssetImportJob(task.id)?.status).toBe('cancelled');
      expect(controller.editor.serialize().records.filter(record => record.kind !== 'page')).toEqual([]);
    } finally {
      releaseCommit.resolve();
      await controller.dispose();
    }
  });

  it('keeps rollback failure actionable when cancellation races a commit response', async () => {
    const commitStarted = createDeferred();
    const releaseCommit = createDeferred();
    const cleanupFailure = new Error('orphan blob could not be deleted');
    const controller = new GlideboardController({
      sessionKey: 'asset-job-cancel-cleanup-failure',
      assetStorage: {
        prepare: async () => ({
          token: '44444444-4444-4444-8444-444444444444',
          stage: async () => {},
          commit: async () => {
            commitStarted.resolve();
            await releaseCommit.promise;
          },
          rollback: async () => { throw cleanupFailure; },
        }),
        resolve: () => null,
      },
    });
    try {
      const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng(8, 8) });
      await commitStarted.promise;
      controller.cancelAssetImport(task.id);
      releaseCommit.resolve();
      await expect(task.result).rejects.toMatchObject({
        name: 'AssetOrphanCleanupError',
        code: 'orphan-cleanup',
      });
      expect(controller.getAssetImportJob(task.id)).toMatchObject({
        status: 'error',
        error: { category: 'storage', retryable: true },
      });
    } finally {
      releaseCommit.resolve();
      await controller.dispose();
    }
  });

  it('clears import history immediately while active cleanup settles', async () => {
    const stageStarted = createDeferred();
    const releaseStage = createDeferred();
    const controller = new GlideboardController({
      sessionKey: 'asset-job-reset-history',
      assetStorage: {
        prepare: async () => ({
          ...successfulAssetPersistence(),
          stage: async () => {
            stageStarted.resolve();
            await releaseStage.promise;
          },
        }),
        resolve: () => null,
      },
    });
    const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng(8, 8) });
    const rejected = expect(task.result).rejects.toMatchObject({ name: 'AbortError' });
    await stageStarted.promise;
    controller.clearAssetImportHistory();
    expect(controller.assetImportJobsSignal.peek()).toEqual([]);
    releaseStage.resolve();
    await rejected;
    await controller.dispose();
  });

  it('ignores stale callbacks when a cancelled job is retried immediately', async () => {
    let persistAttempt = 0;
    const stage = vi.fn(async (_bytes: Uint8Array, signal: AbortSignal) => {
      persistAttempt += 1;
      if (persistAttempt === 1) {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')),
            { once: true });
        });
      }
    });
    const controller = new GlideboardController({
      sessionKey: 'asset-job-cancel-retry-race',
      assetStorage: { prepare: async () => ({ ...successfulAssetPersistence(), stage }), resolve: () => null },
    });
    try {
      const first = controller.queueAssetImport({ kind: 'raster', bytes: createPng(9, 9) });
      const firstRejected = expect(first.result).rejects.toMatchObject({ name: 'AbortError' });
      await vi.waitFor(() => expect(stage).toHaveBeenCalledOnce());
      expect(controller.cancelAssetImport(first.id)).toBe(true);

      const retried = controller.retryAssetImport(first.id);
      await firstRejected;
      const shapeId = await retried.result;
      expect(controller.getAssetImportJob(first.id)).toMatchObject({
        status: 'complete',
        attempt: 2,
        shapeId,
      });
      expect(stage).toHaveBeenCalledTimes(2);
    } finally {
      void controller.dispose();
    }
  });

  it('categorizes host errors and retries a stable job before dismissal', async () => {
    let attempt = 0;
    const prepare = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw Object.assign(new Error('object store offline'), {
          category: 'network',
          retryable: true,
        });
      }
      return successfulAssetPersistence();
    });
    const controller = new GlideboardController({
      sessionKey: 'asset-job-retry',
      assetStorage: { prepare: prepare as any, resolve: () => null },
    });
    try {
      const first = controller.queueAssetImport({ kind: 'raster', bytes: createPng(10, 5) });
      await expect(first.result).rejects.toThrow('object store offline');
      expect(controller.getAssetImportJob(first.id)).toMatchObject({
        status: 'error',
        attempt: 1,
        error: { category: 'network', retryable: true },
      });
      expect(controller.dismissAssetImport(first.id)).toBe(true);
      expect(controller.getAssetImportJob(first.id)).toBeUndefined();

      const retryable = controller.queueAssetImport({ kind: 'raster', bytes: createPng(12, 6) });
      await retryable.result;
      expect(() => controller.retryAssetImport(retryable.id)).toThrow('cannot be retried');

      attempt = 0;
      const failed = controller.queueAssetImport({ kind: 'raster', bytes: createPng(14, 7) });
      await expect(failed.result).rejects.toThrow('object store offline');
      const retried = controller.retryAssetImport(failed.id);
      expect(retried.id).toBe(failed.id);
      await retried.result;
      expect(controller.getAssetImportJob(failed.id)).toMatchObject({
        status: 'complete',
        attempt: 2,
      });
      expect(controller.dismissAssetImport(failed.id)).toBe(true);
      expect(controller.getAssetImportJob(failed.id)).toBeUndefined();
    } finally {
      void controller.dispose();
    }
  });

  it('publishes ingress limits and categorizes limit failures', async () => {
    const controller = new GlideboardController({ sessionKey: 'asset-limit-error' });
    try {
      expect(controller.assetLimits.maxSvgBytes).toBe(1024 * 1024);
      expect(controller.assetLimits.supportedMimeTypes).toContain('image/webp');
      const task = controller.queueAssetImport({
        kind: 'svg',
        source: `<svg viewBox="0 0 1 1"><path d="${'M0 0 '.repeat(250_000)}"/></svg>`,
      });
      await expect(task.result).rejects.toThrow('byte limit');
      expect(controller.getAssetImportJob(task.id)).toMatchObject({
        status: 'error',
        error: { category: 'limit-exceeded', retryable: false },
      });
    } finally {
      void controller.dispose();
    }
  });

  it('atomically replaces immutable asset references while preserving shape state', async () => {
    const persisted: Uint8Array[] = [];
    const controller = new GlideboardController({
      sessionKey: 'asset-replace',
      assetStorage: {
        prepare: async () => ({
          ...successfulAssetPersistence(),
          stage: async bytes => { persisted.push(new Uint8Array(bytes)); },
        }),
        resolve: () => null,
      },
    });
    try {
      const shapeId = await controller.importRaster(createPng(20, 10), 'image/png', { x: 11, y: 22 });
      controller.editor.updateShape(shapeId, {
        rotation: Math.PI / 4,
        props: {
          w: 333,
          h: 222,
          crop: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 },
          altText: 'Architecture diagram',
        },
      } as any);
      const before = controller.editor.getShape(shapeId)!;
      const oldAssetId = before.props['assetId'];
      const historyLength = controller.editor.history.undoStack.length;

      const replacedId = await controller.replaceAsset(shapeId, {
        kind: 'raster',
        bytes: createPng(40, 30),
        declaredMimeType: 'image/png',
      });
      const after = controller.editor.getShape(shapeId)!;
      expect(replacedId).toBe(shapeId);
      expect(after).toMatchObject({ x: 11, y: 22, rotation: Math.PI / 4 });
      expect(after.props).toMatchObject({
        w: 333,
        h: 222,
        crop: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 },
        altText: 'Architecture diagram',
      });
      expect(after.props['assetId']).not.toBe(oldAssetId);
      expect(controller.editor.history.undoStack).toHaveLength(historyLength + 1);
      expect(controller.editor.history.undoStack[controller.editor.history.undoStack.length - 1]?.label)
        .toBe('Replace Asset');
      expect(persisted).toHaveLength(2);

      controller.editor.undo();
      expect(controller.editor.getShape(shapeId)?.props['assetId']).toBe(oldAssetId);
      expect(controller.editor.store.get(after.props['assetId'] as string)).toBeUndefined();
    } finally {
      void controller.dispose();
    }
  });

  it('leaves the existing reference untouched when replacement persistence fails', async () => {
    let persistCount = 0;
    const controller = new GlideboardController({
      sessionKey: 'asset-replace-failure',
      assetStorage: {
        prepare: async () => {
          persistCount += 1;
          if (persistCount > 1) throw new Error('replacement unavailable');
          return successfulAssetPersistence();
        },
        resolve: () => null,
      },
    });
    try {
      const shapeId = await controller.importRaster(createPng(20, 10));
      const oldAssetId = controller.editor.getShape(shapeId)?.props['assetId'];
      await expect(controller.replaceAsset(shapeId, {
        kind: 'raster',
        bytes: createPng(30, 15),
      })).rejects.toThrow('replacement unavailable');
      expect(controller.editor.getShape(shapeId)?.props['assetId']).toBe(oldAssetId);
      expect(controller.editor.serialize().records.filter(record => record.kind === 'asset')).toHaveLength(1);
    } finally {
      void controller.dispose();
    }
  });

  it('rolls back staged bytes when a replacement target disappears after persistence', async () => {
    const replacementPersisted = createDeferred();
    const releaseReplacement = createDeferred();
    const commit = vi.fn(async () => {});
    const rollback = vi.fn(async () => {});
    let persistCount = 0;
    const controller = new GlideboardController({
      sessionKey: 'asset-replace-late-validation',
      assetStorage: {
        prepare: async () => {
          persistCount += 1;
          if (persistCount === 1) return successfulAssetPersistence();
          return {
            token: '22222222-2222-4222-8222-222222222222', commit, rollback,
            stage: async () => {
              replacementPersisted.resolve();
              await releaseReplacement.promise;
            },
          };
        },
        resolve: () => null,
      },
    });
    try {
      const shapeId = await controller.importRaster(createPng(20, 10));
      const replacement = controller.replaceAsset(shapeId, {
        kind: 'raster',
        bytes: createPng(30, 15),
      });
      await replacementPersisted.promise;
      controller.editor.deleteShapes([shapeId]);
      releaseReplacement.resolve();

      await expect(replacement).rejects.toThrow('was not found');
      expect(commit).not.toHaveBeenCalled();
      expect(rollback).toHaveBeenCalledOnce();
      expect(controller.editor.serialize().records.filter(record => record.kind === 'asset'))
        .toHaveLength(1);
    } finally {
      releaseReplacement.resolve();
      await controller.dispose();
    }
  });

  it('downloads validated original bytes only through the trusted host contract', async () => {
    const original = createPng(18, 9);
    const download = vi.fn(async () => ({
      bytes: original,
      mimeType: 'image/png',
      fileName: 'original.png',
    }));
    const controller = new GlideboardController({
      sessionKey: 'asset-download',
      assetStorage: {
        prepare: async () => successfulAssetPersistence(),
        resolve: () => null,
        download,
      },
    });
    try {
      const shapeId = await controller.importRaster(original, 'image/png');
      const result = await controller.downloadAsset(shapeId);
      expect(download).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ mimeType: 'image/png', fileName: 'original.png' });
      expect(result.bytes).toEqual(original);
      expect(result.bytes).not.toBe(original);

      const assetId = String(controller.editor.getShape(shapeId)?.props['assetId']);
      download.mockResolvedValueOnce({ bytes: original, mimeType: 'image/png' });
      await expect(controller.downloadAsset(assetId, new AbortController().signal, {
        documentId: 'document-explicit', versionId: 'version-explicit',
      })).resolves.toEqual({ bytes: original, mimeType: 'image/png' });

      download.mockResolvedValueOnce({ bytes: original, mimeType: 'image/jpeg', fileName: 'bad.jpg' });
      await expect(controller.downloadAsset(shapeId)).rejects.toThrow('did not match');

      download.mockResolvedValueOnce({ bytes: original.slice(0, -1), mimeType: 'image/png' });
      await expect(controller.downloadAsset(shapeId)).rejects.toThrow('did not match');

      download.mockResolvedValueOnce({ bytes: Array.from(original), mimeType: 'image/png' } as any);
      await expect(controller.downloadAsset(shapeId)).rejects.toThrow('did not match');

      const corrupted = new Uint8Array(original);
      corrupted[8] = corrupted[8]! ^ 0xff;
      download.mockResolvedValueOnce({ bytes: corrupted, mimeType: 'image/png', fileName: 'corrupt.png' });
      await expect(controller.downloadAsset(shapeId)).rejects.toThrow('did not match');
    } finally {
      void controller.dispose();
    }
  });

  it('exports raster SVGs with verified embedded bytes instead of runtime URLs', async () => {
    const original = createPng(18, 9);
    const context = { documentId: 'board-1', versionId: 'version-4' };
    const download = vi.fn(async () => ({ bytes: original, mimeType: 'image/png' }));
    const controller = new GlideboardController({
      sessionKey: 'portable-svg-export',
      assetResolutionContext: context,
      assetStorage: {
        prepare: async () => successfulAssetPersistence(),
        resolve: () => 'https://signed.example.test/runtime.png',
        download,
      },
    });
    try {
      await controller.importRaster(original, 'image/png');
      const svg = await controller.exportSvgAtTarget();

      expect(svg).toContain('href="data:image/png;base64,');
      expect(svg).not.toContain('signed.example.test');
      expect(download).toHaveBeenCalledWith(expect.anything(), expect.any(AbortSignal), context);
    } finally {
      await controller.dispose();
    }
  });

  it('registers retention before returning a production portable fragment', async () => {
    const original = createPng(12, 6);
    const retainReferences = vi.fn(async () => undefined);
    const controller = new GlideboardController({
      sessionKey: 'portable-fragment-retention',
      assetStorage: {
        prepare: async () => successfulAssetPersistence(),
        resolve: () => null,
        download: async () => ({ bytes: original, mimeType: 'image/png' }),
        retainReferences,
      },
    });
    try {
      const shapeId = await controller.importRaster(original, 'image/png');
      const fragment = await controller.createPortableFragment({ shapeIds: [shapeId] });

      expect(fragment?.rasterPayloads).toHaveLength(1);
      expect(retainReferences).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringMatching(/^asset:/)]),
        undefined,
        expect.any(AbortSignal),
      );
    } finally {
      await controller.dispose();
    }
  });

  it('imports plain text at explicit and viewport positions and updates connector terminals', () => {
    const controller = new GlideboardController({ sessionKey: 'plain-text-and-connectors' });
    try {
      expect(controller.importPlainText('')).toBeNull();
      const explicit = controller.importPlainText('Explicit', { x: 12, y: 34 })!;
      expect(controller.editor.getShape(explicit)).toMatchObject({
        x: 12,
        y: 34,
        props: expect.objectContaining({ text: 'Explicit', textAlign: 'left' }),
      });
      controller.editor.camera.setCamera({ x: 100, y: 200, z: 1 });
      const centered = controller.importPlainText('Centered')!;
      expect(controller.editor.getShape(centered)?.type).toBe('text');
      expect(controller.editor.getSelectedShapeIds()).toEqual([centered]);

      controller.setArrowheadStart('arrow');
      controller.setArrowheadEnd('none');
      expect(controller.arrowPresetSignal.peek()).toBe('arrow');
      controller.setConnectorPreset('line');
      expect(controller.arrowPresetSignal.peek()).toBe('line');
      controller.setConnectorPreset('double-arrow');
      expect(controller.arrowPresetSignal.peek()).toBe('double-arrow');
      controller.setConnectorPreset('arrow');
      expect(controller.arrowheadStartSignal.peek()).toBe('none');
      expect(controller.arrowheadEndSignal.peek()).toBe('arrow');
    } finally {
      void controller.dispose();
    }
  });

  it('fails closed when download, portability, or collaboration checkpoint hooks are absent', async () => {
    const controller = new GlideboardController({ sessionKey: 'missing-host-hooks' });
    try {
      await expect(controller.downloadAsset('asset:missing')).rejects.toMatchObject({ category: 'unavailable' });
      await expect(controller.createPortableFragment({ shapeIds: [] })).rejects.toThrow(/download and retention/);
      await expect(controller.pastePortableFragment({} as any)).rejects.toThrow(/materialization hook/);
      expect(() => controller.getCollaborationCheckpoints()).toThrow(/not attached/);
      expect(() => controller.captureProjectionTarget()).toThrow(/not attached/);
    } finally {
      await controller.dispose();
    }
  });

  it('captures collaboration targets and exercises the debug command and inspection surface', async () => {
    const controller = new GlideboardController({ sessionKey: 'debug-complete-surface' });
    const doc = new Y.Doc();
    try {
      controller.attachCollaboration({ doc });
      const target = await controller.captureProjectionTarget();
      expect(target.storeRevision).toBeGreaterThanOrEqual(0);
      expect(controller.getCollaborationCheckpoints()).toBeTruthy();

      const cleanup = controller.attachDebugApi('__phase3ControllerDebug');
      const api = (window as any).__phase3ControllerDebug;
      const first = controller.editor.createShape(createBoxRecord('shape:debug-a', 0, 0) as any);
      const second = controller.editor.createShape(createBoxRecord('shape:debug-b', 100, 0, 'a0002') as any);
      api.select([first, second]);
      expect(api.getSelection()).toEqual([first, second]);
      expect(api.getCurrentToolId()).toBe('select');
      api.setCurrentTool('box');
      expect(api.getCurrentToolId()).toBe('box');
      expect(api.getDocument().records.length).toBeGreaterThan(2);
      expect(api.getAIContext()).toBeTruthy();
      expect(api.getToolManifest()).toBeTruthy();
      expect(api.getAcceptanceState()).toMatchObject({ shapeCount: 2, assetCount: 0 });
      expect(api.getFocusedGroupId()).toBeNull();
      expect(api.getShapeLocalBounds(first)).toBeTruthy();
      expect(api.getSmartRoutingSnapshot()).toBeTruthy();
      expect(api.getArrowRoutePoints(first)).toBeNull();
      expect(api.duplicateShapes([first], { x: 5, y: 5 })).toHaveLength(1);
      api.undo();
      api.redo();
      api.reset();
      expect(api.getAcceptanceState().shapeCount).toBe(0);
      cleanup();
      cleanup();
      expect((window as any).__phase3ControllerDebug).toBeUndefined();
    } finally {
      await controller.dispose();
      doc.destroy();
    }
  });
});
