import * as Y from 'yjs';
import { createMutationCapability, isCanonicalOrderKey } from '@durgakiran/glideline';
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
  it('projects grouping as one Yjs transaction and preserves hierarchy remotely', async () => {
    const capabilityA = createMutationCapability();
    const capabilityB = createMutationCapability();
    const editorA = createGlideboardEditorInstance([], undefined, capabilityA);
    const editorB = createGlideboardEditorInstance([], undefined, capabilityB);
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    connectDocs(docA, docB);
    const cleanupA = bindGlideboardCollaboration(editorA, { doc: docA }, capabilityA);
    const cleanupB = bindGlideboardCollaboration(editorB, { doc: docB }, capabilityB);
    editorA.createShape(createBoxRecord('shape:group-a', 20, 20) as any);
    editorA.createShape(createBoxRecord('shape:group-b', 180, 80) as any);
    await Promise.resolve();
    let transactions = 0;
    const count = () => { transactions += 1; };
    docA.on('afterTransaction', count);

    const group = editorA.groupShapes(['shape:group-a', 'shape:group-b'] as any);
    await Promise.resolve();

    expect(transactions).toBe(1);
    expect(editorB.getShape(group)?.type).toBe('group');
    expect(editorB.getShape('shape:group-a' as any)?.parentId).toBe(group);
    expect(editorB.getShape('shape:group-b' as any)?.parentId).toBe(group);
    docA.off('afterTransaction', count);
    cleanupA();
    cleanupB();
  });

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

    const records = doc.getMap<Y.Map<unknown>>('glideboard-records-v2');
    expect(records.size).toBe(2);
    expect(records.get('shape:seed')?.toJSON()).toMatchObject({ id: 'shape:seed', x: 12, y: 24 });

    cleanup();
  });

  it('migrates persisted collaborative v2 indices before projecting them', () => {
    const seedCapability = createMutationCapability();
    const seedEditor = createGlideboardEditorInstance([], undefined, seedCapability);
    seedEditor.createShape(createBoxRecord('shape:first', 12, 24) as any);
    seedEditor.createShape(createBoxRecord('shape:second', 12, 24) as any);
    const doc = new Y.Doc();
    const seedBinding = bindGlideboardCollaboration(seedEditor, { doc }, seedCapability);
    seedBinding();

    const metadata = doc.getMap<any>('glideboard-meta');
    const currentSchema = metadata.get('documentSchema');
    metadata.set('documentSchema', { ...currentSchema, storeVersion: 2 });
    const records = doc.getMap<Y.Map<unknown>>('glideboard-records-v2');
    records.get('shape:first')!.set('index', 'legacy-a');
    records.get('shape:second')!.set('index', 'legacy-b');

    const capability = createMutationCapability();
    const editor = createGlideboardEditorInstance([], undefined, capability);
    const binding = bindGlideboardCollaboration(editor, { doc }, capability);

    expect(isCanonicalOrderKey(editor.getShape('shape:first' as any)?.index)).toBe(true);
    expect(isCanonicalOrderKey(editor.getShape('shape:second' as any)?.index)).toBe(true);
    expect(metadata.get('documentSchema').storeVersion).toBe(currentSchema.storeVersion);
    expect(records.get('shape:first')?.get('index')).toBe(editor.getShape('shape:first' as any)?.index);
    binding();
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
    expect(editorA.serialize().records.filter(record => record.kind !== 'page')).toHaveLength(0);
    expect(editorB.getShape('shape:preview' as any)).toBeUndefined();
    expect(docA.getMap('glideboard-records-v2').has('shape:preview')).toBe(false);

    cleanupA();
    cleanupB();
  });

  it('maps a committed store revision to detached Yjs checkpoint bytes', async () => {
    const capability = createMutationCapability();
    const editor = createGlideboardEditorInstance([], undefined, capability);
    const doc = new Y.Doc();
    const binding = bindGlideboardCollaboration(editor, { doc }, capability);
    const projectedStates: Array<{ target: any; encodedState: Uint8Array }> = [];
    const unsubscribe = binding.checkpoints.subscribe(state => projectedStates.push(state));

    editor.createShape(createBoxRecord('shape:checkpoint', 10, 20) as any);
    const revision = editor.store.revision;
    const target = await binding.checkpoints.waitForStoreRevision(revision);

    expect(target.storeRevision).toBe(revision);
    expect(target.yjs.transactionSequence).toBeGreaterThan(0);
    expect(target.yjs.stateDigest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const projected = projectedStates.find(state => state.target.storeRevision === revision);
    expect(projected).toBeDefined();
    const detachedDoc = new Y.Doc();
    Y.applyUpdate(detachedDoc, projected!.encodedState);
    expect(detachedDoc.getMap<Y.Map<unknown>>('glideboard-records-v2').get('shape:checkpoint')?.toJSON()).toMatchObject({
      id: 'shape:checkpoint',
      x: 10,
      y: 20,
    });

    doc.getMap('glideboard-records').set('shape:later', createBoxRecord('shape:later', 30, 40));
    expect(detachedDoc.getMap('glideboard-records-v2').has('shape:later')).toBe(false);

    unsubscribe();
    binding();
  });

  it('checkpoints rich-text Yjs edits without a store commit', async () => {
    const capability = createMutationCapability();
    const editor = createGlideboardEditorInstance([], undefined, capability);
    const doc = new Y.Doc();
    const binding = bindGlideboardCollaboration(editor, { doc }, capability);
    const fragments = doc.getMap<Y.XmlFragment>('glideboard-rich-text-fragments-v1');
    const fragment = new Y.XmlFragment();
    fragments.set('shape:text', fragment);
    const beforeTyping = await binding.checkpoints.captureTarget();

    const text = new Y.XmlText();
    fragment.insert(0, [text]);
    text.insert(0, 'Saved while typing');
    const afterTyping = await binding.checkpoints.captureTarget();

    expect(afterTyping.storeRevision).toBe(beforeTyping.storeRevision);
    expect(afterTyping.yjs.transactionSequence).toBeGreaterThan(beforeTyping.yjs.transactionSequence);
    expect(afterTyping.yjs.stateDigest).not.toBe(beforeTyping.yjs.stateDigest);
    binding();
  });

  it('replays the captured state to durability listeners at a save boundary', async () => {
    const capability = createMutationCapability();
    const editor = createGlideboardEditorInstance([], undefined, capability);
    const doc = new Y.Doc();
    const binding = bindGlideboardCollaboration(editor, { doc }, capability);
    await binding.checkpoints.captureTarget();
    const delivered: Array<{ target: any }> = [];
    const unsubscribe = binding.checkpoints.subscribe(state => delivered.push(state));
    await Promise.resolve();
    delivered.length = 0;

    const target = await binding.checkpoints.captureTarget();

    expect(delivered.at(-1)?.target).toEqual(target);
    unsubscribe();
    binding();
  });

  it('quarantines checkpoint capture when a remote projection is invalid', async () => {
    const capability = createMutationCapability();
    const editor = createGlideboardEditorInstance([], undefined, capability);
    editor.createShape(createBoxRecord('shape:preserved', 4, 5) as any);
    const doc = new Y.Doc();
    const binding = bindGlideboardCollaboration(editor, { doc }, capability);

    const remoteDoc = new Y.Doc();
    remoteDoc.getMap('glideboard-records-v2').set('invalid', { id: 'invalid' });
    try {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(remoteDoc), remoteDoc);
    } catch {
      // Yjs versions may propagate observer errors; quarantine is the contract.
    }
    expect(binding.checkpoints.status.peek()).toBe('quarantined');
    expect(editor.getShape('shape:preserved' as any)).toBeDefined();
    expect(editor.getShape('invalid' as any)).toBeUndefined();
    await expect(binding.checkpoints.captureTarget()).rejects.toThrow('quarantined');

    binding();
  });

  it('merges concurrent edits to different record fields', () => {
    const capabilityA = createMutationCapability();
    const capabilityB = createMutationCapability();
    const editorA = createGlideboardEditorInstance([], undefined, capabilityA);
    const editorB = createGlideboardEditorInstance([], undefined, capabilityB);
    const docA = new Y.Doc();
    const seed = createBoxRecord('shape:merge', 10, 20);
    editorA.createShape(seed as any);
    const bindingA = bindGlideboardCollaboration(editorA, { doc: docA }, capabilityA);
    expect(bindingA.checkpoints.status.peek()).toBe('healthy');
    expect(editorA.getShape(seed.id as any)).toBeDefined();
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const bindingB = bindGlideboardCollaboration(editorB, { doc: docB }, capabilityB);

    editorA.updateShape(seed.id as any, { x: 500 } as any);
    editorB.updateShape(seed.id as any, {
      props: { ...editorB.getShape(seed.id as any)!.props, label: 'Remote label' },
    } as any);
    const updateA = Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB));
    const updateB = Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA));
    Y.applyUpdate(docA, updateB, docB);
    Y.applyUpdate(docB, updateA, docA);

    expect(editorA.getShape(seed.id as any)).toMatchObject({ x: 500, props: { label: 'Remote label' } });
    expect(editorB.getShape(seed.id as any)).toMatchObject({ x: 500, props: { label: 'Remote label' } });
    bindingA();
    bindingB();
  });

  it('converges concurrent same-field edits to one deterministic Yjs value', () => {
    const capabilityA = createMutationCapability();
    const capabilityB = createMutationCapability();
    const editorA = createGlideboardEditorInstance([], undefined, capabilityA);
    const editorB = createGlideboardEditorInstance([], undefined, capabilityB);
    const docA = new Y.Doc();
    editorA.createShape(createBoxRecord('shape:same-field', 10, 20) as any);
    const bindingA = bindGlideboardCollaboration(editorA, { doc: docA }, capabilityA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const bindingB = bindGlideboardCollaboration(editorB, { doc: docB }, capabilityB);

    editorA.updateShape('shape:same-field' as any, { x: 100 } as any);
    editorB.updateShape('shape:same-field' as any, { x: 200 } as any);
    const updateA = Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB));
    const updateB = Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA));
    Y.applyUpdate(docA, updateB, docB);
    Y.applyUpdate(docB, updateA, docA);

    const xA = editorA.getShape('shape:same-field' as any)?.x;
    const xB = editorB.getShape('shape:same-field' as any)?.x;
    expect(xA).toBe(xB);
    expect([100, 200]).toContain(xA);
    bindingA();
    bindingB();
  });

  it('converges concurrent equal order keys using shape id as the tie-break', () => {
    const capabilityA = createMutationCapability();
    const capabilityB = createMutationCapability();
    const editorA = createGlideboardEditorInstance([], undefined, capabilityA);
    const editorB = createGlideboardEditorInstance([], undefined, capabilityB);
    const docA = new Y.Doc();
    editorA.createShape(createBoxRecord('shape:seed', 10, 20) as any);
    const bindingA = bindGlideboardCollaboration(editorA, { doc: docA }, capabilityA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const bindingB = bindGlideboardCollaboration(editorB, { doc: docB }, capabilityB);

    editorA.createShape(createBoxRecord('shape:concurrent-b', 20, 20) as any);
    editorB.createShape(createBoxRecord('shape:concurrent-a', 30, 20) as any);
    expect(editorA.getShape('shape:concurrent-b' as any)?.index)
      .toBe(editorB.getShape('shape:concurrent-a' as any)?.index);

    const updateA = Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB));
    const updateB = Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA));
    Y.applyUpdate(docA, updateB, docB);
    Y.applyUpdate(docB, updateA, docA);

    const expected = ['shape:seed', 'shape:concurrent-a', 'shape:concurrent-b'];
    expect(editorA.getOrderedShapeIds()).toEqual(expected);
    expect(editorB.getOrderedShapeIds()).toEqual(expected);
    bindingA();
    bindingB();
  });

  it('makes a tombstone win over a concurrent update to the deleted generation', () => {
    const capabilityA = createMutationCapability();
    const capabilityB = createMutationCapability();
    const editorA = createGlideboardEditorInstance([], undefined, capabilityA);
    const editorB = createGlideboardEditorInstance([], undefined, capabilityB);
    const docA = new Y.Doc();
    editorA.createShape(createBoxRecord('shape:delete-update', 10, 20) as any);
    const bindingA = bindGlideboardCollaboration(editorA, { doc: docA }, capabilityA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const bindingB = bindGlideboardCollaboration(editorB, { doc: docB }, capabilityB);

    editorA.deleteShapes(['shape:delete-update' as any]);
    editorB.updateShape('shape:delete-update' as any, { x: 999 } as any);
    const updateA = Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB));
    const updateB = Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA));
    Y.applyUpdate(docA, updateB, docB);
    Y.applyUpdate(docB, updateA, docA);

    expect(editorA.getShape('shape:delete-update' as any)).toBeUndefined();
    expect(editorB.getShape('shape:delete-update' as any)).toBeUndefined();
    expect(docA.getMap<Y.Map<unknown>>('glideboard-records-v2').get('shape:delete-update')?.get('$tombstone')).toBe(true);
    bindingA();
    bindingB();
  });

  it('publishes the store when a throwing Yjs observer did not alter the prepared command', () => {
    const capability = createMutationCapability();
    const editor = createGlideboardEditorInstance([], undefined, capability);
    const doc = new Y.Doc();
    const binding = bindGlideboardCollaboration(editor, { doc }, capability);
    const throwingObserver = () => { throw new Error('injected delivery observer failure'); };
    doc.on('update', throwingObserver);

    expect(() => editor.createShape(createBoxRecord('shape:observer', 1, 2) as any)).not.toThrow();
    expect(editor.getShape('shape:observer' as any)).toBeDefined();
    expect(doc.getMap('glideboard-records-v2').has('shape:observer')).toBe(true);

    doc.off('update', throwingObserver);
    binding();
  });

  it('tracks deletion-only transactions as a distinct checkpoint and tombstone', async () => {
    const capability = createMutationCapability();
    const editor = createGlideboardEditorInstance([], undefined, capability);
    const doc = new Y.Doc();
    const binding = bindGlideboardCollaboration(editor, { doc }, capability);
    editor.createShape(createBoxRecord('shape:delete', 1, 2) as any);
    const created = await binding.checkpoints.captureTarget();

    editor.deleteShapes(['shape:delete' as any]);
    const deleted = await binding.checkpoints.captureTarget();

    expect(deleted.yjs.transactionSequence).toBeGreaterThan(created.yjs.transactionSequence);
    expect(deleted.yjs.stateDigest).not.toBe(created.yjs.stateDigest);
    expect(doc.getMap<Y.Map<unknown>>('glideboard-records-v2').get('shape:delete')?.get('$tombstone')).toBe(true);
    binding();
  });

  it('waits for provider readiness before seeding an empty shared document', () => {
    const capability = createMutationCapability();
    const editor = createGlideboardEditorInstance([], undefined, capability);
    editor.createShape(createBoxRecord('shape:wait', 1, 2) as any);
    const handlers = new Set<(synced: boolean) => void>();
    const provider = {
      synced: false,
      on: (_event: 'sync' | 'synced', handler: (synced: boolean) => void) => handlers.add(handler),
      off: (_event: 'sync' | 'synced', handler: (synced: boolean) => void) => handlers.delete(handler),
    };
    const doc = new Y.Doc();
    const binding = bindGlideboardCollaboration(editor, { doc, provider }, capability);

    expect(binding.checkpoints.status.peek()).toBe('catching-up');
    expect(doc.getMap('glideboard-records-v2').size).toBe(0);
    handlers.forEach(handler => handler(true));
    expect(binding.checkpoints.status.peek()).toBe('healthy');
    expect(doc.getMap('glideboard-records-v2').has('shape:wait')).toBe(true);
    binding();
    expect(handlers.size).toBe(0);
  });

  it('refuses an incompatible shared schema without changing the editor', async () => {
    const capability = createMutationCapability();
    const editor = createGlideboardEditorInstance([], undefined, capability);
    const doc = new Y.Doc();
    doc.getMap('glideboard-meta').set('schemaVersion', 999);
    const binding = bindGlideboardCollaboration(editor, { doc }, capability);

    expect(binding.checkpoints.status.peek()).toBe('incompatible');
    await expect(binding.checkpoints.captureTarget()).rejects.toThrow('incompatible');
    expect(() => editor.createShape(createBoxRecord('shape:nope', 1, 2) as any)).toThrow('incompatible');
    expect(editor.serialize().records.filter(record => record.kind !== 'page')).toHaveLength(0);
    binding();
  });

  it('records bootstrap identity and refuses a Y.Doc belonging to another board', async () => {
    const firstCapability = createMutationCapability();
    const firstEditor = createGlideboardEditorInstance([], undefined, firstCapability);
    const doc = new Y.Doc();
    const firstBinding = bindGlideboardCollaboration(firstEditor, {
      doc,
      boardIdentity: 'space-a:page-a',
      bootstrapRevision: '7',
    }, firstCapability);
    const metadata = doc.getMap('glideboard-meta');
    expect(metadata.get('boardIdentity')).toBe('space-a:page-a');
    expect(metadata.get('bootstrapRevision')).toBe('7');
    firstBinding();

    const secondCapability = createMutationCapability();
    const secondEditor = createGlideboardEditorInstance([], undefined, secondCapability);
    const secondBinding = bindGlideboardCollaboration(secondEditor, {
      doc,
      boardIdentity: 'space-a:page-b',
    }, secondCapability);
    expect(secondBinding.checkpoints.status.peek()).toBe('incompatible');
    await expect(secondBinding.checkpoints.captureTarget()).rejects.toThrow('incompatible');
    secondBinding();
  });

  it('freezes instead of silently forking when a legacy client writes after migration', () => {
    const capability = createMutationCapability();
    const editor = createGlideboardEditorInstance([], undefined, capability);
    const doc = new Y.Doc();
    const binding = bindGlideboardCollaboration(editor, { doc }, capability);
    editor.createShape(createBoxRecord('shape:v2', 1, 2) as any);

    doc.getMap('glideboard-records').set('shape:legacy', createBoxRecord('shape:legacy', 3, 4));

    expect(binding.checkpoints.status.peek()).toBe('incompatible');
    expect(editor.getShape('shape:legacy' as any)).toBeUndefined();
    binding();
  });
});
