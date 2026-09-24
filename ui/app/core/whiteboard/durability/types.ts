export interface YjsProjectionCheckpoint {
    readonly transactionSequence: number;
    readonly stateDigest: string;
    readonly serverUpdateSequence?: number;
}

export interface ProjectionTarget {
    readonly storeRevision: number;
    readonly yjs: Pick<YjsProjectionCheckpoint, "transactionSequence" | "stateDigest">;
}

export interface ProjectedYjsState {
    readonly target: ProjectionTarget;
    readonly encodedState: Uint8Array;
}

export interface CollaborationCheckpointSource {
    readonly status?: {
        peek(): "healthy" | "catching-up" | "quarantined" | "incompatible" | "failed";
        subscribe(listener: (value: "healthy" | "catching-up" | "quarantined" | "incompatible" | "failed") => void): () => void;
    };
    subscribe(listener: (state: ProjectedYjsState) => void): () => void;
    captureTarget(): Promise<ProjectionTarget>;
}

export interface DurabilityCheckpoint {
    readonly sessionKey: string;
    readonly draftId: string;
    readonly storeRevision: number;
    readonly durableRevision: string;
    readonly yjs: YjsProjectionCheckpoint;
}

export interface RecoveryWrite {
    readonly sessionKey: string;
    readonly draftId: string;
    readonly generation: number;
    readonly target: ProjectionTarget;
    readonly encodedState: Uint8Array;
}

export interface YjsRecoveryAdapter {
    hydrate(doc: Y.Doc): Promise<RecoveryWrite | null>;
    persist(write: RecoveryWrite): Promise<void>;
    clearThrough(write: RecoveryWrite): Promise<void>;
    advanceDraft(sessionKey: string, draftId: string): void;
    dispose(): Promise<void>;
}

export interface YjsSaveRequest extends RecoveryWrite {
    readonly clientId: string;
    readonly expectedDurableRevision: string;
    readonly requestId: string;
    readonly signal: AbortSignal;
}

export interface YjsSaveResult {
    readonly draftId: string;
    readonly durableRevision: string;
    readonly acknowledgedCheckpoint: YjsProjectionCheckpoint;
}

export interface YjsPersistenceAdapter {
    save(request: YjsSaveRequest): Promise<YjsSaveResult>;
}

export interface DurabilityStatus {
    readonly phase: "clean" | "dirty" | "saving" | "offline" | "error" | "conflict" | "quarantined";
    readonly latestGeneration: number;
    readonly localRecovery: "pending" | "acknowledged" | "error";
    readonly localCheckpointGeneration?: number;
    readonly durableRevision: string;
    readonly acknowledgedYjsCheckpoint?: YjsProjectionCheckpoint;
    readonly error?: Error;
    readonly remoteRevision?: string;
}

export class DurabilityConflictError extends Error {
    constructor(
        readonly remoteRevision: string,
        readonly remoteState?: Uint8Array,
    ) {
        super("The whiteboard draft changed on the server.");
        this.name = "DurabilityConflictError";
    }
}

export class DurabilityDisposedError extends Error {
    constructor() {
        super("The whiteboard durability session is disposed.");
        this.name = "DurabilityDisposedError";
    }
}

export class DurabilityTargetError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DurabilityTargetError";
    }
}

export class LocalRecoveryUnavailableError extends Error {
    constructor(message = "Local whiteboard recovery storage is unavailable.") {
        super(message);
        this.name = "LocalRecoveryUnavailableError";
    }
}
import type * as Y from "yjs";
