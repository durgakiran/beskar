"use client";

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
        const es = new EventSource(eventsUrl);

        const onMessage = (ev: MessageEvent) => {
            try {
                const parsed = JSON.parse(ev.data as string) as PageEventV1;
                if (
                    parsed?.schemaVersion === 1 &&
                    (parsed.type === "document.published" ||
                        parsed.type === "draft.updated" ||
                        parsed.type === "editor.inactive")
                ) {
                    onPageEventRef.current(parsed);
                }
            } catch {
                /* ignore ping / non-json */
            }
        };

        es.addEventListener("message", onMessage as EventListener);
        es.onerror = () => {
            /* browser will retry */
        };

        return () => {
            reportedTransportRef.current = false;
            es.removeEventListener("message", onMessage as EventListener);
            es.close();
        };
    }, [spaceId, pageId, enabled]);
}
