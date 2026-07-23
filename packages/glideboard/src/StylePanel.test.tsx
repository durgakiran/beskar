import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GlideboardProvider } from './GlideboardContext';
import { GlideboardController } from './GlideboardController';
import { StylePanel } from './StylePanel';

afterEach(cleanup);

function renderPanel(controller: GlideboardController) {
  return render(
    <GlideboardProvider controller={controller}>
      <StylePanel />
    </GlideboardProvider>,
  );
}

describe('StylePanel text targeting', () => {
  it('shows text-only controls for standalone text', () => {
    const controller = new GlideboardController({ sessionKey: 'text-style-panel' });
    try {
      const id = controller.editor.createShape({
        type: 'text',
        x: 20,
        y: 30,
        props: { text: 'Text', font: 'sans', fontSize: 'md', color: 'black' },
      });
      controller.editor.setSelectedShapeIds([id]);
      const view = renderPanel(controller);

      expect(view.getByText('Text Color')).toBeDefined();
      expect(view.getByText('Font Family')).toBeDefined();
      expect(view.getByText('Font Size')).toBeDefined();
      expect(view.queryByText('Stroke / Fill Color')).toBeNull();
      expect(view.queryByText('Stroke Width')).toBeNull();
      expect(view.queryByText('Fill')).toBeNull();
    } finally {
      void controller.dispose();
    }
  });

  it('uses the edited or label-targeted shape while selection is cleared', () => {
    const controller = new GlideboardController({ sessionKey: 'label-style-panel' });
    try {
      const id = controller.editor.createShape({
        type: 'box',
        x: 20,
        y: 30,
        props: { label: 'Label' },
      });
      controller.editor.setSelectedShapeIds([id]);
      controller.textStyleTargetIdSignal.value = id;
      const view = renderPanel(controller);

      expect(view.getByText('Text Color')).toBeDefined();
      expect(view.queryByText('Fill')).toBeNull();

      act(() => controller.editor.startEditing(id));
      expect(controller.editor.getSelectedShapeIds()).toEqual([]);
      expect(view.getByText('Text Color')).toBeDefined();
      expect(view.queryByText('Stroke Width')).toBeNull();

      fireEvent.click(view.getByTitle('tomato'));
      expect(controller.editor.getShape(id)?.props.labelColor).toBe('tomato');
      act(() => controller.editor.cancelEditing(false));
    } finally {
      void controller.dispose();
    }
  });
});
