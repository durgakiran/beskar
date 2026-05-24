import { useEffect, useState } from 'react';
import type { Signal } from '@preact/signals';

export function useSignalValue<T>(sig?: Signal<T>): T | undefined {
  const [val, setVal] = useState(() => sig?.peek());

  useEffect(() => {
    if (!sig) {
      setVal(undefined);
      return;
    }
    setVal(sig.peek());
    return sig.subscribe(newVal => {
      setVal(newVal);
    });
  }, [sig]);

  return val;
}
