import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ArrowUtil, type AnyRecord } from '@durgakiran/glideline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlideboardProvider } from './GlideboardContext';
import { GlideboardController } from './GlideboardController';
import { Canvas, getCanvasToolCursor } from './Canvas';

const overlayMocks = vi.hoisted(() => ({
  getHandleAtPagePoint: vi.fn(() => null as string | null),
  getCursorForHandle: vi.fn(() => 'default'),
}));

vi.mock('./CanvasOverlays', () => ({
  CanvasOverlays: () => null,
  getHandleAtPagePoint: overlayMocks.getHandleAtPagePoint,
  getCursorForHandle: overlayMocks.getCursorForHandle,
}));

class ResizeObserverStub {
  static callback: ResizeObserverCallback | null = null;
  constructor(callback: ResizeObserverCallback) { ResizeObserverStub.callback = callback; }
  observe() {}
  disconnect() {}
}

function setupCanvas(controller: GlideboardController) {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  let wheelHandler: EventListener | null = null;
  const nativeAddEventListener = HTMLElement.prototype.addEventListener;
  const addEventListener = vi.spyOn(HTMLElement.prototype, 'addEventListener').mockImplementation(function (
    this: HTMLElement,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (
      type === 'wheel'
      && typeof listener === 'function'
      && typeof options === 'object'
      && options.passive === false
    ) wheelHandler = listener;
    nativeAddEventListener.call(this, type, listener, options);
  });
  const view = render(
    <GlideboardProvider controller={controller}>
      <Canvas />
    </GlideboardProvider>,
  );
  addEventListener.mockRestore();
  const canvas = view.container.querySelector('[data-glideboard-role="canvas"]') as HTMLElement;
  canvas.getBoundingClientRect = () => ({
    x: 10, y: 20, left: 10, top: 20, right: 810, bottom: 620,
    width: 800, height: 600, toJSON: () => ({}),
  });
  canvas.setPointerCapture = vi.fn();
  canvas.releasePointerCapture = vi.fn();
  canvas.hasPointerCapture = vi.fn(() => true);
  return { ...view, canvas, wheelHandler: wheelHandler! };
}

function box(id: string, x: number) {
  return {
    id,
    type: 'box',
    x,
    y: 20,
    rotation: 0,
    index: id,
    props: { w: 120, h: 80, label: id },
    meta: {},
  };
}

afterEach(() => {
  cleanup();
  overlayMocks.getHandleAtPagePoint.mockReset().mockReturnValue(null);
  overlayMocks.getCursorForHandle.mockReset().mockReturnValue('default');
  ResizeObserverStub.callback = null;
  vi.unstubAllGlobals();
});

describe('Canvas asset cursor policy', () => {
  it('covers asset placement, panning, captured panning, handles, and idle selection', () => {
    expect(getCanvasToolCursor('asset', null)).toBe('crosshair');
    expect(getCanvasToolCursor('hand', null)).toBe('grab');
    expect(getCanvasToolCursor('hand', null, 1)).toBe('grabbing');
    expect(getCanvasToolCursor('select', null)).toBe('default');
    expect(getCanvasToolCursor('select', 'top-left')).toBe('default');
    expect(getCanvasToolCursor(undefined, null)).toBe('default');
  });
});

describe('Canvas text editing overlay', () => {
  it('applies shape opacity to standalone text and labels', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const controller = new GlideboardController({ sessionKey: 'text-label-opacity' });
    try {
      const boxId = controller.editor.createShape({
        type: 'box', x: 20, y: 30, props: { label: 'Label', opacity: 0.4 },
      });
      const textId = controller.editor.createShape({
        type: 'text', x: 200, y: 30, props: { text: 'Text', opacity: 0.6 },
      });
      const view = render(
        <GlideboardProvider controller={controller}>
          <Canvas />
        </GlideboardProvider>,
      );

      const boxLabel = view.container.querySelector<HTMLElement>(
        `[data-shape-id="${boxId}"] [data-glideboard-role="shape-label"]`,
      );
      const textView = view.container.querySelector<HTMLElement>(
        `[data-shape-id="${textId}"] .glideboard-rich-text-view`,
      );
      expect(boxLabel?.style.opacity).toBe('0.4');
      expect(textView?.style.opacity).toBe('0.6');
    } finally {
      void controller.dispose();
    }
  });

  it('does not render an empty arrow label until editing is activated', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const controller = new GlideboardController({ sessionKey: 'empty-arrow-label' });
    try {
      const id = controller.editor.createShape({
        type: 'arrow',
        x: 20,
        y: 30,
        props: {
          ...new ArrowUtil().getDefaultProps(),
          end: {
            boundShapeId: null,
            normalizedAnchor: { x: 0.5, y: 0.5 },
            point: { x: 200, y: 0 },
          },
        },
      });
      const view = render(
        <GlideboardProvider controller={controller}>
          <Canvas />
        </GlideboardProvider>,
      );

      expect(view.container.querySelector('[data-glideboard-role="shape-label"]')).toBeNull();
      act(() => controller.editor.startEditing(id, { labelPosition: 0.75 }));
      expect(view.getByRole('textbox')).toBeDefined();
    } finally {
      void controller.dispose();
    }
  });

  it('mounts one editor and commits its narrow draft through the session controller', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const controller = new GlideboardController({ sessionKey: 'text-overlay' });
    try {
      const first = controller.editor.createShape(box('shape:first', 10) as any);
      controller.editor.createShape(box('shape:second', 200) as any);
      const view = render(
        <GlideboardProvider controller={controller}>
          <Canvas />
        </GlideboardProvider>,
      );

      act(() => controller.editor.startEditing(first));
      const editable = view.getByRole('textbox');
      expect(view.container.querySelectorAll('[contenteditable]')).toHaveLength(1);
      expect(
        view.container
          .querySelector('[data-glideboard-role="text-editing-overlay"]')
          ?.getAttribute('data-shape-id'),
      ).toBe(first);

      editable.textContent = 'Safe draft';
      fireEvent.input(editable);
      act(() => controller.editor.updateShape(first, { props: { color: '#ff0000' } }));
      fireEvent.blur(editable);

      expect(controller.editor.getShape(first)?.props).toMatchObject({
        label: 'Safe draft',
        color: '#ff0000',
      });
      expect(view.queryByRole('textbox')).toBeNull();

      act(() => controller.editor.startEditing(first));
      const reopened = view.getByRole('textbox');
      expect(reopened.textContent).toBe('Safe draft');
      expect(document.activeElement).toBe(reopened);
    } finally {
      void controller.dispose();
    }
  });
});

describe('Canvas viewport rendering', () => {
  it('keeps native focused-search typing out of the Canvas editor boundary', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const controller = new GlideboardController({ sessionKey: 'focused-search-canvas-boundary' });
    const dispatchEvent = vi.spyOn(controller.editor, 'dispatchEvent');
    try {
      const view = render(
        <GlideboardProvider controller={controller}>
          <Canvas />
        </GlideboardProvider>,
      );
      const canvas = view.container.querySelector('[data-glideboard-role="canvas"]') as HTMLElement;
      const search = document.createElement('input');
      search.type = 'search';
      search.setAttribute('data-glideboard-ignore-shortcuts', '');
      canvas.append(search);
      search.focus();

      search.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'r', code: 'KeyR', bubbles: true, cancelable: true, composed: true,
      }));
      search.value = 'raster';
      search.dispatchEvent(new InputEvent('input', {
        data: 'raster', inputType: 'insertText', bubbles: true, composed: true,
      }));
      canvas.dispatchEvent(new KeyboardEvent('keydown', {
        key: 't', code: 'KeyT', bubbles: true, cancelable: true, composed: true,
      }));

      expect(document.activeElement).toBe(search);
      expect(search.value).toBe('raster');
      expect(dispatchEvent).not.toHaveBeenCalled();
      expect(controller.editor.currentToolId.peek()).toBe('select');
      expect(controller.editor.serialize().records.filter(record => record.kind === 'shape')).toHaveLength(0);
    } finally {
      void controller.dispose();
    }
  });

  it('shows the armed asset-placement cursor on the actual canvas', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const controller = new GlideboardController({ sessionKey: 'asset-cursor' });
    try {
      const view = render(
        <GlideboardProvider controller={controller}>
          <Canvas />
        </GlideboardProvider>,
      );
      const canvas = view.container.querySelector('[data-glideboard-role="canvas"]') as HTMLElement;

      act(() => controller.editor.setCurrentTool('asset'));
      expect(canvas.style.cursor).toBe('crosshair');
      expect(canvas.getAttribute('data-asset-placement-armed')).toBe('true');

      fireEvent.pointerMove(canvas, { clientX: 80, clientY: 60, buttons: 0 });
      expect(canvas.style.cursor).toBe('crosshair');

      act(() => controller.editor.setCurrentTool('select'));
      expect(canvas.style.cursor).toBe('default');
      expect(canvas.hasAttribute('data-asset-placement-armed')).toBe(false);
    } finally {
      void controller.dispose();
    }
  });

  it('mounts viewport hits plus pinned offscreen selections only', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const controller = new GlideboardController({ sessionKey: 'viewport-selection' });
    try {
      const visible = controller.editor.createShape(box('shape:visible', 20) as any);
      const offscreen = controller.editor.createShape(box('shape:offscreen', 5_000) as any);
      let ephemeral: string | undefined;
      controller.editor.batch('Offscreen preview', () => {
        ephemeral = controller.editor.createShape(box('shape:ephemeral', 6_000) as any);
      }, { history: 'ignore', scope: 'ephemeral' });
      const view = render(
        <GlideboardProvider controller={controller}>
          <Canvas />
        </GlideboardProvider>,
      );

      expect(view.container.querySelector(`[data-shape-id="${visible}"]`)).not.toBeNull();
      expect(view.container.querySelector(`[data-shape-id="${offscreen}"]`)).toBeNull();
      expect(view.container.querySelector(`[data-shape-id="${ephemeral}"]`)).not.toBeNull();

      act(() => controller.editor.setSelectedShapeIds([offscreen]));
      await waitFor(() => {
        expect(view.container.querySelector(`[data-shape-id="${offscreen}"]`)).not.toBeNull();
      });

      act(() => controller.editor.setSelectedShapeIds([]));
      await waitFor(() => {
        expect(view.container.querySelector(`[data-shape-id="${offscreen}"]`)).toBeNull();
      });

      expect(controller.editor.getShape(offscreen)).toBeDefined();
    } finally {
      void controller.dispose();
    }
  });

  it('renders transformed outlines and crossing connectors whose origins are offscreen', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const controller = new GlideboardController({ sessionKey: 'viewport-transforms' });
    try {
      const rotated = controller.editor.createShape({
        id: 'shape:rotated-offscreen' as any,
        type: 'box',
        x: -700,
        y: -400,
        rotation: Math.PI / 4,
        index: 'a0',
        props: { w: 400, h: 1_000, label: '' },
        meta: {},
      });
      const crossing = controller.editor.createShape({
        id: 'shape:crossing-arrow' as any,
        type: 'arrow',
        x: -500,
        y: 80,
        rotation: 0,
        index: 'a1',
        props: {
          ...new ArrowUtil().getDefaultProps(),
          start: {
            boundShapeId: null,
            normalizedAnchor: { x: 0.5, y: 0.5 },
            point: { x: 0, y: 0 },
          },
          end: {
            boundShapeId: null,
            normalizedAnchor: { x: 0.5, y: 0.5 },
            point: { x: 1_500, y: 0 },
          },
        },
        meta: {},
      });
      const view = render(
        <GlideboardProvider controller={controller}>
          <Canvas />
        </GlideboardProvider>,
      );

      expect(view.container.querySelector(`[data-shape-id="${rotated}"]`)).not.toBeNull();
      expect(view.container.querySelector(`[data-shape-id="${crossing}"]`)).not.toBeNull();
    } finally {
      void controller.dispose();
    }
  });

  it('applies camera movement once at the shared world layer', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const controller = new GlideboardController({ sessionKey: 'world-transform' });
    try {
      const id = controller.editor.createShape(box('shape:world', 40) as any);
      const view = render(
        <GlideboardProvider controller={controller}>
          <Canvas />
        </GlideboardProvider>,
      );

      act(() => controller.editor.camera.setCamera({ x: 100, y: 50, z: 2 }));
      const worldLayer = view.container.querySelector(
        '[data-glideboard-role="world-layer"]',
      ) as HTMLElement;
      const shape = view.container.querySelector(`[data-shape-id="${id}"]`) as HTMLElement;

      expect(worldLayer.style.transform).toBe('matrix(2, 0, 0, 2, -200, -100)');
      expect(shape.style.transform).toBe('matrix(1, 0, 0, 1, 40, 20)');
    } finally {
      void controller.dispose();
    }
  });

  it('renders real shape geometry, labels, clipping, and bounded missing assets', async () => {
    const controller = new GlideboardController({
      sessionKey: 'canvas-shape-rendering',
      assetStorage: {
        prepare: vi.fn() as any,
        resolve: () => null,
      },
    });
    try {
      const frame = controller.editor.createShape({
        type: 'frame', x: 20, y: 20, props: { w: 240, h: 180, name: 'Clip frame', clipContent: true },
      });
      const child = controller.editor.createShape({
        type: 'box', parentId: frame, x: 30, y: 40,
        props: { w: 120, h: 80, label: 'Visible label' },
      } as any);
      const assetId = 'asset:canvas-missing';
      const report = controller.editor.importRecords([{
        id: assetId, kind: 'asset', type: 'raster-image', schemaVersion: 1,
        props: { hash: 'a'.repeat(64), mimeType: 'image/png', byteLength: 8, width: 40, height: 20 },
        meta: {},
      } as AnyRecord]);
      const raster = controller.editor.createShape({
        type: 'raster-image', x: 300, y: 40,
        props: { w: 160, h: 90, assetId: report.idMap[assetId] ?? assetId, altText: 'Lost preview' },
      });
      const view = setupCanvas(controller);

      await waitFor(() => {
        const missing = view.container.querySelector(`[data-shape-id="${raster}"] [data-missing-asset="true"]`);
        expect(missing?.getAttribute('aria-label')).toBe('Missing asset: Lost preview');
        expect(missing?.querySelector('svg')?.getAttribute('width')).toBe('160');
      });
      expect(view.container.querySelector(`[data-shape-id="${child}"]`)?.textContent).toContain('Visible label');
      expect((view.container.querySelector(`[data-shape-id="${child}"]`) as HTMLElement).style.clipPath).toContain('polygon');
    } finally {
      await controller.dispose();
    }
  });

  it('renders polygon and open-path eraser previews and removes them when cleared', async () => {
    const controller = new GlideboardController({ sessionKey: 'eraser-previews' });
    try {
      const boxId = controller.editor.createShape(box('shape:erase-box', 20) as any);
      const arrowId = controller.editor.createShape({
        type: 'arrow', x: 20, y: 160,
        props: { ...new ArrowUtil().getDefaultProps(), end: { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: 140, y: 0 } } },
      });
      const view = setupCanvas(controller);
      act(() => { controller.editor.erasingShapeIds.value = new Set([boxId, arrowId]); });
      const preview = await waitFor(() => view.container.querySelector('[data-glideboard-role="eraser-preview-overlay"]')!);
      expect(preview.querySelectorAll('polygon')).toHaveLength(1);
      expect(preview.querySelectorAll('polyline')).toHaveLength(1);
      act(() => { controller.editor.erasingShapeIds.value = new Set(); });
      expect(view.container.querySelector('[data-glideboard-role="eraser-preview-overlay"]')).toBeNull();
    } finally {
      await controller.dispose();
    }
  });

  it('routes wheel navigation, resize observation, handles, shapes, and empty canvas pointers', async () => {
    const controller = new GlideboardController({ sessionKey: 'canvas-pointer-routing' });
    try {
      const shapeId = controller.editor.createShape(box('shape:pointer-hit', 20) as any);
      const shape = controller.editor.getShape(shapeId)!;
      const dispatch = vi.spyOn(controller.editor, 'dispatchEvent');
      const hit = vi.spyOn(controller.editor, 'getTopShapeAtPoint').mockReturnValue(shape);
      const pagePoint = vi.spyOn(controller.editor, 'screenToPage').mockImplementation(point => point);
      const view = setupCanvas(controller);
      act(() => ResizeObserverStub.callback?.([{
        contentRect: { width: 640, height: 480 },
      } as ResizeObserverEntry], {} as ResizeObserver));
      expect(controller.editor.camera.getViewportBounds()).toMatchObject({ w: 640, h: 480 });

      const camera = controller.editor.camera;
      camera.setCamera({ x: 0, y: 0, z: 1 });
      view.wheelHandler.call(view.canvas, {
        clientX: 110, clientY: 120, deltaX: 0, deltaY: -10,
        ctrlKey: true, metaKey: false, shiftKey: false, preventDefault: vi.fn(),
      } as unknown as WheelEvent);
      expect(camera.getCamera().z).toBeGreaterThan(1);
      camera.setCamera({ x: 0, y: 0, z: 1 });
      view.wheelHandler.call(view.canvas, {
        clientX: 0, clientY: 0, deltaX: 4, deltaY: 6,
        ctrlKey: false, metaKey: false, shiftKey: true, preventDefault: vi.fn(),
      } as unknown as WheelEvent);
      expect(camera.getCamera()).toMatchObject({ x: 10, y: 0 });
      camera.setCamera({ x: 0, y: 0, z: 1 });
      view.wheelHandler.call(view.canvas, {
        clientX: 0, clientY: 0, deltaX: 4, deltaY: 6,
        ctrlKey: false, metaKey: false, shiftKey: false, preventDefault: vi.fn(),
      } as unknown as WheelEvent);
      expect(camera.getCamera()).toMatchObject({ x: 4, y: 6 });

      overlayMocks.getHandleAtPagePoint.mockReturnValue('e');
      fireEvent.pointerDown(view.canvas, { button: 0, pointerId: 7, clientX: 100, clientY: 100 });
      expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'pointerDown', target: 'handle', handleId: 'e' }));
      overlayMocks.getHandleAtPagePoint.mockReturnValue(null);
      fireEvent.pointerDown(view.canvas, { button: 0, pointerId: 8, clientX: 100, clientY: 100, shiftKey: true });
      expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'pointerDown', target: 'shape', shapeId, shiftKey: true }));
      hit.mockReturnValue(undefined);
      fireEvent.pointerDown(view.canvas, { button: 0, pointerId: 9, clientX: 100, clientY: 100 });
      expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'pointerDown', target: 'canvas' }));
      expect(pagePoint).toHaveBeenCalled();
    } finally {
      await controller.dispose();
    }
  });

  it('restores temporary hand tools, deferred tools, pointer capture, and awareness cursors', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const controller = new GlideboardController({ sessionKey: 'canvas-pointer-lifecycle' });
    const awareness = { setLocalStateField: vi.fn() };
    controller.awarenessSignal.value = awareness;
    try {
      const dispatch = vi.spyOn(controller.editor, 'dispatchEvent');
      const view = setupCanvas(controller);
      controller.editor.setCurrentTool('box');
      fireEvent.pointerDown(view.canvas, { button: 1, pointerId: 11, clientX: 40, clientY: 50 });
      expect(controller.editor.currentToolId.peek()).toBe('hand');
      fireEvent.pointerMove(view.canvas, { pointerId: 11, clientX: 60, clientY: 70, buttons: 1, altKey: true });
      expect(awareness.setLocalStateField).toHaveBeenCalledWith('canvasCursor', { x: 50, y: 50 });
      controller.deferredToolRestoreRef.current = 'ellipse';
      fireEvent.pointerUp(view.canvas, { button: 1, pointerId: 11, clientX: 60, clientY: 70 });
      expect(view.canvas.releasePointerCapture).toHaveBeenCalledWith(11);
      expect(controller.editor.currentToolId.peek()).toBe('ellipse');

      fireEvent.pointerDown(view.canvas, { button: 0, pointerId: 12, clientX: 80, clientY: 90 });
      fireEvent.pointerCancel(view.canvas, { pointerId: 12 });
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'keyDown', key: 'Escape' }));
      fireEvent.pointerMove(view.canvas, { clientX: 90, clientY: 100 });
      fireEvent.pointerLeave(view.canvas);
      expect(awareness.setLocalStateField).toHaveBeenLastCalledWith('canvasCursor', null);
    } finally {
      await controller.dispose();
    }
  });

  it('dispatches double-click and keyboard behavior while respecting read-only mode', async () => {
    const controller = new GlideboardController({ sessionKey: 'canvas-keyboard-double-click' });
    try {
      const id = controller.editor.createShape(box('shape:double', 20) as any);
      vi.spyOn(controller.editor, 'getTopShapeAtPoint').mockReturnValue(controller.editor.getShape(id));
      const dispatch = vi.spyOn(controller.editor, 'dispatchEvent');
      const view = setupCanvas(controller);
      fireEvent.doubleClick(view.canvas, { clientX: 50, clientY: 60 });
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'doubleClick', shapeId: id }));
      act(() => controller.editor.stopEditing());
      fireEvent.keyDown(view.canvas, { key: 'ArrowLeft' });
      expect(dispatch).toHaveBeenCalledWith({ type: 'keyDown', key: 'ArrowLeft' });
      act(() => controller.setReadOnly(true));
      dispatch.mockClear();
      fireEvent.doubleClick(view.canvas, { clientX: 50, clientY: 60 });
      fireEvent.keyDown(view.canvas, { key: 'ArrowLeft' });
      fireEvent.pointerDown(view.canvas, { button: 1, pointerId: 15 });
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      await controller.dispose();
    }
  });

  it('handles empty text, composition, keyboard commit, and conflict cancellation', async () => {
    const controller = new GlideboardController({ sessionKey: 'canvas-text-input-events' });
    try {
      const id = controller.editor.createShape({ type: 'text', x: 30, y: 30, props: { text: '' } } as any);
      const view = setupCanvas(controller);
      act(() => controller.editor.startEditing(id));
      const editable = await view.findByRole('textbox');
      act(() => controller.editor.updateEditingDraft('AB', {
        richText: {
          format: 'beskar-canvas-rich-text', version: 1, profile: 'text',
          doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'AB' }] }] },
        },
        w: 20,
        h: 22,
        sizeMode: 'auto',
      }));
      fireEvent.keyDown(editable, { key: 'Enter', ctrlKey: true });
      await waitFor(() => expect(view.queryByRole('textbox')).toBeNull());
      expect((controller.editor.getShape(id)?.props as any).text).toBe('AB');

      act(() => controller.editor.startEditing(id));
      fireEvent.keyDown(await view.findByRole('textbox'), { key: 'Escape' });
      await waitFor(() => expect(view.queryByRole('textbox')).toBeNull());
    } finally {
      await controller.dispose();
    }
  });

  it('covers hidden shapes, a disabled grid, empty eraser outlines, and empty editing input', async () => {
    const controller = new GlideboardController({ sessionKey: 'canvas-alternate-rendering' });
    try {
      const hidden = controller.editor.createShape({
        ...box('shape:hidden', 20), isHidden: true,
      } as any);
      const emptyOutline = controller.editor.createShape(box('shape:empty-outline', 180) as any);
      controller.editor.snapping.updateSettings({ showGrid: false });
      vi.spyOn(controller.editor.transforms, 'getWorldOutline').mockImplementation(id => (
        id === emptyOutline ? [] : [{ x: 0, y: 0 }, { x: 10, y: 10 }]
      ));
      const view = setupCanvas(controller);
      expect(view.container.querySelector(`[data-shape-id="${hidden}"]`)).toBeNull();
      expect(view.container.querySelector('rect[fill^="url("]')).toBeNull();

      act(() => {
        controller.editor.erasingShapeIds.value = new Set([emptyOutline, 'shape:not-found' as any]);
      });
      expect(view.container.querySelector('[data-glideboard-role="eraser-preview-overlay"]')).not.toBeNull();
      expect(view.container.querySelector('[data-glideboard-role="eraser-preview-overlay"] polygon')).toBeNull();

      const textId = controller.editor.createShape({ type: 'text', x: 20, y: 200, props: { text: 'Draft' } } as any);
      act(() => controller.editor.startEditing(textId));
      const editable = await view.findByRole('textbox');
      const editingBox = view.container.querySelector('[data-glideboard-role="rich-text-editing-overlay"]')!;
      fireEvent.pointerDown(editingBox);
      fireEvent.pointerDown(editable);
      const otherBoard = document.createElement('div');
      otherBoard.dataset.glideboardRole = 'app';
      document.body.append(otherBoard);
      fireEvent.pointerDown(otherBoard);
      expect(view.getByRole('textbox')).toBeDefined();
      otherBoard.remove();
      const stylePanel = document.createElement('div');
      stylePanel.dataset.glideboardRole = 'selected-style-panel';
      document.body.append(stylePanel);
      fireEvent.pointerDown(stylePanel);
      expect(view.getByRole('textbox')).toBeDefined();
      stylePanel.remove();
      fireEvent.keyDown(editable, { key: 'Escape' });
      await waitFor(() => expect(view.queryByRole('textbox')).toBeNull());
    } finally {
      await controller.dispose();
    }
  });

  it('cancels pending awareness and pointer interactions through loss, blur, and unmount', async () => {
    let pendingFrame: FrameRequestCallback | null = null;
    const cancelFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pendingFrame = callback; return 42; });
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    const controller = new GlideboardController({ sessionKey: 'canvas-cancellation-paths' });
    const awareness = { setLocalStateField: vi.fn() };
    controller.awarenessSignal.value = awareness;
    try {
      const dispatch = vi.spyOn(controller.editor, 'dispatchEvent');
      const view = setupCanvas(controller);
      expect(fireEvent.pointerDown(view.canvas, { button: 2, pointerId: 1 })).toBe(true);
      fireEvent.pointerMove(view.canvas, { clientX: 30, clientY: 40 });
      expect(pendingFrame).not.toBeNull();

      fireEvent.pointerDown(view.canvas, { button: 0, pointerId: 2, clientX: 30, clientY: 40 });
      fireEvent.lostPointerCapture(view.canvas, { pointerId: 2 });
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'keyDown', key: 'Escape' }));

      fireEvent.pointerDown(view.canvas, { button: 0, pointerId: 3, clientX: 30, clientY: 40 });
      fireEvent(window, new Event('blur'));
      expect(controller.activePointerIdRef.current).toBeNull();

      act(() => controller.setReadOnly(true));
      overlayMocks.getHandleAtPagePoint.mockReturnValue('n');
      fireEvent.pointerMove(view.canvas, { clientX: 40, clientY: 50 });
      expect(overlayMocks.getHandleAtPagePoint).not.toHaveBeenLastCalledWith(controller.editor, 30, 30);

      view.unmount();
      expect(cancelFrame).toHaveBeenCalledWith(42);
      expect(controller.getCanvasElement()).toBeNull();
    } finally {
      await controller.dispose();
    }
  });

  it('prevents middle-button browser behavior and focus theft after editing begins', async () => {
    const controller = new GlideboardController({ sessionKey: 'canvas-focus-prevention' });
    try {
      const textId = controller.editor.createShape({ type: 'text', x: 20, y: 20, props: { text: 'Edit me' } } as any);
      vi.spyOn(controller.editor, 'getTopShapeAtPoint').mockReturnValue(controller.editor.getShape(textId));
      const originalDispatch = controller.editor.dispatchEvent.bind(controller.editor);
      vi.spyOn(controller.editor, 'dispatchEvent').mockImplementation(event => {
        if (event.type === 'pointerDown') controller.editor.startEditing(textId);
        return originalDispatch(event);
      });
      const view = setupCanvas(controller);
      fireEvent.pointerDown(view.canvas, { button: 0, pointerId: 8, clientX: 30, clientY: 30 });
      expect(fireEvent.mouseDown(view.canvas, { button: 0 })).toBe(false);
      expect(fireEvent.mouseDown(view.canvas, { button: 1 })).toBe(false);
      expect(fireEvent.mouseDown(view.canvas, { button: 0 })).toBe(true);
    } finally {
      await controller.dispose();
    }
  });

  it('covers SVG injection variants, conflicting drafts, and passive pointer alternatives', async () => {
    const controller = new GlideboardController({ sessionKey: 'canvas-alternate-branches' });
    try {
      const id = controller.editor.createShape({
        type: 'box', x: 20, y: 20,
        props: { w: 120, h: 80, label: 'Right aligned', textAlign: 'right' },
      } as any);
      const util = controller.editor.getShapeUtil('box') as any;
      const originalToSvg = util.toSvg.bind(util);
      const toSvg = vi.spyOn(util, 'toSvg').mockReturnValueOnce(null).mockImplementation((shape: any) => {
        const element = originalToSvg(shape);
        element.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'defs'));
        return element;
      });
      const view = setupCanvas(controller);
      act(() => controller.editor.updateShape(id, { props: { color: '#123456' } }));
      await waitFor(() => expect(view.container.querySelector(`[data-shape-id="${id}"] defs`)).not.toBeNull());
      expect(toSvg).toHaveBeenCalled();

      act(() => controller.editor.startEditing(id));
      const session = controller.editor.textEditing.session.peek()!;
      act(() => { controller.editor.textEditing.session.value = { ...session, status: 'conflicted' }; });
      const editable = view.getByRole('textbox');
      expect(editable.getAttribute('aria-invalid')).toBe('true');
      fireEvent.keyDown(editable, { key: 'a' });
      const commit = vi.spyOn(controller.editor, 'commitEditing').mockReturnValue(false);
      fireEvent.blur(editable);
      expect(commit).toHaveBeenCalled();

      controller.awarenessSignal.value = null;
      (view.canvas.hasPointerCapture as ReturnType<typeof vi.fn>).mockReturnValue(false);
      fireEvent.pointerDown(view.canvas, { button: 0, pointerId: 21, clientX: 50, clientY: 50 });
      fireEvent.pointerUp(view.canvas, { button: 0, pointerId: 21, clientX: 50, clientY: 50 });
      fireEvent.pointerLeave(view.canvas);
      fireEvent.lostPointerCapture(view.canvas, { pointerId: 21 });
      expect(view.canvas.releasePointerCapture).not.toHaveBeenCalledWith(21);
    } finally {
      await controller.dispose();
    }
  });
});
