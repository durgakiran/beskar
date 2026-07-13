const FALLBACK_HOST = "localhost:8085";

function resolveBrowserWebSocketUrl(path: string): string {
    const backendUrl = import.meta.env.VITE_USER_SERVER_URL;
    if (backendUrl) {
        try {
            const url = new URL(backendUrl);
            const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";
            return `${wsProtocol}//${url.host}${path}`;
        } catch (e) {
            console.error("Failed to parse VITE_USER_SERVER_URL", e);
        }
    }

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
