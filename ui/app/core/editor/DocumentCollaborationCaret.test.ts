import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, Node } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import { absolutePositionToRelativePosition, yCursorPluginKey, ySyncPluginKey } from '@tiptap/y-tiptap';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { DocumentCollaborationCaret } from './DocumentCollaborationCaret';

const disposables: Array<() => void> = [];
afterEach(() => disposables.splice(0).reverse().forEach(dispose => dispose()));

describe('document collaboration caret', () => {
    it('hides the local cursor and selection after client ID rotation while retaining remote sessions', async () => {
        const doc = new Y.Doc();
        const awareness = new Awareness(doc);
        const user = { id: 'same-account', name: 'Local editor', color: '#aabbcc' };
        const editor = new Editor({
            element: document.createElement('div'),
            extensions: [
                Node.create({ name: 'doc', topNode: true, content: 'block+' }),
                Node.create({ name: 'paragraph', group: 'block', content: 'inline*',
                    parseHTML: () => [{ tag: 'p' }], renderHTML: () => ['p', 0] }),
                Node.create({ name: 'text', group: 'inline' }),
                Collaboration.configure({ document: doc }),
                DocumentCollaborationCaret.configure({ provider: { awareness }, user }),
            ],
        });
        disposables.push(() => { editor.destroy(); awareness.destroy(); doc.destroy(); });
        editor.commands.setContent('<p>Shared body</p>');
        vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
        const sync = ySyncPluginKey.getState(editor.state);
        const cursor = {
            anchor: absolutePositionToRelativePosition(2, sync.type, sync.binding.mapping),
            head: absolutePositionToRelativePosition(5, sync.type, sync.binding.mapping),
        };
        doc.clientID = (doc.clientID + 1) % 0x100000000;
        awareness.setLocalStateField('cursor', cursor);
        await vi.waitFor(() => expect(awareness.getLocalState()?.cursor).toBeTruthy());
        editor.view.dispatch(editor.state.tr.setMeta(yCursorPluginKey, { awarenessUpdated: true }));
        expect(yCursorPluginKey.getState(editor.state).find()).toHaveLength(0);
        expect(editor.view.dom.querySelector('.collaboration-carets__label')).toBeNull();

        const remoteDoc = new Y.Doc();
        const remoteAwareness = new Awareness(remoteDoc);
        disposables.push(() => { remoteAwareness.destroy(); remoteDoc.destroy(); });
        remoteAwareness.setLocalState({ user: { ...user, name: 'Remote editor' }, cursor });
        applyAwarenessUpdate(awareness, encodeAwarenessUpdate(remoteAwareness, [remoteAwareness.clientID]), 'remote');
        await vi.waitFor(() => expect(editor.view.dom.querySelector('.collaboration-carets__label')?.textContent).toBe('Remote editor'));
        expect(editor.view.dom.textContent).not.toContain('Local editor');
        expect(yCursorPluginKey.getState(editor.state).find()).toHaveLength(2);
    });
});
