import { useMemo } from 'react';
import type { GlideShape } from '@durgakiran/glideline';
import { useSignalValue } from '../useSignalValue';
import { useGlideboardController } from '../GlideboardContext';

export function useSelectedShapes(): GlideShape[] {
  const { editor } = useGlideboardController();
  const selectedIds = useSignalValue(editor.getSelectionSignal());
  const storeVersion = useSignalValue(editor.store.getVersionSignal());

  return useMemo(() => {
    void storeVersion;
    return (selectedIds ?? [])
      .map(id => editor.store.getSignal(id)?.value as GlideShape | null | undefined)
      .filter(Boolean) as GlideShape[];
  }, [editor, selectedIds, storeVersion]);
}
