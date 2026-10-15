import * as Y from 'yjs';
import { digest } from './api';

/** Settle Yjs cleanup on detached bytes, without changing the captured checkpoint. */
export function normalizeYjsState(bytes: Uint8Array): Uint8Array {
    const doc = new Y.Doc();
    try {
        Y.applyUpdate(doc, bytes);
        if (doc.store.pendingStructs || doc.store.pendingDs) {
            throw new Error('Document has unresolved updates');
        }
        return Y.encodeStateAsUpdate(doc);
    } finally {
        doc.destroy();
    }
}

export async function matchesPublishedState(editor: Uint8Array, server: Uint8Array): Promise<boolean> {
    const [editorDigest, serverDigest] = await Promise.all([
        digest(normalizeYjsState(editor)),
        digest(normalizeYjsState(server)),
    ]);
    return editorDigest === serverDigest;
}
