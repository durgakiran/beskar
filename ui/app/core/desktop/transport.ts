let transportBase: string | undefined;

export function getDesktopTransportURL(path: string): string | undefined {
    if (!(path.startsWith('/api/v1/') || path === '/ws' || path === '/collab') || /[\\#]/.test(path) || new URL(path, 'http://native').pathname !== path.split('?')[0]) {
        throw new Error('Invalid native transport path');
    }
    return transportBase && `${transportBase}${path}`;
}

/** Route backend traffic over real HTTP while Wails IPC/assets stay native. */
export function setupDesktopTransport(base: string) {
    const url = new URL(base);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.search || url.hash || url.username || url.password || !/^\/[a-f0-9]{64}$/.test(url.pathname)) {
        throw new Error('Invalid native transport endpoint');
    }
    transportBase = base;
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
        const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(raw, window.location.href);
        const page = new URL(window.location.href);
        if (url.protocol !== page.protocol || url.host !== page.host || !url.pathname.startsWith('/api/v1/')) {
            return nativeFetch(input, init);
        }
        const destination = `${base}${url.pathname}${url.search}`;
        if (!(input instanceof Request)) return nativeFetch(destination, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
        const forwarded = new Request(destination, {
            method: input.method, headers: input.headers,
            body: input.body ? await input.clone().arrayBuffer() : undefined,
            credentials: input.credentials, cache: input.cache, redirect: input.redirect,
            referrerPolicy: input.referrerPolicy, integrity: input.integrity,
            keepalive: input.keepalive, signal: input.signal,
        });
        return nativeFetch(forwarded, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    };
}
