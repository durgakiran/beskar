import * as Y from 'yjs';
import { createMutationCapability } from '@durgakiran/glideline';
import { describe, expect, it } from 'vitest';
import { bindGlideboardCollaboration } from './collaboration';
import { createGlideboardEditorInstance } from './editor';

function connectDocs(docA: Y.Doc, docB: Y.Doc) {
  docA.on('update', (update, origin) => {
    if (origin === docB) return;
    Y.applyUpdate(docB, update, docA);
  });
  docB.on('update', (update, origin) => {
    if (origin === docA) return;
    Y.applyUpdate(docA, update, docB);
  });
}

function createBoxRecord(id: string, x: number, y: number) {
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
    const capabilityA = createMutationCapability();
    const capabilityB = createMutationCapability();
    const editorA = createGlideboardEditorInstance([], undefined, capabilityA);
    const editorB = createGlideboardEditorInstance([], undefined, capabilityB);
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    connectDocs(docA, docB);
    const cleanupA = bindGlideboardCollaboration(editorA, { doc: docA }, capabilityA);
    const cleanupB = bindGlideboardCollaboration(editorB, { doc: docB }, capabilityB);

    editorA.createShape(createBoxRecord('shape:one', 40, 80) as any);
    await Promise.resolve();

    const remoteShape = editorB.getShape('shape:one' as any);
    expect(remoteShape).toBeTruthy();
    expect(remoteShape?.x).toBe(40);

    editorB.updateShape('shape:one' as any, { x: 220 } as any);
    await Promise.resolve();

    expect(editorA.getShape('shape:one' as any)?.x).toBe(220);

    cleanupA();
    cleanupB();
  });

  it('seeds an empty shared doc from existing local records', () => {
    const capability = createMutationCapability();
    const editor = createGlideboardEditorInstance([], undefined, capability);
    editor.createShape(createBoxRecord('shape:seed', 12, 24) as any);

    const doc = new Y.Doc();
    const cleanup = bindGlideboardCollaboration(editor, { doc }, capability);

    const records = doc.getMap('glideboard-records');
    expect(records.size).toBe(1);
    expect(records.get('shape:seed')).toMatchObject({ id: 'shape:seed', x: 12, y: 24 });

    cleanup();
  });

  it('does not synchronize or serialize ephemeral preview records', async () => {
    const capabilityA = createMutationCapability();
    const capabilityB = createMutationCapability();
    const editorA = createGlideboardEditorInstance([], undefined, capabilityA);
    const editorB = createGlideboardEditorInstance([], undefined, capabilityB);
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    connectDocs(docA, docB);
    const cleanupA = bindGlideboardCollaboration(editorA, { doc: docA }, capabilityA);
    const cleanupB = bindGlideboardCollaboration(editorB, { doc: docB }, capabilityB);

    editorA.batch('Preview', () => {
      editorA.createShape(createBoxRecord('shape:preview', 20, 30) as any);
    }, { history: 'ignore', scope: 'ephemeral' });
    await Promise.resolve();

    expect(editorA.getShape('shape:preview' as any)).toBeDefined();
    expect(editorA.serialize().records).toHaveLength(0);
    expect(editorB.getShape('shape:preview' as any)).toBeUndefined();
    expect(docA.getMap('glideboard-records').has('shape:preview')).toBe(false);

    cleanupA();
    cleanupB();
  });
});
