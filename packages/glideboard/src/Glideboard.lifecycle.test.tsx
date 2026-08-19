import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import * as Y from 'yjs';
import type { GlideDocument, GlidePlugin } from '@durgakiran/glideline';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GlideboardController } from './GlideboardController';
import { Glideboard } from './Glideboard';
import type { GlideboardAssetPlacementConfig, GlideboardHandle } from './types';

const capturedControllers = vi.hoisted(() => ({
  bySession: new Map<string, unknown>(),
  all: [] as unknown[],
}));

vi.mock('./WhiteboardApp', async () => {
  const { useGlideboardController } = await import('./GlideboardContext');

  return {
    WhiteboardApp() {
      const controller = useGlideboardController();
      capturedControllers.bySession.set(controller.sessionKey, controller);
      if (!capturedControllers.all.includes(controller)) {
        capturedControllers.all.push(controller);
      }
      return null;
    },
  };
});

const DEBUG_API_KEY = '__GLIDEBOARD_LIFECYCLE_TEST__';

function controllerFor(sessionKey: string): GlideboardController {
  const controller = capturedControllers.bySession.get(sessionKey);
  expect(controller).toBeDefined();
  return controller as GlideboardController;
}

async function flushControllerCreation() {
  await act(async () => {
    await Promise.resolve();
  });
}

function createBoxRecord(id: string, x: number, y = 0) {
  return {
    id,
    type: 'box',
    x,
    y,
    index: 'a0001',
    rotation: 0,
    props: {
      w: 120,
      h: 80,
      label: id,
    },
    meta: {},
  };
}

function addBox(controller: GlideboardController, id: string, x: number) {
  controller.editor.run(() => {
    controller.editor.createShape(createBoxRecord(id, x) as any);
  });
}

function makeCustomShapes(): GlidePlugin[] {
  return [{ id: 'lifecycle-test-plugin' }];
}

class CreationErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: unknown }
> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    return this.state.error ? <span>creation failed</span> : this.props.children;
  }
}

async function advanceTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('Glideboard board-scoped lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedControllers.bySession.clear();
    capturedControllers.all.length = 0;
    delete (window as any)[DEBUG_API_KEY];
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (window as any)[DEBUG_API_KEY];
  });

  it('abandons deferred controller creation when unmounted synchronously', async () => {
    const view = render(<Glideboard sessionKey="abandoned-before-creation" />);
    view.unmount();

    await flushControllerCreation();

    expect(capturedControllers.bySession.has('abandoned-before-creation')).toBe(false);
  });

  it('surfaces controller construction failures through React', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const view = render(
        <CreationErrorBoundary>
          <Glideboard sessionKey="invalid-startup" initialDocument={{} as GlideDocument} />
        </CreationErrorBoundary>,
      );

      await flushControllerCreation();

      expect(view.getByText('creation failed')).toBeTruthy();
      expect(capturedControllers.bySession.has('invalid-startup')).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('does not publish a construction error after a plugin synchronously unmounts the board', async () => {
    let view!: ReturnType<typeof render>;
    const plugin: GlidePlugin = {
      id: 'unmounting-plugin',
      onInstall: () => {
        view.unmount();
        throw new Error('plugin failed after unmount');
      },
    };
    view = render(<Glideboard sessionKey="unmounted-construction-error" customShapes={[plugin]} />);

    await flushControllerCreation();

    expect(capturedControllers.bySession.has('unmounted-construction-error')).toBe(false);
  });

	it('exposes generic asset placement configuration through the public handle', async () => {
    const ref = React.createRef<GlideboardHandle>();
    render(<Glideboard ref={ref} sessionKey="asset-placement-handle" />);
    await flushControllerCreation();
    const controller = controllerFor('asset-placement-handle');
    const configure = vi.spyOn(controller, 'configureAssetPlacement');
    const config: GlideboardAssetPlacementConfig = {
      selection: {
        itemId: 'library:item',
        mediaType: 'svg',
        width: 24,
        height: 24,
        provenance: {
          providerId: 'provider',
          itemId: 'library:item',
          sourceLibraryId: 'library',
          sourceVersion: '1',
          license: 'MIT',
        },
      },
      materializer: async () => { throw new Error('not used'); },
    };

    act(() => ref.current!.configureAssetPlacement(config));

    expect(configure).toHaveBeenCalledWith(config);
    expect(controller.editor.currentToolId.peek()).toBe('asset');
	});

	it('exposes asset replace, verified download, and permission commands through the public handle', async () => {
		const ref = React.createRef<GlideboardHandle>();
		render(<Glideboard ref={ref} sessionKey="asset-lifecycle-handle" />);
		await flushControllerCreation();
		const controller = controllerFor('asset-lifecycle-handle');
		const replace = vi.spyOn(controller, 'replaceAsset').mockResolvedValue('shape:asset' as never);
		const download = vi.spyOn(controller, 'downloadAsset').mockResolvedValue({ bytes: new Uint8Array([1]), mimeType: 'image/png' });
		const setReadOnly = vi.spyOn(controller, 'setReadOnly');
		const request = { kind: 'svg' as const, source: '<svg />' };

		await ref.current!.replaceAsset('shape:asset' as never, request);
		await ref.current!.downloadAsset('shape:asset');
		ref.current!.setReadOnly(true);

		expect(replace).toHaveBeenCalledWith('shape:asset', request);
		expect(download).toHaveBeenCalledWith('shape:asset', undefined, undefined);
		expect(setReadOnly).toHaveBeenCalledWith(true);
	});

  it('delegates every portability and asset lifecycle command through the public handle', async () => {
    const ref = React.createRef<GlideboardHandle>();
    render(<Glideboard ref={ref} sessionKey="complete-phase3-handle" />);
    await flushControllerCreation();
    const controller = controllerFor('complete-phase3-handle');
    const spies = {
      checkpoints: vi.spyOn(controller, 'getCollaborationCheckpoints').mockReturnValue({} as never),
      serialize: vi.spyOn(controller.editor, 'serialize').mockReturnValue({} as never),
      replaceDocument: vi.spyOn(controller, 'replaceDocument').mockImplementation(() => undefined),
      exportSvg: vi.spyOn(controller, 'exportSvgAtTarget').mockResolvedValue('<svg />'),
      createPortableFragment: vi.spyOn(controller, 'createPortableFragment').mockResolvedValue(null),
      pastePortableFragment: vi.spyOn(controller, 'pastePortableFragment').mockResolvedValue([]),
      importSvg: vi.spyOn(controller, 'importSvg').mockResolvedValue('shape:svg' as never),
      importRaster: vi.spyOn(controller, 'importRaster').mockResolvedValue('shape:raster' as never),
      replaceAsset: vi.spyOn(controller, 'replaceAsset').mockResolvedValue('shape:replacement' as never),
      downloadAsset: vi.spyOn(controller, 'downloadAsset').mockResolvedValue({ bytes: new Uint8Array(), mimeType: 'image/png' }),
      clearHistory: vi.spyOn(controller, 'clearAssetImportHistory'),
      configurePlacement: vi.spyOn(controller, 'configureAssetPlacement').mockImplementation(() => undefined),
      setTool: vi.spyOn(controller, 'setCurrentTool'),
      setReadOnly: vi.spyOn(controller, 'setReadOnly'),
      settle: vi.spyOn(controller, 'settleActiveEdit').mockResolvedValue(undefined),
      fence: vi.spyOn(controller, 'acquireMutationFence').mockResolvedValue({} as never),
      projection: vi.spyOn(controller, 'captureProjectionTarget').mockReturnValue({} as never),
      flush: vi.spyOn(controller, 'flush').mockResolvedValue(undefined),
    };
    const handle = ref.current!;
    void handle.checkpoints;
    handle.serialize();
    handle.replaceDocument({} as never);
    await handle.exportSvg({} as never);
    await handle.createPortableFragment({});
    await handle.pastePortableFragment({} as never);
    await handle.importSvg('<svg />');
    await handle.importRaster(new Uint8Array([1]), 'image/png');
    await handle.replaceAsset('shape:old' as never, { kind: 'svg', source: '<svg />' });
    await handle.downloadAsset('asset:one');
    handle.clearAssetImportHistory();
    handle.configureAssetPlacement({} as never);
    handle.getRecoverableTextDraft();
    handle.setCurrentTool('select');
    handle.setReadOnly(false);
    await handle.settleActiveEdit('commit');
    await handle.acquireMutationFence('test');
    handle.captureProjectionTarget();
    await handle.flush();
    for (const spy of Object.values(spies)) expect(spy).toHaveBeenCalled();
  });

  it('gives two mounted boards distinct, independently mutable state', async () => {
    render(
      <>
        <Glideboard sessionKey="board-a" />
        <Glideboard sessionKey="board-b" />
      </>,
    );
    await flushControllerCreation();

    const boardA = controllerFor('board-a');
    const boardB = controllerFor('board-b');

    expect(boardA).not.toBe(boardB);
    expect(boardA.editor).not.toBe(boardB.editor);
    expect(boardA.editor.store).not.toBe(boardB.editor.store);
    expect(boardA.editor.camera).not.toBe(boardB.editor.camera);
    expect(boardA.editor.history).not.toBe(boardB.editor.history);
    expect(boardA.readOnlySignal).not.toBe(boardB.readOnlySignal);
    expect(boardA.awarenessSignal).not.toBe(boardB.awarenessSignal);
    expect(boardA.isCanvasDraggingRef).not.toBe(boardB.isCanvasDraggingRef);
    expect(boardA.arrowPresetSignal).not.toBe(boardB.arrowPresetSignal);

    act(() => {
      addBox(boardA, 'box:shared', 20);
      addBox(boardB, 'box:shared', 420);
      boardA.editor.setSelectedShapeIds(['box:shared'] as any);
      boardA.editor.camera.setCamera({ x: 80, y: 40, z: 2 });
      boardA.editor.setCurrentTool('box');
      boardA.setConnectorPreset('double-arrow');
      boardA.isCanvasDraggingRef.current = true;
    });

    expect((boardA.editor.getShape('box:shared' as any) as any)?.x).toBe(20);
    expect((boardB.editor.getShape('box:shared' as any) as any)?.x).toBe(420);
    expect(boardA.editor.getSelectedShapeIds()).toEqual([]);
    expect(boardB.editor.getSelectedShapeIds()).toEqual([]);
    expect(boardA.editor.camera.getCamera()).toEqual({ x: 80, y: 40, z: 2 });
    expect(boardB.editor.camera.getCamera()).toEqual({ x: 0, y: 0, z: 1 });
    expect(boardA.editor.currentToolId.peek()).toBe('box');
    expect(boardB.editor.currentToolId.peek()).toBe('select');
    expect(boardA.arrowPresetSignal.peek()).toBe('double-arrow');
    expect(boardB.arrowPresetSignal.peek()).toBe('arrow');
    expect(boardA.isCanvasDraggingRef.current).toBe(true);
    expect(boardB.isCanvasDraggingRef.current).toBe(false);
    expect(boardA.editor.history.undoStack).toHaveLength(1);
    expect(boardB.editor.history.undoStack).toHaveLength(1);

    act(() => boardA.editor.undo());
    expect(boardA.editor.getShape('box:shared' as any)).toBeUndefined();
    expect((boardB.editor.getShape('box:shared' as any) as any)?.x).toBe(420);
    act(() => boardA.editor.redo());
    expect((boardA.editor.getShape('box:shared' as any) as any)?.x).toBe(20);
    expect((boardB.editor.getShape('box:shared' as any) as any)?.x).toBe(420);
  });

  it('preserves records and history across callback, read-only, and plugin identity changes', async () => {
    const firstCallback = vi.fn();
    const latestCallback = vi.fn();
    const view = render(
      <Glideboard
        sessionKey="stable-board"
        customShapes={makeCustomShapes()}
        onDocumentChange={firstCallback}
        documentChangeDebounceMs={25}
      />,
    );
    await flushControllerCreation();
    const originalController = controllerFor('stable-board');

    act(() => {
      addBox(originalController, 'box:persisted', 64);
    });
    expect(vi.getTimerCount()).toBe(1);
    expect(originalController.editor.history.undoStack).toHaveLength(1);

    view.rerender(
      <Glideboard
        sessionKey="stable-board"
        customShapes={makeCustomShapes()}
        readOnly
        onDocumentChange={latestCallback}
        documentChangeDebounceMs={25}
      />,
    );

    const rerenderedController = controllerFor('stable-board');
    expect(rerenderedController).toBe(originalController);
    expect(capturedControllers.all).toHaveLength(1);
    expect(rerenderedController.editor.getShape('box:persisted' as any)).toBeDefined();
    expect(rerenderedController.editor.history.undoStack).toHaveLength(1);
    expect(rerenderedController.readOnlySignal.peek()).toBe(true);
    expect(rerenderedController.editor.currentToolId.peek()).toBe('hand');

    await advanceTimers(25);

    expect(firstCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledTimes(1);
    const savedDocument = latestCallback.mock.calls[0]![0] as GlideDocument;
    expect(savedDocument.records.filter(record => record.kind !== 'page')).toEqual([
      expect.objectContaining({ id: 'box:persisted', x: 64 }),
    ]);
  });

  it('creates a fresh controller when the session key changes', async () => {
    const view = render(<Glideboard sessionKey="session-one" />);
    await flushControllerCreation();
    const firstController = controllerFor('session-one');

    act(() => {
      addBox(firstController, 'box:old-session', 100);
      firstController.editor.setSelectedShapeIds(['box:old-session'] as any);
      firstController.editor.camera.setCamera({ x: 30, y: 20, z: 1.5 });
      firstController.editor.setCurrentTool('arrow');
      firstController.setConnectorPreset('double-arrow');
    });

    view.rerender(<Glideboard sessionKey="session-two" />);
    await flushControllerCreation();
    const secondController = controllerFor('session-two');

    expect(secondController).not.toBe(firstController);
    expect(capturedControllers.all).toHaveLength(2);
    expect(secondController.sessionKey).toBe('session-two');
    expect(secondController.editor.serialize().records.filter(record => record.kind !== 'page')).toEqual([]);
    expect(secondController.editor.getSelectedShapeIds()).toEqual([]);
    expect(secondController.editor.history.undoStack).toEqual([]);
    expect(secondController.editor.camera.getCamera()).toEqual({ x: 0, y: 0, z: 1 });
    expect(secondController.editor.currentToolId.peek()).toBe('select');
    expect(secondController.arrowPresetSignal.peek()).toBe('arrow');
  });

  it('survives React StrictMode effect replay without clearing or saving on mount', async () => {
    const onDocumentChange = vi.fn();
    const onInstall = vi.fn();
    const view = render(
      <React.StrictMode>
        <Glideboard
          sessionKey="strict-board"
          customShapes={[{ id: 'strict-plugin', onInstall }]}
          debugApiKey={DEBUG_API_KEY}
          onDocumentChange={onDocumentChange}
          documentChangeDebounceMs={20}
        />
      </React.StrictMode>,
    );
    await flushControllerCreation();
    const controller = controllerFor('strict-board');

    expect(onInstall).toHaveBeenCalledTimes(1);
    expect((window as any)[DEBUG_API_KEY]).toBeDefined();
    await advanceTimers(100);
    expect(onDocumentChange).not.toHaveBeenCalled();

    act(() => {
      addBox(controller, 'box:strict', 88);
    });
    expect(controller.editor.getShape('box:strict' as any)).toBeDefined();
    expect(controller.editor.history.undoStack).toHaveLength(1);

    await advanceTimers(20);
    expect(onDocumentChange).toHaveBeenCalledTimes(1);
    expect((onDocumentChange.mock.calls[0]![0] as GlideDocument).records.filter(record => record.kind !== 'page')).toEqual([
      expect.objectContaining({ id: 'box:strict', x: 88 }),
    ]);

    view.unmount();
    expect((window as any)[DEBUG_API_KEY]).toBeUndefined();
  });

  it('does not broadcast a transient presence departure during StrictMode replay', async () => {
    const doc = new Y.Doc();
    const awareness = {
      clientID: 1,
      setLocalStateField: vi.fn(),
      getStates: () => new Map<number, unknown>(),
      on: vi.fn(),
      off: vi.fn(),
    };
    const view = render(
      <React.StrictMode>
        <Glideboard
          sessionKey="strict-presence"
          collaboration={{
            doc,
            provider: { awareness },
            user: { id: 'user-a', name: 'A', color: '#f00' },
          }}
        />
      </React.StrictMode>,
    );

    await act(async () => Promise.resolve());
    expect(awareness.setLocalStateField.mock.calls).not.toContainEqual(['user', null]);
    expect(awareness.setLocalStateField.mock.calls).not.toContainEqual(['canvasCursor', null]);

    view.unmount();
    await act(async () => Promise.resolve());

    expect(awareness.setLocalStateField).toHaveBeenCalledWith('canvasCursor', null);
    expect(awareness.setLocalStateField).toHaveBeenCalledWith('user', null);
    doc.destroy();
  });

  it('cancels a removed board save without deleting a newer debug API', async () => {
    const boardASave = vi.fn();

    function DebugBoards({ showA, showB }: { showA: boolean; showB: boolean }) {
      return (
        <>
          {showA ? (
            <Glideboard
              key="debug-a"
              sessionKey="debug-a"
              debugApiKey={DEBUG_API_KEY}
              onDocumentChange={boardASave}
              documentChangeDebounceMs={50}
            />
          ) : null}
          {showB ? (
            <Glideboard
              key="debug-b"
              sessionKey="debug-b"
              debugApiKey={DEBUG_API_KEY}
            />
          ) : null}
        </>
      );
    }

    const view = render(<DebugBoards showA showB={false} />);
    await flushControllerCreation();
    const boardA = controllerFor('debug-a');
    const apiA = (window as any)[DEBUG_API_KEY];
    expect(apiA).toBeDefined();

    act(() => {
      addBox(boardA, 'box:pending-save', 12);
    });

    view.rerender(<DebugBoards showA showB />);
    await flushControllerCreation();
    const apiB = (window as any)[DEBUG_API_KEY];
    expect(apiB).toBeDefined();
    expect(apiB).not.toBe(apiA);

    view.rerender(<DebugBoards showA={false} showB />);
    expect((window as any)[DEBUG_API_KEY]).toBe(apiB);

    await advanceTimers(50);
    expect(boardASave).not.toHaveBeenCalled();

    view.unmount();
    expect((window as any)[DEBUG_API_KEY]).toBeUndefined();
  });

  it('can flush a pending standalone save when the board unmounts', async () => {
    const onDocumentChange = vi.fn((_document: GlideDocument) => {});
    const view = render(
      <Glideboard
        sessionKey="flush-on-unmount"
        onDocumentChange={onDocumentChange}
        documentChangeDebounceMs={1_000}
        pendingSaveOnUnmount="flush"
      />,
    );
    await flushControllerCreation();
    const controller = controllerFor('flush-on-unmount');

    act(() => {
      addBox(controller, 'box:flush-on-unmount', 24);
    });
    expect(onDocumentChange).not.toHaveBeenCalled();

    view.unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onDocumentChange).toHaveBeenCalledTimes(1);
    expect((onDocumentChange.mock.calls[0]![0] as GlideDocument).records.filter(record => record.kind !== 'page')).toEqual([
      expect.objectContaining({ id: 'box:flush-on-unmount', x: 24 }),
    ]);
  });
});
