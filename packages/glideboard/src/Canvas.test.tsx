import React from 'react';
import { act, cleanup, createEvent, fireEvent, render, waitFor } from '@testing-library/react';
import { ArrowUtil, ERASER_RADIUS_PX, type AnyRecord } from '@durgakiran/glideline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlideboardProvider } from './GlideboardContext';
import { GlideboardController } from './GlideboardController';
import { Canvas, getCanvasToolCursor } from './Canvas';
import { LayersPanel } from './LayersPanel';
import type { GlideboardStrokeDiagnostic, GlideboardStrokeDiagnosticsHandler } from './types';

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

function setupCanvas(controller: GlideboardController, onStrokeDiagnostics?: GlideboardStrokeDiagnosticsHandler) {
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
      <Canvas onStrokeDiagnostics={onStrokeDiagnostics} />
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

describe('stroke diagnostics', () => {
  const pen = { pointerId: 11, pointerType: 'pen', button: 0, pressure: 0.5, clientX: 100, clientY: 100 };
  const touch = { pointerId: 12, pointerType: 'touch', button: 0, clientX: 200, clientY: 200 };
  const mouse = { ...touch, pointerId: 1, pointerType: 'mouse' };

  it('separates coalesced input, filtered movement and the final committed point', async () => {
    const controller = new GlideboardController({ sessionKey: 'stroke-diagnostics-samples' });
    try {
      const handler = vi.fn<GlideboardStrokeDiagnosticsHandler>();
      const { canvas } = setupCanvas(controller, handler);
      act(() => controller.setCurrentTool('draw'));

      const down = createEvent.pointerDown(canvas, pen);
      Object.defineProperty(down, 'timeStamp', { value: 100 });
      fireEvent(canvas, down);

      const move = createEvent.pointerMove(canvas, { ...pen, clientX: 110, pressure: 0, buttons: 1 });
      Object.defineProperties(move, {
        timeStamp: { value: 114 },
        getCoalescedEvents: { value: () => [
          { clientX: 100.5, clientY: 100, pressure: 0.5, timeStamp: 104 },
          { clientX: 110, clientY: 100, pressure: 0, timeStamp: 114 },
        ] },
      });
      fireEvent(canvas, move);

      const up = createEvent.pointerUp(canvas, { ...pen, clientX: 112 });
      Object.defineProperty(up, 'timeStamp', { value: 115 });
      fireEvent(canvas, up);

      await waitFor(() => expect(handler).toHaveBeenCalledTimes(1), { timeout: 1500 });
      expect(handler).toHaveBeenCalledWith([expect.objectContaining({
        type: 'stroke-ended', reason: 'pointerup', pointerType: 'pen', outcome: 'committed',
        moveEventCount: 1, coalescedEventsAvailable: true, coalescedSampleCount: 2,
        distinctMoveSampleCount: 2, zeroPressureMoveEventCount: 1,
        maxInputSampleGapMs: 10, maxInputSampleDistancePx: 9.5,
        acceptedPointCount: 2, committedPointCount: 3,
        zoomAtStart: 1, strokeStyle: 'solid', strokeWidth: 'medium', pressureSensitive: false,
        frameTiming: expect.objectContaining({
          animationFrameCount: 0, synchronousFlushCount: 1,
          maxAnimationFrameGapMs: null, maxInputToSvgReadyMs: null,
        }),
      })]);
    } finally {
      await controller.dispose();
    }
  });

  it('distinguishes browser interruptions, records the outcome, and deduplicates capture cleanup', async () => {
    const controller = new GlideboardController({ sessionKey: 'stroke-diagnostics-browser' });
    try {
      const diagnostics: GlideboardStrokeDiagnostic[] = [];
      const handler = vi.fn((batch: readonly GlideboardStrokeDiagnostic[]) => { diagnostics.push(...batch); });
      const { canvas } = setupCanvas(controller, handler);
      act(() => controller.setCurrentTool('draw'));

      fireEvent.pointerDown(canvas, pen);
      fireEvent.pointerDown(canvas, touch);
      fireEvent.pointerCancel(canvas, touch);
      fireEvent.lostPointerCapture(canvas, touch);
      fireEvent.pointerUp(canvas, pen);
      fireEvent.lostPointerCapture(canvas, pen);

      fireEvent.pointerDown(canvas, pen);
      fireEvent.pointerCancel(canvas, pen);
      fireEvent.lostPointerCapture(canvas, pen);

      fireEvent.pointerDown(canvas, pen);
      fireEvent.pointerMove(canvas, { ...pen, clientX: 120, buttons: 1 });
      fireEvent.lostPointerCapture(canvas, pen);
      fireEvent.pointerUp(canvas, pen);

      fireEvent.pointerDown(canvas, touch);
      fireEvent.pointerDown(canvas, pen);
      fireEvent.pointerCancel(canvas, touch);
      fireEvent.pointerUp(canvas, pen);

      fireEvent.pointerDown(canvas, mouse);
      fireEvent.pointerDown(canvas, pen);
      fireEvent.pointerCancel(canvas, mouse);
      fireEvent.pointerUp(canvas, pen);

      expect(handler).not.toHaveBeenCalled();
      await waitFor(() => expect(diagnostics).toHaveLength(7), { timeout: 1500 });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(diagnostics).toMatchObject([
        { type: 'stroke-ended', reason: 'pointerup', pointerType: 'pen', outcome: 'committed', acceptedPointCount: 1 },
        { type: 'stroke-ended', reason: 'pointercancel', pointerType: 'pen', outcome: 'discarded', acceptedPointCount: 1 },
        { type: 'stroke-ended', reason: 'lostpointercapture', pointerType: 'pen', outcome: 'committed', acceptedPointCount: 2 },
        { type: 'stroke-ended', reason: 'pen-takeover', pointerType: 'touch', outcome: 'discarded', acceptedPointCount: 1 },
        { type: 'stroke-ended', reason: 'pointerup', pointerType: 'pen', outcome: 'committed', acceptedPointCount: 1 },
        { type: 'pen-press-blocked', reason: 'another-pointer-active', activePointerType: 'mouse' },
        { type: 'stroke-ended', reason: 'pointercancel', pointerType: 'mouse', outcome: 'discarded', blockedPenPressCount: 1 },
      ]);
      expect(diagnostics.every(diagnostic => !('pointerId' in diagnostic) && !('strokeId' in diagnostic))).toBe(true);
    } finally {
      await controller.dispose();
    }
  });

  it('records Escape, blur, tool changes, read-only transitions and unmount', async () => {
    const controller = new GlideboardController({ sessionKey: 'stroke-diagnostics-cleanup' });
    try {
      const diagnostics: GlideboardStrokeDiagnostic[] = [];
      const view = setupCanvas(controller, batch => { diagnostics.push(...batch); });
      act(() => controller.setCurrentTool('draw'));

      fireEvent.pointerDown(view.canvas, pen);
      fireEvent.keyDown(view.canvas, { key: 'Escape' });
      fireEvent.pointerUp(view.canvas, pen);

      fireEvent.pointerDown(view.canvas, pen);
      fireEvent.blur(window);

      fireEvent.pointerDown(view.canvas, pen);
      await act(async () => controller.setCurrentTool('hand'));
      fireEvent.pointerUp(view.canvas, pen);
      act(() => controller.setCurrentTool('draw'));

      fireEvent.pointerDown(view.canvas, pen);
      await act(async () => controller.setReadOnly(true));
      act(() => {
        controller.setReadOnly(false);
        controller.setCurrentTool('draw');
      });
      fireEvent.blur(window);

      fireEvent.pointerDown(view.canvas, pen);
      view.unmount();

      await waitFor(() => expect(diagnostics).toHaveLength(5), { timeout: 1500 });
      expect(diagnostics).toMatchObject([
        { type: 'stroke-ended', reason: 'escape', outcome: 'discarded', acceptedPointCount: 1 },
        { type: 'stroke-ended', reason: 'window-blur', outcome: 'discarded', acceptedPointCount: 1 },
        { type: 'stroke-ended', reason: 'tool-change', outcome: 'discarded' },
        { type: 'stroke-ended', reason: 'read-only', outcome: 'discarded' },
        { type: 'stroke-ended', reason: 'unmount', outcome: 'discarded', acceptedPointCount: 1 },
      ]);
    } finally {
      await controller.dispose();
    }
  });
});

it('shows the pencil tip during drawing and updates live ink once per frame without dropping samples', async () => {
  const controller = new GlideboardController({ sessionKey: 'frame-batched-draw' });
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  try {
    const handler = vi.fn<GlideboardStrokeDiagnosticsHandler>();
    const { canvas, container } = setupCanvas(controller, handler);
    const util = controller.editor.getShapeUtil('freehand');
    const toSvg = util.toSvg.bind(util);
    vi.spyOn(util, 'toSvg').mockImplementation(shape => {
      now += 3;
      return toSvg(shape);
    });
    act(() => controller.setCurrentTool('draw'));
    const cursor = container.querySelector<HTMLElement>('[data-glideboard-role="pencil-cursor"]')!;
    expect(canvas.style.cursor).toBe('none');
    expect(cursor.style.visibility).toBe('hidden');

    const pen = { pointerId: 12, pointerType: 'pen', button: 0, clientX: 100, clientY: 100 };
    fireEvent.pointerOver(canvas, pen);
    expect(cursor.style.visibility).toBe('visible');
    fireEvent.pointerDown(canvas, pen);
    const id = controller.editor.getCurrentPageShapeIdsSignal().peek()[0]!;
    const dispatchEvent = controller.editor.dispatchEvent.bind(controller.editor);
    const dispatch = vi.spyOn(controller.editor, 'dispatchEvent').mockImplementation(event => {
      if (event.type === 'pointerMove') now += 4;
      return dispatchEvent(event);
    });
    const firstMove = createEvent.pointerMove(canvas, { ...pen, clientX: 104, pressure: 0.4, buttons: 1 });
    Object.defineProperty(firstMove, 'getCoalescedEvents', {
      value: () => [{ clientX: 102, clientY: 101, pressure: 0.3 }],
    });
    now = 10;
    fireEvent(canvas, firstMove);
    now = 12;
    fireEvent.pointerMove(canvas, { ...pen, clientX: 110, clientY: 105, pressure: 0.7, buttons: 1 });
    expect(cursor.style.transform).toBe('translate3d(98px, 63px, 0)');
    expect(dispatch).not.toHaveBeenCalled();

    const runFrame = (timestamp: number) => act(() => {
      const scheduled = [...frames.values()];
      frames.clear();
      for (const callback of scheduled) callback(timestamp);
    });
    now = 18;
    runFrame(16);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(controller.editor.getShape(id)?.props.points).toHaveLength(4);

    now = 36;
    fireEvent.pointerMove(canvas, { ...pen, clientX: 110, clientY: 105, pressure: 0.7, buttons: 1 });
    now = 42;
    runFrame(40);
    now = 50;
    fireEvent.pointerMove(canvas, { ...pen, clientX: 115, clientY: 107, pressure: 0.8, buttons: 1 });
    now = 52;
    fireEvent.pointerUp(canvas, { ...pen, clientX: 120, clientY: 109 });
    expect(controller.editor.getShape(id)?.props.points).toMatchObject([
      { x: 90, y: 80 }, { x: 92, y: 81, pressure: 0.3 }, { x: 94, y: 80, pressure: 0.4 },
      { x: 100, y: 85, pressure: 0.7 }, { x: 105, y: 87, pressure: 0.8 }, { x: 110, y: 89 },
    ]);
    fireEvent.pointerOut(canvas, pen);
    expect(cursor.style.visibility).toBe('hidden');
    act(() => controller.setCurrentTool('select'));
    expect(container.querySelector('[data-glideboard-role="pencil-cursor"]')).toBeNull();
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1), { timeout: 1500 });
    expect(handler).toHaveBeenCalledWith([expect.objectContaining({
      frameTiming: {
        animationFrameCount: 2, synchronousFlushCount: 1, maxAnimationFrameGapMs: 24,
        maxInputQueueMs: 8, maxDrawUpdateMs: 4, maxUpdateToSvgStartMs: 0,
        svgRenderCount: 1, maxSvgRenderMs: 3, slowestSvgPointCount: 4, maxInputToSvgReadyMs: 15,
      },
    })]);
  } finally {
    clock.mockRestore();
    await controller.dispose();
  }
});

it.each([false, true])('gives the pen an active touch drawing gesture with touch movement %s', async moved => {
  const controller = new GlideboardController({ sessionKey: 'draw-pen-takeover' });
  try {
    const { canvas } = setupCanvas(controller);
    act(() => controller.setCurrentTool('draw'));
    const touch = { pointerId: 21, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 };
    const pen = { pointerId: 22, pointerType: 'pen', button: 0, clientX: 200, clientY: 200 };
    const strokes = () => controller.editor.serialize().records.filter(record => record.type === 'freehand');
    vi.mocked(canvas.releasePointerCapture).mockImplementation(pointerId => {
      fireEvent.lostPointerCapture(canvas, { pointerId });
    });

    fireEvent.pointerDown(canvas, touch);
    if (moved) fireEvent.pointerMove(canvas, { ...touch, clientX: 130, buttons: 1 });
    fireEvent.pointerDown(canvas, pen);
    expect(controller.activePointerIdRef.current).toBe(pen.pointerId);
    expect(controller.penModeSignal.peek()).toBe(false);
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(touch.pointerId);
    expect(canvas.setPointerCapture).toHaveBeenLastCalledWith(pen.pointerId);
    expect(strokes()).toHaveLength(moved ? 1 : 0);

    fireEvent.pointerCancel(canvas, touch);
    fireEvent.lostPointerCapture(canvas, touch);
    fireEvent.pointerMove(canvas, { ...pen, clientX: 230, buttons: 1 });
    fireEvent.pointerUp(canvas, pen);
    expect(strokes()).toHaveLength(moved ? 2 : 1);

    fireEvent.pointerDown(canvas, touch);
    fireEvent.pointerUp(canvas, touch);
    expect(strokes()).toHaveLength(moved ? 3 : 2);
  } finally {
    await controller.dispose();
  }
});

it('keeps pen mode active between strokes on touch-capable devices and resumes finger input when exited', async () => {
  const controller = new GlideboardController({ sessionKey: 'pen-mode-touch-device' });
  const touchPoints = vi.spyOn(window.navigator, 'maxTouchPoints', 'get').mockReturnValue(5);
  try {
    const { canvas } = setupCanvas(controller);
    act(() => controller.setCurrentTool('draw'));
    const touch = { pointerId: 21, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 };
    const pen = { pointerId: 22, pointerType: 'pen', button: 0, clientX: 200, clientY: 200 };
    const strokes = () => controller.editor.serialize().records.filter(record => record.type === 'freehand');

    fireEvent.pointerDown(canvas, touch);
    fireEvent.pointerDown(canvas, pen);
    expect(controller.penModeSignal.peek()).toBe(true);
    fireEvent.pointerCancel(canvas, touch);
    fireEvent.lostPointerCapture(canvas, touch);
    fireEvent.pointerUp(canvas, pen);
    expect(strokes()).toHaveLength(1);

    fireEvent.pointerDown(canvas, touch);
    fireEvent.pointerMove(canvas, { ...touch, clientX: 130, buttons: 1 });
    fireEvent.pointerUp(canvas, touch);
    expect(strokes()).toHaveLength(1);
    expect(controller.activePointerIdRef.current).toBeNull();

    act(() => controller.setCurrentTool('select'));
    fireEvent.doubleClick(canvas, { clientX: 500, clientY: 200 });
    expect(controller.editor.editingShapeId.peek()).toBeNull();

    act(() => {
      controller.penModeSignal.value = false;
      controller.setCurrentTool('draw');
    });
    fireEvent.pointerDown(canvas, touch);
    fireEvent.pointerUp(canvas, touch);
    expect(strokes()).toHaveLength(2);
  } finally {
    touchPoints.mockRestore();
    await controller.dispose();
  }
});

it('shows the partial eraser footprint at the pointer in screen pixels', async () => {
  const controller = new GlideboardController({ sessionKey: 'partial-eraser-cursor' });
  try {
    const view = setupCanvas(controller);
    const cursor = () => view.container.querySelector<HTMLElement>('[data-glideboard-role="partial-eraser-cursor"]');
    fireEvent.pointerMove(view.canvas, { clientX: 90, clientY: 100, pointerType: 'mouse' });
    expect(cursor()).toBeNull();

    act(() => controller.setCurrentTool('partial-eraser'));
    expect(cursor()?.style.visibility).toBe('visible');
    expect(cursor()?.style.left).toBe('80px');
    expect(cursor()?.style.top).toBe('80px');
    expect(cursor()?.style.width).toBe(`${ERASER_RADIUS_PX * 2}px`);
    act(() => controller.editor.camera.setCamera({ z: 3 }));
    fireEvent.pointerMove(view.canvas, { clientX: 160, clientY: 50, pointerType: 'mouse' });
    expect(cursor()?.style.left).toBe('150px');
    expect(cursor()?.style.top).toBe('30px');
    expect(cursor()?.style.width).toBe(`${ERASER_RADIUS_PX * 2}px`);
    fireEvent.pointerLeave(view.canvas);
    expect(cursor()?.style.visibility).toBe('hidden');
    act(() => controller.setCurrentTool('eraser'));
    expect(cursor()).toBeNull();
  } finally {
    await controller.dispose();
  }
});

it('renders partial cuts immediately, restores on Escape, and saves on release or interrupted capture', async () => {
  const controller = new GlideboardController({ sessionKey: 'partial-eraser-live-ink' });
  const { editor } = controller;
  try {
    const id = editor.createShape({
      type: 'freehand', x: 40, y: 100,
      props: { points: [{ x: 40, y: 100, pressure: 0.5 }, { x: 180, y: 100, pressure: 0.5 }], isComplete: true },
    });
    const view = setupCanvas(controller);
    const strokePaths = () => view.container.querySelectorAll(`[data-shape-id="${id}"] > svg path`);
    const pointer = { pointerId: 1, pointerType: 'mouse', clientX: 120 };
    const sweep = () => {
      fireEvent.pointerDown(view.canvas, { ...pointer, button: 0, clientY: 80 });
      fireEvent.pointerMove(view.canvas, { ...pointer, buttons: 1, clientY: 160 });
    };
    act(() => controller.setCurrentTool('partial-eraser'));
    expect(strokePaths()).toHaveLength(1);
    sweep();
    expect(strokePaths()).toHaveLength(2);
    expect(editor.getShapes()).toHaveLength(1);

    fireEvent.keyDown(view.canvas, { key: 'Escape' });
    fireEvent.pointerUp(view.canvas, { ...pointer, button: 0, clientY: 160 });
    expect(strokePaths()).toHaveLength(1);
    sweep();
    expect(strokePaths()).toHaveLength(2);
    fireEvent.pointerUp(view.canvas, { ...pointer, button: 0, clientY: 160 });
    expect(editor.getShapes()).toHaveLength(2);
    act(() => editor.undo());
    expect(editor.getShapes()).toHaveLength(1);
    expect(strokePaths()).toHaveLength(1);

    sweep();
    expect(strokePaths()).toHaveLength(2);
    fireEvent.pointerDown(view.canvas, { ...pointer, button: 0, pointerId: 2, clientY: 120 });
    fireEvent.pointerCancel(view.canvas, { ...pointer, pointerId: 2 });
    expect(strokePaths()).toHaveLength(2);
    expect(editor.getShapes()).toHaveLength(1);
    fireEvent.pointerCancel(view.canvas, pointer);
    expect(editor.getShapes()).toHaveLength(2);
    fireEvent.pointerUp(view.canvas, { ...pointer, button: 0, clientY: 160 });
    act(() => editor.undo());
    expect(editor.getShapes()).toHaveLength(1);
    expect(strokePaths()).toHaveLength(1);
  } finally {
    await controller.dispose();
  }
});

describe('Canvas navigation', () => {
  function resize(width: number, height: number) {
    act(() => ResizeObserverStub.callback?.([{
      contentRect: { width, height },
    } as ResizeObserverEntry], {} as ResizeObserver));
  }

  it('returns to nearby content from the gap between clusters and preserves zoom', async () => {
    const controller = new GlideboardController({ sessionKey: 'back-to-content' });
    const { editor } = controller;
    try {
      editor.createShape(box('shape:nearby', 0));
      editor.createShape(box('shape:farther', 2200));
      const view = setupCanvas(controller);
      resize(640, 480);
      expect(view.queryByRole('button', { name: 'Back to content' })).toBeNull();
      act(() => editor.camera.setCamera({ x: 620, y: 0, z: 2 }));
      fireEvent.click(view.getByRole('button', { name: 'Back to content' }));
      expect(editor.camera.getCamera()).toEqual({ x: -100, y: -60, z: 2 });
      expect(view.queryByRole('button', { name: 'Back to content' })).toBeNull();
    } finally {
      await controller.dispose();
    }
  });

  it('hides the minimap during freehand drawing and restarts the delay after another stroke', async () => {
    vi.useFakeTimers();
    const controller = new GlideboardController({ sessionKey: 'minimap-drawing' });
    const { editor } = controller;
    try {
      const view = setupCanvas(controller);
      const minimap = () => view.queryByRole('img', { name: /Minimap of the current whiteboard/ });
      const indicator = () => view.container.querySelector('[data-glideboard-role="minimap-viewport"]');
      resize(640, 480);
      expect(minimap()).not.toBeNull();
      act(() => editor.camera.setCamera({ x: 60, z: 2 }));
      expect(indicator()?.getAttribute('x')).toBe('60');
      expect(indicator()?.getAttribute('width')).toBe('320');
      resize(800, 600);
      expect(indicator()?.getAttribute('width')).toBe('400');

      const press = (x: number) => fireEvent.pointerDown(view.canvas, {
        button: 0, pointerId: 1, clientX: x, clientY: 65,
      });
      const release = () => fireEvent.pointerUp(view.canvas, {
        button: 0, pointerId: 1, clientX: 280, clientY: 65,
      });
      act(() => controller.setCurrentTool('draw'));
      expect(minimap()).not.toBeNull();
      press(70);
      expect(minimap()).toBeNull();
      act(() => vi.advanceTimersByTime(2000));
      expect(minimap()).toBeNull();
      release();
      act(() => vi.advanceTimersByTime(1000));
      press(140);
      release();
      act(() => {
        editor.camera.setCamera({ x: 120 });
        controller.setCurrentTool('hand');
        vi.advanceTimersByTime(1499);
      });
      expect(minimap()).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(indicator()?.getAttribute('x')).toBe('120');
      press(70);
      expect(minimap()).not.toBeNull();
      release();
    } finally {
      vi.useRealTimers();
      await controller.dispose();
    }
  });

  it('hides the minimap while placing, dragging, and editing nodes', async () => {
    vi.useFakeTimers();
    const controller = new GlideboardController({ sessionKey: 'minimap-diagram-editing' });
    const { editor } = controller;
    try {
      const view = setupCanvas(controller);
      resize(640, 480);
      const minimap = () => view.queryByRole('img', { name: /Minimap of the current whiteboard/ });
      const point = (x: number, y: number) => ({ x, y });
      const down = (x: number, y: number, shapeId?: ReturnType<typeof editor.createShape>) =>
        editor.dispatchEvent({ type: 'pointerDown', point: point(x, y), shiftKey: false, target: shapeId ? 'shape' : 'canvas', shapeId });
      const move = (x: number, y: number) => editor.dispatchEvent({ type: 'pointerMove', point: point(x, y) });
      const up = (x: number, y: number) => editor.dispatchEvent({ type: 'pointerUp', point: point(x, y) });
      const idle = () => act(() => vi.advanceTimersByTime(1500));

      act(() => controller.setCurrentTool('box'));
      expect(minimap()).not.toBeNull();
      act(() => { down(30, 30); move(160, 120); });
      expect(minimap()).toBeNull();
      idle();
      expect(minimap()).toBeNull();
      act(() => up(160, 120));
      expect(minimap()).toBeNull();
      idle();
      expect(minimap()).not.toBeNull();

      const boxId = editor.getShapes()[0]!.id;
      act(() => { controller.setCurrentTool('select'); down(70, 75, boxId); up(70, 75); });
      expect(minimap()).not.toBeNull();
      act(() => { down(70, 75, boxId); move(200, 150); });
      expect(minimap()).toBeNull();
      act(() => up(200, 150));
      idle();
      expect(minimap()).not.toBeNull();

      act(() => { controller.setCurrentTool('text'); down(300, 100); up(300, 100); });
      expect(editor.editingShapeId.peek()).toBeTruthy();
      expect(minimap()).toBeNull();
      idle();
      expect(minimap()).toBeNull();
      act(() => editor.stopEditing());
      expect(minimap()).toBeNull();
      idle();
      expect(minimap()).not.toBeNull();
    } finally {
      vi.useRealTimers();
      await controller.dispose();
    }
  });

  it('restarts the minimap delay after another instant local edit', async () => {
    vi.useFakeTimers();
    const controller = new GlideboardController({ sessionKey: 'minimap-local-edits' });
    const { editor } = controller;
    try {
      const view = setupCanvas(controller);
      resize(640, 480);
      const minimap = () => view.queryByRole('img', { name: /Minimap of the current whiteboard/ });
      act(() => { editor.createShape({ type: 'sticky-note', x: 20, y: 20 }); });
      expect(minimap()).toBeNull();
      act(() => vi.advanceTimersByTime(1000));
      act(() => { editor.createShape({ type: 'sticky-note', x: 220, y: 20 }); });
      act(() => vi.advanceTimersByTime(1499));
      expect(minimap()).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(minimap()).not.toBeNull();
    } finally {
      vi.useRealTimers();
      await controller.dispose();
    }
  });
});

describe('Canvas text editing overlay', () => {
  it('keeps the frame name in sync between Layers and the inline canvas editor', async () => {
    const controller = new GlideboardController({ sessionKey: 'frame-name' });
    const { editor } = controller;
    try {
      const id = editor.createShape({ type: 'frame', x: 50, y: 70, props: { label: 'Original frame' } });
      const view = setupCanvas(controller);
      const layers = render(<GlideboardProvider controller={controller}><LayersPanel /></GlideboardProvider>);
      const name = layers.getByLabelText<HTMLInputElement>('Rename frame');
      const label = () => view.container.querySelector(`[data-shape-id="${id}"] [data-glideboard-role="shape-label"]`);
      expect(label()?.textContent).toBe('Original frame');

      name.focus();
      fireEvent.change(name, { target: { value: 'From Layers' } });
      fireEvent.keyDown(name, { key: 'Enter' });
      expect(label()?.textContent).toBe('From Layers');

      fireEvent.doubleClick(view.getByText('From Layers'));
      const textbox = view.getByRole('textbox', { name: 'Frame name' });
      expect(textbox.textContent).toBe('From Layers');
      textbox.textContent = 'From canvas';
      fireEvent.input(textbox);
      fireEvent.keyDown(textbox, { key: 'Enter' });
      expect(label()?.textContent).toBe('From canvas');
      expect(name.value).toBe('From canvas');
      expect(editor.getShapes()).toHaveLength(1);

      act(() => editor.undo());
      expect(label()?.textContent).toBe('From Layers');
      expect(name.value).toBe('From Layers');
    } finally {
      await act(async () => controller.dispose());
    }
  });

  it('opens a new text edit on a blank double-click in Select mode', async () => {
    const controller = new GlideboardController({ sessionKey: 'double-click-create-text' });
    const { editor } = controller;
    try {
      const view = setupCanvas(controller);
      act(() => editor.camera.setCamera({ x: 100, y: 200, z: 2 }));
      const click = { clientX: 130, clientY: 100 };
      act(() => controller.setCurrentTool('hand'));
      fireEvent.doubleClick(view.canvas, click);
      expect(editor.getShapes()).toHaveLength(0);

      act(() => controller.setCurrentTool('select'));
      fireEvent.doubleClick(view.canvas, click);
      expect(editor.getShapes()).toHaveLength(1);
      const [shape] = editor.getShapes();
      expect(shape).toMatchObject({ type: 'text', x: 160, y: 240 });
      expect(editor.editingShapeId.peek()).toBe(shape!.id);
      expect(editor.currentToolId.peek()).toBe('select');
      fireEvent.doubleClick(view.canvas, click);
      expect(editor.getShapes()).toHaveLength(1);
    } finally {
      await act(async () => controller.dispose());
    }
  });

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
      fireEvent.pointerUp(view.canvas, { button: 0, pointerId: 7, clientX: 100, clientY: 100 });
      overlayMocks.getHandleAtPagePoint.mockReturnValue(null);
      fireEvent.pointerDown(view.canvas, { button: 0, pointerId: 8, clientX: 100, clientY: 100, shiftKey: true });
      expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'pointerDown', target: 'shape', shapeId, shiftKey: true }));
      fireEvent.pointerUp(view.canvas, { button: 0, pointerId: 8, clientX: 100, clientY: 100 });
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

  it('handles rich-text keyboard commit and conflict cancellation', async () => {
    const controller = new GlideboardController({ sessionKey: 'canvas-text-input-events' });
    try {
      const id = controller.editor.createShape({
        type: 'text', x: 30, y: 30, props: {
          text: 'AB',
          richText: {
            format: 'beskar-canvas-rich-text', version: 1, profile: 'text',
            doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'AB' }] }] },
          },
          w: 20,
          h: 22,
          sizeMode: 'auto',
        },
      } as any);
      const view = setupCanvas(controller);
      act(() => controller.editor.startEditing(id));
      const editable = await view.findByRole('textbox');
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

  it.each([0, 2])('keeps a multi-selection when opening the context menu with pointer button %i', async (button) => {
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const controller = new GlideboardController({ sessionKey: 'context-menu-selection' });
    const { editor } = controller;
    try {
      const first = editor.createShape({ type: 'box', x: 100, y: 120 });
      const second = editor.createShape({ type: 'box', x: 300, y: 120 });
      editor.setSelectedShapeIds([first, second]);
      const dispatch = vi.spyOn(editor, 'dispatchEvent');
      const view = setupCanvas(controller);
      const pointer = { button, ctrlKey: button === 0, pointerType: 'mouse', pointerId: 7, clientX: 30, clientY: 40 };
      fireEvent.pointerDown(view.canvas, pointer);
      fireEvent.contextMenu(view.canvas, pointer);
      fireEvent.pointerUp(view.canvas, pointer);

      expect(editor.getSelectedShapeIds()).toEqual([first, second]);
      expect(dispatch).not.toHaveBeenCalled();
      expect(view.canvas.setPointerCapture).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      platform.mockRestore();
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
