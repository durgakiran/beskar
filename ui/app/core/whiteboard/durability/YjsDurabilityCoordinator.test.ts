import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    DurabilityConflictError,
    type ProjectedYjsState,
    type RecoveryWrite,
    type YjsPersistenceAdapter,
    type YjsRecoveryAdapter,
    type YjsSaveResult,
} from "./types";
import { YjsDurabilityCoordinator } from "./YjsDurabilityCoordinator";

async function projectedState(storeRevision: number, transactionSequence: number, marker: number): Promise<ProjectedYjsState> {
    const encodedState = new Uint8Array([marker]);
    const digest = await crypto.subtle.digest("SHA-256", encodedState);
    const stateDigest = `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
    return {
        target: { storeRevision, yjs: { transactionSequence, stateDigest } },
        encodedState,
    };
}

function createRecovery() {
    const writes: RecoveryWrite[] = [];
    const recovery: YjsRecoveryAdapter = {
        hydrate: vi.fn(async () => null),
        persist: vi.fn(async write => { writes.push(write); }),
        clearThrough: vi.fn(async () => {}),
        advanceDraft: vi.fn(),
        dispose: vi.fn(async () => {}),
    };
    return { recovery, writes };
}

describe("YjsDurabilityCoordinator", () => {
    beforeEach(() => vi.useFakeTimers());

    it("marks clean only after local and matching server acknowledgement", async () => {
        const { recovery } = createRecovery();
        const persistence: YjsPersistenceAdapter = {
            save: vi.fn(async request => ({
                draftId: request.draftId,
                durableRevision: "rev-2",
                acknowledgedCheckpoint: {
                    ...request.target.yjs,
                    serverUpdateSequence: 12,
                },
            })),
        };
        const coordinator = new YjsDurabilityCoordinator({
            sessionKey: "account:space:page:draft-1",
            draftId: "draft-1",
            clientId: "client-1",
            durableRevision: "rev-1",
            persistence,
            recovery,
            debounceMs: 20,
        });
        const state = await projectedState(4, 8, 1);

        await coordinator.acceptProjectedState(state);
        expect(coordinator.getSnapshot().phase).toBe("dirty");
        await vi.advanceTimersByTimeAsync(20);

        expect(persistence.save).toHaveBeenCalledTimes(1);
        expect(coordinator.getSnapshot()).toMatchObject({
            phase: "clean",
            durableRevision: "rev-2",
            localRecovery: "acknowledged",
            localCheckpointGeneration: 1,
        });
        const checkpoint = await coordinator.flush(state.target);
        expect(checkpoint.storeRevision).toBe(4);
        expect(coordinator.getAcknowledgedState(checkpoint)).toEqual(new Uint8Array([1]));
    });

    it("does not mark a newer generation clean when an older request completes", async () => {
        const { recovery } = createRecovery();
        let resolveFirst!: (value: YjsSaveResult) => void;
        const persistence: YjsPersistenceAdapter = {
            save: vi.fn(request => {
                if (request.generation === 1) {
                    return new Promise<YjsSaveResult>(resolve => { resolveFirst = resolve; });
                }
                return Promise.resolve({
                    draftId: request.draftId,
                    durableRevision: `rev-${request.generation}`,
                    acknowledgedCheckpoint: { ...request.target.yjs },
                });
            }),
        };
        const coordinator = new YjsDurabilityCoordinator({
            sessionKey: "session",
            draftId: "draft",
            clientId: "client",
            durableRevision: "rev-0",
            persistence,
            recovery,
            debounceMs: 10,
            retryBaseMs: 1,
            random: () => 0.5,
        });
        const first = await projectedState(1, 1, 1);
        const second = await projectedState(2, 2, 2);

        await coordinator.acceptProjectedState(first);
        await vi.advanceTimersByTimeAsync(10);
        await coordinator.acceptProjectedState(second);
        resolveFirst({
            draftId: "draft",
            durableRevision: "rev-1",
            acknowledgedCheckpoint: { ...first.target.yjs },
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(coordinator.getSnapshot().phase).not.toBe("clean");
        await vi.runAllTimersAsync();
        expect(persistence.save).toHaveBeenCalledTimes(2);
        expect(coordinator.getSnapshot().phase).toBe("clean");
        expect(coordinator.getSnapshot().latestGeneration).toBe(2);
    });

    it("enters conflict state without overwriting or retrying automatically", async () => {
        const { recovery } = createRecovery();
        const persistence: YjsPersistenceAdapter = {
            save: vi.fn(async () => { throw new DurabilityConflictError("rev-remote"); }),
        };
        const coordinator = new YjsDurabilityCoordinator({
            sessionKey: "session",
            draftId: "draft",
            clientId: "client",
            durableRevision: "rev-local",
            persistence,
            recovery,
            debounceMs: 5,
        });
        const state = await projectedState(1, 1, 9);

        await coordinator.acceptProjectedState(state);
        await vi.advanceTimersByTimeAsync(5);

        expect(coordinator.getSnapshot()).toMatchObject({
            phase: "conflict",
            remoteRevision: "rev-remote",
        });
        await vi.runAllTimersAsync();
        expect(persistence.save).toHaveBeenCalledTimes(1);
    });

    it("seeds the acknowledged checkpoint as generation zero for the next draft", async () => {
        const { recovery } = createRecovery();
        const persistence: YjsPersistenceAdapter = {
            save: vi.fn(async request => ({
                draftId: request.draftId,
                durableRevision: "1",
                acknowledgedCheckpoint: { ...request.target.yjs, serverUpdateSequence: 1 },
            })),
        };
        const coordinator = new YjsDurabilityCoordinator({
            sessionKey: "session:draft-1",
            draftId: "draft-1",
            clientId: "client",
            durableRevision: "0",
            persistence,
            recovery,
        });
        const state = await projectedState(3, 5, 4);
        await coordinator.acceptProjectedState(state);
        const published = await coordinator.flush(state.target);

        await coordinator.advanceDraft({
            sessionKey: "session:draft-2",
            draftId: "draft-2",
            durableRevision: "0",
        }, published);
        const nextDraftCheckpoint = await coordinator.flush(state.target);

        expect(nextDraftCheckpoint).toMatchObject({
            sessionKey: "session:draft-2",
            draftId: "draft-2",
            durableRevision: "0",
            yjs: { serverUpdateSequence: 0 },
        });
        expect(persistence.save).toHaveBeenCalledTimes(1);
        expect(recovery.advanceDraft).toHaveBeenCalledWith("session:draft-2", "draft-2");
    });

    it("reuses the idempotency key when an ambiguous save is retried", async () => {
        const { recovery } = createRecovery();
        const requestIds: string[] = [];
        let attempt = 0;
        const persistence: YjsPersistenceAdapter = {
            save: vi.fn(async request => {
                requestIds.push(request.requestId);
                attempt += 1;
                if (attempt === 1) throw new Error("response lost");
                return {
                    draftId: request.draftId,
                    durableRevision: "1",
                    acknowledgedCheckpoint: { ...request.target.yjs, serverUpdateSequence: 1 },
                };
            }),
        };
        const coordinator = new YjsDurabilityCoordinator({
            sessionKey: "session",
            draftId: "draft",
            clientId: "client",
            durableRevision: "0",
            persistence,
            recovery,
            debounceMs: 1,
            retryBaseMs: 1,
            random: () => 0.5,
        });
        await coordinator.acceptProjectedState(await projectedState(1, 1, 7));

        await vi.runAllTimersAsync();

        expect(requestIds).toHaveLength(2);
        expect(requestIds[1]).toBe(requestIds[0]);
        expect(coordinator.getSnapshot().phase).toBe("clean");
    });

    it("rebases projections that arrive while publish is completing onto the next draft", async () => {
        const { recovery } = createRecovery();
        const savedDrafts: string[] = [];
        const persistence: YjsPersistenceAdapter = {
            save: vi.fn(async request => {
                savedDrafts.push(request.draftId);
                return {
                    draftId: request.draftId,
                    durableRevision: "1",
                    acknowledgedCheckpoint: { ...request.target.yjs, serverUpdateSequence: 1 },
                };
            }),
        };
        const coordinator = new YjsDurabilityCoordinator({
            sessionKey: "session:draft-1",
            draftId: "draft-1",
            clientId: "client",
            durableRevision: "0",
            persistence,
            recovery,
            debounceMs: 100,
        });
        const publishedState = await projectedState(1, 1, 1);
        await coordinator.acceptProjectedState(publishedState);
        const published = await coordinator.flush(publishedState.target);
        const duringPublish = await projectedState(2, 2, 2);
        await coordinator.acceptProjectedState(duringPublish);

        await coordinator.advanceDraft({
            sessionKey: "session:draft-2",
            draftId: "draft-2",
            durableRevision: "0",
        }, published);
        await coordinator.flush(duringPublish.target);

        expect(savedDrafts).toEqual(["draft-1", "draft-2"]);
        expect(coordinator.getSnapshot().phase).toBe("clean");
    });

    it("merges a revision conflict into a newer projection and retries automatically", async () => {
        const { recovery } = createRecovery();
        let attempts = 0;
        const persistence: YjsPersistenceAdapter = {
            save: vi.fn(async request => {
                attempts += 1;
                if (attempts === 1) {
                    throw new DurabilityConflictError("1", new Uint8Array([8]));
                }
                return {
                    draftId: request.draftId,
                    durableRevision: "2",
                    acknowledgedCheckpoint: { ...request.target.yjs, serverUpdateSequence: 2 },
                };
            }),
        };
        let coordinator!: YjsDurabilityCoordinator;
        coordinator = new YjsDurabilityCoordinator({
            sessionKey: "session",
            draftId: "draft",
            clientId: "client",
            durableRevision: "0",
            persistence,
            recovery,
            resolveConflict: async () => {
                const merged = await projectedState(2, 2, 9);
                await coordinator.acceptProjectedState(merged);
                return merged.target;
            },
        });
        const local = await projectedState(1, 1, 7);
        await coordinator.acceptProjectedState(local);

        const checkpoint = await coordinator.flush(local.target);

        expect(attempts).toBe(2);
        expect(checkpoint).toMatchObject({ storeRevision: 2, durableRevision: "2" });
        expect(coordinator.getSnapshot().phase).toBe("clean");
    });

    it("adopts a server-verified peer draft transition and saves the merged projection", async () => {
        const { recovery } = createRecovery();
        const savedDrafts: string[] = [];
        const persistence: YjsPersistenceAdapter = {
            save: vi.fn(async request => {
                savedDrafts.push(request.draftId);
                return {
                    draftId: request.draftId,
                    durableRevision: "1",
                    acknowledgedCheckpoint: { ...request.target.yjs, serverUpdateSequence: 1 },
                };
            }),
        };
        const coordinator = new YjsDurabilityCoordinator({
            sessionKey: "session:old",
            draftId: "old",
            clientId: "client",
            durableRevision: "4",
            persistence,
            recovery,
            debounceMs: 100,
        });
        const merged = await projectedState(8, 9, 3);
        await coordinator.acceptProjectedState(merged);

        await coordinator.adoptAuthoritativeDraft({
            sessionKey: "session:new",
            draftId: "new",
            durableRevision: "0",
        }, merged.target);
        await coordinator.flush(merged.target);

        expect(savedDrafts).toEqual(["new"]);
        expect(coordinator.getDraftId()).toBe("new");
        expect(recovery.advanceDraft).toHaveBeenCalledWith("session:new", "new");
    });
});
