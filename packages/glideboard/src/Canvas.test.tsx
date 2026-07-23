import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
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
