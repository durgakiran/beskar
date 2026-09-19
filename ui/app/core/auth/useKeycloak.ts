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

export function useDesktopLogout() {
    const callbackFn = useCallback(async () => {
        try {
            // @ts-ignore
            const { Logout } = await import('../../../wailsjs/beskar/desktop/auth/authservice');
            await Logout();
        } catch (error) {
            console.log(error);
        }
    }, []);

    return callbackFn;
}
