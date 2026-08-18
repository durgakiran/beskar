// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import {
  createEditor,
  getHistoryManagerForTesting,
  getMutableStoreForTesting,
  PortablePasteRollbackError,
  validatePortableBoardFragmentStructure,
  type GlidePlugin,
} from './editor';
import { BoxUtil } from './shapes/BoxUtil';
import { FrameUtil } from './shapes/FrameUtil';
import { GroupUtil } from './shapes/GroupUtil';
import { TextUtil } from './shapes/TextUtil';
import { BindingUtil, ShapeUtil } from './shapes/ShapeUtil';
import { StateNode } from './state-node';
import { SelectTool } from './tools/SelectTool';
import { T } from './validators';
import { bid, sid, type GlideBinding, type GlideShape, type ShapeId } from './types';

class TestBindingUtil extends BindingUtil<GlideBinding<{ weight: number }>> {
  static override type = 'test-binding';
  static override props = { weight: T.number };
  getDefaultProps() { return { weight: 1 }; }
}

class DuplicateBoxUtil extends BoxUtil {}

class AlternateTool extends StateNode {
  static override id = 'alternate';
}

const plugin: GlidePlugin = {
  id: 'phase3-canonical',
  shapes: [BoxUtil as any, FrameUtil as any, GroupUtil as any, TextUtil as any],
  bindings: [TestBindingUtil as any],
};

function makeEditor() {
  return createEditor({ plugins: [plugin], tools: [SelectTool, AlternateTool], viewport: { width: 500, height: 300 } });
}

function box(editor: ReturnType<typeof makeEditor>, name: string, x: number, y: number, w = 40, h = 30) {
  return editor.createShape({
    id: sid(`shape:${name}`), type: 'box', x, y,
    props: { ...new BoxUtil().getDefaultProps(), w, h, label: name },
  });
}

describe('Phase 3 canonical editor acceptance', () => {
  it('exposes reactive ordering, geometry, camera, hit testing, and resolver boundaries', () => {
    const editor = createEditor({
      plugins: [plugin], viewport: { width: 500, height: 300 }, camera: { x: 10, y: 20, z: 2 },
      assetResolver: () => 'javascript:alert(1)',
    });
    const first = box(editor, 'first', 10, 20);
    const second = box(editor, 'second', 80, 20);

    expect(editor.getShapeIdsSignal().peek()).toEqual(expect.arrayContaining([first, second]));
    expect(editor.getOrderedShapeIdsSignal().peek()).toEqual(editor.getOrderedShapeIds());
    expect(editor.compareShapeOrder(editor.getShape(first)!, editor.getShape(second)!)).toBeLessThan(0);
    expect(editor.sortShapesByCanonicalOrder([editor.getShape(second)!, editor.getShape(first)!]).map(s => s.id))
      .toEqual([first, second]);
    expect(editor.getShapeSignal(first).peek()?.['id']).toBe(first);
    expect(editor.getDocumentVersionSignal().peek()).toBeGreaterThan(0);
    expect(editor.getShapesInViewport().length).toBeGreaterThan(0);
    expect(editor.getShapesInBox({ minX: 0, minY: 0, maxX: 200, maxY: 100 })).toHaveLength(2);
    expect(editor.getShapesAtPoint({ x: 20, y: 30 }).map(s => s.id)).toContain(first);
    expect(editor.getTopShapeAtPoint({ x: 20, y: 30 })?.id).toBe(first);
    expect(editor.getTopShapeAtPoint({ x: 20, y: 30 }, () => false)).toBeUndefined();
    expect(editor.getShapeLocalBounds(first).w).toBe(40);
    expect(editor.getShapeLocalOutline(first)).toHaveLength(4);
    expect(editor.getShapeWorldBounds(first).w).toBe(40);
    expect(editor.getShapeVisualWorldBounds(editor.getShape(first)!).w).toBeGreaterThanOrEqual(40);
    expect(editor.getLocalTransform(first)).toBeDefined();
    expect(editor.getWorldTransform(first)).toBeDefined();
    expect(editor.getWorldTransformInverse(first)).toBeDefined();
    expect(editor.pageToLocal(first, editor.localToPage(first, { x: 2, y: 3 }))).toEqual({ x: 2, y: 3 });
    expect(editor.parentToPage(editor.getDefaultPageId(), { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
    expect(editor.pageToParent(editor.getDefaultPageId(), { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
    expect(editor.pageDeltaToParent(editor.getDefaultPageId(), { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
    expect(editor.pageToScreen(editor.screenToPage({ x: 30, y: 40 }))).toEqual({ x: 30, y: 40 });
    expect(editor.getViewportBounds().w).toBe(250);
    expect(editor.getSmartRoutingSnapshot()).toBeDefined();
    expect(editor.resolveAssetUrl({ id: 'asset:x', kind: 'asset' } as any)).toBeNull();

    const malformed = createEditor({ plugins: [plugin], assetResolver: () => 'http://[::1' });
    expect(malformed.resolveAssetUrl({ id: 'asset:x', kind: 'asset' } as any)).toBeNull();
  });

  it('enforces hierarchy focus, clipping, hidden, locked, and ordering behavior', () => {
    const editor = makeEditor();
    const frame = editor.createShape({ type: 'frame', x: 0, y: 0, props: { ...new FrameUtil().getDefaultProps(), w: 200, h: 150, clipContent: true } });
    const child = editor.createShape({ type: 'group', parentId: frame, x: 10, y: 10, props: {} });
    const grandchild = editor.createShape({ type: 'box', parentId: child, x: 1, y: 1, props: { ...new BoxUtil().getDefaultProps(), w: 5, h: 5 } });

    expect(editor.getChildren(frame).map(s => s.id)).toEqual([child]);
    expect(editor.getOrderedChildIds(frame)).toEqual([child]);
    expect(editor.getAncestors(grandchild).map(s => s.id)).toEqual([child, frame, editor.getDefaultPageId()]);
    expect(editor.getClippingFrameAncestors(grandchild).map(s => s.id)).toEqual([frame]);
    expect(editor.getSelectableShapeId(grandchild)).toBe(child);
    expect(editor.enterGroup(frame)).toBe(false);
    expect(editor.enterGroup(child)).toBe(true);
    expect(editor.getSelectableShapeId(grandchild)).toBe(grandchild);
    expect(editor.exitGroup()).toBe(true);
    expect(editor.exitGroup()).toBe(false);
    expect(editor.enterGroup(sid('shape:missing'))).toBe(false);

    editor.setLocked([frame], true);
    expect(editor.isShapeEffectivelyLocked(grandchild)).toBe(true);
    editor.setLocked([frame], false);
    editor.setHidden([frame], true);
    expect(editor.isShapeEffectivelyHidden(grandchild)).toBe(true);
    editor.setHidden([frame], false);
    expect(editor.isShapeEffectivelyHidden(grandchild)).toBe(false);
    expect(editor.generateIndexAbove(frame)).toEqual(expect.any(String));
    expect(editor.generateIndicesBetween(frame, null, null, 3)).toHaveLength(3);
    expect(editor.generateIndicesBetween(frame, null, null, 0)).toEqual([]);
  });

  it('runs every precision and arrange mode with undoable state changes', () => {
    const editor = makeEditor();
    const ids = [box(editor, 'a', 0, 0, 20, 10), box(editor, 'b', 70, 40, 30, 20), box(editor, 'c', 160, 80, 40, 30)];
    for (const operation of ['left', 'center-x', 'right', 'top', 'center-y', 'bottom'] as const) {
      editor.alignShapes(ids, operation);
    }
    editor.distributeShapes(ids, 'horizontal', 'centers');
    editor.distributeShapes(ids, 'vertical', 'gaps');
    editor.matchShapeSizes(ids, 'width');
    editor.matchShapeSizes(ids, 'height');
    editor.matchShapeSizes(ids, 'both');
    editor.flipShapes(ids, 'horizontal');
    editor.flipShapes(ids, 'vertical');
    editor.tidyShapes(ids, 'row', 8);
    editor.tidyShapes(ids, 'grid', 12);
    editor.nudgeShapes(ids, { x: 5, y: -3 });
    editor.setShapePrecision(ids[0]!, { x: 50, y: 60, w: 100, lockAspect: true, rotation: Math.PI / 4 });
    editor.setShapePrecision(ids[1]!, { h: 80, lockAspect: true });
    editor.resetShapeRotations(ids);

    expect(editor.getShape(ids[0]!)?.rotation).toBe(0);
    expect(editor.history.undoStack.length).toBeGreaterThan(10);
    expect(editor.undo().status).toBe('applied');
    expect(editor.redo().status).toBe('applied');
    expect(() => editor.alignShapes([ids[0]!], 'left')).toThrow(/at least 2/);
    editor.setLocked([ids[0]!], true);
    expect(() => editor.nudgeShapes([ids[0]!], { x: 1, y: 1 })).toThrow(/locked/);
  });

  it('covers selection, clipboard, editing, tools, batching, and session reset contracts', () => {
    const editor = makeEditor();
    const one = box(editor, 'one', 0, 0);
    const two = box(editor, 'two', 60, 0);
    editor.setSelectedShapeIds([one, sid('shape:missing')]);
    expect(editor.getSelectedShapeIds()).toEqual([one]);
    expect(editor.getSelectionSignal().peek()).toEqual([one]);
    editor.selectAll();
    expect(editor.getSelectedShapeIds()).toHaveLength(2);
    editor.copy([one, two]);
    expect(editor.paste({ x: 200, y: 100 })).toHaveLength(2);
    expect(editor.duplicateShapes([one], { x: 7, y: 9 })).toHaveLength(1);

    const text = editor.createShape({ type: 'text', x: 0, y: 0, rotation: 0.2, props: { ...new TextUtil().getDefaultProps(), text: 'draft' } });
    editor.startEditing(text);
    expect(editor.textEditing.session.peek()?.shapeId).toBe(text);
    editor.updateEditingDraft('changed');
    editor.setEditingComposition(true);
    expect(editor.commitEditing()).toBe(false);
    editor.setEditingComposition(false);
    expect(editor.commitEditing()).toBe(true);
    expect(editor.getShape(text)?.props['text']).toBe('changed');
    editor.startEditing(one);
    expect(editor.textEditing.session.peek()?.shapeId).toBe(one);
    editor.cancelEditing(true, true);
    expect(editor.getSelectedShapeIds()).toEqual([one]);
    editor.stopEditing(true);

    editor.setCurrentTool('alternate', { preserveSelection: true });
    expect(editor.getCurrentTool()).toBeInstanceOf(AlternateTool);
    editor.dispatchEvent({ type: 'keyDown', key: 'Escape' });
    expect(() => editor.setCurrentTool('missing')).toThrow(/unknown tool/i);
    editor.batch('Create', () => box(editor, 'batched', 0, 0));
    editor.run(() => editor.setBindingPreview({ shapeId: one } as any), { history: 'ignore' });
    editor.clearBindingPreview();
    editor.resetSessionState();
    expect(editor.getSelectedShapeIds()).toEqual([]);
    expect(editor.focusedGroupId.peek()).toBeNull();
  });

  it('covers binding utilities and factory duplicate/missing static guards', () => {
    const editor = makeEditor();
    const one = box(editor, 'bound-a', 0, 0);
    const two = box(editor, 'bound-b', 80, 0);
    expect(editor.getBindingUtil('test-binding')).toBeInstanceOf(TestBindingUtil);
    expect(editor.getBindingUtil({ type: 'missing' } as any)).toBeUndefined();
    const binding = editor.createBinding({
      id: bid('binding:test'), type: 'test-binding', fromId: one, toId: two, props: { weight: 2 },
    });
    expect(editor.getBindingsFromShape(one)).toHaveLength(1);
    expect(editor.getBindingsToShape(two)).toHaveLength(1);
    editor.updateBinding(binding, { weight: 3 });
    expect(editor.store.get(binding)?.['props']).toMatchObject({ weight: 3 });
    editor.deleteBinding(binding);
    expect(editor.store.get(binding)).toBeUndefined();

    expect(() => (editor as any)._registerUtil(new BoxUtil())).toThrow(/duplicate ShapeUtil/);
    expect(() => (editor as any)._registerBindingUtil(new TestBindingUtil())).toThrow(/duplicate BindingUtil/);
    class MissingShapeType extends ShapeUtil<GlideShape<Record<string, never>>> {
      static override props = {};
      getDefaultProps() { return {}; }
      getGeometry() { return new (class { bounds = { x: 0, y: 0, w: 1, h: 1 }; })() as any; }
    }
    class MissingBindingType extends TestBindingUtil { static override type = '' as any; }
    expect(() => createEditor({ plugins: [{ id: 'missing-shape', shapes: [MissingShapeType as any] }] })).toThrow(/missing static 'type'/);
    expect(() => createEditor({ plugins: [{ id: 'missing-binding', bindings: [MissingBindingType as any] }] })).toThrow(/missing static 'type'/);
    expect(() => createEditor({ plugins: [{ id: 'dup-binding-a', bindings: [TestBindingUtil as any] }, { id: 'dup-binding-b', bindings: [TestBindingUtil as any] }] })).toThrow(/duplicate binding type/);
    expect(() => createEditor({ plugins: [{ id: 'dup-shape-a', shapes: [BoxUtil as any] }, { id: 'dup-shape-b', shapes: [DuplicateBoxUtil as any] }] })).toThrow(/duplicate shape type/);
  });

  it('rejects invalid mutation targets and preserves canonical hierarchy state', () => {
    const editor = makeEditor();
    const one = box(editor, 'guard-one', 0, 0);
    const two = box(editor, 'guard-two', 50, 0);
    const frame = editor.createShape({ type: 'frame', x: 0, y: 0, props: { ...new FrameUtil().getDefaultProps(), w: 200, h: 100 } });

    expect(() => editor.updateShape(sid('shape:missing'), { x: 1 })).toThrow(/not found/);
    expect(() => editor.updateShape(one, { index: 'bad' } as any)).toThrow(/managed by reorderShapes/);
    editor.setLocked([one], true);
    expect(() => editor.updateShape(one, { x: 1 })).toThrow(/locked/);
    expect(() => editor.deleteShapes([one])).toThrow(/Locked shapes/);
    expect(() => editor.reorderShapes([one], 'front')).toThrow(/Locked shapes/);
    expect(() => editor.reparentShapes([one], frame)).toThrow(/Locked shapes/);
    editor.setLocked([one], false);
    editor.setLocked([frame], true);
    expect(() => editor.reparentShapes([one], frame)).toThrow(/locked container/);
    editor.setLocked([frame], false);

    expect(() => editor.reparentShapes([frame], frame)).toThrow(/own parent/);
    expect(() => editor.reparentShapes([sid('shape:missing')], frame)).toThrow(/not found/);
    expect(() => editor.reparentShapes([one], sid('shape:missing'))).toThrow(/must be a page/);
    expect(() => editor.reparentShapes([one], two)).toThrow(/must be a page/);
    expect(() => editor.groupShapes([sid('shape:missing'), two])).toThrow(/not found/);
    expect(() => editor.groupShapes([one])).toThrow(/at least two/);
    editor.reparentShapes([two], frame);
    expect(() => editor.groupShapes([one, two])).toThrow(/siblings/);
    editor.reparentShapes([two], editor.getDefaultPageId());
    editor.setLocked([two], true);
    expect(() => editor.groupShapes([one, two])).toThrow(/Locked shapes/);
    editor.setLocked([two], false);
    expect(() => editor.ungroupShapes([one])).toThrow(/not a group/);
    expect(() => editor.removeFramesKeepContent([one])).toThrow(/not a frame/);

    editor.reorderShapes([], 'front');
    editor.reorderShapes([one, two], 'front');
    editor.reorderShapes([one], 'front');
    editor.reorderShapes([one], 'back');
    editor.reorderShapes([one], 'forward');
    editor.reorderShapes([one], 'backward');
    expect(editor.getShapes(true)).toHaveLength(3);
    expect(editor.duplicateShapes([sid('shape:missing')])).toEqual([]);
    editor.deleteShapes([sid('shape:missing')]);
    editor.startEditing(sid('shape:missing'));
    expect(editor.textEditing.session.peek()).toBeNull();
    expect(() => editor.getShapeLocalBounds(sid('shape:missing'))).toThrow(/not found/);
    expect(() => editor.getShapeWorldBounds(sid('shape:missing'))).toThrow(/not found/);
    expect(() => editor.getShapeVisualWorldBounds(sid('shape:missing'))).toThrow(/not found/);
  });

  it('round trips persistence and exports visible clipped SVG content', () => {
    const editor = makeEditor();
    const frame = editor.createShape({ type: 'frame', x: 5, y: 5, props: { ...new FrameUtil().getDefaultProps(), w: 120, h: 80, clipContent: true } });
    const child = editor.createShape({ type: 'box', parentId: frame, x: 10, y: 10, props: { ...new BoxUtil().getDefaultProps(), w: 40, h: 20 } });
    const hidden = box(editor, 'hidden-export', 200, 0);
    editor.setHidden([hidden], true);

    const svg = editor.exportToSvg([frame]);
    expect(svg).toContain('<clipPath');
    expect(svg).toContain('viewBox=');
    expect(editor.exportRegionToSvg({ x: 0, y: 0, w: 300, h: 200, minX: 0, minY: 0, maxX: 300, maxY: 200 })).toContain('width="300"');
    expect(editor.exportToSvg([])).toBe('<svg></svg>');
    expect(editor.getAIContext()).toBeDefined();
    expect(editor.getAIContext({ viewport: true })).toBeDefined();

    const document = editor.serialize();
    const destination = makeEditor();
    destination.deserialize(document);
    expect(destination.getShape(child)).toBeDefined();
    const blank = makeEditor().serialize();
    destination.replaceDocument(blank);
    expect(destination.getShape(child)).toBeUndefined();
    const imported = destination.importRecords(document.records);
    expect(destination.getShape(imported.idMap[child] as ShapeId)).toBeDefined();
    const second = makeEditor();
    const importedObject = second.importRecords(document);
    expect(second.getShape(importedObject.idMap[frame] as ShapeId)).toBeDefined();
  });

  it('preflights malformed portable relationships and compensates failed pastes', async () => {
    const source = makeEditor();
    const one = box(source, 'portable-one', 0, 0);
    const two = box(source, 'portable-two', 60, 0);
    source.createBinding({ type: 'test-binding', fromId: one, toId: two, props: { weight: 1 } });
    const fragment = await source.createPortableBoardFragment([one, two], {
      exportRasterAsset: vi.fn(), retainAssetReferences: vi.fn(async () => undefined),
    });
    expect(fragment).not.toBeNull();
    const destination = makeEditor();
    const paste = (candidate: any) => destination.pastePortableBoardFragment(candidate, {
      materializeRasterAsset: vi.fn(),
    });

    await expect(paste({ ...fragment!, records: [...fragment!.records.map(record => structuredClone(record)), structuredClone(fragment!.records[0])] }))
      .rejects.toThrow(/Duplicate portable record/);
    await expect(paste({ ...fragment!, rootIds: ['shape:not-imported'] })).rejects.toThrow(/not a shape/);
    await expect(paste({ ...fragment!, assetRefs: [one] })).rejects.toThrow(/not an imported asset/);
    await expect(paste({
      ...fragment!, records: fragment!.records.map(record => record['id'] === one
        ? { ...record, parentId: 'shape:not-imported' } : record),
    })).rejects.toThrow(/invalid parent/);
    const binding = fragment!.records.find(record => record['kind'] === 'binding')!;
    await expect(paste({
      ...fragment!, records: fragment!.records.map(record => record === binding
        ? { ...record, fromId: 'shape:not-imported' } : record),
    })).rejects.toThrow(/must reference imported shapes/);

    const denied = makeEditor();
    const deny = createEditor({
      plugins: [plugin], tools: [SelectTool],
      mutationPolicy: { authorize: request => request.command === 'document.import' ? 'deny' : 'allow' },
    });
    await expect(deny.pastePortableBoardFragment(fragment!, { materializeRasterAsset: vi.fn() })).rejects.toThrow(/not permitted/i);
    expect(await denied.createPortableBoardFragment([sid('shape:missing')], {
      exportRasterAsset: vi.fn(), retainAssetReferences: vi.fn(),
    })).toBeNull();
  });

  it('validates portable structure boundaries before mutation', () => {
    const rasterAssetId = `asset:sha256:${'a'.repeat(64)}`;
    const bounds = { x: 0, y: 0, w: 1, h: 1, minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const valid: any = {
      schema: { portableBoardFragmentVersion: 1, storeVersion: 6 },
      rootIds: [], records: [], assetRefs: [], rasterPayloads: [], sourceBounds: bounds,
      resolutionContext: { documentId: 'doc', metadata: { ok: true } },
    };
    expect(() => validatePortableBoardFragmentStructure(valid)).not.toThrow();
    const cases: any[] = [
      null,
      { ...valid, extra: true },
      { ...valid, schema: null },
      { ...valid, schema: { ...valid.schema, extra: true } },
      { ...valid, schema: { ...valid.schema, portableBoardFragmentVersion: 2 } },
      { ...valid, schema: { ...valid.schema, storeVersion: 0 } },
      { ...valid, schema: { ...valid.schema, storeVersion: 1.5 } },
      { ...valid, schema: { ...valid.schema, storeVersion: 999 } },
      { ...valid, rootIds: 'bad' },
      { ...valid, rootIds: [3] },
      { ...valid, rootIds: [''] },
      { ...valid, rootIds: ['x'.repeat(1_048_577)] },
      { ...valid, rootIds: ['same', 'same'] },
      { ...valid, assetRefs: [null] },
      { ...valid, records: [null] },
      { ...valid, records: [{ meta: { value: Number.NaN } }] },
      { ...valid, sourceBounds: null },
      { ...valid, sourceBounds: { ...bounds, extra: 1 } },
      { ...valid, sourceBounds: { ...bounds, x: Number.NaN } },
      { ...valid, resolutionContext: [] },
      { ...valid, resolutionContext: { documentId: 'doc', extra: true } },
      { ...valid, rasterPayloads: [null] },
      { ...valid, rasterPayloads: [{ kind: 'embedded', base64: '', byteLength: 0 }] },
      { ...valid, rasterPayloads: [{ assetId: rasterAssetId, kind: 'embedded', base64: '!', byteLength: 1 }] },
      { ...valid, rasterPayloads: [{ assetId: rasterAssetId, kind: 'embedded', base64: '', byteLength: 1.5 }] },
      { ...valid, rasterPayloads: [{ assetId: rasterAssetId, kind: 'embedded', base64: '', byteLength: 21 * 1024 * 1024 }] },
      { ...valid, rasterPayloads: [{ assetId: rasterAssetId, kind: 'embedded', base64: 3, byteLength: 1 }] },
      { ...valid, rasterPayloads: [{ assetId: rasterAssetId, kind: 'embedded', base64: '', byteLength: -1 }] },
      { ...valid, rasterPayloads: [{ assetId: rasterAssetId, kind: 'durable-reference', reference: 3 }] },
      { ...valid, rasterPayloads: [{ assetId: rasterAssetId, kind: 'durable-reference', reference: '' }] },
      { ...valid, rasterPayloads: [{ assetId: rasterAssetId, kind: 'durable-reference', reference: 'x'.repeat(1_048_577) }] },
      { ...valid, rasterPayloads: [{ assetId: rasterAssetId, kind: 'unknown' }] },
    ];
    cases.forEach((candidate, index) => {
      expect(() => validatePortableBoardFragmentStructure(candidate), `portable boundary case ${index}`).toThrow();
    });

    const deep: any = {};
    let cursor = deep;
    for (let index = 0; index < 66; index++) cursor = cursor.next = {};
    const arrayCycle: any[] = [];
    arrayCycle.push(arrayCycle);
    const objectCycle: any = {};
    objectCycle.self = objectCycle;
    for (const records of [
      [{ meta: deep }],
      [{ meta: arrayCycle }],
      [{ meta: objectCycle }],
      [{ meta: { value: BigInt(1) } }],
      [{ meta: { value: 'x'.repeat(65_537) } }],
    ]) expect(() => validatePortableBoardFragmentStructure({ ...valid, records })).toThrow();
    expect(() => validatePortableBoardFragmentStructure({
      ...valid, rasterPayloads: [{ assetId: rasterAssetId, kind: 'embedded', base64: '!!!!', byteLength: 3 }],
    })).toThrow(/canonical base64/);

    const rollbackError = new PortablePasteRollbackError(new Error('import'), [new Error('rollback')]);
    expect(rollbackError.importError).toBeInstanceOf(Error);
    expect(rollbackError.rollbackErrors).toHaveLength(1);
    const editor = makeEditor();
    expect(getMutableStoreForTesting(editor)).toBeDefined();
    expect(getHistoryManagerForTesting(editor)).toBeDefined();
  });
});
