import { useEffect, useState } from 'react';
export function useSignalValue(sig) {
    const [value, setValue] = useState(() => sig?.peek());
    useEffect(() => {
        if (!sig) {
            setValue(undefined);
            return;
        }
        setValue(sig.peek());
        return sig.subscribe(next => {
            setValue(next);
        });
    }, [sig]);
    return value;
}
//# sourceMappingURL=useSignalValue.js.map