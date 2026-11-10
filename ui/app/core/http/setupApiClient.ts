import { redirectToLogin } from '../auth/redirectToLogin';

/** Install before rendering so hooks, adapters, uploads and SSE share auth handling. */
export function setupApiClient(onUnauthorized: () => void = redirectToLogin, options: { csrf?: boolean } = {}) {
    const originalFetch = globalThis.fetch.bind(globalThis);
    const pageUrl = new URL(window.location.href);
    const apiBases = [
        import.meta.env.VITE_API_BASE_URL,
        import.meta.env.VITE_API_URL,
        import.meta.env.VITE_USER_SERVER_URL,
        import.meta.env.VITE_EDITOR_SERVER_URL,
        import.meta.env.VITE_IMAGE_SERVER_URL,
    ].filter(Boolean).map(base => new URL(base, pageUrl));
    let authenticationExpired = false;
    const csrfTokens = new Map<string, Promise<string | Response>>();

    const csrfToken = (origin: string) => {
        let pending = csrfTokens.get(origin);
        if (!pending) {
            pending = (async () => {
                const response = await originalFetch(`${origin}/auth/csrf`, {
                    credentials: 'include', cache: 'no-store', redirect: 'error',
                });
                if (!response.ok) { csrfTokens.delete(origin); return response; }
                const data = await response.json();
                if (typeof data.csrfToken !== 'string' || !data.csrfToken) throw new Error('Missing CSRF token');
                return data.csrfToken as string;
            })().catch(error => { csrfTokens.delete(origin); throw error; });
            csrfTokens.set(origin, pending);
        }
        return pending;
    };

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
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, pageUrl);
        if (applicationRequest && authenticationExpired) {
            // Callers may retry errors while navigation is pending. Never send those requests.
            throw new DOMException('Session expired', 'AbortError');
        }

        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        signal?.throwIfAborted();
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        const credentials = init?.credentials ?? (input instanceof Request ? input.credentials : 'same-origin');
        let response: Response | undefined;
        let csrfOrigin: string | undefined;
        const apiRequest = /^\/api\/v[12](?:\/|$)/.test(url.pathname) || url.pathname === '/auth/logout'
            || apiBases.some(base => {
                const path = base.pathname.replace(/\/+$/, '');
                return path !== '' && url.origin === base.origin && (url.pathname === path || url.pathname.startsWith(`${path}/`));
            });
        const sessionBootstrap = method === 'GET' && url.pathname === '/api/v1/authenticated';
        if (options.csrf !== false && applicationRequest && apiRequest && !sessionBootstrap
            && credentials !== 'omit' && !headers.has('Authorization')) {
            csrfOrigin = url.origin;
            const token = await csrfToken(csrfOrigin);
            signal?.throwIfAborted();
            if (authenticationExpired) throw new DOMException('Session expired', 'AbortError');
            if (token instanceof Response) response = token.clone();
            else {
                headers.set('X-CSRF-Token', token);
                init = { ...init, headers, redirect: 'error' };
            }
        }
        response ??= await originalFetch(input, init);
        if (options.csrf !== false && applicationRequest && method === 'GET' && response.status === 200
            && credentials !== 'omit' && !headers.has('Authorization')) {
            if (url.pathname === '/api/v1/authenticated') {
                // AuthGuard awaits this request before mounting the workspace.
                // Cache the session token first, without consuming its response.
                const session = await response.clone().json();
                signal?.throwIfAborted();
                const token = session?.data?.csrfToken;
                if (typeof token !== 'string' || !token) throw new Error('Missing session CSRF token');
                if (!authenticationExpired) csrfTokens.set(url.origin, Promise.resolve(token));
            }
        }
        // Never replay a mutation. A later explicit retry can fetch a new token
        // after another tab changes accounts or invalidates this session.
        if (csrfOrigin && response.status === 403) csrfTokens.delete(csrfOrigin);
        if (applicationRequest && response.status === 401 && !authenticationExpired && !signal?.aborted) {
            authenticationExpired = true;
            onUnauthorized();
        }
        return response;
    };

    // Desktop sign-in completes without reloading the application.
    return () => { authenticationExpired = false; csrfTokens.clear(); };
}
