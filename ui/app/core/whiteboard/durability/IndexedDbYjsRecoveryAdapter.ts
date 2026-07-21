import * as Y from "yjs";
import type { ProjectionTarget, RecoveryWrite, YjsRecoveryAdapter } from "./types";
import { LocalRecoveryUnavailableError } from "./types";

const DATABASE_NAME = "beskar-whiteboard-recovery";
const DATABASE_VERSION = 1;
const STORE_NAME = "checkpoints";
const SESSION_DRAFT_INDEX = "sessionDraft";

export const INDEXED_DB_RECOVERY_ORIGIN = Symbol("indexeddb-whiteboard-recovery");

interface StoredCheckpoint {
    key: string;
    sessionDraft: string;
    sessionKey: string;
    draftId: string;
    generation: number;
    storeRevision: number;
    transactionSequence: number;
    stateDigest: string;
    encodedState: ArrayBuffer;
}

export class IndexedDbYjsRecoveryAdapter implements YjsRecoveryAdapter {
    private sessionDraft: string;
    private readonly database: Promise<IDBDatabase>;
    private disposed = false;

    constructor(
        private sessionKey: string,
        private draftId: string,
        indexedDb: IDBFactory | undefined = globalThis.indexedDB,
    ) {
        if (!indexedDb) throw new LocalRecoveryUnavailableError();
        this.sessionDraft = `${sessionKey}\u0000${draftId}`;
        this.database = openDatabase(indexedDb);
    }

    async hydrate(doc: Y.Doc): Promise<RecoveryWrite | null> {
        this.assertActive();
        const db = await this.database;
        const transaction = db.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME)
            .index(SESSION_DRAFT_INDEX)
            .getAll(IDBKeyRange.only(this.sessionDraft));
        const records = await requestResult<StoredCheckpoint[]>(request);
        await transactionComplete(transaction);
        const latest = records.sort((a, b) => b.generation - a.generation)[0];
        if (!latest) return null;
        const encodedState = new Uint8Array(latest.encodedState.slice(0));
        Y.applyUpdate(doc, encodedState, INDEXED_DB_RECOVERY_ORIGIN);
        return toRecoveryWrite(latest, encodedState);
    }

    async persist(write: RecoveryWrite): Promise<void> {
        this.assertMatchingSession(write);
        const sessionDraft = this.sessionDraft;
        const db = await this.database;
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(toStoredCheckpoint(write, sessionDraft));
        await transactionComplete(transaction);
    }

    async clearThrough(write: RecoveryWrite): Promise<void> {
        this.assertMatchingSession(write);
        const sessionDraft = this.sessionDraft;
        const db = await this.database;
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const index = transaction.objectStore(STORE_NAME).index(SESSION_DRAFT_INDEX);
        const cursorRequest = index.openCursor(IDBKeyRange.only(sessionDraft));
        await new Promise<void>((resolve, reject) => {
            cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("Unable to scan whiteboard recovery checkpoints."));
            cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result;
                if (!cursor) {
                    resolve();
                    return;
                }
                const checkpoint = cursor.value as StoredCheckpoint;
                if (checkpoint.generation <= write.generation) cursor.delete();
                cursor.continue();
            };
        });
        await transactionComplete(transaction);
    }

    advanceDraft(sessionKey: string, draftId: string): void {
        this.assertActive();
        this.sessionKey = sessionKey;
        this.draftId = draftId;
        this.sessionDraft = `${sessionKey}\u0000${draftId}`;
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        const db = await this.database;
        db.close();
    }

    private assertMatchingSession(write: RecoveryWrite): void {
        this.assertActive();
        if (write.sessionKey !== this.sessionKey || write.draftId !== this.draftId) {
            throw new LocalRecoveryUnavailableError("Recovery checkpoint belongs to a different whiteboard draft session.");
        }
    }

    private assertActive(): void {
        if (this.disposed) throw new LocalRecoveryUnavailableError("Local whiteboard recovery storage is disposed.");
    }
}

function openDatabase(indexedDb: IDBFactory): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            const store = db.objectStoreNames.contains(STORE_NAME)
                ? request.transaction!.objectStore(STORE_NAME)
                : db.createObjectStore(STORE_NAME, { keyPath: "key" });
            if (!store.indexNames.contains(SESSION_DRAFT_INDEX)) {
                store.createIndex(SESSION_DRAFT_INDEX, "sessionDraft", { unique: false });
            }
        };
        request.onerror = () => reject(request.error ?? new LocalRecoveryUnavailableError());
        request.onblocked = () => reject(new LocalRecoveryUnavailableError("Local recovery database upgrade is blocked."));
        request.onsuccess = () => resolve(request.result);
    });
}

function toStoredCheckpoint(write: RecoveryWrite, sessionDraft: string): StoredCheckpoint {
    return {
        key: `${sessionDraft}\u0000${String(write.generation).padStart(16, "0")}`,
        sessionDraft,
        sessionKey: write.sessionKey,
        draftId: write.draftId,
        generation: write.generation,
        storeRevision: write.target.storeRevision,
        transactionSequence: write.target.yjs.transactionSequence,
        stateDigest: write.target.yjs.stateDigest,
        encodedState: Uint8Array.from(write.encodedState).buffer,
    };
}

function toRecoveryWrite(checkpoint: StoredCheckpoint, encodedState: Uint8Array): RecoveryWrite {
    const target: ProjectionTarget = Object.freeze({
        storeRevision: checkpoint.storeRevision,
        yjs: Object.freeze({
            transactionSequence: checkpoint.transactionSequence,
            stateDigest: checkpoint.stateDigest,
        }),
    });
    return Object.freeze({
        sessionKey: checkpoint.sessionKey,
        draftId: checkpoint.draftId,
        generation: checkpoint.generation,
        target,
        encodedState,
    });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onerror = () => reject(request.error ?? new LocalRecoveryUnavailableError());
        request.onsuccess = () => resolve(request.result);
    });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new LocalRecoveryUnavailableError());
        transaction.onabort = () => reject(transaction.error ?? new LocalRecoveryUnavailableError("Local recovery transaction was aborted."));
    });
}
