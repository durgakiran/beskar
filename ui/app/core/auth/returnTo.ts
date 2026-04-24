export const CURRENT_PATH_HEADER = "x-beskar-current-path";

export function normalizeReturnTo(value: string | null | undefined) {
    const trimmed = value?.trim();
    if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
        return "/";
    }
    if (/[\\\r\n\t]/.test(trimmed)) {
        return "/";
    }

    const path = trimmed.split(/[?#]/, 1)[0].toLowerCase();
    if (path === "/auth" || path.startsWith("/auth/")) {
        return "/";
    }

    return trimmed;
}

export function buildAuthLoginUrl(returnTo: string | null | undefined) {
    return `/auth/login?returnTo=${encodeURIComponent(normalizeReturnTo(returnTo))}`;
}
