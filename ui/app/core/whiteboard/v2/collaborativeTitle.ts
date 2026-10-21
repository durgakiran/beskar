import * as Y from 'yjs';

export const WHITEBOARD_TITLE_KEY = 'collaborativeTitleV1';

/** A nested type preserves the existing whiteboard root/schema contract. */
export function whiteboardTitle(doc: Y.Doc, initialTitle: string, identity: string): Y.Text {
    const metadata = doc.getMap('glideboard-meta');
    if (!(metadata.get(WHITEBOARD_TITLE_KEY) instanceof Y.Text)) {
        // Identical bootstraps share CRDT identities, so joining peers cannot
        // duplicate the initial title. Keep seed IDs outside random uint32 IDs.
        let hash = 2166136261;
        for (const char of `${identity}:${initialTitle}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
        const seed = new Y.Doc();
        seed.clientID = 0x100000000 + hash;
        const text = new Y.Text(initialTitle);
        seed.getMap('glideboard-meta').set(WHITEBOARD_TITLE_KEY, text);
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed), 'whiteboard-title-bootstrap');
        seed.destroy();
    }
    return metadata.get(WHITEBOARD_TITLE_KEY) as Y.Text;
}
