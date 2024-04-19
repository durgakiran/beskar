import { useEffect, useState } from "react";

export function useDebounce(value, delay, ignoreFirst =  false) {
    const [debouncedValue, setDebouncedValue] = useState(value);
    const [isFirst, setIsFirst] = useState(true);

    useEffect(() => {
        const handler = setTimeout(() => {
            if (ignoreFirst && isFirst) {
                
            } else {
                setDebouncedValue(value);
            }
            setIsFirst(false);
        }, delay);
      
        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);

    return debouncedValue;
}
