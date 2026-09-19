import { describe, expect, it } from 'vitest';
import {
  createEditor,
  getHistoryManagerForTesting,
  getMutableStoreForTesting,
  type GlidePlugin,
} from './editor';
import { RecordIdService } from './id';
import { GlideSchema } from './schema';
import { GlideStore } from './store';
import { sid, type AnyRecord, type GlideShape, type ShapeId } from './types';
import { BoxUtil } from './shapes/BoxUtil';
import { ArrowBindingUtil, ArrowPlugin, ArrowUtil, type ArrowShape } from './shapes/ArrowUtil';
import { buildArrowBindingRecord, buildArrowShapeRecord } from './arrow-records';

class AssetBoxUtil extends (BoxUtil as new () => BoxUtil) {
  static readonly type = 'asset-box';
  static readonly references = [
    { path: '/props/assetId', targetKind: 'asset', onDetach: 'null' },
  ] as const;
}

class ContainerBoxUtil extends (BoxUtil as new () => BoxUtil) {
  static readonly type = 'container-box';
  static readonly canContainChildren = true;
}

const TestPlugin: GlidePlugin = {
  id: 'workstream-d-test',
  shapes: [BoxUtil as any, ContainerBoxUtil as any, AssetBoxUtil as any, ArrowUtil as any],
  bindings: [ArrowBindingUtil as any],
};

function makeEditor(tokens?: string[]) {
  const idService = tokens
    ? new RecordIdService(() => tokens.shift() ?? `fallback-${tokens.length}`)
    : undefined;
  return createEditor({
    plugins: [TestPlugin],
    ...(idService ? { idService } : {}),
  });
}

function createBox(editor: ReturnType<typeof makeEditor>, id: string, x: number, overrides: AnyRecord = {}): ShapeId {
  return editor.createShape({
    id: sid(id),
    type: 'box',
    x,
    y: 0,
    rotation: 0,
    index: `a:${id}`,
    meta: {},
    props: { w: 100, h: 60 },
    ...overrides,
  });
}

function createContainer(editor: ReturnType<typeof makeEditor>, id: string, x: number, overrides: AnyRecord = {}): ShapeId {
  return editor.createShape({
    id: sid(id), type: 'container-box', x, y: 0, rotation: 0,
    props: { w: 100, h: 60 }, ...overrides,
  });
}

function createBoundArrow(
  editor: ReturnType<typeof makeEditor>,
  arrowId: ShapeId,
  sourceId: ShapeId,
  targetId: ShapeId,
): void {
  const arrow = buildArrowShapeRecord({
    id: arrowId,
    startWorld: { x: 100, y: 30 },
    endWorld: { x: 300, y: 30 },
  });
  arrow.props.start = {
    boundShapeId: sourceId,
    normalizedAnchor: { x: 1, y: 0.5 },
    point: { x: 0, y: 0 },
  };
  arrow.props.end = {
    boundShapeId: targetId,
    normalizedAnchor: { x: 0, y: 0.5 },
    point: { x: 200, y: 0 },
  };
  editor.createShape(arrow as unknown as AnyRecord);
  editor.createBinding(buildArrowBindingRecord({
    id: 'binding:start', fromId: arrowId, toId: sourceId,
    terminal: 'start', normalizedAnchor: { x: 1, y: 0.5 },
  }));
  editor.createBinding(buildArrowBindingRecord({
    id: 'binding:end', fromId: arrowId, toId: targetId,
    terminal: 'end', normalizedAnchor: { x: 0, y: 0.5 },
  }));
}

describe('Workstream D derived indices and graph integrity', () => {
  it('tracks page, parent, asset, binding, and spatial deltas and can rebuild corruption', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).transact({ origin: 'system', history: 'ignore' }, tx => {
      tx.insert({ id: 'page:a', kind: 'page', type: 'page', name: 'A', meta: {} });
      tx.insert({ id: 'page:b', kind: 'page', type: 'page', name: 'B', meta: {} });
      tx.insert({ id: 'asset:one', kind: 'asset', type: 'image', props: { contentHash: 'one' }, meta: {} });
      tx.insert({ id: 'asset:two', kind: 'asset', type: 'image', props: { contentHash: 'two' }, meta: {} });
    });
    const parentA = createContainer(editor, 'parent:a', 0, { parentId: 'page:a' });
    const parentB = createContainer(editor, 'parent:b', 200, { parentId: 'page:b' });
    editor.createShape({
      id: sid('child'), type: 'asset-box', x: 10, y: 10, rotation: 0, index: 'a:child', meta: {},
      parentId: parentA,
      props: { w: 40, h: 30, assetId: 'asset:one' },
    });

    getMutableStoreForTesting(editor).transact({ origin: 'user' }, tx => {
      tx.update('child', record => ({
        ...record,
        x: 350,
        parentId: parentB,
        props: { ...(record['props'] as AnyRecord), assetId: 'asset:two' },
      }));
    });

    expect(editor.store.getShapeIdsOnPage('page:a' as any)).not.toContain(sid('child'));
    expect(editor.store.getShapeIdsOnPage('page:b' as any)).toContain(sid('child'));
    expect(editor.store.getChildren(parentA)).toEqual([]);
    expect(editor.store.getChildren(parentB).map(record => record['id'])).toEqual(['child']);
    expect(editor.store.getAssetUserIds('asset:one' as any)).toEqual([]);
    expect(editor.store.getAssetUserIds('asset:two' as any)).toEqual(['child']);
    editor.setActivePage('page:b' as any);
    expect(editor.getShapesAtPoint({ x: 555, y: 15 }).map(shape => shape.id)).toContain(sid('child'));
    expect(editor.store.assertIntegrity()).toMatchObject({ ok: true, recordCount: 8 });

    (editor.store as any)._childrenByParent.get(parentB).clear();
    expect(editor.store.assertIntegrity().issues.map(issue => issue.code))
      .toContain('parent-membership-mismatch');

    getMutableStoreForTesting(editor).rebuildIndices();
    expect(editor.store.assertIntegrity()).toMatchObject({ ok: true });
    expect(editor.store.getChildren(parentB).map(record => record['id'])).toEqual(['child']);
  });

  it('removes an obsolete RBush entry when updated geometry becomes unavailable', () => {
    const editor = makeEditor();
    const id = createBox(editor, 'geometry', 0);
    expect(editor.getShapesAtPoint({ x: 10, y: 10 }).map(shape => shape.id)).toContain(id);
    getMutableStoreForTesting(editor).getGeometry = () => undefined;
    editor.updateShape(id, { x: 20 });
    expect(editor.getShapesAtPoint({ x: 10, y: 10 }).map(shape => shape.id)).not.toContain(id);
    expect(editor.store.assertIntegrity().ok).toBe(true);
  });

  it('rejects dangling util-declared references and direct bound-shape deletion atomically', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).transact({ origin: 'system', history: 'ignore' }, tx => {
      tx.insert({ id: 'asset:one', kind: 'asset', type: 'image', props: { contentHash: 'one' }, meta: {} });
    });
    const source = createBox(editor, 'source', 0);
    const target = createBox(editor, 'target', 300);
    const arrowId = sid('arrow');
    createBoundArrow(editor, arrowId, source, target);
    editor.createShape({
      id: sid('asset-shape'), type: 'asset-box', x: 0, y: 100, rotation: 0, index: 'asset', meta: {},
      props: { w: 30, h: 20, assetId: 'asset:one' },
    });
    const revision = editor.store.revision;

    expect(() => getMutableStoreForTesting(editor).transact({ origin: 'user' }, tx => {
      tx.update('asset-shape', record => ({
        ...record,
        props: { ...(record['props'] as AnyRecord), assetId: 'asset:missing' },
      }));
    })).toThrow('must reference an existing asset record');
    expect(() => getMutableStoreForTesting(editor).remove([target])).toThrow('must reference an existing shape record');

    expect(editor.store.revision).toBe(revision);
    expect((editor.store.get('asset-shape')!['props'] as AnyRecord)['assetId']).toBe('asset:one');
    expect(editor.getShape(target)).toBeDefined();
    expect(editor.getBindingsToShape(target)).toHaveLength(1);
    expect(editor.store.assertIntegrity().ok).toBe(true);
  });

  it('treats binding records as authoritative and rejects a contradictory terminal cache', () => {
    const editor = makeEditor();
    const other = createBox(editor, 'other', 0);
    const target = createBox(editor, 'target', 300);
    const arrow = buildArrowShapeRecord({
      id: sid('detached-arrow'),
      startWorld: { x: 0, y: 0 },
      endWorld: { x: 100, y: 0 },
    });
    arrow.props.end.boundShapeId = other;
    editor.createShape(arrow as unknown as AnyRecord);
    const revision = editor.store.revision;

    expect(() => getMutableStoreForTesting(editor).transact({ origin: 'user' }, tx => {
      tx.insert(buildArrowBindingRecord({
        id: 'binding:contradiction',
        fromId: arrow.id,
        toId: target,
        terminal: 'end',
        normalizedAnchor: { x: 0, y: 0.5 },
      }));
    })).toThrow('conflicts with the arrow end terminal');

    expect(editor.store.revision).toBe(revision);
    expect(editor.getBinding('binding:contradiction' as any)).toBeUndefined();
  });

  it('cascades descendants and bindings in one deletion history entry', () => {
    const editor = makeEditor();
    const parent = createContainer(editor, 'group', 0);
    const child = createBox(editor, 'child', 20, { parentId: parent });
    const target = createBox(editor, 'target', 300);
    const arrowId = sid('arrow');
    createBoundArrow(editor, arrowId, child, target);
    getHistoryManagerForTesting(editor).clear();

    editor.deleteShapes([parent]);

    expect(editor.getShape(parent)).toBeUndefined();
    expect(editor.getShape(child)).toBeUndefined();
    expect(editor.getBindingsToShape(child)).toEqual([]);
    expect(editor.history.undoStack).toHaveLength(1);
    expect(editor.history.undoStack[0]?.label).toBe('Delete Shapes');
    expect(editor.store.assertIntegrity().ok).toBe(true);

    editor.undo();
    expect(editor.getShape(parent)).toBeDefined();
    expect(editor.getShape(child)).toBeDefined();
    expect(editor.getBindingsToShape(child)).toHaveLength(1);
    expect(editor.store.assertIntegrity().ok).toBe(true);
  });
});

describe('Workstream D graph-aware clipboard and duplication', () => {
  it('duplicates an arrow graph with rewritten bindings as one undoable command', () => {
    const editor = makeEditor();
    const source = createBox(editor, 'source', 0);
    const target = createBox(editor, 'target', 300);
    const arrowId = sid('arrow');
    createBoundArrow(editor, arrowId, source, target);
    getHistoryManagerForTesting(editor).clear();

    const [newSource, newTarget, newArrow] = editor.duplicateShapes([source, target, arrowId], { x: 20, y: 15 });
    const arrow = editor.getShape<ArrowShape>(newArrow!)!;
    const bindings = editor.getBindingsFromShape(newArrow!);

    expect(arrow.props.start.boundShapeId).toBe(newSource);
    expect(arrow.props.end.boundShapeId).toBe(newTarget);
    expect(new Set(bindings.map(binding => binding.toId))).toEqual(new Set([newSource, newTarget]));
    expect(editor.history.undoStack).toHaveLength(1);
    expect(editor.history.undoStack[0]?.label).toBe('Duplicate Shapes');
    expect(editor.store.assertIntegrity().ok).toBe(true);

    editor.undo();
    expect(editor.getShape(newArrow!)).toBeUndefined();
    expect(editor.getShape(arrowId)).toBeDefined();
    editor.redo();
    expect(editor.getBindingsFromShape(newArrow!)).toHaveLength(2);
    expect(editor.store.assertIntegrity().ok).toBe(true);
  });

  it('detaches external arrow terminals while preserving their visible points', () => {
    const editor = makeEditor();
    const source = createBox(editor, 'source', 0);
    const target = createBox(editor, 'target', 300);
    const arrowId = sid('arrow');
    createBoundArrow(editor, arrowId, source, target);

    const [copyId] = editor.duplicateShapes([arrowId], { x: 40, y: 25 });
    const original = editor.getShape<ArrowShape>(arrowId)!;
    const copy = editor.getShape<ArrowShape>(copyId!)!;
    expect(copy.props.start.boundShapeId).toBeNull();
    expect(copy.props.end.boundShapeId).toBeNull();
    expect(copy.props.start.point).toEqual(original.props.start.point);
    expect(copy.props.end.point).toEqual(original.props.end.point);
    expect(copy.x).toBe(original.x + 40);
    expect(copy.y).toBe(original.y + 25);
    expect(editor.getBindingsFromShape(copyId!)).toEqual([]);
  });

  it('copies descendants and assets, rewrites ownership, and does not alias props', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).transact({ origin: 'system', history: 'ignore' }, tx => {
      tx.insert({ id: 'asset:source', kind: 'asset', type: 'image', props: { contentHash: 'image' }, meta: {} });
    });
    const parent = createContainer(editor, 'parent', 0);
    editor.createShape({
      id: sid('asset-child'), type: 'asset-box', x: 10, y: 10, rotation: 0, index: 'a:child', meta: {},
      parentId: parent,
      props: { w: 30, h: 20, assetId: 'asset:source', nested: { value: 1 } },
    });

    const [newParent] = editor.duplicateShapes([parent]);
    const [newChild] = editor.store.getChildren(newParent!);
    const childProps = newChild!['props'] as AnyRecord;
    const copiedAssetId = childProps['assetId'] as string;

    expect(newChild!['parentId']).toBe(newParent);
    expect(copiedAssetId).not.toBe('asset:source');
    expect(editor.store.get(copiedAssetId)?.['kind']).toBe('asset');
    expect(childProps).not.toBe((editor.store.get('asset-child')!['props'] as AnyRecord));
    expect(editor.store.assertIntegrity().ok).toBe(true);
  });
});

describe('Workstream D identifier allocation', () => {
  it('allocates readable shape and binding IDs through the editor service', () => {
    const editor = makeEditor(['one', 'two']);
    const target = createBox(editor, 'target', 100);
    const shapeId = editor.createShape({
      type: 'box', x: 0, y: 0, props: { w: 10, h: 10 },
    });
    const bindingId = editor.createBinding({
      type: 'arrow', fromId: shapeId, toId: target,
      props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, fromEdge: 'left' },
    });

    expect(shapeId).toBe('shape:box:one');
    expect(bindingId).toBe('binding:arrow:two');
  });

  it('retries collisions using an injectable deterministic token source', () => {
    const schema = new GlideSchema();
    schema.registerShapeUtil({ type: 'box' });
    const tokens = ['same', 'same', 'unique'];
    const store = new GlideStore(schema, new RecordIdService(() => tokens.shift()!));
    store.put([{
      id: 'shape:box:same', type: 'box', x: 0, y: 0, rotation: 0, index: 'a', props: {}, meta: {},
    }]);

    expect(store.createRecordId('shape:box')).toBe('shape:box:unique');
  });
});
