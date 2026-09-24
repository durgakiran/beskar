import * as Y from 'yjs';
import { base64ToUint8Array } from 'app/core/utils/base64';
import { jsonRequest, checkedFetch, contentUrl, digest, sequence, type Snapshot, type DraftManifest } from './api';

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
        let current = sequence(snapshot.throughSequence);
        const head = sequence(manifest.headSequence);
        if (current > head) throw new Error('Invalid draft boundary');
        let url = manifest.updatesUrl;
        const visited = new Set<string>();
        while (true) {
            if (visited.has(url)) throw new Error('Repeated whiteboard replay cursor');
            visited.add(url);
            const page = await jsonRequest<{ headSequence: string; updates: { sequence: string; updateEncoding: string; update: string }[]; complete: boolean; nextCursor: string | null }>(contentUrl(url), { signal });
            if (page.headSequence !== manifest.headSequence) throw new Error('Whiteboard replay head changed');
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
        return { manifest, state: Y.encodeStateAsUpdate(doc), cache: { snapshot, bytes } };
    } finally { doc.destroy(); }
}
