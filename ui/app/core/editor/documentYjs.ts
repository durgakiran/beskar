import * as Y from 'yjs';
import type { Schema } from '@tiptap/pm/model';
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap';

export function isFreshDocument(doc: Y.Doc): boolean {
    const fragment = doc.getXmlFragment('default');
    if (fragment.length === 0) return true;
    if (fragment.length !== 1) return false;
    const paragraph = fragment.get(0);
    if (!(paragraph instanceof Y.XmlElement) || paragraph.nodeName !== 'paragraph') return false;
    // BlockId assigns an identity to the temporary paragraph before the snapshot
    // arrives. That identity alone does not make it user-authored content.
    if (Object.entries(paragraph.getAttributes()).some(([key, value]) => key !== 'blockId' && value != null)) return false;
    return paragraph.toArray().every(child => child instanceof Y.XmlText && child.toString() === '');
}

/** Stable server-version identities make simultaneous legacy bootstrap idempotent. */
export function publishedDocumentSeed(docId: number, title: string, body?: { schema: Schema; json: unknown }): Uint8Array {
    const seed = new Y.Doc();
    seed.clientID = docId;
    seed.getText('title').insert(0, title || '');
    if (body) prosemirrorJSONToYXmlFragment(body.schema, body.json, seed.getXmlFragment('default'));
    const update = Y.encodeStateAsUpdate(seed);
    seed.destroy();
    return update;
}

export function mergeDocumentState(doc: Y.Doc, update: Uint8Array): void {
    doc.transact(() => {
        if (isFreshDocument(doc)) {
            const fragment = doc.getXmlFragment('default');
            if (fragment.length) fragment.delete(0, fragment.length);
        }
        Y.applyUpdate(doc, update);
        doc.getMap('documentMeta').set('loaded', true);
    });
}
