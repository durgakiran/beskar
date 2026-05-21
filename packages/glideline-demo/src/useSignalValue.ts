import { useEffect, useState } from 'react';
import type { Signal } from '@preact/signals';

export function useSignalValue<T>(sig?: Signal<T>): T | undefined {
  const [val, setVal] = useState(() => sig?.peek());

  useEffect(() => {
    if (!sig) return;
    return sig.subscribe(newVal => {
      setVal(newVal);
    });
  }, [sig]);

  return val;
}
