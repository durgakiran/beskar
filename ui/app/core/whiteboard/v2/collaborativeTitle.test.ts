import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { whiteboardTitle } from './collaborativeTitle';

describe('whiteboard shared title', () => {
    it('merges concurrent title edits from independently bootstrapped peers without duplicating the seed', () => {
        const a = new Y.Doc(), b = new Y.Doc();
        try {
            const first = whiteboardTitle(a, 'Board', 'v2:space:42:snapshot');
            const second = whiteboardTitle(b, 'Board', 'v2:space:42:snapshot');
            first.insert(0, 'Shared ');
            second.insert(second.length, '!');
            const updateA = Y.encodeStateAsUpdate(a), updateB = Y.encodeStateAsUpdate(b);
            Y.applyUpdate(a, updateB); Y.applyUpdate(b, updateA);
            expect(first.toString()).toBe('Shared Board!');
            expect(second.toString()).toBe(first.toString());
            expect([...a.share.keys()]).toEqual(['glideboard-meta']);
        } finally { a.destroy(); b.destroy(); }
    });

    it('retains saved CRDT content when reopening instead of replacing it with stale metadata', () => {
        const original = new Y.Doc(), restored = new Y.Doc();
        try {
            whiteboardTitle(original, 'Board', 'snapshot').insert(0, 'New ');
            Y.applyUpdate(restored, Y.encodeStateAsUpdate(original));
            expect(whiteboardTitle(restored, 'Stale title', 'other-snapshot').toString()).toBe('New Board');
        } finally { original.destroy(); restored.destroy(); }
    });
});
