// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { signal } from '@preact/signals';
import { describe, expect, it } from 'vitest';
import { useSignalValue } from '../useSignalValue';

function SignalProbe({ sig }: { sig?: { peek(): string; subscribe(fn: (value: string) => void): () => void } }) {
  const value = useSignalValue(sig as any);
  return <div data-testid="value">{value ?? 'empty'}</div>;
}

describe('useSignalValue', () => {
  it('reads the current value immediately when the signal instance changes', () => {
    const first = signal('alpha');
    const second = signal('beta');
    const { rerender } = render(<SignalProbe />);

    expect(screen.getByTestId('value').textContent).toBe('empty');

    rerender(<SignalProbe sig={first as any} />);
    expect(screen.getByTestId('value').textContent).toBe('alpha');

    rerender(<SignalProbe sig={second as any} />);
    expect(screen.getByTestId('value').textContent).toBe('beta');
  });
});
