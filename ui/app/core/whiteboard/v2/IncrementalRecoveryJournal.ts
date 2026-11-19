import { LocalRecoveryUnavailableError } from '../durability/types';

const STORE = 'updates';
const BATCHES = 'batches';

export interface JournalUpdate {
    readonly id: number;
    readonly bytes: Uint8Array;
    readonly requestId?: string;
}

export interface RecoveryJournal {
    read(): Promise<JournalUpdate[]>;
    append(bytes: Uint8Array): Promise<number>;
    prepare(ids: readonly number[], bytes: Uint8Array, requestId: string): Promise<void>;
    acknowledge(requestId: string): Promise<void>;
    close(): Promise<void>;
}

export class IncrementalRecoveryJournal implements RecoveryJournal {
    private readonly database: Promise<IDBDatabase>;

    constructor(private readonly namespace: string, indexedDb: IDBFactory | undefined = globalThis.indexedDB) {
        if (!indexedDb) throw new LocalRecoveryUnavailableError();
        this.database = new Promise((resolve, reject) => {
            const request = indexedDb.open('beskar-whiteboard-update-journal', 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }).createIndex('namespace', 'namespace');
                request.result.createObjectStore(BATCHES, { keyPath: 'requestId' }).createIndex('namespace', 'namespace');
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new LocalRecoveryUnavailableError());
            request.onblocked = () => reject(new LocalRecoveryUnavailableError('Whiteboard recovery database is blocked.'));
        });
    }

    async read(): Promise<JournalUpdate[]> {
        const transaction = (await this.database).transaction([STORE, BATCHES], 'readonly');
        const completed = finish(transaction);
        const updates = transaction.objectStore(STORE).index('namespace').getAll(this.namespace);
        const batches = transaction.objectStore(BATCHES).index('namespace').getAll(this.namespace);
        await completed;
        const prepared = batches.result as StoredBatch[];
        const covered = new Set(prepared.flatMap(batch => batch.ids));
        const raw = (updates.result as JournalUpdate[]).filter(update => !covered.has(update.id));
        return [...raw, ...prepared.map(batch => ({ id: batch.ids[0]!, bytes: batch.bytes, requestId: batch.requestId }))]
            .sort((left, right) => left.id - right.id);
    }

    async append(bytes: Uint8Array): Promise<number> {
        const transaction = (await this.database).transaction(STORE, 'readwrite');
        const completed = finish(transaction);
        const request = transaction.objectStore(STORE).add({ namespace: this.namespace, bytes });
        await completed;
        return Number(request.result);
    }

    async prepare(ids: readonly number[], bytes: Uint8Array, requestId: string): Promise<void> {
        const transaction = (await this.database).transaction(BATCHES, 'readwrite');
        const completed = finish(transaction);
        // Keep the immutable request separate from its journal entries. Two
        // tabs sharing a recovery namespace can overlap without rewriting
        // each other's pending requests or deleting unacknowledged edits.
        transaction.objectStore(BATCHES).add({ namespace: this.namespace, ids, bytes, requestId });
        await completed;
    }

    async acknowledge(requestId: string): Promise<void> {
        const transaction = (await this.database).transaction([STORE, BATCHES], 'readwrite');
        const completed = finish(transaction);
        const batches = transaction.objectStore(BATCHES);
        const request = batches.get(requestId);
        request.onsuccess = () => {
            const batch = request.result as StoredBatch | undefined;
            if (batch?.namespace !== this.namespace) return;
            const updates = transaction.objectStore(STORE);
            for (const id of batch.ids) updates.delete(id);
            batches.delete(requestId);
        };
        await completed;
    }

    async close(): Promise<void> {
        (await this.database).close();
    }
}

interface StoredBatch {
    readonly namespace: string;
    readonly ids: readonly number[];
    readonly bytes: Uint8Array;
    readonly requestId: string;
}

function finish(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new LocalRecoveryUnavailableError());
    });
}
