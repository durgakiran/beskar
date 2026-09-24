// @vitest-environment jsdom

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
    localToPage: vi.fn((_id, point) => point),
    getBindingsFromShape: vi.fn(() => []),
    getCurrentTool: vi.fn(() => ({})),
  }
}));

vi.mock('../../useSignalValue', () => ({
  useSignalValue: (sig: any) => sig?.value ?? sig
}));

describe('SelectionLayer', () => {
  it('renders bend, start, and end handles for a selected arrow', () => {
    (wbEditor.getSelectionSignal as any).mockReturnValue({ value: ['shape:arrow'] });
    (wbEditor.store.getSignal as any).mockImplementation((id: string) => ({
      value: {
        id,
        type: 'arrow',
        x: 10,
        y: 20,
        rotation: 0,
        props: {
          routeStyle: 'curve',
          bend: 0.5,
          start: { point: { x: 0, y: 0 }, boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 } },
          end: { point: { x: 100, y: 0 }, boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 } },
        },
      },
    }));
    (wbEditor.getShapeUtil as any).mockImplementation(() => ({
      getGeometry: () => ({ getBounds: () => ({ minX: 0, minY: 0, maxX: 100, maxY: 50, w: 100, h: 50 }) })
    }));

    const { container } = render(
      <svg><SelectionLayer /></svg>
    );

    expect(container.querySelector('rect[data-handle="start"]')).not.toBeNull();
    expect(container.querySelector('rect[data-handle="end"]')).not.toBeNull();
    expect(container.querySelector('circle[data-handle="bend"]')).not.toBeNull();
  });

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
      getGeometry: () => ({ getBounds: () => ({ minX: 10, minY: 10, maxX: 110, maxY: 60, w: 100, h: 50 }) })
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
