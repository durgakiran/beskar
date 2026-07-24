import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ArrowUtil } from '@durgakiran/glideline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlideboardProvider } from './GlideboardContext';
import { GlideboardController } from './GlideboardController';
import { Canvas } from './Canvas';

vi.mock('./CanvasOverlays', () => ({
  CanvasOverlays: () => null,
  getHandleAtPagePoint: () => null,
  getCursorForHandle: () => 'default',
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
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
  vi.unstubAllGlobals();
});

describe('Canvas text editing overlay', () => {
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
});
