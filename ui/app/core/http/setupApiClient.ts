import { redirectToLogin } from '../auth/redirectToLogin';

/** Install before rendering so hooks, adapters, uploads and SSE share auth handling. */
export function setupApiClient(onUnauthorized: () => void = redirectToLogin) {
    const originalFetch = globalThis.fetch.bind(globalThis);
    const pageUrl = new URL(window.location.href);
    const apiBases = [
        import.meta.env.VITE_API_BASE_URL,
        import.meta.env.VITE_API_URL,
        import.meta.env.VITE_USER_SERVER_URL,
        import.meta.env.VITE_EDITOR_SERVER_URL,
    ].filter(Boolean).map(base => new URL(base, pageUrl));
    let authenticationExpired = false;

    const isApplicationRequest = (input: RequestInfo | URL) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, pageUrl);
        // Native IPC must remain available to clear tokens and sign in again.
        if (url.origin === pageUrl.origin && /^\/wails(?:\/|$)/.test(url.pathname)) return false;
        return url.origin === pageUrl.origin || apiBases.some(base => {
            const path = base.pathname.replace(/\/+$/, '');
            return url.origin === base.origin && (url.pathname === path || url.pathname.startsWith(`${path}/`));
        });
    };

    globalThis.fetch = async (input, init) => {
        const applicationRequest = isApplicationRequest(input);
        if (applicationRequest && authenticationExpired) {
            // Callers may retry errors while navigation is pending. Never send those requests.
            throw new DOMException('Session expired', 'AbortError');
        }

        const response = await originalFetch(input, init);
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        if (applicationRequest && response.status === 401 && !authenticationExpired && !signal?.aborted) {
            authenticationExpired = true;
            onUnauthorized();
        }
        return response;
    };

    // Desktop sign-in completes without reloading the application.
    return () => { authenticationExpired = false; };
}
