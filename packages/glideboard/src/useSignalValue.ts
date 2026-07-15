import { useEffect, useState } from 'react';
import type { ReadonlySignal } from '@preact/signals';

export function useSignalValue<T>(sig?: ReadonlySignal<T>): T | undefined {
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
