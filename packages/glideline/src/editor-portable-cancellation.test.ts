// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { createEditor, getMutableStoreForTesting, type PortableAssetMaterialization } from './editor';
import { RasterImageUtil } from './shapes/RasterImageUtil';
import { aid } from './types';

const PNG_BYTES = new Uint8Array([137, 80, 78, 71]);
const HASH = 'a'.repeat(64);

function makeEditor() {
  return createEditor({ plugins: [{ id: 'portable-cancellation', shapes: [RasterImageUtil] }] });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

async function rasterFragment() {
  const editor = makeEditor();
  const assetId = aid(`asset:sha256:${HASH}`);
  getMutableStoreForTesting(editor).transact({ origin: 'system', history: 'ignore' }, tx => {
    tx.insert({
      id: assetId, kind: 'asset', type: 'raster-image', schemaVersion: 1,
      props: { hash: HASH, mimeType: 'image/png', byteLength: PNG_BYTES.byteLength, width: 1, height: 1 },
      meta: {},
    });
  });
  const shapeId = editor.createShape({
    type: 'raster-image', x: 10, y: 20, props: { w: 30, h: 20, assetId },
  });
  return (await editor.createPortableBoardFragment([shapeId], {
    exportRasterAsset: async () => ({ kind: 'self-contained', bytes: PNG_BYTES }),
    retainAssetReferences: () => undefined,
  }))!;
}

describe('portable paste readiness and cancellation', () => {
  it('compensates cancellation after materialization resolves and settles only after cleanup', async () => {
    const fragment = await rasterFragment();
    const editor = makeEditor();
    const abort = new AbortController();
    const materialization = deferred<PortableAssetMaterialization>();
    const cleanup = deferred<void>();
    const rollback = vi.fn(() => cleanup.promise);
    const beforeCommit = vi.fn();
    const pending = editor.pastePortableBoardFragment(fragment, {
      signal: abort.signal, materializeRasterAsset: () => materialization.promise, beforeCommit,
    });
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    materialization.resolve({ rollback });
    abort.abort();
    await Promise.resolve();

    expect(rollback).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    expect(beforeCommit).not.toHaveBeenCalled();
    expect(editor.serialize().records.filter(record => record.kind === 'shape' || record.kind === 'asset')).toEqual([]);

    cleanup.resolve();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(settled).toBe(true);
  });

  it('compensates materialized files when the host rejects the final document commit', async () => {
    const fragment = await rasterFragment();
    const editor = makeEditor();
    const rollback = vi.fn();
    const beforeCommit = vi.fn(() => {
      expect(editor.serialize().records.filter(record => record.kind === 'shape' || record.kind === 'asset')).toEqual([]);
      throw new Error('Board session changed');
    });

    await expect(editor.pastePortableBoardFragment(fragment, {
      materializeRasterAsset: async () => ({ rollback }), beforeCommit,
    })).rejects.toThrow('Board session changed');

    expect(beforeCommit).toHaveBeenCalledOnce();
    expect(rollback).toHaveBeenCalledOnce();
    expect(editor.serialize().records.filter(record => record.kind === 'shape' || record.kind === 'asset')).toEqual([]);
  });

  it.each(['initial', 'explicit'] as const)('retains the %s destination without replacing a newer selection', async destination => {
    const fragment = await rasterFragment();
    const editor = makeEditor();
    const initialPage = editor.getActivePageId();
    const newPage = editor.createPage('Another page');
    const existingIds = await editor.pastePortableBoardFragment(fragment, {
      materializeRasterAsset: async () => ({ rollback: vi.fn() }),
    });
    if (destination === 'initial') editor.setActivePage(initialPage);
    const materialization = deferred<PortableAssetMaterialization>();
    const pending = editor.pastePortableBoardFragment(fragment, {
      materializeRasterAsset: () => materialization.promise,
      ...(destination === 'explicit' ? { targetPageId: initialPage } : {}),
      select: false,
    });
    editor.setActivePage(newPage);
    editor.setSelectedShapeIds(existingIds);
    const rollback = vi.fn();
    materialization.resolve({ rollback });
    const ids = await pending;

    expect(ids).toHaveLength(1);
    expect(editor.getShape(ids[0]!)?.parentId).toBe(initialPage);
    expect(editor.getActivePageId()).toBe(newPage);
    expect(editor.getSelectedShapeIds()).toEqual(existingIds);
    expect(rollback).not.toHaveBeenCalled();
  });
});
