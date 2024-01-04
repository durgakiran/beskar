import { useEffect, useRef } from "react";

export function useDidMountEffect(func, deps) {
    const didMount = useRef(false);

    useEffect(() => {
        console.log(deps);
        console.log(didMount.current);
        if (didMount.current) {
            func();
        } else {
            console.log(didMount);
            didMount.current = true;
        }
    }, deps);
}
