
import { useEffect, useRef } from "react";

const USER_URI = import.meta.env.VITE_USER_SERVER_URL?.replace(/\/+$/, "") || "";

export type PageEventV1 = {
    schemaVersion: number;
    type: string;
    spaceId: string;
    pageId: number;
    docId: number;
    draftGeneration: number;
    occurredAt: string;
    userId?: string;
    reason?: string;
};

type Options = {
    spaceId: string;
    pageId: string;
    enabled: boolean;
    /** When NEXT_PUBLIC_PAGE_EVENTS_SSE is exactly "0", only short-poll meta (no EventSource). */
    onPageEvent: (event: PageEventV1) => void;
    /** M8: invoked once with the active transport (`sse` or `shortpoll`). */
    onTransport?: (transport: "sse" | "shortpoll") => void;
};

/**
 * Subscribes to server page events for a document (SSE via Redis fan-out, or meta short-poll fallback).
 */
export function useEditorPageEvents({ spaceId, pageId, enabled, onPageEvent, onTransport }: Options) {
    const onPageEventRef = useRef(onPageEvent);
    onPageEventRef.current = onPageEvent;
    const onTransportRef = useRef(onTransport);
    onTransportRef.current = onTransport;
    const reportedTransportRef = useRef(false);

    useEffect(() => {
        if (!enabled || !spaceId || !pageId) return;

        const sseDisabled = import.meta.env.VITE_PAGE_EVENTS_SSE === "0";
        const metaPath = `${USER_URI}/editor/space/${spaceId}/page/${pageId}/edit/meta`;

        if (sseDisabled) {
            if (!reportedTransportRef.current) {
                reportedTransportRef.current = true;
                onTransportRef.current?.("shortpoll");
            }
            const poll = async () => {
                try {
                    const res = await fetch(metaPath, { credentials: "include", headers: { "Content-Type": "application/json" } });
                    if (!res.ok) return;
                    const json = (await res.json()) as { data?: { draftGeneration?: number; docId?: number } };
                    const inner = json?.data;
                    const gen = inner?.draftGeneration;
                    if (typeof gen !== "number") return;
                    onPageEventRef.current({
                        schemaVersion: 1,
                        type: "draft.updated",
                        spaceId,
                        pageId: Number(pageId),
                        docId: typeof inner?.docId === "number" ? inner.docId : 0,
                        draftGeneration: gen,
                        occurredAt: new Date().toISOString(),
                    });
                } catch {
                    /* ignore */
                }
            };
            const id = window.setInterval(() => void poll(), 45_000);
            void poll();
            return () => {
                reportedTransportRef.current = false;
                window.clearInterval(id);
            };
        }

        if (!reportedTransportRef.current) {
            reportedTransportRef.current = true;
            onTransportRef.current?.("sse");
        }
        const eventsUrl = `${USER_URI}/editor/space/${spaceId}/page/${pageId}/events`;
        const controller = new AbortController();
        let reconnectTimer: number | null = null;
        let stopped = false;

        const connect = async () => {
            try {
                const res = await fetch(eventsUrl, {
                    method: 'GET',
                    headers: { Accept: 'text/event-stream' },
                    credentials: 'include',
                    signal: controller.signal,
                });

                if (!res.ok) throw new Error(`SSE failed: ${res.status}`);
                if (!res.body) throw new Error('SSE response has no body');

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (!stopped) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
                    let boundary = buffer.indexOf('\n\n');

                    while (boundary >= 0) {
                        const rawEvent = buffer.slice(0, boundary);
                        buffer = buffer.slice(boundary + 2);
                        boundary = buffer.indexOf('\n\n');

                        // Extract data line
                        const dataLine = rawEvent
                            .split('\n')
                            .filter(line => line.startsWith('data:'))
                            .map(line => line.slice(5).trimStart())
                            .join('\n');

                        if (dataLine) {
                            try {
                                const parsed = JSON.parse(dataLine) as PageEventV1;
                                if (
                                    parsed?.schemaVersion === 1 &&
                                    (parsed.type === "document.published" ||
                                        parsed.type === "draft.updated" ||
                                        parsed.type === "editor.inactive")
                                ) {
                                    onPageEventRef.current(parsed);
                                }
                            } catch {
                                /* ignore non-json */
                            }
                        }
                    }
                }
            } catch (err: any) {
                if (stopped || err?.name === 'AbortError') return;
                console.error("SSE Error:", err);
            }

            if (!stopped) {
                reconnectTimer = window.setTimeout(connect, 2000);
            }
        };

        connect();

        return () => {
            stopped = true;
            controller.abort();
            reportedTransportRef.current = false;
            if (reconnectTimer) {
                window.clearTimeout(reconnectTimer);
            }
        };
    }, [spaceId, pageId, enabled]);
}
