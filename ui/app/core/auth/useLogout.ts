import { useCallback, useState } from "react";


export function useLogout() {
    const [error, setError] = useState<string | null>(null);
    const callbackFn = useCallback(async () => {
        setError(null);
        try {
            const response = await fetch("/auth/logout", { method: 'POST', credentials: 'include', redirect: 'error' });
            if (!response.ok) throw new Error('Unable to sign out. Please try again.');
            const { redirect } = await response.json();
            const destination = new URL(redirect || '/', window.location.href);
            if (!['http:', 'https:'].includes(destination.protocol)) throw new Error('Invalid logout destination');
            window.location.href = destination.href;
        } catch {
            setError('Unable to sign out. Please try again.');
        }
    }, []);

    return { logout: callbackFn, error };
}

export function useDesktopLogout() {
    const callbackFn = useCallback(async () => {
        try {
            // @ts-ignore
            const { Logout } = await import('../../../wailsjs/beskar/desktop/auth/uiauthservice');
            await Logout();
        } catch {
            // The native status notice explains local and provider outcomes.
        }
    }, []);

    return callbackFn;
}
