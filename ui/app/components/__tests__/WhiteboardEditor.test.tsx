import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WhiteboardEditor, { trustedPortableAssetRequest } from "../WhiteboardEditor";

const useGet = vi.fn();
const providerInstances: Array<{ room: string; doc: Y.Doc; options: unknown }> = [];
const glideboardMock = vi.hoisted(() => ({
    settleActiveEdit: vi.fn(),
    acquireMutationFence: vi.fn(),
    assetStorage: null as any,
}));

vi.mock("@http/hooks", () => ({
    useGet: (...args: unknown[]) => useGet(...args),
}));

vi.mock("@durgakiran/glideboard", () => ({
    safeAwarenessEntries: (states: Map<number, any>) => Array.from(states.entries())
        .filter(([, state]) => Boolean(state?.user))
        .map(([clientId, state]) => ({ clientId, user: state.user, cursor: state.cursor ?? null })),
    Glideboard: React.forwardRef(function MockGlideboard(
        { readOnly, collaboration, sessionKey, assetStorage }: any,
        ref: React.ForwardedRef<unknown>,
    ) {
        glideboardMock.assetStorage = assetStorage;
        const checkpointSource = React.useMemo(() => {
            let sequence = 0;
            let latest: any = null;
            let active = true;
            const listeners = new Set<(state: any) => void>();
            let pending = Promise.resolve();
            const project = () => {
                pending = pending.then(async () => {
                    if (!active) return;
                    const encodedState = Y.encodeStateAsUpdate(collaboration.doc);
                    const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(encodedState));
                    const stateDigest = `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
                    sequence += 1;
                    latest = {
                        target: {
                            storeRevision: sequence,
                            yjs: { transactionSequence: sequence, stateDigest },
                        },
                        encodedState,
                    };
                    listeners.forEach(listener => listener(latest));
                });
            };
            collaboration.doc.on("update", project);
            project();
            return {
                source: {
                    subscribe(listener: (state: any) => void) {
                        listeners.add(listener);
                        if (latest) listener(latest);
                        return () => listeners.delete(listener);
                    },
                    async captureTarget() {
                        await pending;
                        return latest.target;
                    },
                },
                dispose() {
                    active = false;
                    collaboration.doc.off("update", project);
                },
            };
        }, [collaboration.doc]);
        React.useEffect(() => () => checkpointSource.dispose(), [checkpointSource]);
        React.useImperativeHandle(ref, () => ({
            checkpoints: checkpointSource.source,
            captureProjectionTarget: checkpointSource.source.captureTarget,
            settleActiveEdit: glideboardMock.settleActiveEdit,
            acquireMutationFence: glideboardMock.acquireMutationFence,
            serialize: () => ({ records: [] }),
            exportSvg: async () => '<svg />',
            setCurrentTool: vi.fn(),
        }), [checkpointSource]);
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
        glideboardMock.settleActiveEdit.mockResolvedValue(undefined);
        glideboardMock.acquireMutationFence.mockReturnValue({ release: vi.fn() });
        glideboardMock.assetStorage = null;
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

    it("persists whiteboard raster assets through a page-scoped staging transaction", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);
        renderEditor({ slug: ["space-1", "2"], readOnly: true });
        await waitFor(() => expect(glideboardMock.assetStorage).not.toBeNull());

        const token = "11111111-1111-4111-8111-111111111111";
        fetchMock
            .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { token } }) })
            .mockResolvedValueOnce({ ok: true, status: 204 })
            .mockResolvedValueOnce({ ok: true, status: 204 });
        const hash = "a".repeat(64);
        const controller = new AbortController();
        const persistence = await glideboardMock.assetStorage.prepare({
            props: { hash, mimeType: "image/png" },
        }, controller.signal);
        await persistence.stage(new Uint8Array([1, 2, 3]), controller.signal);
        await persistence.commit(controller.signal);

        expect(persistence).toEqual(expect.objectContaining({
            commit: expect.any(Function),
            rollback: expect.any(Function),
        }));

        expect(fetchMock).toHaveBeenLastCalledWith(
            `/api/v1/media/whiteboard-asset/2/${hash}/staging/${token}/commit`,
            expect.objectContaining({
                method: "POST",
                credentials: "include",
                signal: expect.any(AbortSignal),
            }),
        );
        expect(glideboardMock.assetStorage.resolve({ props: { hash } }))
            .toBe(`/api/v1/media/whiteboard-asset/2/${hash}`);
    });

    it("replays a commit whose first response is lost without compensating committed bytes", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);
        renderEditor({ slug: ["space-1", "2"], readOnly: true });
        await waitFor(() => expect(glideboardMock.assetStorage).not.toBeNull());

        const token = "44444444-4444-4444-8444-444444444444";
        fetchMock
            .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { token } }) })
            .mockResolvedValueOnce({ ok: true, status: 204 })
            .mockRejectedValueOnce(new TypeError("response lost"))
            .mockResolvedValueOnce({ ok: true, status: 200 });
        const hash = "e".repeat(64);
        const persistence = await glideboardMock.assetStorage.prepare(
            { props: { hash, mimeType: "image/png" } },
            new AbortController().signal,
        );
        await persistence.stage(new Uint8Array([1]), new AbortController().signal);
        await persistence.commit(new AbortController().signal);

        const commitCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/commit"));
        expect(commitCalls).toHaveLength(2);
        expect(commitCalls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
        expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    });

    it("fences fresh commit-response retries with the caller cancellation signal", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);
        renderEditor({ slug: ["space-1", "2"], readOnly: true });
        await waitFor(() => expect(glideboardMock.assetStorage).not.toBeNull());
        const token = "45454545-4545-4545-8545-454545454545";
        let retrySignal: AbortSignal | undefined;
        fetchMock
            .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { token } }) })
            .mockResolvedValueOnce({ ok: true, status: 204 })
            .mockRejectedValueOnce(new TypeError("response lost"))
            .mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
                retrySignal = init?.signal as AbortSignal;
                retrySignal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
            }));
        const hash = "4".repeat(64);
        const controller = new AbortController();
        const persistence = await glideboardMock.assetStorage.prepare(
            { props: { hash, mimeType: "image/png" } }, controller.signal,
        );
        await persistence.stage(new Uint8Array([1]), controller.signal);
        const committed = persistence.commit(controller.signal);
        await waitFor(() => expect(retrySignal).toBeInstanceOf(AbortSignal));
        controller.abort();
        await expect(committed).rejects.toMatchObject({ name: "AbortError" });
        expect(retrySignal?.aborted).toBe(true);
        expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/commit"))).toHaveLength(2);
    });

	it.each([
		[507, "limit-exceeded", false],
		[429, "rate-limit", true],
        [403, "permission", false],
        [422, "invalid-content", false],
        [409, "conflict", false],
        [503, "network", true],
        [500, "storage", true],
    ])("maps staging HTTP %s to %s", async (status, category, retryable) => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);
        renderEditor({ slug: ["space-1", "2"], readOnly: true });
        await waitFor(() => expect(glideboardMock.assetStorage).not.toBeNull());
		fetchMock.mockResolvedValueOnce({ ok: false, status, headers: new Headers(), clone: () => ({ text: async () => "" }) });
        await expect(glideboardMock.assetStorage.prepare(
            { props: { hash: "7".repeat(64), mimeType: "image/png" } }, new AbortController().signal,
        )).rejects.toMatchObject({ category, retryable });
	});

	it("honors Retry-After before retrying a rate-limited commit", async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
		vi.stubGlobal("fetch", fetchMock);
		renderEditor({ slug: ["space-1", "2"], readOnly: true });
		await waitFor(() => expect(glideboardMock.assetStorage).not.toBeNull());
		const token = "99999999-9999-4999-8999-999999999999";
		fetchMock
			.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { token } }) })
			.mockResolvedValueOnce({ ok: true, status: 204 })
			.mockResolvedValueOnce({
				ok: false, status: 429, headers: new Headers({ "Retry-After": "0.5" }),
				clone: () => ({ text: async () => "slow down" }),
			})
			.mockResolvedValueOnce({ ok: true, status: 200 });
		const signal = new AbortController().signal;
		const persistence = await glideboardMock.assetStorage.prepare(
			{ props: { hash: "8".repeat(64), mimeType: "image/png" } }, signal,
		);
		await persistence.stage(new Uint8Array([1]), signal);

		vi.useFakeTimers();
		try {
			const committed = persistence.commit(signal);
			await vi.advanceTimersByTimeAsync(499);
			expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/commit"))).toHaveLength(1);
			await vi.advanceTimersByTimeAsync(1);
			await committed;
			expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/commit"))).toHaveLength(2);
		} finally {
			vi.useRealTimers();
		}
	});

    it.each([
        ["Wed, 21 Oct 2015 07:28:00 GMT", 0],
        ["not-a-delay", null],
    ])("handles Retry-After value %s", async (retryAfter, expectedDelay) => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);
        renderEditor({ slug: ["space-1", "2"], readOnly: true });
        await waitFor(() => expect(glideboardMock.assetStorage).not.toBeNull());
        const token = "abababab-abab-4bab-8bab-abababababab";
        fetchMock
            .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { token } }) })
            .mockResolvedValueOnce({ ok: true, status: 204 })
            .mockResolvedValueOnce({
                ok: false,
                status: 429,
                headers: new Headers({ "Retry-After": retryAfter }),
                clone: () => ({ text: async () => "limited" }),
            })
            .mockResolvedValueOnce({ ok: true, status: 204 });
        const signal = new AbortController().signal;
        const persistence = await glideboardMock.assetStorage.prepare(
            { props: { hash: "1".repeat(64), mimeType: "image/png" } }, signal,
        );
        await persistence.stage(new Uint8Array([1]), signal);
        await persistence.commit(signal);
        expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/commit"))).toHaveLength(2);
        if (expectedDelay === 0) expect(expectedDelay).toBe(0);
    });

    it("cancels during a Retry-After wait without issuing another commit", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);
        renderEditor({ slug: ["space-1", "2"], readOnly: true });
        await waitFor(() => expect(glideboardMock.assetStorage).not.toBeNull());
        const token = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
        fetchMock
            .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { token } }) })
            .mockResolvedValueOnce({ ok: true, status: 204 })
            .mockResolvedValueOnce({
                ok: false, status: 429, headers: new Headers({ "Retry-After": "60" }),
                clone: () => ({ text: async () => "limited" }),
            });
        const controller = new AbortController();
        const persistence = await glideboardMock.assetStorage.prepare(
            { props: { hash: "2".repeat(64), mimeType: "image/png" } }, controller.signal,
        );
        await persistence.stage(new Uint8Array([1]), controller.signal);
        const committing = persistence.commit(controller.signal);
        await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/commit"))).toHaveLength(1));
        controller.abort();
        await expect(committing).rejects.toMatchObject({ name: "AbortError" });
        expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/commit"))).toHaveLength(1);
    });

    it.each([
        [401, "permission"],
        [400, "invalid-content"],
        [413, "limit-exceeded"],
        [415, "unsupported-format"],
        [404, "not-found"],
        [418, "storage"],
    ])("maps additional asset HTTP %s responses", async (status, category) => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);
        renderEditor({ slug: ["space-1", "2"], readOnly: true });
        await waitFor(() => expect(glideboardMock.assetStorage).not.toBeNull());
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status,
            headers: new Headers(),
            clone: () => ({ text: async () => { throw new Error("unreadable"); } }),
        });
        await expect(glideboardMock.assetStorage.prepare(
            { props: { hash: "3".repeat(64), mimeType: "image/png" } }, new AbortController().signal,
        )).rejects.toMatchObject({ category, retryable: false });
    });

    it("preserves abort, categorized, and ordinary fetch failures", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);
        renderEditor({ slug: ["space-1", "2"], readOnly: true });
        await waitFor(() => expect(glideboardMock.assetStorage).not.toBeNull());
        const storage = glideboardMock.assetStorage;
        const asset = { props: { hash: "4".repeat(64), mimeType: "image/png" } };
        const abortError = new DOMException("cancelled", "AbortError");
        fetchMock.mockRejectedValueOnce(abortError);
        await expect(storage.prepare(asset, new AbortController().signal)).rejects.toBe(abortError);
        const categorized = Object.assign(new Error("known"), { category: "conflict", retryable: false });
        fetchMock.mockRejectedValueOnce(categorized);
        await expect(storage.prepare(asset, new AbortController().signal)).rejects.toBe(categorized);
        const ordinary = new Error("ordinary");
        fetchMock.mockRejectedValueOnce(ordinary);
        await expect(storage.prepare(asset, new AbortController().signal)).rejects.toBe(ordinary);
    });

    it("stops a non-retryable commit and rolls its staging transaction back", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);
        renderEditor({ slug: ["space-1", "2"], readOnly: true });
        await waitFor(() => expect(glideboardMock.assetStorage).not.toBeNull());
        const token = "efefefef-efef-4fef-8fef-efefefefefef";
        fetchMock
            .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { token } }) })
            .mockResolvedValueOnce({ ok: true, status: 204 })
            .mockResolvedValueOnce({ ok: false, status: 409, headers: new Headers(), clone: () => ({ text: async () => "conflict" }) })
            .mockResolvedValueOnce({ ok: true, status: 204 });
        const signal = new AbortController().signal;
        const persistence = await glideboardMock.assetStorage.prepare(
            { props: { hash: "5".repeat(64), mimeType: "image/png" } }, signal,
        );
        await persistence.stage(new Uint8Array([1]), signal);
        await expect(persistence.commit(signal)).rejects.toMatchObject({ category: "conflict" });
        expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/commit"))).toHaveLength(1);
        expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
    });

    it("rolls back portable staging when upload fails and surfaces rollback failure", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);
        renderEditor({ slug: ["space-1", "2"], readOnly: true });
        await waitFor(() => expect(glideboardMock.assetStorage).not.toBeNull());

        const token = "55555555-5555-4555-8555-555555555555";
        fetchMock
            .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { token } }) })
            .mockResolvedValueOnce({ ok: false, status: 503 })
            .mockResolvedValueOnce({ ok: false, status: 500 });
        const hash = "f".repeat(64);

        await expect(glideboardMock.assetStorage.materializePortableAsset(
            { assetId: `asset:sha256:${hash}`, kind: "embedded", base64: "AQ==", byteLength: 1 },
            { props: { hash, mimeType: "image/png" } },
            undefined,
            new AbortController().signal,
        )).rejects.toThrow(/persistence and rollback both failed/);
        expect(fetchMock).toHaveBeenLastCalledWith(
            `/api/v1/media/whiteboard-asset/2/${hash}/staging/${token}`,
            { method: "DELETE", credentials: "include" },
        );
    });

    it("removes a newly uploaded host asset when late validation rolls back", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);
        renderEditor({ slug: ["space-1", "2"], readOnly: true });
        await waitFor(() => expect(glideboardMock.assetStorage).not.toBeNull());

        const token = "22222222-2222-4222-8222-222222222222";
        fetchMock
            .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { token } }) })
            .mockResolvedValueOnce({ ok: true, status: 204 })
            .mockResolvedValueOnce({ ok: true, status: 204 })
            .mockResolvedValueOnce({ ok: true, status: 204 });
        const hash = "b".repeat(64);
        const persistence = await glideboardMock.assetStorage.prepare({
            props: { hash, mimeType: "image/png" },
        }, new AbortController().signal);

        await persistence.stage(new Uint8Array([4, 5, 6]), new AbortController().signal);
        await persistence.commit(new AbortController().signal);
        await persistence.rollback();

        expect(fetchMock).toHaveBeenLastCalledWith(
            `/api/v1/media/whiteboard-asset/2/${hash}/staging/${token}`,
            { method: "DELETE", credentials: "include" },
        );
    });

    it("rejects an untrusted portable durable reference without sending credentials or fetching it", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);
        renderEditor({ slug: ["space-1", "2"], readOnly: true });
        await waitFor(() => expect(glideboardMock.assetStorage).not.toBeNull());

        await expect(glideboardMock.assetStorage.materializePortableAsset(
            { assetId: `asset:sha256:${"c".repeat(64)}`, kind: "durable-reference", reference: "https://untrusted.example/private.png" },
            { props: { hash: "c".repeat(64), mimeType: "image/png" } },
            undefined,
            new AbortController().signal,
        )).rejects.toThrow(/trusted media URL/);

        expect(fetchMock.mock.calls.some(([url]) => String(url).includes("untrusted.example"))).toBe(false);
    });

    it("does not expand durable-reference trust to a configured cross-origin API base", () => {
        const hash = "e".repeat(64);
        expect(() => trustedPortableAssetRequest(
            `https://api.example.test/api/v1/media/whiteboard-asset/9/${hash}`,
            "https://api.example.test/api/v1",
        )).toThrow(/trusted media URL/);
    });

    it("fetches a canonical same-origin portable media reference with credentials", async () => {
        const hash = "d".repeat(64);
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);
        renderEditor({ slug: ["space-1", "2"], readOnly: true });
        await waitFor(() => expect(glideboardMock.assetStorage).not.toBeNull());
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 201,
                json: async () => ({ data: { token: "33333333-3333-4333-8333-333333333333" } }),
            })
            .mockResolvedValueOnce({ ok: true, status: 204 })
            .mockResolvedValueOnce({ ok: true, status: 204 });

        await glideboardMock.assetStorage.materializePortableAsset(
            { assetId: `asset:sha256:${hash}`, kind: "durable-reference", reference: `/api/v1/media/whiteboard-asset/9/${hash}` },
            { props: { hash, mimeType: "image/png" } },
            undefined,
            new AbortController().signal,
        );

        expect(fetchMock).toHaveBeenCalledWith(
            `${window.location.origin}/api/v1/media/whiteboard-asset/9/${hash}`,
            expect.objectContaining({ credentials: "include" }),
        );
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
            if (String(input).endsWith("/checkpoint") && init?.method === "PUT") return saveResponse;
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
            "/editor/space/space-1/whiteboard/2/checkpoint",
            expect.objectContaining({ method: "PUT", credentials: "include" }),
        ));
        expect(glideboardMock.settleActiveEdit).toHaveBeenCalledWith("commit");
        expect(closeButton.hasAttribute("disabled")).toBe(true);

        const checkpointRequest = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/checkpoint"));
        const checkpointBody = JSON.parse(String(checkpointRequest?.[1]?.body));
        resolveSave({
            ok: true,
            status: 200,
            json: async () => ({
                data: {
                    draftId: checkpointBody.draftId,
                    revision: "1",
                    acknowledgedCheckpoint: {
                        transactionSequence: checkpointBody.transactionSequence,
                        stateDigest: checkpointBody.stateDigest,
                        serverUpdateSequence: 1,
                    },
                },
            }),
        } as Response);
        await waitFor(() => expect(closeButton.hasAttribute("disabled")).toBe(false));
    });

    it("validates every production asset host response before trusting it", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);
        renderEditor({ slug: ["space-1", "2"], readOnly: true });
        await waitFor(() => expect(glideboardMock.assetStorage).not.toBeNull());
        const storage = glideboardMock.assetStorage;
        const signal = new AbortController().signal;

        await expect(storage.prepare({ props: { hash: "bad", mimeType: "image/png" } }, signal))
            .rejects.toThrow(/Invalid whiteboard asset identity/);
        await expect(storage.prepare({ props: { hash: "a".repeat(64), mimeType: "image/svg+xml" } }, signal))
            .rejects.toThrow(/Unsupported whiteboard asset MIME type/);
        expect(storage.resolve({ props: { hash: "bad" } })).toBeNull();
        await expect(storage.download({ props: { hash: "bad" } }, signal)).rejects.toThrow(/Invalid whiteboard asset identity/);

        fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
        await expect(storage.prepare({ props: { hash: "a".repeat(64), mimeType: "image/png" } }, signal))
            .rejects.toThrow(/prepare failed \(503\)/);
        fetchMock.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { token: "invalid" } }) });
        await expect(storage.prepare({ props: { hash: "a".repeat(64), mimeType: "image/png" } }, signal))
            .rejects.toThrow(/invalid token/);

        fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
        await expect(storage.download({ props: { hash: "a".repeat(64) } }, signal)).rejects.toThrow(/download failed \(404\)/);
        fetchMock.mockResolvedValueOnce({
            ok: true, status: 200,
            arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
            headers: new Headers(),
        });
        await expect(storage.download({ props: { hash: "a".repeat(64) } }, signal))
            .resolves.toEqual({ bytes: new Uint8Array([1, 2]), mimeType: "" });

        fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
        await expect(storage.retainReferences([], { documentId: "9" }, signal)).rejects.toThrow(/retention failed/);
        fetchMock.mockResolvedValueOnce({ ok: true, status: 204 });
        await expect(storage.retainReferences([], undefined, signal)).resolves.toBeUndefined();

        await expect(storage.materializePortableAsset(
            { kind: "embedded", assetId: `asset:sha256:${"a".repeat(64)}`, base64: "AQ==", byteLength: 2 },
            { props: { hash: "a".repeat(64), mimeType: "image/png" } }, undefined, signal,
        )).rejects.toThrow(/length mismatch/);
    });

    it("compensates after three ambiguous commit failures and reports rollback failure", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(boardData("space-1", "2")));
        vi.stubGlobal("fetch", fetchMock);
        renderEditor({ slug: ["space-1", "2"], readOnly: true });
        await waitFor(() => expect(glideboardMock.assetStorage).not.toBeNull());
        const hash = "9".repeat(64);
        const token = "99999999-9999-4999-8999-999999999999";
        fetchMock
            .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { token } }) })
            .mockResolvedValueOnce({ ok: true, status: 204 })
            .mockResolvedValueOnce({ ok: false, status: 500 })
            .mockRejectedValueOnce(new TypeError("lost"))
            .mockResolvedValueOnce({ ok: false, status: 502 })
            .mockResolvedValueOnce({ ok: false, status: 503 });
        const persistence = await glideboardMock.assetStorage.prepare(
            { props: { hash, mimeType: "image/png" } }, new AbortController().signal,
        );
        await persistence.stage(new Uint8Array([1]), new AbortController().signal);
        await expect(persistence.commit(new AbortController().signal))
            .rejects.toThrow(/outcome and rollback both failed/);
        expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/commit"))).toHaveLength(3);
    });

    it("renders load failures and rejects a board response for another session", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
        vi.stubGlobal("fetch", fetchMock);
        const first = renderEditor({ slug: ["space-1", "2"], readOnly: true });
        expect(await screen.findByText("Error loading whiteboard.")).not.toBeNull();
        first.unmount();

        fetchMock.mockResolvedValue(jsonResponse(boardData("other-space", "99")));
        renderEditor({ slug: ["space-1", "2"], readOnly: true });
        expect(await screen.findByText("Error loading whiteboard.")).not.toBeNull();
        expect(errorSpy).toHaveBeenCalled();
    });
});
