import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sid, type AnyRecord } from '@durgakiran/glideline';
import { GlideboardProvider, useGlideboardController } from './GlideboardContext';
import { GlideboardController } from './GlideboardController';
import { WhiteboardApp } from './WhiteboardApp';
import { shouldIgnoreGlideboardShortcuts } from './shortcut-guards';

vi.mock('./Canvas', () => ({
  Canvas() {
    const controller = useGlideboardController();
    return <div ref={element => controller.setCanvasElement(element)} data-glideboard-role="canvas" />;
  },
}));
vi.mock('./ContextMenu', () => ({ ContextMenu: () => null }));
vi.mock('./ZoomWidget', () => ({ ZoomWidget: () => null, fitToScreen: () => undefined }));
vi.mock('./BackToContentButton', () => ({ BackToContentButton: () => null }));
vi.mock('./CollaborationCursors', () => ({ CollaborationCursors: () => null }));

afterEach(() => cleanup());

function shapeRecords(controller: GlideboardController) {
  return controller.editor.serialize().records.filter(record => record.kind === 'shape');
}

function dispatchTypingKey(target: HTMLElement, key: string, code?: string) {
  const event = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, composed: true });
  act(() => target.dispatchEvent(event));
}

function createPng(width: number, height: number): Uint8Array {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(png.buffer).setUint32(16, width);
  new DataView(png.buffer).setUint32(20, height);
  return png;
}

describe('WhiteboardApp shortcut boundaries', () => {
  it('guards native capture and React shortcuts while raster drafts remain focused and uncommitted', () => {
    const controller = new GlideboardController({ sessionKey: 'asset-shortcut-boundary' });
    const captureKeys: string[] = [];
    const captureObserver = (event: KeyboardEvent) => captureKeys.push(event.key);
    try {
      const assetId = 'asset:raster-shortcut-boundary';
      const report = controller.editor.importRecords([{
        id: assetId,
        kind: 'asset',
        type: 'raster-image',
        schemaVersion: 1,
        props: {
          hash: 'c'.repeat(64), mimeType: 'image/png', byteLength: 128, width: 400, height: 200,
        },
        meta: {},
      } as AnyRecord]);
      const importedAssetId = report.idMap[assetId] ?? assetId;
      const shapeId = controller.editor.createShape({
        type: 'raster-image', x: 0, y: 0,
        props: { w: 200, h: 100, assetId: importedAssetId, crop: { x: 0, y: 0, w: 1, h: 1 } },
      });
      controller.editor.setSelectedShapeIds([shapeId]);
      const updateShape = vi.spyOn(controller.editor, 'updateShape');
      window.addEventListener('keydown', captureObserver, { capture: true });

      const view = render(
        <GlideboardProvider controller={controller}>
          <WhiteboardApp />
        </GlideboardProvider>,
      );
      const altText = view.getByLabelText('Alt text') as HTMLInputElement;
      altText.focus();
      fireEvent.change(altText, { target: { value: 'Raster preview' } });
      dispatchTypingKey(altText, 't', 'KeyT');
      dispatchTypingKey(altText, ' ', 'Space');

      expect(captureKeys).toEqual(['t', ' ']);
      expect(controller.editor.currentToolId.peek()).toBe('select');
      expect(controller.editor.getSelectedShapeIds()).toEqual([shapeId]);
      expect(shapeRecords(controller)).toHaveLength(1);
      expect(controller.editor.getShape(shapeId)?.props.altText).toBe('');
      expect(view.getByLabelText('Alt text')).toBe(altText);
      expect(document.activeElement).toBe(altText);
      expect(updateShape).not.toHaveBeenCalled();

      fireEvent.blur(altText);
      expect(controller.editor.getShape(shapeId)?.props.altText).toBe('Raster preview');

      const cropX = view.getByLabelText('Crop X') as HTMLInputElement;
      cropX.focus();
      fireEvent.change(cropX, { target: { value: '0.25' } });
      dispatchTypingKey(cropX, 'r', 'KeyR');
      act(() => controller.editor.updateShape(sid(shapeId), { props: { aspectLocked: false } }));

      expect(view.getByLabelText('Crop X')).toBe(cropX);
      expect(cropX.value).toBe('0.25');
      expect(document.activeElement).toBe(cropX);
      expect(controller.editor.currentToolId.peek()).toBe('select');
      expect(controller.editor.getSelectedShapeIds()).toEqual([shapeId]);
      expect(shapeRecords(controller)).toHaveLength(1);
      expect(controller.editor.getShape(shapeId)?.props.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });

      fireEvent.change(view.getByLabelText('Crop W'), { target: { value: '0.75' } });
      fireEvent.click(view.getByText('Apply crop'));
      expect(controller.editor.getShape(shapeId)?.props.crop).toEqual({ x: 0.25, y: 0, w: 0.75, h: 1 });
    } finally {
      window.removeEventListener('keydown', captureObserver, { capture: true });
      void controller.dispose();
    }
  });

  it('preserves native inspector paste while canvas paste still creates text', () => {
    const controller = new GlideboardController({ sessionKey: 'asset-paste-boundary' });
    try {
      const assetId = 'asset:raster-paste-boundary';
      const report = controller.editor.importRecords([{
        id: assetId,
        kind: 'asset',
        type: 'raster-image',
        schemaVersion: 1,
        props: {
          hash: 'd'.repeat(64), mimeType: 'image/png', byteLength: 128, width: 400, height: 200,
        },
        meta: {},
      } as AnyRecord]);
      const importedAssetId = report.idMap[assetId] ?? assetId;
      const shapeId = controller.editor.createShape({
        type: 'raster-image', x: 0, y: 0,
        props: { w: 200, h: 100, assetId: importedAssetId },
      });
      controller.editor.setSelectedShapeIds([shapeId]);
      const importPlainText = vi.spyOn(controller, 'importPlainText');
      const view = render(
        <GlideboardProvider controller={controller}>
          <WhiteboardApp />
        </GlideboardProvider>,
      );
      const altText = view.getByLabelText('Alt text') as HTMLInputElement;
      altText.focus();

      const nativePasteAllowed = fireEvent.paste(altText, {
        clipboardData: { files: [], getData: (type: string) => type === 'text/plain' ? 'Native input text' : '' },
      });

      expect(nativePasteAllowed).toBe(true);
      expect(importPlainText).not.toHaveBeenCalled();
      expect(shapeRecords(controller)).toHaveLength(1);
      expect(view.getByLabelText('Alt text')).toBe(altText);
      expect(document.activeElement).toBe(altText);

      const app = view.container.querySelector<HTMLElement>('[data-glideboard-role="app"]')!;
      app.focus();
      const canvasPasteAllowed = fireEvent.paste(app, {
        clipboardData: { files: [], getData: (type: string) => type === 'text/plain' ? 'Canvas text' : '' },
      });

      expect(canvasPasteAllowed).toBe(false);
      expect(importPlainText).toHaveBeenCalledWith('Canvas text');
      expect(shapeRecords(controller).map(record => record.type)).toEqual(['raster-image', 'text']);
      expect(view.queryByLabelText('Alt text')).toBeNull();
    } finally {
      void controller.dispose();
    }
  });

  it('recognizes composed-path, active-element, and editable-element guards', () => {
    const marker = document.createElement('div');
    marker.setAttribute('data-glideboard-ignore-shortcuts', '');
    const markerChild = document.createElement('span');
    marker.append(markerChild);
    expect(shouldIgnoreGlideboardShortcuts({ target: document.body, composedPath: () => [document.body, markerChild] }))
      .toBe(true);

    for (const tag of ['input', 'select', 'textarea'] as const) {
      const element = document.createElement(tag);
      document.body.append(element);
      element.focus();
      expect(shouldIgnoreGlideboardShortcuts({ target: document.body })).toBe(true);
      element.remove();
    }

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(shouldIgnoreGlideboardShortcuts({ target: editable, composedPath: () => [editable] })).toBe(true);

    const falseEditable = document.createElement('div');
    falseEditable.setAttribute('contenteditable', 'false');
    expect(shouldIgnoreGlideboardShortcuts({ target: falseEditable, composedPath: () => [] })).toBe(false);
    expect(shouldIgnoreGlideboardShortcuts({ target: null, composedPath: () => [] })).toBe(false);

    const nativeTarget = document.createElement('textarea');
    expect(shouldIgnoreGlideboardShortcuts({
      target: document.body,
      nativeEvent: { composedPath: () => [nativeTarget] } as unknown as Event,
    })).toBe(true);
  });

  it('keeps selected raster and SVG import inspectors mounted after their jobs complete', async () => {
    const controller = new GlideboardController({
      sessionKey: 'completed-raster-inspector',
      assetStorage: {
        prepare: async () => ({
          token: '11111111-1111-4111-8111-111111111111',
          stage: async () => undefined,
          commit: async () => undefined,
          rollback: async () => undefined,
        }),
        resolve: asset => `https://media.example.test/${asset.props['hash']}`,
      },
    });
    try {
      const view = render(
        <GlideboardProvider controller={controller}>
          <WhiteboardApp />
        </GlideboardProvider>,
      );

      let shapeId = '';
      await act(async () => {
        shapeId = await controller.importRaster(createPng(320, 180), 'image/png');
      });

      await waitFor(() => expect(view.getByLabelText('Alt text')).toBeTruthy());
      expect(controller.assetImportJobsSignal.peek()[0]).toMatchObject({ status: 'complete', shapeId });
      expect(controller.editor.getSelectedShapeIds()).toEqual([shapeId]);
      expect(view.container.querySelector('[data-glideboard-role="asset-inspector"]')).toBeTruthy();
      expect(view.getByLabelText('Crop X')).toBeTruthy();

      let svgShapeId = '';
      await act(async () => {
        svgShapeId = await controller.importSvg(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><path d="M0 0h20v10H0z"/></svg>',
        );
      });

      await waitFor(() => expect(view.getByRole('group', { name: 'SVG color mode' })).toBeTruthy());
      expect(controller.assetImportJobsSignal.peek()).toHaveLength(2);
      expect(controller.assetImportJobsSignal.peek()[1]).toMatchObject({ status: 'complete', shapeId: svgShapeId });
      expect(controller.editor.getSelectedShapeIds()).toEqual([svgShapeId]);
      expect(view.getByLabelText('Theme color')).toBeTruthy();
      expect(view.queryByLabelText('Crop X')).toBeNull();
    } finally {
      await controller.dispose();
    }
  });

  it('dispatches the complete editable keyboard command surface', async () => {
    const controller = new GlideboardController({ sessionKey: 'keyboard-command-surface' });
    const first = controller.editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 40, h: 30 } });
    const second = controller.editor.createShape({ type: 'box', x: 80, y: 0, props: { w: 40, h: 30 } });
    const selectBoth = () => controller.editor.setSelectedShapeIds([first, second]);
    const methods = {
      setCurrentTool: vi.spyOn(controller.editor, 'setCurrentTool'),
      deleteShapes: vi.spyOn(controller.editor, 'deleteShapes'),
      nudgeShapes: vi.spyOn(controller.editor, 'nudgeShapes'),
      selectAll: vi.spyOn(controller.editor, 'selectAll'),
      duplicateShapes: vi.spyOn(controller.editor, 'duplicateShapes'),
      groupShapes: vi.spyOn(controller.editor, 'groupShapes'),
      ungroupShapes: vi.spyOn(controller.editor, 'ungroupShapes'),
      setLocked: vi.spyOn(controller.editor, 'setLocked'),
      setHidden: vi.spyOn(controller.editor, 'setHidden'),
      reorderShapes: vi.spyOn(controller.editor, 'reorderShapes'),
      undo: vi.spyOn(controller.editor, 'undo'),
      redo: vi.spyOn(controller.editor, 'redo'),
      copy: vi.spyOn(controller.editor, 'copy'),
    };
    for (const method of Object.values(methods)) {
      if (method !== methods.setCurrentTool && method !== methods.copy) method.mockImplementation(() => undefined as never);
    }
    vi.spyOn(controller, 'createPortableFragment').mockResolvedValue({ schema: { portableBoardFragmentVersion: 1 } } as any);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    try {
      const view = render(
        <GlideboardProvider controller={controller}>
          <WhiteboardApp />
        </GlideboardProvider>,
      );
      const app = view.container.querySelector<HTMLElement>('[data-glideboard-role="app"]')!;

      for (const [key, tool] of Object.entries({ v: 'select', h: 'hand', r: 'box', e: 'ellipse', t: 'text', s: 'sticky-note', d: 'draw', x: 'eraser', a: 'arrow', f: 'frame' })) {
        fireEvent.keyDown(app, { key });
        expect(methods.setCurrentTool).toHaveBeenLastCalledWith(tool);
      }

      selectBoth();
      for (const [key, shiftKey, delta] of [
        ['ArrowLeft', false, { x: -1, y: 0 }], ['ArrowRight', true, { x: 10, y: 0 }],
        ['ArrowUp', false, { x: 0, y: -1 }], ['ArrowDown', true, { x: 0, y: 10 }],
      ] as const) {
        fireEvent.keyDown(app, { key, shiftKey });
        expect(methods.nudgeShapes).toHaveBeenLastCalledWith([first, second], delta);
      }

      fireEvent.keyDown(app, { key: 'a', ctrlKey: true });
      expect(methods.selectAll).toHaveBeenCalled();
      for (const event of [
        { key: 'd', method: methods.duplicateShapes },
        { key: 'g', method: methods.groupShapes },
        { key: 'g', shiftKey: true, method: methods.ungroupShapes },
        { key: 'l', method: methods.setLocked },
        { key: 'h', shiftKey: true, method: methods.setHidden },
        { key: ']', method: methods.reorderShapes },
        { key: ']', shiftKey: true, method: methods.reorderShapes },
        { key: '[', method: methods.reorderShapes },
        { key: '[', shiftKey: true, method: methods.reorderShapes },
      ]) {
        selectBoth();
        fireEvent.keyDown(app, { key: event.key, ctrlKey: true, shiftKey: event.shiftKey });
        expect(event.method).toHaveBeenCalled();
      }

      selectBoth();
      fireEvent.keyDown(app, { key: 'c', ctrlKey: true });
      await waitFor(() => expect(writeText).toHaveBeenCalled());
      expect(methods.copy).toHaveBeenCalledWith([first, second]);

      selectBoth();
      fireEvent.keyDown(app, { key: 'x', ctrlKey: true });
      await waitFor(() => expect(methods.deleteShapes).toHaveBeenCalled());

      fireEvent.keyDown(app, { key: 'z', ctrlKey: true });
      fireEvent.keyDown(app, { key: 'z', ctrlKey: true, shiftKey: true });
      expect(methods.undo).toHaveBeenCalled();
      expect(methods.redo).toHaveBeenCalled();

      selectBoth();
      fireEvent.keyDown(app, { key: 'Escape' });
      expect(controller.editor.getSelectedShapeIds()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      await controller.dispose();
    }
  });

  it('cuts locally as one undoable operation when portable clipboard writing rejects', async () => {
    const controller = new GlideboardController({ sessionKey: 'cut-clipboard-rejection' });
    const shapeId = controller.editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 40, h: 30 } });
    controller.editor.setSelectedShapeIds([shapeId]);
    const copy = vi.spyOn(controller.editor, 'copy');
    vi.spyOn(controller, 'createPortableFragment').mockResolvedValue({
      schema: { portableBoardFragmentVersion: 1 },
    } as any);
    const clipboardError = new Error('clipboard permission denied');
    const writeText = vi.fn().mockRejectedValue(clipboardError);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    try {
      const view = render(
        <GlideboardProvider controller={controller}>
          <WhiteboardApp />
        </GlideboardProvider>,
      );
      const app = view.container.querySelector<HTMLElement>('[data-glideboard-role="app"]')!;

      fireEvent.keyDown(app, { key: 'x', ctrlKey: true });

      expect(controller.editor.getShape(shapeId)).toBeUndefined();
      expect(copy).toHaveBeenCalledWith([shapeId]);
      await waitFor(() => expect(warning).toHaveBeenCalledWith(
        '[Glideboard] Unable to write portable clipboard data',
        clipboardError,
      ));

      controller.editor.undo();
      expect(controller.editor.getShape(shapeId)).toBeDefined();
    } finally {
      vi.unstubAllGlobals();
      warning.mockRestore();
      await controller.dispose();
    }
  });

  it('temporarily switches to hand and restores or defers the prior tool', () => {
    const controller = new GlideboardController({ sessionKey: 'spacebar-hand-tool' });
    try {
      const view = render(
        <GlideboardProvider controller={controller}>
          <WhiteboardApp />
        </GlideboardProvider>,
      );
      const app = view.container.querySelector<HTMLElement>('[data-glideboard-role="app"]')!;
      controller.editor.setCurrentTool('box');
      app.focus();

      fireEvent.keyDown(app, { key: ' ', code: 'Space' });
      fireEvent.keyDown(app, { key: ' ', code: 'Space' });
      expect(controller.editor.currentToolId.peek()).toBe('hand');
      fireEvent.keyUp(app, { key: ' ', code: 'Space' });
      expect(controller.editor.currentToolId.peek()).toBe('box');

      fireEvent.keyDown(app, { key: ' ', code: 'Space' });
      controller.isCanvasDraggingRef.current = true;
      fireEvent.keyUp(app, { key: ' ', code: 'Space' });
      expect(controller.deferredToolRestoreRef.current).toBe('box');

      controller.isCanvasDraggingRef.current = false;
      controller.editor.setCurrentTool('ellipse');
      fireEvent.keyDown(app, { key: ' ', code: 'Space' });
      fireEvent(window, new Event('blur'));
      expect(controller.editor.currentToolId.peek()).toBe('ellipse');
    } finally {
      void controller.dispose();
    }
  });
});
