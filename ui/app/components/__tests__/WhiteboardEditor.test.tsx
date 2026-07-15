import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WhiteboardEditor from "../WhiteboardEditor";

const useGet = vi.fn();
const providerInstances: Array<{ room: string; doc: Y.Doc; options: unknown }> = [];
const glideboardMock = vi.hoisted(() => ({ flush: vi.fn() }));

vi.mock("@http/hooks", () => ({
    useGet: (...args: unknown[]) => useGet(...args),
}));

vi.mock("@durgakiran/glideboard", () => ({
    Glideboard: React.forwardRef(function MockGlideboard(
        { readOnly, collaboration, sessionKey }: any,
        ref: React.ForwardedRef<unknown>,
    ) {
        React.useImperativeHandle(ref, () => ({
            flush: glideboardMock.flush,
            serialize: () => ({ records: [] }),
            exportSvg: async () => '<svg />',
            setCurrentTool: vi.fn(),
        }));
        return React.createElement("div", {
            "data-testid": "glideboard",
            "data-readonly": String(readOnly),
            "data-has-provider": String(Boolean(collaboration?.provider)),
            "data-session-key": sessionKey,
            "data-record-ids": Array.from(
                collaboration.doc.getMap("glideboard-records").keys(),
            ).sort().join(","),
        });
    }),
}));

vi.mock("y-webrtc", () => ({
    WebrtcProvider: class MockWebrtcProvider {
        public awareness = {
            setLocalStateField: vi.fn(),
            getStates: () => new Map(),
            on: vi.fn(),
            off: vi.fn(),
        };

        constructor(room: string, doc: Y.Doc, options: unknown) {
            providerInstances.push({ room, doc, options });
        }

        disconnect() {}
        destroy() {}
    },
}));

function boardData(
    spaceId: string,
    pageId: string,
    overrides: Partial<{ title: string; data: string | null }> = {},
) {
    return {
        id: Number(pageId) || 1,
        docId: 1,
        title: overrides.title ?? "Board",
        data: overrides.data ?? null,
        pageId,
        spaceId,
    };
}

function jsonResponse(data: ReturnType<typeof boardData>): Response {
    return {
        ok: true,
        status: 200,
        json: async () => ({ data }),
    } as Response;
}

function encodeRecord(id: string): string {
    const doc = new Y.Doc();
    doc.getMap("glideboard-records").set(id, { id, type: "box" });
    const encoded = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
    doc.destroy();
    return encoded;
}

describe("WhiteboardEditor", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        providerInstances.length = 0;
        glideboardMock.flush.mockResolvedValue(undefined);
        useGet.mockReturnValue([
            {
                data: { data: { id: "user-1", name: "Asha", email: "asha@example.com" } },
                isLoading: false,
                errors: null,
            },
            vi.fn(),
        ]);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const renderEditor = (props: React.ComponentProps<typeof WhiteboardEditor>) => render(
        <MemoryRouter>
            <WhiteboardEditor {...props} />
        </MemoryRouter>,
    );

    it("uses the read-only fetch path in view mode", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);

        renderEditor({ slug: ["space-1", "2"], readOnly: true });

        await waitFor(() => expect(screen.getByTestId("glideboard")).not.toBeNull());
        expect(screen.getByTestId("glideboard").getAttribute("data-readonly")).toBe("true");
        expect(screen.getByTestId("glideboard").getAttribute("data-session-key")).toBe("space-1:2");
        expect(fetchMock).toHaveBeenCalledWith(
            "/editor/space/space-1/whiteboard/2",
            expect.objectContaining({ credentials: "include", signal: expect.any(AbortSignal) }),
        );
    });

    it("uses the edit fetch path and creates a collaboration provider in edit mode", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);

        renderEditor({ slug: ["space-1", "2"] });

        await waitFor(() => expect(screen.getByTestId("glideboard")).not.toBeNull());
        expect(screen.getByTestId("glideboard").getAttribute("data-readonly")).toBe("false");
        expect(screen.getByTestId("glideboard").getAttribute("data-has-provider")).toBe("true");
        expect(fetchMock).toHaveBeenCalledWith(
            "/editor/space/space-1/whiteboard/2/edit",
            expect.objectContaining({ credentials: "include", signal: expect.any(AbortSignal) }),
        );
        expect(providerInstances[0]?.room).toBe("2-space-space-1");
    });

    it("keeps the current Y.Doc alive through StrictMode replay", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2"))),
        );

        const view = render(
            <MemoryRouter>
                <React.StrictMode>
                    <WhiteboardEditor slug={["space-1", "2"]} />
                </React.StrictMode>
            </MemoryRouter>,
        );

        await waitFor(() => expect(screen.getByTestId("glideboard")).not.toBeNull());
        const liveDoc = providerInstances.at(-1)?.doc;
        expect(liveDoc).toBeDefined();
        expect(liveDoc?.isDestroyed).toBe(false);

        view.unmount();
        await waitFor(() => expect(liveDoc?.isDestroyed).toBe(true));
    });

    it("ignores aborted A-to-B-to-A responses and applies only the current request", async () => {
        type PendingRequest = {
            url: string;
            signal: AbortSignal;
            resolve: (response: Response) => void;
        };
        const requests: PendingRequest[] = [];
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>(resolve => {
            requests.push({
                url: String(input),
                signal: init?.signal as AbortSignal,
                resolve,
            });
        }));
        vi.stubGlobal("fetch", fetchMock);

        const view = renderEditor({ slug: ["space-a", "1"], readOnly: true });
        await waitFor(() => expect(requests).toHaveLength(1));

        view.rerender(
            <MemoryRouter>
                <WhiteboardEditor slug={["space-b", "2"]} readOnly />
            </MemoryRouter>,
        );
        await waitFor(() => expect(requests).toHaveLength(2));
        expect(requests[0]!.signal.aborted).toBe(true);

        view.rerender(
            <MemoryRouter>
                <WhiteboardEditor slug={["space-a", "1"]} readOnly />
            </MemoryRouter>,
        );
        await waitFor(() => expect(requests).toHaveLength(3));
        expect(requests[1]!.signal.aborted).toBe(true);

        requests[0]!.resolve(jsonResponse(boardData("space-a", "1", {
            title: "Stale A",
            data: encodeRecord("shape:stale"),
        })));
        await Promise.resolve();
        expect(screen.queryByTestId("glideboard")).toBeNull();

        requests[2]!.resolve(jsonResponse(boardData("space-a", "1", {
            title: "Current A",
            data: encodeRecord("shape:current"),
        })));

        await waitFor(() => expect(screen.getByTestId("glideboard")).not.toBeNull());
        const board = screen.getByTestId("glideboard");
        expect(board.getAttribute("data-session-key")).toBe("space-a:1");
        expect(board.getAttribute("data-record-ids")).toBe("shape:current");
    });

    it("flushes the current Y.Doc before Close finishes navigating", async () => {
        let resolveSave!: (response: Response) => void;
        const saveResponse = new Promise<Response>(resolve => {
            resolveSave = resolve;
        });
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === "PUT") return saveResponse;
            return Promise.resolve(jsonResponse(boardData("space-1", "2")));
        });
        vi.stubGlobal("fetch", fetchMock);

        renderEditor({ slug: ["space-1", "2"] });
        await waitFor(() => expect(screen.getByTestId("glideboard")).not.toBeNull());

        providerInstances.at(-1)!.doc.getMap("glideboard-records").set(
            "shape:unsaved",
            { id: "shape:unsaved", type: "box" },
        );
        const closeButton = screen.getByRole("button", { name: "Close" });
        fireEvent.click(closeButton);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
            "/editor/space/space-1/whiteboard/2",
            expect.objectContaining({ method: "PUT", keepalive: false }),
        ));
        expect(glideboardMock.flush).toHaveBeenCalledTimes(1);
        expect(closeButton.hasAttribute("disabled")).toBe(true);

        resolveSave({ ok: true, status: 200 } as Response);
        await waitFor(() => expect(closeButton.hasAttribute("disabled")).toBe(false));
    });
});
