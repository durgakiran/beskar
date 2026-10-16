import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Schema } from '@tiptap/pm/model';
import { isFreshDocument, mergeDocumentState, publishedDocumentSeed } from './documentYjs';

const schema = new Schema({ nodes: {
    doc: { content: 'paragraph+' }, paragraph: { content: 'text*', group: 'block' }, text: { group: 'inline' },
} });
const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Published body' }] }] };

describe('document bootstrap', () => {
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
