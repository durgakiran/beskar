import * as Y from 'yjs';
import type { RecoveryWrite, YjsRecoveryAdapter } from 'app/core/whiteboard/durability/types';
import { base64ToUint8Array, uint8ArrayToBase64 } from 'app/core/utils/base64';

export interface DocumentDraftRevision {
    docId: number;
    generation: number;
    draft: boolean;
}

export interface RemoteDraft {
    parentId?: number;
    docId: number;
    draftGeneration?: number;
    draft: boolean;
    data?: { data?: string };
}

/** Each tab saves independently. A stale snapshot is merged before it can replace server state. */
export class DocumentDraftSession {
    private revision?: DocumentDraftRevision;
    private dirty = false;
    private needsReconcile = false;
    private running?: Promise<void>;
    private retry?: ReturnType<typeof setTimeout>;
    private disposed = false;
    private ready: Promise<void> = Promise.resolve();
    private recoveryWrites: Promise<void> = Promise.resolve();
    private generation = 0;
    private onUpdate = () => { this.dirty = true; void this.persistRecovery().catch(() => {}); };
    private abort = new AbortController();

    constructor(
        private doc: Y.Doc,
        private base: string,
        private editPath: string,
        private payload: () => Record<string, unknown>,
        private status: (saving: boolean, error?: string) => void,
        private request: typeof fetch = fetch,
        private onRemote: (remote: RemoteDraft) => void = () => {},
        private recovery?: { adapter: YjsRecoveryAdapter; sessionKey: string; draftId: string },
    ) {}

    initialize(remote: RemoteDraft): void {
        if (this.revision) return;
        this.revision = { docId: remote.docId, generation: remote.draftGeneration ?? 0, draft: remote.draft };
        if (!this.recovery) this.doc.on('update', this.onUpdate);
        if (this.recovery) {
            this.ready = this.recovery.adapter.hydrate(this.doc).then(recovered => {
                if (this.disposed) return;
                this.doc.on('update', this.onUpdate);
                if (recovered) this.dirty = true;
            }).catch(() => {
                if (!this.disposed) this.status(false, 'Local recovery is unavailable. Keep this tab open until changes are saved.');
            });
            void this.ready.then(() => { if (this.dirty) void this.flush().catch(() => {}); });
        }
    }

    private async persistRecovery(state = Y.encodeStateAsUpdate(this.doc)): Promise<RecoveryWrite | undefined> {
        if (!this.recovery || this.disposed) return;
        const generation = ++this.generation;
        const write: RecoveryWrite = {
            sessionKey: this.recovery.sessionKey, draftId: this.recovery.draftId, generation,
            target: { storeRevision: generation, yjs: { transactionSequence: generation, stateDigest: '' } },
            encodedState: state,
        };
        this.recoveryWrites = this.recoveryWrites.catch(() => {}).then(() => this.recovery!.adapter.persist(write));
        await this.recoveryWrites;
        return write;
    }

    reconcile(): Promise<void> {
        this.needsReconcile = true;
        return this.flush();
    }

    private async loadRemote(): Promise<void> {
        const latest = await this.request(`${this.base}/${this.editPath}`, {
            credentials: 'include', signal: this.abort.signal,
        });
        if (!latest.ok) throw new Error('Unable to reconcile document draft.');
        const { data: remote } = await latest.json() as { data: RemoteDraft };
        if (remote.data?.data) Y.applyUpdate(this.doc, base64ToUint8Array(remote.data.data));
        this.revision = { docId: remote.docId, generation: remote.draftGeneration ?? 0, draft: remote.draft };
        this.onRemote(remote);
    }

    getRevision(): DocumentDraftRevision | undefined { return this.revision && { ...this.revision }; }

    save(): Promise<void> {
        this.dirty = true;
        return this.flush();
    }

    async flush(): Promise<void> {
        if (this.disposed || !this.revision) return;
        if (this.retry) clearTimeout(this.retry);
        if (this.running) return this.running;
        this.running = this.drain().finally(() => { this.running = undefined; });
        return this.running;
    }

    private async drain(): Promise<void> {
        await this.ready;
        this.status(true);
        let conflicts = 0;
        try {
            while ((this.dirty || this.needsReconcile) && !this.disposed) {
                if (this.needsReconcile) {
                    this.needsReconcile = false;
                    await this.loadRemote();
                    continue;
                }
                this.dirty = false;
                const state = Y.encodeStateAsUpdate(this.doc);
                const payload = this.payload();
                let recoveryWrite: RecoveryWrite | undefined;
                try { recoveryWrite = await this.persistRecovery(state); } catch { /* Remote persistence remains available. */ }
                const response = await this.request(`${this.base}/editor/update`, {
                    method: 'PUT', credentials: 'include', signal: this.abort.signal,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...payload, data: uint8ArrayToBase64(state), expectedRevision: this.revision }),
                });
                if (response.status === 409) {
                    this.dirty = true;
                    await this.loadRemote();
                    if (++conflicts >= 5) throw new Error('Document is changing quickly. Retrying save.');
                    continue;
                }
                if (!response.ok) throw new Error(`Document save failed (${response.status}).`);
                const receipt = await response.json() as { data: { revision: DocumentDraftRevision } };
                this.revision = receipt.data.revision;
                if (recoveryWrite) {
                    try { await this.recovery!.adapter.clearThrough(recoveryWrite); } catch { /* Retain the checkpoint for recovery. */ }
                }
            }
            if (!this.disposed) this.status(false);
        } catch (error) {
            this.dirty = true;
            if (!this.disposed) {
                this.status(false, error instanceof Error ? `${error.message} Changes are pending; save will retry.` : 'Changes are pending; save will retry.');
                this.retry = setTimeout(() => { void this.flush().catch(() => {}); }, 3000);
            }
            throw error;
        }
    }

    dispose(): void {
        this.doc.off('update', this.onUpdate);
        this.disposed = true;
        void this.ready.then(() => this.recoveryWrites).catch(() => {}).then(() => this.recovery?.adapter.dispose()).catch(() => {});
        this.abort.abort();
        if (this.retry) clearTimeout(this.retry);
    }
}
