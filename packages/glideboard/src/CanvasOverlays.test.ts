// @vitest-environment happy-dom

import React from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GlideboardController } from './GlideboardController';
import { GlideboardProvider } from './GlideboardContext';
import { CanvasOverlays, getHandleAtPagePoint } from './CanvasOverlays';

describe('Multi-selection outlines', () => {
  it('draws the nested shape geometry separately from the shared resize box', () => {
    const controller = new GlideboardController({ sessionKey: 'nested-selection-outlines' });
    const { editor } = controller;
    const outer = editor.createShape({ type: 'box', x: 10, y: 10, props: { w: 300, h: 240 } });
    const inner = editor.createShape({ type: 'diamond', x: 90, y: 70, props: { w: 100, h: 80 } });
    const ctx = {
      save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), clearRect: vi.fn(),
      scale: vi.fn(), translate: vi.fn(), transform: vi.fn(), setLineDash: vi.fn(),
      beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      stroke: vi.fn(), strokeRect: vi.fn(), fillRect: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    };
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const view = render(React.createElement(GlideboardProvider, {
      controller,
      children: React.createElement(CanvasOverlays),
    }));
    try {
      act(() => editor.setSelectedShapeIds([outer, inner]));

      // Diamond outline starts at its top vertex in local coordinates.
      expect(ctx.transform).toHaveBeenCalledWith(1, 0, 0, 1, 90, 70);
      expect(ctx.moveTo).toHaveBeenCalledWith(50, 0);
      expect(ctx.lineTo).toHaveBeenCalledWith(100, 40);
      expect(ctx.strokeRect).toHaveBeenCalledWith(10, 10, 300, 240);
      expect(getHandleAtPagePoint(editor, 10, 10)).toBe('nw');
      expect(getHandleAtPagePoint(editor, 140, 70)).toBeNull();

      ctx.transform.mockClear();
      act(() => editor.setSelectedShapeIds([outer]));
      expect(ctx.transform).not.toHaveBeenCalledWith(1, 0, 0, 1, 90, 70);
    } finally {
      view.unmount();
      context.mockRestore();
      void controller.dispose();
    }
  });
});

describe('Canvas text controls', () => {
  it('exposes the rotation handle for standalone text', () => {
    const controller = new GlideboardController({ sessionKey: 'text-rotation-handle' });
    try {
      const id = controller.editor.createShape({
        type: 'text',
        x: 100,
        y: 80,
        rotation: Math.PI / 4,
        props: { text: 'Rotate me', font: 'sans', fontSize: 'md', color: 'black' },
      });
      controller.editor.setSelectedShapeIds([id]);
      const shape = controller.editor.getShape(id)!;
      const bounds = controller.editor.getShapeUtil('text').getGeometry(shape as any).getBounds();
      const rotatePoint = controller.editor.localToPage(id, {
        x: bounds.minX + bounds.w / 2,
        y: bounds.minY - 20,
      });

      expect(getHandleAtPagePoint(controller.editor, rotatePoint.x, rotatePoint.y)).toBe('rotate');
    } finally {
      void controller.dispose();
    }
  });

  it('only hit-tests corner resize handles for groups', () => {
    const controller = new GlideboardController({ sessionKey: 'group-resize-handles' });
    try {
      const first = controller.editor.createShape({ type: 'box', x: 100, y: 80, props: { w: 100, h: 60 } });
      const second = controller.editor.createShape({ type: 'box', x: 280, y: 180, props: { w: 100, h: 60 } });
      const group = controller.editor.groupShapes([first, second]);
      controller.editor.setSelectedShapeIds([group]);
      const bounds = controller.editor.getShapeLocalBounds(group);
      const east = controller.editor.localToPage(group, { x: bounds.maxX, y: bounds.minY + bounds.h / 2 });
      const southEast = controller.editor.localToPage(group, { x: bounds.maxX, y: bounds.maxY });

      expect(getHandleAtPagePoint(controller.editor, east.x, east.y)).toBeNull();
      expect(getHandleAtPagePoint(controller.editor, southEast.x, southEast.y)).toBe('se');
    } finally {
      void controller.dispose();
    }
  });
});
