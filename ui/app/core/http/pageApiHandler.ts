import { getApiV1Base } from "./apiBase";

export type PageOrderPlacement = "before" | "after";

export async function reorderPage(spaceId: string, pageId: string, targetPageId: string, placement: PageOrderPlacement): Promise<void> {
    const base = getApiV1Base({ fallbackBase: import.meta.env.VITE_USER_SERVER_URL });
    const response = await fetch(`${base}/space/${encodeURIComponent(spaceId)}/page/${encodeURIComponent(pageId)}/order`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPageId: Number(targetPageId), placement }),
    });
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.detail || body?.error?.message || "Unable to save page order. Please try again.");
    }
}

export async function movePage(spaceId: string, pageId: string, parentId: string | null, anchor?: { targetPageId: string; placement: PageOrderPlacement }): Promise<void> {
    const base = getApiV1Base({ fallbackBase: import.meta.env.VITE_USER_SERVER_URL });
    const response = await fetch(`${base}/space/${encodeURIComponent(spaceId)}/page/${encodeURIComponent(pageId)}/parent`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: parentId === null ? null : Number(parentId), ...(anchor ? { targetPageId: Number(anchor.targetPageId), placement: anchor.placement } : {}) }),
    });
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.detail || body?.error?.message || "Unable to move page. Please try again.");
    }
}
