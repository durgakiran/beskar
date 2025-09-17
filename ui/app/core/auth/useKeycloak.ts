import { useCallback } from "react";


export function useLogout() {
    const callbackFn = useCallback(async () => {
        try {
            await fetch("/auth/logout");
        } catch (error) {
            console.log(error);
        }
    }, []);

    return callbackFn;
}
