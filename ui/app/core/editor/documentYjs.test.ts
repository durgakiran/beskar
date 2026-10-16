import { describe, expect, it, vi } from 'vitest';
import { Editor, Node } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import { BlockId } from '../../../../packages/editor/src/extensions/block-id';
import { CustomAttributes } from '../../../../packages/editor/src/extensions/custom-attributes';
import * as Y from 'yjs';
import { Schema } from '@tiptap/pm/model';
import { isFreshDocument, mergeDocumentState, publishedDocumentSeed } from './documentYjs';

const schema = new Schema({ nodes: {
    doc: { content: 'paragraph+' }, paragraph: { content: 'text*', group: 'block' }, text: { group: 'inline' },
} });
const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Published body' }] }] };

describe('document bootstrap', () => {
    it.each([0, 2])('does not accumulate initialization paragraphs on reopen with %i saved blank paragraphs', async (blankParagraphs) => {
        const initialBody = { ...body, content: [...body.content, ...Array.from({ length: blankParagraphs }, () => ({ type: 'paragraph' }))] };
        let saved = publishedDocumentSeed(42, 'Title', { schema, json: initialBody });
        for (let cycle = 0; cycle < 3; cycle++) {
            const doc = new Y.Doc();
            const editor = new Editor({
                element: document.createElement('div'),
                extensions: [
                    Node.create({ name: 'doc', topNode: true, content: 'paragraph+' }),
                    Node.create({ name: 'paragraph', content: 'text*', group: 'block', renderHTML: () => ['p', 0] }),
                    Node.create({ name: 'text', group: 'inline' }),
                    CustomAttributes,
                    BlockId,
                    Collaboration.configure({ document: doc }),
                ],
            });
            try {
                // The editor can mount before the server snapshot arrives.
                await vi.waitFor(() => expect(editor.state.doc.firstChild?.attrs.blockId).toBeTruthy());
                mergeDocumentState(doc, saved);
                expect(editor.getJSON().content).toHaveLength(1 + blankParagraphs);
                expect(editor.state.doc.textContent).toBe('Published body');
                saved = Y.encodeStateAsUpdate(doc);
            } finally {
                editor.destroy();
                doc.destroy();
            }
        }
    });
    it('merges simultaneous published bootstrap without duplicate body or title', () => {
        const a = new Y.Doc(); const b = new Y.Doc();
        mergeDocumentState(a, publishedDocumentSeed(42, 'Title', { schema, json: body }));
        mergeDocumentState(b, publishedDocumentSeed(42, 'Title', { schema, json: body }));
        Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
        expect(a.getXmlFragment('default').length).toBe(1);
        expect(a.getXmlFragment('default').toString()).toBe('<paragraph>Published body</paragraph>');
        expect(a.getText('title').toString()).toBe('Title');
    });
    it('removes only the empty initialization paragraph', () => {
        const doc = new Y.Doc();
        doc.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')]);
        expect(isFreshDocument(doc)).toBe(true);
        mergeDocumentState(doc, publishedDocumentSeed(42, 'Title', { schema, json: body }));
        expect(doc.getXmlFragment('default').length).toBe(1);
    });
    it.each(['textAlign', 'contentId', 'docId', 'orderId'])('preserves an empty paragraph with a meaningful %s attribute', (attribute) => {
        const doc = new Y.Doc();
        const paragraph = new Y.XmlElement('paragraph');
        paragraph.setAttribute('blockId', 'existing-block');
        paragraph.setAttribute(attribute, 'existing-value');
        doc.getXmlFragment('default').insert(0, [paragraph]);
        expect(isFreshDocument(doc)).toBe(false);
        mergeDocumentState(doc, publishedDocumentSeed(42, 'Title', { schema, json: body }));
        expect(doc.getXmlFragment('default').toArray()).toContain(paragraph);
        expect(doc.getXmlFragment('default').length).toBe(2);
        doc.destroy();
    });
    it('preserves peer edits and title edits while merging an older server snapshot', () => {
        const doc = new Y.Doc();
        const update = publishedDocumentSeed(42, 'Title', { schema, json: body });
        mergeDocumentState(doc, update);
        const paragraph = doc.getXmlFragment('default').get(0) as Y.XmlElement;
        (paragraph.get(0) as Y.XmlText).insert(14, ' edited');
        doc.getText('title').insert(5, ' edited');
        mergeDocumentState(doc, update);
        expect(doc.getXmlFragment('default').toString()).toContain(' edited');
        expect(doc.getText('title').toString()).toBe('Title edited');
    });
});
