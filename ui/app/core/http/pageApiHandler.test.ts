import { afterEach, expect, it, vi } from "vitest";
import { reorderPage, movePage } from "./pageApiHandler";

afterEach(() => vi.unstubAllGlobals());

it("saves a relative sibling order with credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { reordered: true } })));
    vi.stubGlobal("fetch", fetcher);
    await reorderPage("space-1", "12", "10", "before");
    expect(fetcher.mock.calls[0][0]).toContain("/space/space-1/page/12/order");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "PUT", credentials: "include" });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ targetPageId: 10, placement: "before" });
});

it("surfaces stale hierarchy and permission errors without claiming success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { detail: "Pages must be different siblings in the same space" } }), { status: 409 })));
    await expect(reorderPage("space-1", "12", "10", "after")).rejects.toThrow("Pages must be different siblings");
});

it("moves under a page with no position anchor", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { pageId: 12, parentId: 10 } })));
    vi.stubGlobal("fetch", fetcher);
    await movePage("space-1", "12", "10");
    expect(fetcher.mock.calls[0][0]).toContain("/space/space-1/page/12/parent");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ parentId: 10 });
});

it("saves the new parent and sibling placement in a single request", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { pageId: 12, parentId: null } })));
    vi.stubGlobal("fetch", fetcher);
    await movePage("space-1", "12", null, { targetPageId: "10", placement: "before" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "PUT", credentials: "include" });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ parentId: null, targetPageId: 10, placement: "before" });
});

it("does not retry a conflicting anchored move", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { detail: "Page hierarchy changed concurrently" } }), { status: 409 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(movePage("space-1", "12", "1", { targetPageId: "10", placement: "after" })).rejects.toThrow("Page hierarchy changed concurrently");
    expect(fetcher).toHaveBeenCalledTimes(1);
});
