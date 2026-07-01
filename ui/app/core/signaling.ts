const FALLBACK_HOST = "localhost:8085";

function resolveBrowserWebSocketUrl(path: string): string {
    const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = typeof window !== "undefined" ? window.location.host : FALLBACK_HOST;
    return `${protocol}//${host}${path}`;
}

export function getSignalingUrl(): string {
    return import.meta.env.VITE_SIGNALING_URL || resolveBrowserWebSocketUrl("/ws");
}

export function getCollaborationUrl(): string {
    return import.meta.env.VITE_COLLAB_URL || resolveBrowserWebSocketUrl("/collab");
}
