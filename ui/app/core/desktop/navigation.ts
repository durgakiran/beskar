import { Browser } from '@wailsio/runtime';

export function externalBrowserURL(raw: string): string | undefined {
    try {
        const url = new URL(raw);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
        if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return;
        return url.href;
    } catch { return; }
}

/** User-activated document links leave the privileged renderer via the browser. */
export function setupDesktopNavigation() {
    const open = (raw: string) => {
        const safe = externalBrowserURL(raw);
        if (safe) void Browser.OpenURL(safe);
    };
    window.open = ((raw?: string | URL) => {
        if (raw) open(String(raw));
        return null;
    }) as typeof window.open;
    document.addEventListener('click', event => {
        const anchor = event.composedPath().find(node => node instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
        if (!anchor || anchor.hasAttribute('download')) return;
        const raw = anchor.getAttribute('href');
        if (!raw || raw.startsWith('#')) return;
        const url = new URL(raw, location.href);
        if (url.origin === location.origin && url.protocol === location.protocol) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        open(url.href);
    }, true);
}
