// @vitest-environment jsdom

import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Rectangle2d } from '../../../../glideline/src/geometry/Rectangle2d';
import { BindingPreviewOverlay } from '../Canvas';
import { wbEditor } from '../editor';

vi.mock('../editor', () => ({
  wbEditor: {
    bindingPreview: { value: null },
    store: {
      getSignal: vi.fn(),
    },
    getShapeUtil: vi.fn(),
  },
}));

vi.mock('../WhiteboardApp', () => ({
  preventFocusStealRef: { current: false },
}));

vi.mock('../../useSignalValue', () => ({
  useSignalValue: (sig: any) => sig?.value ?? sig,
}));

describe('BindingPreviewOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (wbEditor.bindingPreview as any).value = null;
  });

  it('renders source and target binding previews with anchor points', () => {
    (wbEditor.bindingPreview as any).value = {
      terminal: 'end',
      targetId: 'shape:2',
      targetType: 'box',
      normalizedAnchor: { x: 1, y: 0.5 },
      point: { x: 230, y: 45 },
      candidateAnchors: [
        { normalizedAnchor: { x: 0.5, y: 0 }, point: { x: 180, y: 20 } },
        { normalizedAnchor: { x: 1, y: 0.5 }, point: { x: 230, y: 45 } },
        { normalizedAnchor: { x: 0.5, y: 1 }, point: { x: 180, y: 70 } },
        { normalizedAnchor: { x: 0, y: 0.5 }, point: { x: 130, y: 45 } },
      ],
      sourceCandidate: {
        targetId: 'shape:1',
        targetType: 'box',
        normalizedAnchor: { x: 0.5, y: 0 },
        point: { x: 60, y: 20 },
        candidateAnchors: [
          { normalizedAnchor: { x: 0.5, y: 0 }, point: { x: 60, y: 20 } },
          { normalizedAnchor: { x: 1, y: 0.5 }, point: { x: 110, y: 45 } },
          { normalizedAnchor: { x: 0.5, y: 1 }, point: { x: 60, y: 70 } },
          { normalizedAnchor: { x: 0, y: 0.5 }, point: { x: 10, y: 45 } },
        ],
      },
    };

    (wbEditor.store.getSignal as any).mockImplementation((id: string) => ({
      value: {
        id,
        type: 'box',
        x: id === 'shape:1' ? 10 : 130,
        y: 20,
        rotation: 0,
        props: {},
      },
    }));

    (wbEditor.getShapeUtil as any).mockReturnValue({
      getGeometry: () => new Rectangle2d(0, 0, 100, 50),
    });

    const { container } = render(
      <svg>
        <BindingPreviewOverlay />
      </svg>
    );

    expect(container.querySelector('#wb-binding-preview-source')).not.toBeNull();
    expect(container.querySelector('#wb-binding-preview-target')).not.toBeNull();
    expect(container.querySelectorAll('circle').length).toBe(10);
    expect(container.querySelector('#wb-binding-preview-target-active-anchor')).not.toBeNull();
  });

});
