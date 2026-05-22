import { useMemo } from 'react';
import { computed } from '@preact/signals';
import { useSignalValue } from '../../useSignalValue';
import { wbEditor } from '../editor';
import type { GlideShape } from '../../../../glideline/src/types';

export function useSelectedShapes(): GlideShape[] {
  const signal = useMemo(() => computed(() => {
    const ids = wbEditor.getSelectionSignal().value;
    return ids.map(id => wbEditor.store.getSignal(id)?.value as unknown as GlideShape).filter(Boolean);
  }), []);
  
  return useSignalValue(signal) ?? [];
}
