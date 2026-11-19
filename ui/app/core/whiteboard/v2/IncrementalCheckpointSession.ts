import * as Y from 'yjs';
import { uint8ArrayToBase64 } from 'app/core/utils/base64';
import type { CollaborationCheckpointSource, DurabilityStatus, ProjectionTarget } from '../durability/types';
import { DurabilityTargetError } from '../durability/types';
import type { JournalUpdate, RecoveryJournal } from './IncrementalRecoveryJournal';
import { post, sequence } from './api';

export const SERVER_REPLAY_ORIGIN = Symbol('whiteboard-server-replay');
export const CHECKPOINT_MAX_BYTES = 1024 * 1024;
const MAX_BATCH_UPDATES = 128;
const AUTOSAVE_IDLE_MS = 5000;

interface PendingUpdate {
    readonly revision: number;
    readonly bytes: Uint8Array;
    readonly stored: Promise<number>;
    readonly requestId?: string;
}

interface SaveBatch {
    readonly through: number;
    readonly requestId: string;
    readonly body: { update: string; updateEncoding: 'yjs-update-v1'; restoreGeneration: string };
}

interface Options {
    doc: Y.Doc;
    base: string;
    draftId: string;
    restoreGeneration: string;
    durableRevision: string;
    journal: RecoveryJournal;
    recovered: readonly JournalUpdate[];
    signal: AbortSignal;
    onSaved: (sequence: string) => void;
    onDrained?: () => Promise<void>;
}

export class IncrementalCheckpointSession {
    private readonly options: Omit<Options, 'recovered'>;
    private pending: PendingUpdate[] = [];
    private revision = 0;
    private savedRevision = 0;
    private batch: SaveBatch | null = null;
    private saving: Promise<void> | null = null;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private idleUntil = Date.now() + AUTOSAVE_IDLE_MS;
    private retryAfter = 0;
    private retryDelay = 500;
    private source: CollaborationCheckpointSource | null = null;
    private quarantined = false;
    private disposed = false;
    private status: DurabilityStatus;
    private readonly listeners = new Set<() => void>();
    private readonly captured = new WeakMap<ProjectionTarget, Uint8Array>();

    constructor({ recovered, ...options }: Options) {
        this.options = options;
        this.status = { phase: 'clean', latestGeneration: 0, localRecovery: 'acknowledged', durableRevision: options.durableRevision };
        for (const update of recovered) {
            this.pending.push({ ...update, revision: ++this.revision, stored: Promise.resolve(update.id) });
        }
        if (this.pending.length) this.setStatus({ phase: 'dirty' });
        options.doc.on('update', this.onUpdate);
    }

    private onUpdate = (bytes: Uint8Array, origin: unknown): void => {
        if (this.disposed || origin === SERVER_REPLAY_ORIGIN) return;
        const stored = this.options.journal.append(bytes);
        void stored.catch(error => {
            if (!this.disposed) this.setStatus({ phase: 'error', localRecovery: 'error', error: asError(error) });
        });
        this.pending.push({ revision: ++this.revision, bytes, stored });
        this.idleUntil = Date.now() + AUTOSAVE_IDLE_MS;
        if (this.status.phase === 'clean') this.setStatus({ phase: 'dirty', localRecovery: 'pending' });
        this.schedule();
    };

    getSnapshot = (): DurabilityStatus => this.status;

    subscribeStatus(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    attach(source: CollaborationCheckpointSource): () => void {
        this.source = source;
        const unsubscribe = source.subscribe(state => this.captured.set(state.target, state.encodedState));
        const check = (status: string) => {
            if (status === 'healthy') this.schedule();
            else if (status !== 'catching-up') {
                this.quarantined = true;
                clearTimeout(this.timer);
                this.timer = undefined;
                this.setStatus({ phase: 'quarantined', error: new DurabilityTargetError(`Glideboard's Yjs projection is ${status}.`) });
            }
        };
        const stopStatus = source.status?.subscribe(check);
        check(source.status?.peek() ?? 'healthy');
        return () => {
            unsubscribe();
            stopStatus?.();
            if (this.source === source) this.source = null;
        };
    }

    getCapturedState(target: ProjectionTarget): Uint8Array {
        this.assertReady();
        const bytes = this.captured.get(target);
        if (!bytes) throw new DurabilityTargetError('The requested exact whiteboard state was not captured.');
        return bytes.slice();
    }

    async flush(): Promise<void> {
        this.assertReady();
        const through = this.revision;
        clearTimeout(this.timer);
        this.timer = undefined;
        while (this.savedRevision < through) {
            await (this.saving ?? this.startSave(through));
        }
    }

    async retryPending(): Promise<void> {
        this.schedule();
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        this.options.doc.off('update', this.onUpdate);
        clearTimeout(this.timer);
        await this.saving?.catch(() => {});
        await Promise.allSettled(this.pending.map(update => update.stored));
        await this.options.journal.close();
        this.listeners.clear();
    }

    private startSave(through: number): Promise<void> {
        this.setStatus({ phase: 'saving', error: undefined });
        let retryAfter = 0;
        this.saving = this.drain(through).catch(error => {
            if (!this.disposed && !this.quarantined && !this.options.signal.aborted) {
                this.setStatus({
                    localRecovery: this.status.localRecovery === 'error' ? 'error' : 'acknowledged',
                    phase: typeof navigator === 'undefined' || navigator.onLine || this.status.localRecovery === 'error' ? 'error' : 'offline',
                    error: asError(error),
                });
            }
            retryAfter = (error as { retryable?: boolean } | null)?.retryable === false
                ? Infinity : Date.now() + this.retryDelay;
            this.retryDelay = Math.min(this.retryDelay * 2, 10000);
            throw error;
        }).finally(() => {
            this.saving = null;
            this.retryAfter = retryAfter;
            this.schedule();
        });
        return this.saving;
    }

    private async drain(through: number): Promise<void> {
        while (this.savedRevision < through) {
            this.assertReady();
            const batch = this.batch ??= await this.prepareBatch(through);
            this.assertReady();
            const receipt = await post<{ pageId: number; sequence: string }>(
                `${this.options.base}/checkpoint`, batch.body, batch.requestId, this.options.signal,
            );
            if (String(receipt.pageId) !== this.options.draftId) throw new Error('Checkpoint acknowledgement belongs to another board');
            sequence(receipt.sequence);
            await this.options.journal.acknowledge(batch.requestId);
            this.pending = this.pending.filter(update => update.revision > batch.through);
            this.savedRevision = batch.through;
            this.batch = null;
            this.retryDelay = 500;
            this.options.onSaved(receipt.sequence);
            this.status = { ...this.status, durableRevision: receipt.sequence };
        }
        if (!this.pending.length) await this.options.onDrained?.();
        if (!this.disposed && !this.quarantined) {
            this.setStatus({ phase: this.pending.length ? 'dirty' : 'clean', localRecovery: 'acknowledged' });
        }
    }

    private async prepareBatch(through: number): Promise<SaveBatch> {
        const updates = selectCheckpointUpdates(this.pending, through);
        const bytes = updates.length === 1 ? updates[0]!.bytes : Y.mergeUpdates(updates.map(update => update.bytes));
        if (bytes.length > CHECKPOINT_MAX_BYTES) {
            if (updates.length > 1) return this.prepareBatch(updates[0]!.revision);
            throw Object.assign(new Error('One edit exceeds the 1 MiB checkpoint limit. The edit remains in local recovery.'), { retryable: false });
        }
        const ids = await Promise.all(updates.map(update => update.stored));
        const requestId = updates[0]!.requestId ?? crypto.randomUUID();
        if (!updates[0]!.requestId) await this.options.journal.prepare(ids, bytes, requestId);
        return {
            through: updates.at(-1)!.revision, requestId,
            body: { update: uint8ArrayToBase64(bytes), updateEncoding: 'yjs-update-v1', restoreGeneration: this.options.restoreGeneration },
        };
    }

    private schedule(): void {
        if (this.timer !== undefined || this.saving || this.disposed || this.quarantined
            || !this.pending.length || !this.source || this.source.status?.peek() === 'catching-up') return;
        const saveAt = Math.max(this.idleUntil, this.retryAfter);
        if (!Number.isFinite(saveAt)) return;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            // Edits move the deadline, including while a request is in flight.
            // Recheck it here so a burst of strokes needs only one timer.
            if (Date.now() < this.idleUntil) {
                this.schedule();
                return;
            }
            void this.flush().catch(() => {});
        }, Math.max(0, saveAt - Date.now()));
    }

    private assertReady(): void {
        if (this.disposed || this.options.signal.aborted) throw new DOMException('Whiteboard session closed', 'AbortError');
        if (this.quarantined || (this.source?.status && this.source.status.peek() !== 'healthy')) {
            throw new DurabilityTargetError('The whiteboard projection is not ready to save.');
        }
    }

    private setStatus(patch: Partial<DurabilityStatus>): void {
        this.status = { ...this.status, ...patch, latestGeneration: this.revision };
        for (const listener of this.listeners) listener();
    }
}

function selectCheckpointUpdates(pending: PendingUpdate[], through: number): PendingUpdate[] {
    const selected: PendingUpdate[] = [];
    let size = 0;
    for (const update of pending) {
        if (update.revision > through || selected.length >= MAX_BATCH_UPDATES) break;
        if (selected.length && (update.requestId || size + update.bytes.length > CHECKPOINT_MAX_BYTES)) break;
        selected.push(update);
        size += update.bytes.length;
        if (update.requestId) break;
    }
    return selected;
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
