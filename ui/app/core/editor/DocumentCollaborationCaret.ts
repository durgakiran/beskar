import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { yCursorPlugin } from '@tiptap/y-tiptap';
import { Plugin } from '@tiptap/pm/state';
import type { Awareness } from 'y-protocols/awareness';

/** Awareness retains its session ID when Yjs rotates the document client ID. */
export const DocumentCollaborationCaret = CollaborationCaret.extend({
    addProseMirrorPlugins() {
        const awareness: Awareness = this.options.provider.awareness;
        awareness.setLocalStateField('user', this.options.user);
        const updateUsers = () => {
            this.storage.users = Array.from(awareness.getStates().entries()).map(([clientId, state]) => ({
                clientId, ...state.user,
            }));
        };
        updateUsers();
        return [
            yCursorPlugin(awareness, {
                awarenessStateFilter: (_documentClientId, clientId) => clientId !== awareness.clientID,
                cursorBuilder: this.options.render,
                selectionBuilder: this.options.selectionRender,
            }),
            new Plugin({
                view: () => {
                    awareness.on('update', updateUsers);
                    return { destroy: () => awareness.off('update', updateUsers) };
                },
            }),
        ];
    },
});
