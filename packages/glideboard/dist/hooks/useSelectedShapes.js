import { useMemo } from 'react';
import { computed } from '@preact/signals';
import { useSignalValue } from '../useSignalValue';
import { wbEditor } from '../editor';
export function useSelectedShapes() {
    const signal = useMemo(() => computed(() => {
        const ids = wbEditor.getSelectionSignal().value;
        return ids
            .map(id => wbEditor.store.getSignal(id)?.value)
            .filter(Boolean);
    }), []);
    return useSignalValue(signal) ?? [];
}
//# sourceMappingURL=useSelectedShapes.js.map