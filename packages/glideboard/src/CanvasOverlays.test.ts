// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { GlideboardController } from './GlideboardController';
import { getHandleAtPagePoint } from './CanvasOverlays';

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
});
