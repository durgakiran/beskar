import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GlideboardProvider } from './GlideboardContext';
import { GlideboardController } from './GlideboardController';
import { LayersPanel } from './LayersPanel';

afterEach(cleanup);

describe('LayersPanel', () => {
  it('projects hierarchy and exposes rename, lock, visibility, and selection', () => {
    const controller = new GlideboardController({ sessionKey: 'layers-panel' });
    try {
      const first = controller.editor.createShape({ type: 'box', x: 20, y: 20, props: { w: 80, h: 50 } });
      const second = controller.editor.createShape({ type: 'box', x: 160, y: 20, props: { w: 80, h: 50 } });
      const group = controller.editor.groupShapes([first, second]);
      const view = render(<GlideboardProvider controller={controller}><LayersPanel /></GlideboardProvider>);

      fireEvent.click(view.getByTitle('Expand'));
      expect(view.getAllByLabelText('Rename box')).toHaveLength(2);

      const groupName = view.getByLabelText('Rename group');
      fireEvent.change(groupName, { target: { value: 'Services' } });
      fireEvent.blur(groupName);
      expect(controller.editor.getShape(group)?.name).toBe('Services');

      fireEvent.click(view.getAllByTitle('Lock')[0]!);
      expect(controller.editor.getShape(group)?.isLocked).toBe(true);
      fireEvent.click(view.getAllByTitle('Unlock')[0]!);
      fireEvent.click(view.getAllByTitle('Hide')[0]!);
      expect(controller.editor.getShape(group)?.isHidden).toBe(true);
      fireEvent.click(view.getAllByTitle('Show')[0]!);
      fireEvent.click(view.getByLabelText('Rename group').parentElement!);
      expect(controller.editor.getSelectedShapeIds()).toEqual([group]);
    } finally {
      void controller.dispose();
    }
  });
});
