"use client";

import { useEffect, useRef } from "react";

const USER_URI = import.meta.env.VITE_USER_SERVER_URL?.replace(/\/+$/, "") || "";

type Options = {
    spaceId: string;
    pageId: string;
    /** Typically profile loaded and WebRTC provider ready. */
    enabled: boolean;
    /** Matches signaling draft save leader (y-webrtc); sent as `isDraftLeader` for stale detection. */
    isDraftLeader: boolean;
    /** Default 30s per implementation plan §9 F.3 */
    intervalMs?: number;
};

/**
 * POSTs editor presence while the tab is visible (M6). Disabled when `NEXT_PUBLIC_EDITOR_PRESENCE` is `"0"`.
 */
export function useEditorPresenceHeartbeat({ spaceId, pageId, enabled, isDraftLeader, intervalMs = 30_000 }: Options) {
    const isDraftLeaderRef = useRef(isDraftLeader);
    isDraftLeaderRef.current = isDraftLeader;

    useEffect(() => {
        if (!enabled || !spaceId || !pageId) return;
        if (import.meta.env.VITE_EDITOR_PRESENCE === "0") return;
        if (!USER_URI) return;

        const path = `${USER_URI}/editor/space/${spaceId}/page/${pageId}/presence`;

        const send = () => {
            if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
            void fetch(path, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    clientTime: new Date().toISOString(),
                    isDraftLeader: isDraftLeaderRef.current,
                }),
            }).catch(() => {
                /* ignore */
            });
        };

        send();
        const id = window.setInterval(send, intervalMs);
        const onVis = () => {
            if (document.visibilityState === "visible") send();
        };
        document.addEventListener("visibilitychange", onVis);
        return () => {
            window.clearInterval(id);
            document.removeEventListener("visibilitychange", onVis);
        };
    }, [spaceId, pageId, enabled, intervalMs]);
}
