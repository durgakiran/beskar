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
    private generationOffset = 0;
    private readonly writer = crypto.randomUUID();
    private readonly hydrated = new Map<string, number>();
    private writeInFlight = false;
    private readonly pending = new Map<string, {
        checkpoint: StoredCheckpoint;
        waiters: { resolve: () => void; reject: (error: unknown) => void }[];
    }>();

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
            .openCursor(IDBKeyRange.only(this.sessionDraft));
        const completed = transactionComplete(transaction);
        const reading = new Promise<StoredCheckpoint | null>((resolve, reject) => {
            let newest: StoredCheckpoint | null = null;
            request.onerror = () => reject(request.error ?? new LocalRecoveryUnavailableError());
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) { resolve(newest); return; }
                const record = cursor.value as StoredCheckpoint;
                try {
                    // Older clients may have left many complete checkpoints.
                    // Merge them one at a time without loading all buffers at once.
                    Y.applyUpdate(doc, new Uint8Array(record.encodedState), INDEXED_DB_RECOVERY_ORIGIN);
                    this.hydrated.set(record.key, record.generation);
                    this.generationOffset = Math.max(this.generationOffset, record.generation);
                    if (!newest || newest.generation < record.generation) newest = record;
                    cursor.continue();
                } catch (error) { reject(error); }
            };
        });
        const [latest] = await Promise.all([reading, completed]);
        if (!latest) return null;
        const encodedState = new Uint8Array(latest.encodedState.slice(0));
        return toRecoveryWrite(latest, encodedState);
    }

    async persist(write: RecoveryWrite): Promise<void> {
        this.assertMatchingSession(write);
        const checkpoint = toStoredCheckpoint(write, this.sessionDraft, this.writer, this.generationOffset);
        // Each writer replaces its own complete checkpoint. An independent
        // tab's unsaved edits stay available until they are recovered and saved.
        return new Promise<void>((resolve, reject) => {
            const waiter = { resolve, reject };
            const pending = this.pending.get(checkpoint.sessionDraft);
            if (pending) {
                if (pending.checkpoint.generation <= checkpoint.generation) pending.checkpoint = checkpoint;
                pending.waiters.push(waiter);
            } else {
                this.pending.set(checkpoint.sessionDraft, { checkpoint, waiters: [waiter] });
            }
            void this.writePending();
        });
    }

    private async writePending(): Promise<void> {
        const next = this.pending.values().next().value;
        if (this.writeInFlight || !next) return;
        this.writeInFlight = true;
        const { checkpoint, waiters } = next;
        this.pending.delete(checkpoint.sessionDraft);
        try {
            const db = await this.database;
            const transaction = db.transaction(STORE_NAME, "readwrite");
            transaction.objectStore(STORE_NAME).put(checkpoint);
            await transactionComplete(transaction);
            for (const waiter of waiters) waiter.resolve();
        } catch (error) {
            for (const waiter of waiters) waiter.reject(error);
        } finally {
            this.writeInFlight = false;
            void this.writePending();
        }
    }

    async clearThrough(write: RecoveryWrite): Promise<void> {
        this.assertMatchingSession(write);
        const sessionDraft = this.sessionDraft;
        const ownKey = `${this.sessionDraft}\u0000writer:${this.writer}`;
        const through = write.generation + this.generationOffset;
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
                const recovered = this.hydrated.get(checkpoint.key);
                if ((checkpoint.key === ownKey && checkpoint.generation <= through)
                    || (recovered !== undefined && checkpoint.generation <= recovered)) cursor.delete();
                cursor.continue();
            };
        });
        await transactionComplete(transaction);
    }

    advanceDraft(sessionKey: string, draftId: string): void {
        this.assertActive();
        this.generationOffset = 0;
        this.hydrated.clear();
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

function toStoredCheckpoint(write: RecoveryWrite, sessionDraft: string, writer: string, offset: number): StoredCheckpoint {
    return {
        key: `${sessionDraft}\u0000writer:${writer}`,
        sessionDraft,
        sessionKey: write.sessionKey,
        draftId: write.draftId,
        generation: write.generation + offset,
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

function transactionComplete(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new LocalRecoveryUnavailableError());
        transaction.onabort = () => reject(transaction.error ?? new LocalRecoveryUnavailableError("Local recovery transaction was aborted."));
    });
}
