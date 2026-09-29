import * as Y from 'yjs';
import { base64ToUint8Array } from 'app/core/utils/base64';
import { jsonRequest, checkedFetch, contentUrl, digest, sequence, type Snapshot, type DraftManifest, WhiteboardApiError } from './api';

/** Complete and verify an isolated replay before making any changes to the editor. */
export async function loadDraft(base: string, signal?: AbortSignal, cached?: { snapshot: Snapshot; bytes: Uint8Array }) {
    const manifest = await jsonRequest<DraftManifest>(`${base}/draft`, { signal });
    const requested = new URL(base, window.location.origin).pathname.split('/');
    if (String(manifest.pageId) !== requested.at(-1) || manifest.spaceId !== decodeURIComponent(requested.at(-3)!)) throw new Error('Whiteboard replay belongs to another board');
    const snapshot = manifest.baseSnapshot;
    if (snapshot.updateEncoding !== 'yjs-update-v1') throw new Error('Unsupported snapshot encoding');
    const bytes = cached?.snapshot.id === snapshot.id && cached.snapshot.stateDigest === snapshot.stateDigest
        ? cached.bytes : new Uint8Array(await (await checkedFetch(contentUrl(snapshot.downloadUrl), { signal })).arrayBuffer());
    if (bytes.length !== snapshot.byteLength || await digest(bytes) !== snapshot.stateDigest) throw new Error('Whiteboard snapshot verification failed');
    const doc = new Y.Doc();
    try {
        Y.applyUpdate(doc, bytes);
        await applyPages(base, doc, snapshot.throughSequence, manifest.headSequence, manifest.updatesUrl, signal);
        return { manifest, state: Y.encodeStateAsUpdate(doc), cache: { snapshot, bytes } };
    } finally { doc.destroy(); }
}

async function applyPages(base: string, doc: Y.Doc, after: string, headSequence: string, updatesUrl: string, signal?: AbortSignal) {
    let current = sequence(after);
    const head = sequence(headSequence);
    if (current > head) throw new Error('Invalid draft boundary');
    let url = updatesUrl;
    const visited = new Set<string>();
    while (true) {
        if (visited.has(url)) throw new Error('Repeated whiteboard replay cursor');
        visited.add(url);
        const page = await jsonRequest<{ headSequence: string; updates: { sequence: string; updateEncoding: string; update: string }[]; complete: boolean; nextCursor: string | null }>(contentUrl(url), { signal });
        if (page.headSequence !== headSequence) throw new Error('Whiteboard replay head changed');
        for (const update of page.updates) {
            if (sequence(update.sequence) !== current + 1n || sequence(update.sequence) > head || update.updateEncoding !== 'yjs-update-v1') throw new Error('Incomplete whiteboard update history');
            Y.applyUpdate(doc, base64ToUint8Array(update.update));
            current++;
        }
        if (page.complete) {
            if (current !== head || page.nextCursor) throw new Error('Incomplete whiteboard replay');
            break;
        }
        if (!page.nextCursor || !page.updates.length) throw new Error('Missing whiteboard replay cursor');
        url = `${base}/draft/updates?cursor=${encodeURIComponent(page.nextCursor)}`;
    }
    if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error('Whiteboard replay has unresolved dependencies');
}

export type LoadedDraft = Awaited<ReturnType<typeof loadDraft>>;
export interface DraftStatus { headSequence: string; restoreGeneration: string; readOnly: boolean }
interface IncrementalManifest extends DraftStatus {
    afterSequence: string;
    title: string;
    complete: boolean;
    updatesUrl: string | null;
}

/** Advance only verified server state. Local edits and save receipts never move this boundary. */
export async function syncDraft(base: string, previous: LoadedDraft, signal?: AbortSignal): Promise<LoadedDraft & { readOnly: boolean }> {
    const status = await jsonRequest<DraftStatus>(`${base}/draft/status`, { signal });
    sequence(status.headSequence);
    sequence(status.restoreGeneration);
    const generation = previous.manifest.restoreGeneration ?? '0';
    const reload = async () => ({ ...await loadDraft(base, signal, previous.cache), readOnly: status.readOnly });
    if (status.restoreGeneration !== generation) return reload();
    const after = previous.manifest.headSequence;
    if (sequence(status.headSequence) < sequence(after)) throw new Error('Whiteboard server sequence moved backwards');
    if (status.headSequence === after) return { ...previous, readOnly: status.readOnly };
    let next: IncrementalManifest;
    try {
        next = await jsonRequest<IncrementalManifest>(`${base}/draft?afterSequence=${encodeURIComponent(after)}&restoreGeneration=${encodeURIComponent(generation)}`, { signal });
    } catch (error) {
        if (error instanceof WhiteboardApiError && error.code === 'DRAFT_RESET_REQUIRED') return reload();
        throw error;
    }
    if (next.restoreGeneration !== generation || next.afterSequence !== after || sequence(next.headSequence) < sequence(after)) throw new Error('Invalid incremental draft boundary');
    const doc = new Y.Doc();
    try {
        Y.applyUpdate(doc, previous.state);
        if (next.complete) {
            if (next.headSequence !== after || next.updatesUrl !== null) throw new Error('Invalid completed draft replay');
        } else {
            if (!next.updatesUrl || next.headSequence === after) throw new Error('Missing incremental draft updates');
            await applyPages(base, doc, after, next.headSequence, next.updatesUrl, signal);
        }
        return { ...previous, manifest: { ...previous.manifest, headSequence: next.headSequence, title: next.title },
            state: Y.encodeStateAsUpdate(doc), readOnly: next.readOnly };
    } finally { doc.destroy(); }
}
