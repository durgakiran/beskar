import type {
    CollaborationCheckpointSource,
    DurabilityCheckpoint,
    DurabilityStatus,
    ProjectedYjsState,
    ProjectionTarget,
    RecoveryWrite,
    YjsPersistenceAdapter,
    YjsRecoveryAdapter,
    YjsSaveResult,
} from "./types";
import {
    DurabilityConflictError,
    DurabilityDisposedError,
    DurabilityTargetError,
} from "./types";

interface CoordinatorOptions {
    sessionKey: string;
    draftId: string;
    clientId: string;
    durableRevision: string;
    acknowledgedStateDigest?: string;
    acknowledgedServerUpdateSequence?: number;
    persistence: YjsPersistenceAdapter;
    recovery: YjsRecoveryAdapter;
    resolveConflict?: (remoteState: Uint8Array, localState: Uint8Array) => Promise<ProjectionTarget>;
    debounceMs?: number;
    retryBaseMs?: number;
    retryMaxMs?: number;
    random?: () => number;
}

interface GenerationRecord extends RecoveryWrite {
    localPromise: Promise<boolean>;
    requestId: string;
}

type StatusListener = () => void;

function targetKey(target: ProjectionTarget): string {
    return `${target.storeRevision}:${target.yjs.transactionSequence}:${target.yjs.stateDigest}`;
}

function copyTarget(target: ProjectionTarget): ProjectionTarget {
    return Object.freeze({
        storeRevision: target.storeRevision,
        yjs: Object.freeze({ ...target.yjs }),
    });
}

function copyStatus(status: DurabilityStatus): DurabilityStatus {
    return Object.freeze({ ...status });
}

async function sha256(bytes: Uint8Array): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error("Whiteboard durability requires Web Crypto SHA-256 support.");
    const digest = await subtle.digest("SHA-256", Uint8Array.from(bytes));
    return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

function requestId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `whiteboard-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class YjsDurabilityCoordinator {
    private sessionKey: string;
    private draftId: string;
    private durableRevision: string;
    private readonly clientId: string;
    private readonly persistence: YjsPersistenceAdapter;
    private readonly recovery: YjsRecoveryAdapter;
    private readonly resolveConflict?: CoordinatorOptions["resolveConflict"];
    private readonly debounceMs: number;
    private readonly retryBaseMs: number;
    private readonly retryMaxMs: number;
    private readonly random: () => number;
    private readonly acknowledgedStateDigest?: string;
    private readonly acknowledgedServerUpdateSequence?: number;
    private status: DurabilityStatus;
    private readonly statusListeners = new Set<StatusListener>();
    private readonly records = new Map<string, GenerationRecord>();
    private readonly acknowledgedStates = new Map<string, Uint8Array>();
    private latestRecord: GenerationRecord | null = null;
    private generation = 0;
    private initialProjectionHandled = false;
    private projectionQuarantined = false;
    private serverAcknowledgedGeneration = 0;
    private retryAttempt = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private inFlight: Promise<DurabilityCheckpoint> | null = null;
    private abortController: AbortController | null = null;
    private unsubscribeCheckpoints: (() => void) | null = null;
    private processing: Promise<void> = Promise.resolve();
    private disposed = false;

    constructor(options: CoordinatorOptions) {
        this.sessionKey = options.sessionKey;
        this.draftId = options.draftId;
        this.clientId = options.clientId;
        this.durableRevision = options.durableRevision;
        this.persistence = options.persistence;
        this.recovery = options.recovery;
        this.resolveConflict = options.resolveConflict;
        this.debounceMs = options.debounceMs ?? 750;
        this.retryBaseMs = options.retryBaseMs ?? 500;
        this.retryMaxMs = options.retryMaxMs ?? 10_000;
        this.random = options.random ?? Math.random;
        this.acknowledgedStateDigest = options.acknowledgedStateDigest || undefined;
        this.acknowledgedServerUpdateSequence = options.acknowledgedServerUpdateSequence;
        this.status = copyStatus({
            phase: "clean",
            latestGeneration: 0,
            localRecovery: "acknowledged",
            localCheckpointGeneration: 0,
            durableRevision: options.durableRevision,
        });
    }

    getSnapshot = (): DurabilityStatus => this.status;

    getDraftId = (): string => this.draftId;

    subscribeStatus = (listener: StatusListener): (() => void) => {
        this.statusListeners.add(listener);
        return () => this.statusListeners.delete(listener);
    };

    attach(source: CollaborationCheckpointSource): () => void {
        this.assertActive();
        this.unsubscribeCheckpoints?.();
        const unsubscribeStates = source.subscribe(state => {
            void this.acceptProjectedState(state).catch(() => {
                // Status exposes verification/recovery failure to the host UI.
            });
        });
        const updateProjectionStatus = (projection: "healthy" | "catching-up" | "quarantined" | "incompatible" | "failed") => {
            if (projection === "healthy" || projection === "catching-up") return;
            this.projectionQuarantined = true;
            this.cancelTimer();
            this.setStatus({
                phase: "quarantined",
                error: new DurabilityTargetError(`Glideboard's Yjs projection is ${projection}.`),
            });
        };
        if (source.status) updateProjectionStatus(source.status.peek());
        const unsubscribeProjection = source.status?.subscribe(updateProjectionStatus) ?? (() => {});
        const unsubscribe = () => {
            unsubscribeStates();
            unsubscribeProjection();
        };
        this.unsubscribeCheckpoints = unsubscribe;
        return () => {
            unsubscribe();
            if (this.unsubscribeCheckpoints === unsubscribe) this.unsubscribeCheckpoints = null;
        };
    }

    acceptProjectedState(state: ProjectedYjsState): Promise<void> {
        this.assertActive();
        if (this.projectionQuarantined) {
            return Promise.reject(new DurabilityTargetError("Glideboard's Yjs projection is quarantined."));
        }
        const encodedState = state.encodedState.slice();
        const target = copyTarget(state.target);
        const operation = this.processing.catch(() => {}).then(async () => {
            const actualDigest = await sha256(encodedState);
            if (actualDigest !== target.yjs.stateDigest) {
                const error = new DurabilityTargetError("Projected Yjs bytes do not match their checkpoint digest.");
                this.projectionQuarantined = true;
                this.setStatus({ phase: "quarantined", error });
                throw error;
            }

            if (this.records.has(targetKey(target))) return;

            const isInitialProjection = !this.initialProjectionHandled;
            this.initialProjectionHandled = true;
            if (
                isInitialProjection &&
                this.acknowledgedStateDigest === actualDigest
            ) {
                const write: GenerationRecord = Object.freeze({
                    sessionKey: this.sessionKey,
                    draftId: this.draftId,
                    generation: 0,
                    target,
                    encodedState,
                    localPromise: Promise.resolve(true),
                    requestId: requestId(),
                });
                this.records.set(targetKey(target), write);
                this.latestRecord = write;
                this.acknowledgedStates.set(targetKey(target), encodedState.slice());
                this.setStatus({
                    phase: "clean",
                    acknowledgedYjsCheckpoint: {
                        ...target.yjs,
                        serverUpdateSequence: this.acknowledgedServerUpdateSequence,
                    },
                });
                return;
            }

            const generation = ++this.generation;
            const write: RecoveryWrite = Object.freeze({
                sessionKey: this.sessionKey,
                draftId: this.draftId,
                generation,
                target,
                encodedState,
            });
            const localPromise = this.recovery.persist(write).then(() => {
                if (this.disposed || write.sessionKey !== this.sessionKey || write.draftId !== this.draftId) return true;
                this.setStatus({
                    localRecovery: "acknowledged",
                    localCheckpointGeneration: Math.max(this.status.localCheckpointGeneration ?? 0, generation),
                });
                return true;
            }).catch(error => {
                if (!this.disposed) this.setStatus({ phase: "error", localRecovery: "error", error: asError(error) });
                return false;
            });
            const record: GenerationRecord = Object.freeze({ ...write, localPromise, requestId: requestId() });
            this.records.set(targetKey(target), record);
            this.latestRecord = record;
            this.retryAttempt = 0;
            this.setStatus({
                phase: "dirty",
                latestGeneration: generation,
                localRecovery: "pending",
                error: undefined,
                remoteRevision: undefined,
            });
            this.scheduleAutomaticSave(this.debounceMs);
        }).catch(error => {
            if (!this.disposed && this.status.phase !== "quarantined") {
                this.setStatus({ phase: "error", error: asError(error) });
            }
            throw error;
        });
        this.processing = operation.catch(() => {});
        return operation;
    }

    async flush(target: ProjectionTarget): Promise<DurabilityCheckpoint> {
        this.assertActive();
        if (this.projectionQuarantined) {
            throw new DurabilityTargetError("Cannot flush a quarantined Yjs projection.");
        }
        this.cancelTimer();
        await this.processing;
        const record = this.records.get(targetKey(target));
        if (!record) throw new DurabilityTargetError("The requested Glideboard projection target was not captured by this durability session.");
        if (record.generation < this.serverAcknowledgedGeneration) {
            throw new DurabilityTargetError("The requested projection target has been superseded by a newer server revision.");
        }
        return this.persistRecord(record);
    }

    getAcknowledgedState(checkpoint: DurabilityCheckpoint): Uint8Array {
        const state = this.acknowledgedStates.get(targetKey({
            storeRevision: checkpoint.storeRevision,
            yjs: checkpoint.yjs,
        }));
        if (!state) throw new DurabilityTargetError("No acknowledged encoded state exists for this checkpoint.");
        return state.slice();
    }

    async advanceDraft(
        next: { sessionKey: string; draftId: string; durableRevision: string },
        baseline: DurabilityCheckpoint,
    ): Promise<void> {
        this.assertActive();
        this.cancelTimer();
        this.abortController?.abort();
        await this.processing;
        await this.inFlight?.catch(() => {});
        this.cancelTimer();
        const oldTarget = { storeRevision: baseline.storeRevision, yjs: baseline.yjs };
        const encodedState = this.acknowledgedStates.get(targetKey(oldTarget));
        if (!encodedState) throw new DurabilityTargetError("Cannot advance a draft without its acknowledged baseline state.");
        const baselineRecord = this.records.get(targetKey(oldTarget));
        if (!baselineRecord) throw new DurabilityTargetError("Cannot locate the published generation in this durability session.");
        const projectedAfterPublish = [...this.records.values()]
            .filter(record => record.generation > baselineRecord.generation)
            .sort((left, right) => left.generation - right.generation)
            .map(record => ({ target: record.target, encodedState: record.encodedState.slice() }));
        this.sessionKey = next.sessionKey;
        this.draftId = next.draftId;
        this.durableRevision = next.durableRevision;
        this.recovery.advanceDraft(next.sessionKey, next.draftId);
        this.generation = 0;
        this.initialProjectionHandled = true;
        this.serverAcknowledgedGeneration = 0;
        this.records.clear();
        this.acknowledgedStates.clear();
        const target = copyTarget({
            storeRevision: baseline.storeRevision,
            yjs: {
                transactionSequence: baseline.yjs.transactionSequence,
                stateDigest: baseline.yjs.stateDigest,
            },
        });
        const record: GenerationRecord = Object.freeze({
            sessionKey: next.sessionKey,
            draftId: next.draftId,
            generation: 0,
            target,
            encodedState: encodedState.slice(),
            localPromise: Promise.resolve(true),
            requestId: requestId(),
        });
        this.records.set(targetKey(target), record);
        this.acknowledgedStates.set(targetKey(target), encodedState.slice());
        this.latestRecord = record;
        this.setStatus({
            phase: "clean",
            latestGeneration: 0,
            localRecovery: "acknowledged",
            localCheckpointGeneration: 0,
            durableRevision: next.durableRevision,
            acknowledgedYjsCheckpoint: {
                transactionSequence: baseline.yjs.transactionSequence,
                stateDigest: baseline.yjs.stateDigest,
                serverUpdateSequence: 0,
            },
            error: undefined,
            remoteRevision: undefined,
        });
        for (const projected of projectedAfterPublish) {
            await this.acceptProjectedState(projected);
        }
    }

    async adoptAuthoritativeDraft(
        next: { sessionKey: string; draftId: string; durableRevision: string },
        mergedTarget: ProjectionTarget,
    ): Promise<void> {
        this.assertActive();
        this.cancelTimer();
        this.abortController?.abort();
        await this.processing;
        await this.inFlight?.catch(() => {});
        this.cancelTimer();
        const merged = this.records.get(targetKey(mergedTarget));
        if (!merged) throw new DurabilityTargetError("The authoritative draft transition is missing its merged projection.");

        this.sessionKey = next.sessionKey;
        this.draftId = next.draftId;
        this.durableRevision = next.durableRevision;
        this.recovery.advanceDraft(next.sessionKey, next.draftId);
        this.generation = 1;
        this.initialProjectionHandled = true;
        this.serverAcknowledgedGeneration = 0;
        this.records.clear();
        this.acknowledgedStates.clear();
        const write: RecoveryWrite = Object.freeze({
            sessionKey: next.sessionKey,
            draftId: next.draftId,
            generation: 1,
            target: copyTarget(mergedTarget),
            encodedState: merged.encodedState.slice(),
        });
        const localPromise = this.recovery.persist(write).then(() => {
            if (!this.disposed && this.sessionKey === next.sessionKey && this.draftId === next.draftId) {
                this.setStatus({ localRecovery: "acknowledged", localCheckpointGeneration: 1 });
            }
            return true;
        }).catch(error => {
            if (!this.disposed && this.sessionKey === next.sessionKey && this.draftId === next.draftId) {
                this.setStatus({ localRecovery: "error", error: asError(error) });
            }
            return false;
        });
        const rebased: GenerationRecord = Object.freeze({ ...write, localPromise, requestId: requestId() });
        this.records.set(targetKey(mergedTarget), rebased);
        this.latestRecord = rebased;
        this.setStatus({
            phase: "dirty",
            latestGeneration: 1,
            localRecovery: "pending",
            localCheckpointGeneration: 0,
            durableRevision: next.durableRevision,
            acknowledgedYjsCheckpoint: undefined,
            error: undefined,
            remoteRevision: undefined,
        });
        this.scheduleAutomaticSave(0);
    }

    async dispose(policy: "flush" | "cancel"): Promise<void> {
        if (this.disposed) return;
        this.unsubscribeCheckpoints?.();
        this.unsubscribeCheckpoints = null;
        this.cancelTimer();
        if (policy === "flush" && this.latestRecord) {
            await this.flush(this.latestRecord.target);
        } else if (policy === "cancel") {
            this.abortController?.abort();
        }
        this.disposed = true;
        await this.recovery.dispose();
        this.statusListeners.clear();
    }

    private persistRecord(record: GenerationRecord): Promise<DurabilityCheckpoint> {
        this.assertActive();
        if (record.generation <= this.serverAcknowledgedGeneration) {
            const checkpoint = this.checkpointFor(record, this.status.acknowledgedYjsCheckpoint);
            return Promise.resolve(checkpoint);
        }
        if (this.inFlight) {
            return this.inFlight.then(() => this.persistRecord(record));
        }

        const abortController = new AbortController();
        this.abortController = abortController;
        this.setStatus({ phase: "saving", error: undefined, remoteRevision: undefined });

        let operation!: Promise<DurabilityCheckpoint>;
        operation = (async () => {
            try {
                let savingRecord = record;
                let conflictAttempts = 0;
                while (true) {
                    const locallyRecovered = await savingRecord.localPromise;
                    try {
                        const result = await this.persistence.save({
                            ...savingRecord,
                            encodedState: savingRecord.encodedState.slice(),
                            clientId: this.clientId,
                            expectedDurableRevision: this.durableRevision,
                            requestId: savingRecord.requestId,
                            signal: abortController.signal,
                        });
                        if (savingRecord.sessionKey !== this.sessionKey || savingRecord.draftId !== this.draftId) {
                            throw new DurabilityTargetError("Ignoring acknowledgement from a superseded whiteboard draft session.");
                        }
                        if (this.projectionQuarantined) {
                            throw new DurabilityTargetError("Cannot acknowledge a quarantined Yjs projection as clean.");
                        }
                        this.validateSaveResult(savingRecord, result);
                        this.durableRevision = result.durableRevision;
                        this.serverAcknowledgedGeneration = savingRecord.generation;
                        this.acknowledgedStates.set(targetKey(savingRecord.target), savingRecord.encodedState.slice());
                        if (locallyRecovered) await this.recovery.clearThrough(savingRecord);
                        this.retryAttempt = 0;
                        const checkpoint = this.checkpointFor(savingRecord, result.acknowledgedCheckpoint);
                        const stillDirty = (this.latestRecord?.generation ?? 0) > savingRecord.generation;
                        this.setStatus({
                            phase: stillDirty ? "dirty" : "clean",
                            durableRevision: result.durableRevision,
                            acknowledgedYjsCheckpoint: result.acknowledgedCheckpoint,
                            error: undefined,
                            remoteRevision: undefined,
                        });
                        return checkpoint;
                    } catch (error) {
                        if (
                            !(error instanceof DurabilityConflictError) ||
                            !error.remoteState ||
                            !this.resolveConflict ||
                            conflictAttempts >= 3
                        ) {
                            throw error;
                        }
                        conflictAttempts += 1;
                        this.setStatus({ phase: "conflict", error, remoteRevision: error.remoteRevision });
                        this.durableRevision = error.remoteRevision;
                        const mergedTarget = await this.resolveConflict(
                            error.remoteState.slice(),
                            savingRecord.encodedState.slice(),
                        );
                        await this.processing;
                        const mergedRecord = this.records.get(targetKey(mergedTarget));
                        if (!mergedRecord || mergedRecord.generation <= savingRecord.generation) {
                            throw new DurabilityTargetError("Conflict merge did not produce a newer Glideboard projection checkpoint.");
                        }
                        savingRecord = mergedRecord;
                        this.setStatus({ phase: "saving", error: undefined, remoteRevision: undefined });
                    }
                }
            } catch (error) {
                if (error instanceof DurabilityConflictError) {
                    this.setStatus({ phase: "conflict", error, remoteRevision: error.remoteRevision });
                } else if (
                    !abortController.signal.aborted &&
                    record.sessionKey === this.sessionKey &&
                    record.draftId === this.draftId
                ) {
                    this.setStatus({ phase: navigatorOnline() ? "error" : "offline", error: asError(error) });
                }
                throw error;
            } finally {
                if (this.inFlight === operation) this.inFlight = null;
                if (this.abortController === abortController) this.abortController = null;
                if (!this.disposed && this.latestRecord && this.latestRecord.generation > this.serverAcknowledgedGeneration) {
                    this.scheduleRetry();
                }
            }
        })();
        this.inFlight = operation;
        return operation;
    }

    private validateSaveResult(record: GenerationRecord, result: YjsSaveResult): void {
        if (result.draftId !== record.draftId) {
            throw new DurabilityTargetError("Server acknowledgement returned a different draft identity.");
        }
        if (!result.durableRevision) {
            throw new DurabilityTargetError("Server acknowledgement omitted the durable revision.");
        }
        if (
            result.acknowledgedCheckpoint.stateDigest !== record.target.yjs.stateDigest ||
            result.acknowledgedCheckpoint.transactionSequence !== record.target.yjs.transactionSequence
        ) {
            throw new DurabilityTargetError("Server acknowledgement does not match the saved Yjs checkpoint.");
        }
    }

    private checkpointFor(record: GenerationRecord, acknowledged?: YjsSaveResult["acknowledgedCheckpoint"]): DurabilityCheckpoint {
        if (!acknowledged) throw new DurabilityTargetError("The projection target has no server acknowledgement.");
        return Object.freeze({
            sessionKey: record.sessionKey,
            draftId: record.draftId,
            storeRevision: record.target.storeRevision,
            durableRevision: this.durableRevision,
            yjs: Object.freeze({ ...acknowledged }),
        });
    }

    private scheduleAutomaticSave(delayMs: number): void {
        this.cancelTimer();
        if (this.disposed || !this.latestRecord || this.inFlight) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            const record = this.latestRecord;
            if (!record || record.generation <= this.serverAcknowledgedGeneration) return;
            void this.persistRecord(record).catch(() => {});
        }, Math.max(0, delayMs));
    }

    private scheduleRetry(): void {
        if (this.status.phase === "conflict" || this.status.phase === "quarantined") return;
        this.retryAttempt += 1;
        const exponential = Math.min(this.retryMaxMs, this.retryBaseMs * (2 ** (this.retryAttempt - 1)));
        const jitter = 0.75 + (this.random() * 0.5);
        this.scheduleAutomaticSave(Math.round(exponential * jitter));
    }

    private cancelTimer(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    private setStatus(patch: Partial<DurabilityStatus>): void {
        this.status = copyStatus({ ...this.status, ...patch });
        for (const listener of [...this.statusListeners]) listener();
    }

    private assertActive(): void {
        if (this.disposed) throw new DurabilityDisposedError();
    }
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

function navigatorOnline(): boolean {
    return typeof navigator === "undefined" || navigator.onLine !== false;
}
