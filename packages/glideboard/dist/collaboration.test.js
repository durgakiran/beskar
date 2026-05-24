import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { bindGlideboardCollaboration } from './collaboration';
import { createGlideboardEditorInstance } from './editor';
function connectDocs(docA, docB) {
    docA.on('update', (update, origin) => {
        if (origin === docB)
            return;
        Y.applyUpdate(docB, update, docA);
    });
    docB.on('update', (update, origin) => {
        if (origin === docA)
            return;
        Y.applyUpdate(docA, update, docB);
    });
}
function createBoxRecord(id, x, y) {
    return {
        id,
        type: 'box',
        x,
        y,
        index: 'a0001',
        rotation: 0,
        props: {
            w: 120,
            h: 80,
            label: 'Box',
        },
        meta: {},
    };
}
describe('bindGlideboardCollaboration', () => {
    it('synchronizes shape creates and updates between editors', async () => {
        const editorA = createGlideboardEditorInstance();
        const editorB = createGlideboardEditorInstance();
        const docA = new Y.Doc();
        const docB = new Y.Doc();
        connectDocs(docA, docB);
        const cleanupA = bindGlideboardCollaboration(editorA, { doc: docA });
        const cleanupB = bindGlideboardCollaboration(editorB, { doc: docB });
        editorA.createShape(createBoxRecord('shape:one', 40, 80));
        await Promise.resolve();
        const remoteShape = editorB.getShape('shape:one');
        expect(remoteShape).toBeTruthy();
        expect(remoteShape?.x).toBe(40);
        editorB.updateShape('shape:one', { x: 220 });
        await Promise.resolve();
        expect(editorA.getShape('shape:one')?.x).toBe(220);
        cleanupA();
        cleanupB();
    });
    it('seeds an empty shared doc from existing local records', () => {
        const editor = createGlideboardEditorInstance();
        editor.createShape(createBoxRecord('shape:seed', 12, 24));
        const doc = new Y.Doc();
        const cleanup = bindGlideboardCollaboration(editor, { doc });
        const records = doc.getMap('glideboard-records');
        expect(records.size).toBe(1);
        expect(records.get('shape:seed')).toMatchObject({ id: 'shape:seed', x: 12, y: 24 });
        cleanup();
    });
});
//# sourceMappingURL=collaboration.test.js.map