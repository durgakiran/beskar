import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TipTap } from './tiptap';

const mocks = vi.hoisted(() => ({ editor: vi.fn() }));
vi.mock('@durgakiran/editor', () => ({
    Editor: (props: unknown) => { mocks.editor(props); return null; },
    getExtensions: () => [],
    TableFloatingMenu: () => null,
    TextFormattingMenu: () => null,
    CommentInputPopover: () => null,
    CommentGutter: () => null,
    CommentThreadCard: () => null,
    CommentSidePanel: () => null,
    OverlapDisambiguationPopover: () => null,
}));
vi.mock('../http/commentApiHandler', () => ({ makeCommentApiHandler: () => ({ getThreads: async () => [] }) }));
vi.mock('../hooks/useCommentEvents', () => ({ useCommentEvents: () => null }));

const props = {
    setEditorContext: () => {}, user: { id: 'actor', email: '', name: 'Actor' },
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    pageId: '42', spaceId: 'space-a', id: 42, title: 'Mentions', updateContent: () => {},
};
beforeEach(() => { mocks.editor.mockClear(); vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'success', data: { users: [], hasMore: false } })))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('document mention integration', () => {
    it.each([true, false])('supplies search, resolution and hover details when editable=%s', async editable => {
        render(<TipTap {...props} editable={editable} />);
        const { mentionHandler, editable: actualEditable } = mocks.editor.mock.calls.at(-1)![0];
        expect(actualEditable).toBe(editable);
        expect(mentionHandler.resolveUser).toBeTypeOf('function');
        expect(mentionHandler.getUserDetails).toBeTypeOf('function');
        await mentionHandler.searchUsers('Alex');
        expect(vi.mocked(fetch).mock.calls.at(-1)![0]).toContain('/space/space-a/mentions/users?');
    });
    it('retains a stable handler on rerenders and replaces it when the current space changes', async () => {
        const view = render(<TipTap {...props} editable={false} />);
        const first = mocks.editor.mock.calls.at(-1)![0].mentionHandler;
        view.rerender(<TipTap {...props} editable={false} title="Updated title" />);
        expect(mocks.editor.mock.calls.at(-1)![0].mentionHandler).toBe(first);
        view.rerender(<TipTap {...props} editable={false} spaceId="space-b" />);
        const next = mocks.editor.mock.calls.at(-1)![0].mentionHandler;
        expect(next).not.toBe(first);
        await next.searchUsers('Alex');
        expect(vi.mocked(fetch).mock.calls.at(-1)![0]).toContain('/space/space-b/mentions/users?');
    });
});
