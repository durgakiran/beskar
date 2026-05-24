import { useMemo } from 'react';
import { computed } from '@preact/signals';
import type { GlideShape } from '@durgakiran/glideline';
import { useSignalValue } from '../useSignalValue';
import { wbEditor } from '../editor';

export function useSelectedShapes(): GlideShape[] {
  const signal = useMemo(() => computed(() => {
    const ids = wbEditor.getSelectionSignal().value;
    return ids
      .map(id => wbEditor.store.getSignal(id)?.value as GlideShape | null | undefined)
      .filter(Boolean) as GlideShape[];
  }), []);

  return useSignalValue(signal) ?? [];
}
