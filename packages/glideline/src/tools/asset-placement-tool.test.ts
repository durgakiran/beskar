import { describe, expect, it, vi } from 'vitest';
import { createEditor, type GlidePlugin } from '../editor';
import { SanitizedAssetPlugin } from '../shapes/SanitizedSvgUtil';
import { aid, type GlideAsset } from '../types';
import {
  AssetPlacementPlugin,
  AssetPlacementTool,
  type AssetMaterialization,
  type AssetPlacementSelection,
} from './AssetPlacementTool';

const selection: AssetPlacementSelection = {
  itemId: 'vendor:mark',
  mediaType: 'svg',
  width: 200,
  height: 100,
  provenance: {
    providerId: 'vendor',
    itemId: 'vendor:mark',
    sourceLibraryId: 'brand-kit',
    sourceVersion: '7.2.1',
    license: 'CC-BY-4.0',
  },
};

const HASH = 'a'.repeat(64);

function asset(hash = HASH): GlideAsset {
  return {
    id: aid(`asset:sha256:${hash}`),
    kind: 'asset',
    type: 'sanitized-svg',
    schemaVersion: 1,
    props: {
      hash,
      mimeType: 'image/svg+xml',
      sanitizerVersion: 1,
      byteLength: 12,
      width: 200,
      height: 100,
      viewBox: [0, 0, 200, 100],
      paths: [{ d: 'M0 0 L200 100' }],
    },
    meta: {},
  };
}

function materialized(hash = HASH): AssetMaterialization {
  return { asset: asset(hash), contentHash: hash, rollback: vi.fn() };
}

function makeEditor() {
  const plugins: GlidePlugin[] = [SanitizedAssetPlugin as GlidePlugin, AssetPlacementPlugin as GlidePlugin];
  const editor = createEditor({ plugins });
  editor.setCurrentTool('asset');
  return { editor, tool: editor.getCurrentTool() as AssetPlacementTool };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('AssetPlacementTool', () => {
  it('places a click-sized SVG and retains immutable source metadata', async () => {
    const { editor, tool } = makeEditor();
    tool.configure(selection, async () => materialized());

    editor.dispatchEvent({ type: 'pointerDown', point: { x: 300, y: 200 }, shiftKey: false, target: 'canvas' });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 300, y: 200 } });
    await settle();

    const shape = editor.getShape(editor.getSelectedShapeIds()[0]!)!;
    expect(shape.type).toBe('sanitized-svg');
    expect(shape.props).toMatchObject({ w: 200, h: 100, assetId: `asset:sha256:${HASH}` });
    expect({ x: shape.x, y: shape.y }).toEqual({ x: 200, y: 150 });
    expect(shape.meta['assetLibrary']).toEqual({
      ...selection.provenance,
      contentHash: HASH,
    });
    expect(editor.store.get(`asset:sha256:${HASH}`)?.['meta']).toEqual({
      assetLibrary: { ...selection.provenance, contentHash: HASH },
    });
  });

  it('uses the same tool for aspect-safe drag placement', async () => {
    const { editor, tool } = makeEditor();
    tool.configure(selection, async () => materialized());

    editor.dispatchEvent({ type: 'pointerDown', point: { x: 10, y: 20 }, shiftKey: false, target: 'canvas' });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 310, y: 320 } });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 310, y: 320 } });
    await settle();

    expect(editor.getShape(editor.getSelectedShapeIds()[0]!)!.props).toMatchObject({ w: 300, h: 150 });
  });

  it('places raster assets through the same generic contract', async () => {
    const { editor, tool } = makeEditor();
    const rasterSelection: AssetPlacementSelection = {
      ...selection,
      mediaType: 'raster',
      width: 640,
      height: 480,
    };
    const raster: AssetMaterialization = {
      asset: {
        id: aid(`asset:sha256:${HASH}`),
        kind: 'asset',
        type: 'raster-image',
        schemaVersion: 1,
        props: { hash: HASH, mimeType: 'image/png', byteLength: 100, width: 640, height: 480 },
        meta: {},
      },
      contentHash: HASH,
      rollback: vi.fn(),
    };
    tool.configure(rasterSelection, async () => raster);

    const id = await tool.place({ x: 5, y: 10, w: 320, h: 240 });

    expect(editor.getShape(id!)?.type).toBe('raster-image');
    expect(editor.getShape(id!)?.props).toMatchObject({ w: 320, h: 240, assetId: raster.asset.id });
  });

  it('creates neither asset nor shape when materialization fails', async () => {
    const { editor, tool } = makeEditor();
    const onError = vi.fn();
    tool.configure(selection, async () => { throw new Error('offline'); }, { onError });

    const result = await tool.place({ x: 0, y: 0, w: 100, h: 50 });

    expect(result).toBeNull();
    expect(editor.serialize().records.filter(record => record.kind === 'asset')).toHaveLength(0);
    expect(editor.serialize().records.filter(record => record.kind === 'shape')).toHaveLength(0);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' }));
  });

  it('rolls materialization back when the atomic store command rejects it', async () => {
    const { editor, tool } = makeEditor();
    const result = materialized();
    result.asset.props.hash = 'b'.repeat(64);
    tool.configure(selection, async () => result);

    await tool.place({ x: 0, y: 0, w: 100, h: 50 });

    expect(result.rollback).toHaveBeenCalledOnce();
    expect(result.rollback).toHaveBeenCalledWith('placement-failed');
    expect(editor.serialize().records.filter(record => record.kind === 'asset')).toHaveLength(0);
    expect(editor.serialize().records.filter(record => record.kind === 'shape')).toHaveLength(0);
  });

  it('cancels an in-flight operation without reporting an error', async () => {
    const { editor, tool } = makeEditor();
    const onError = vi.fn();
    let observedSignal: AbortSignal | undefined;
    tool.configure(selection, request => {
      observedSignal = request.signal;
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
      });
    }, { onError });

    editor.dispatchEvent({ type: 'pointerDown', point: { x: 0, y: 0 }, shiftKey: false, target: 'canvas' });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 0, y: 0 } });
    await Promise.resolve();
    tool.cancel();
    await settle();

    expect(observedSignal?.aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(() => tool.getSelection()).toThrow('not configured');
    expect(editor.serialize().records.filter(record => record.kind === 'asset' || record.kind === 'shape')).toHaveLength(0);
  });

  it('clears its configured selection when Escape cancels placement', () => {
    const first = makeEditor();
    first.tool.configure(selection, async () => materialized());
    first.editor.dispatchEvent({ type: 'keyDown', key: 'Escape' });
    expect(first.editor.currentToolId.peek()).toBe('select');
    expect(() => first.tool.getSelection()).toThrow('not configured');
  });

  it('deduplicates retained content and commits placement as one undo entry', async () => {
    const { editor, tool } = makeEditor();
    tool.configure(selection, async () => materialized());
    await tool.place({ x: 0, y: 0, w: 100, h: 50 });

    editor.setCurrentTool('asset');
    tool.configure(selection, async () => materialized());
    await tool.place({ x: 120, y: 0, w: 100, h: 50 });

    expect(editor.serialize().records.filter(record => record.kind === 'asset')).toHaveLength(1);
    expect(editor.serialize().records.filter(record => record.kind === 'shape')).toHaveLength(2);
    editor.undo();
    expect(editor.serialize().records.filter(record => record.kind === 'shape')).toHaveLength(1);
    expect(editor.serialize().records.filter(record => record.kind === 'asset')).toHaveLength(1);
  });

  it('merges missing retained metadata when content hashes deduplicate', async () => {
    const { editor, tool } = makeEditor();
    tool.configure({
      ...selection,
      provenance: { ...selection.provenance, sourceVersion: '', license: '' },
    }, async () => materialized());
    await tool.place({ x: 0, y: 0, w: 100, h: 50 });

    editor.setCurrentTool('asset');
    tool.configure(selection, async () => materialized());
    await tool.place({ x: 120, y: 0, w: 100, h: 50 });

    expect(editor.store.get(`asset:sha256:${HASH}`)?.['meta']).toMatchObject({
      assetLibrary: {
        sourceVersion: selection.provenance.sourceVersion,
        license: selection.provenance.license,
      },
    });
  });

  it('does not compensate committed records when post-commit work throws', async () => {
    const { editor, tool } = makeEditor();
    const result = materialized();
    const onError = vi.fn();
    const onPlaced = vi.fn(() => { throw new Error('placed callback failed'); });
    vi.spyOn(editor, 'setSelectedShapeIds').mockImplementation(() => {
      throw new Error('selection failed');
    });
    tool.configure(selection, async () => result, { onError, onPlaced });

    const shapeId = await tool.place({ x: 0, y: 0, w: 100, h: 50 });

    expect(shapeId).not.toBeNull();
    expect(editor.getShape(shapeId!)).toBeDefined();
    expect(editor.store.get(String(result.asset.id))).toBeDefined();
    expect(result.rollback).not.toHaveBeenCalled();
    expect(onPlaced).toHaveBeenCalledWith(shapeId);
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
