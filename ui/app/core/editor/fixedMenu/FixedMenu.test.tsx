import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { Theme } from '@radix-ui/themes';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { EditorContext } from '../context/editorContext';
import FixedMenu from './FixedMenu';

vi.mock('@durgakiran/editor', async () => ({
    SlashCommandGroups: (await import('../../../../../packages/editor/src/extensions/slash-command/groups')).GROUPS,
    openLinkEditor: (editor: Editor) => editor.view.dom.dispatchEvent(new Event('beskar:edit-link')),
}));

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
const editors: Editor[] = [];
afterEach(() => { cleanup(); editors.splice(0).forEach(editor => editor.destroy()); });

function setup(ready = true) {
    const editor = new Editor({ extensions: [StarterKit, TextAlign.configure({ types: ['heading', 'paragraph'] }), TextStyle, Color, Highlight.configure({ multicolor: true }), Table, TableRow, TableCell, TableHeader], content: '<h2>Project notes</h2><p>Select this text</p>' });
    editors.push(editor);
    editor.commands.setTextSelection({ from: 1, to: 8 });
    const toggle = vi.fn();
    render(<Theme><EditorContext.Provider value={editor}><FixedMenu isEditorReady={ready}
        isSidePanelOpen={false} setIsSidePanelOpen={toggle} canComment /></EditorContext.Provider></Theme>);
    return { editor, toggle };
}

async function menu(label: string) {
    fireEvent.pointerDown(screen.getByRole('button', { name: label }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    return screen.findByRole('menu');
}

describe('document top toolbar', () => {
    it('formats the selection, reflects external transactions, and supports undo', () => {
        const { editor } = setup();
        const bold = screen.getByRole('button', { name: 'Bold (Ctrl/⌘ B)' });
        fireEvent.click(bold);
        expect(editor.isActive('bold')).toBe(true);
        expect(bold.getAttribute('aria-pressed')).toBe('true');
        act(() => { editor.commands.toggleBold(); });
        expect(bold.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl/⌘ Z)' }));
        expect(editor.isActive('bold')).toBe(true);
    });

    it('aligns headings without converting them to paragraphs', async () => {
        const { editor } = setup();
        const popup = await menu('Text alignment');
        fireEvent.click(within(popup).getByRole('menuitem', { name: /Align center/ }));
        expect(editor.isActive('heading', { level: 2 })).toBe(true);
        expect(editor.getAttributes('heading').textAlign).toBe('center');
    });

    it('searches insert commands and inserts a table with top controls', async () => {
        const { editor } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
        const search = await screen.findByRole('textbox', { name: 'Search insert options' });
        fireEvent.change(search, { target: { value: 'grid' } });
        expect(screen.getByText('Insert a 3x3 table')).toBeTruthy();
        fireEvent.change(search, { target: { value: '3x3' } });
        fireEvent.keyDown(search, { key: 'Enter' });
        expect(editor.isActive('table')).toBe(true);
        const popup = await menu('Table');
        fireEvent.click(within(popup).getByRole('menuitem', { name: 'Add row below' }));
        let rows = 0;
        editor.state.doc.descendants(node => { if (node.type.name === 'tableRow') rows++; });
        expect(rows).toBe(4);
    });

    it('applies colors to the preserved selection', async () => {
        const { editor } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Blue text color' }));
        expect(editor.getAttributes('textStyle').color).toBe('#2563eb');
        expect(editor.state.selection.from).toBe(1);
        expect(editor.state.selection.to).toBe(8);
    });

    it('clears visual formatting while preserving hyperlinks', () => {
        const { editor } = setup();
        act(() => { editor.chain().setBold().setColor('#2563eb').setLink({ href: 'https://example.com' }).run(); });
        fireEvent.click(screen.getByRole('button', { name: 'Clear text formatting' }));
        expect(editor.isActive('bold')).toBe(false);
        expect(editor.getAttributes('textStyle').color).toBeUndefined();
        expect(editor.getAttributes('link').href).toBe('https://example.com');
    });

    it('routes link and comment actions and toggles comments', () => {
        const { editor, toggle } = setup();
        const link = vi.fn();
        const comment = vi.fn();
        editor.view.dom.addEventListener('beskar:edit-link', link);
        editor.view.dom.addEventListener('beskar:add-comment', comment);
        fireEvent.click(screen.getByRole('button', { name: 'Add or edit link (Ctrl/⌘ K)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
        fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
        expect(link).toHaveBeenCalledOnce();
        expect(comment).toHaveBeenCalledOnce();
        expect(toggle).toHaveBeenCalledWith(true);
        act(() => { editor.commands.setTextSelection(1); });
        expect((screen.getByRole('button', { name: 'Select text to add a comment' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('disables editing tools before the document is ready', () => {
        setup(false);
        expect((screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Bold (Ctrl/⌘ B)' }) as HTMLButtonElement).disabled).toBe(true);
    });
});
