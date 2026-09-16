const key = "teddox.inviteReturn";

export function rememberInviteReturn(path: string) {
    try {
        sessionStorage.setItem(key, JSON.stringify({ path, expires: Date.now() + 30 * 60_000 }));
    } catch {
        /* The original invite link still works when browser storage is unavailable. */
    }
}

export function consumeInviteReturn(): string | null {
    try {
        const raw = sessionStorage.getItem(key);
        sessionStorage.removeItem(key);
        if (!raw) return null;
        const { path, expires } = JSON.parse(raw);
        const url = new URL(path, window.location.origin);
        if (expires > Date.now() && url.origin === window.location.origin && url.pathname === "/invite/action" && url.searchParams.get("token")) {
            return url.pathname + url.search;
        }
    } catch {
        /* Ignore stale or invalid return locations. */
    }
    return null;
}
