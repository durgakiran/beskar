import React from 'react';
import { render } from '@testing-library/react';
import { SelectionLayer } from '../SelectionLayer';
import { wbEditor } from '../editor';
import { vi, describe, it, expect } from 'vitest';

// Mock the editor and useSignalValue hook
vi.mock('../editor', () => ({
  wbEditor: {
    getSelectionSignal: vi.fn(),
    camera: { signal: { value: { x: 0, y: 0, z: 1 } } },
    store: {
      getSignal: vi.fn(),
    },
    getShape: vi.fn(),
    getShapeUtil: vi.fn(),
    getCurrentTool: vi.fn(() => ({})),
  }
}));

vi.mock('../../useSignalValue', () => ({
  useSignalValue: (sig: any) => sig?.value ?? sig
}));

describe('SelectionLayer', () => {
  it('renders nothing when no shapes are selected', () => {
    (wbEditor.getSelectionSignal as any).mockReturnValue({ value: [] });
    const { container } = render(
      <svg><SelectionLayer /></svg>
    );
    expect(container.querySelector('g')).toBeNull();
  });

  it('renders handles for a single selected box', () => {
    (wbEditor.getSelectionSignal as any).mockReturnValue({ value: ['shape:1'] });
    
    // Mock the shape store signal
    (wbEditor.store.getSignal as any).mockImplementation((id: string) => {
      return {
        value: { id, type: 'box', x: 10, y: 10, rotation: 0 }
      };
    });

    (wbEditor.getShape as any).mockImplementation(() => ({ type: 'box' }));
    
    (wbEditor.getShapeUtil as any).mockImplementation(() => ({
      getGeometry: () => ({ minX: 10, minY: 10, maxX: 110, maxY: 60, w: 100, h: 50 })
    }));

    const { container } = render(
      <svg><SelectionLayer /></svg>
    );
    
    const handles = container.querySelectorAll('rect[data-handle]');
    expect(handles.length).toBe(8); // 8 resize handles
    
    const rotateHandle = container.querySelector('circle[data-handle="rotate"]');
    expect(rotateHandle).not.toBeNull();
  });
});
