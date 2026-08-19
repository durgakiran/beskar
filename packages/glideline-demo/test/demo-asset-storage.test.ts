// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GlideAsset } from '@durgakiran/glideline';
import { createDemoAssetStorage } from '../src/demo-asset-storage';
import type { DemoAssetStorage } from '../src/demo-asset-storage';

const asset = {
  id: `asset:sha256:${'a'.repeat(64)}`,
  type: 'raster-image',
  props: { mimeType: 'image/png' },
  meta: {},
} as unknown as GlideAsset;

async function stage(storage: DemoAssetStorage, target: GlideAsset, bytes: Uint8Array) {
  const signal = new AbortController().signal;
  const persistence = await storage.prepare!(target, signal);
  await persistence.stage(bytes, signal);
  return persistence;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createDemoAssetStorage', () => {
  it('removes staged bytes when a late failure rolls back after commit', async () => {
    const revokeObjectURL = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo-asset');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
    const storage = createDemoAssetStorage({
      isSlowUpload: () => false,
      consumeUploadFailure: () => false,
    });

    const persistence = await stage(storage, asset, new Uint8Array([1, 2, 3]));
    expect(storage.resolve(asset)).toBeNull();

    await persistence.commit(new AbortController().signal);
    expect(storage.resolve(asset)).toBe('blob:demo-asset');
    await persistence.rollback();

    expect(storage.resolve(asset)).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:demo-asset');
  });

  it('restores raster bytes by immutable hash after storage is recreated', async () => {
    const urls = ['blob:first', 'blob:restored'];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => urls.shift()!);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const options = { isSlowUpload: () => false, consumeUploadFailure: () => false };
    const first = createDemoAssetStorage(options);
    const persistence = await stage(first, asset, new Uint8Array([1, 2, 3]));
    await persistence.commit(new AbortController().signal);
    first.dispose();

    const restored = createDemoAssetStorage(options);
    expect(restored.resolve(asset)).toBe('blob:restored');
    await expect(restored.download!(asset, new AbortController().signal)).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
    });
    restored.dispose();
  });

  it('cancels deferred disposal when React StrictMode immediately reactivates storage', async () => {
    const revokeObjectURL = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:strict-mode');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
    const storage = createDemoAssetStorage({ isSlowUpload: () => false, consumeUploadFailure: () => false });
    storage.activate();
    const persistence = await stage(storage, asset, new Uint8Array([1, 2, 3]));
    await persistence.commit(new AbortController().signal);

    storage.dispose();
    storage.activate();
    await Promise.resolve();

    expect(storage.resolve(asset)).toBe('blob:strict-mode');
    expect(revokeObjectURL).not.toHaveBeenCalled();
    storage.dispose();
  });

  it('rejects untrusted durable references without sending a request', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:portable');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const storage = createDemoAssetStorage({ isSlowUpload: () => false, consumeUploadFailure: () => false });

    await expect(storage.materializePortableAsset!(
      { assetId: String(asset.id), kind: 'durable-reference', reference: 'https://untrusted.example/asset.png' },
      asset,
      undefined,
      new AbortController().signal,
    )).rejects.toThrow(/trusted whiteboard media URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed raster IDs before decode, fetch, or persistence', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const storage = createDemoAssetStorage({ isSlowUpload: () => false, consumeUploadFailure: () => false });
    const prepare = vi.spyOn(storage, 'prepare');
    const invalidIds = ['', 'asset:a', `asset:sha256:${'A'.repeat(64)}`, `asset:sha256:${'é'.repeat(64)}`];

    for (const assetId of invalidIds) {
      await expect(storage.materializePortableAsset!(
        { assetId, kind: 'embedded', base64: 'AQ==', byteLength: 1 },
        asset,
        undefined,
        new AbortController().signal,
      )).rejects.toThrow(/canonical SHA-256/);
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('includes credentials only for a canonical same-origin media reference', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:portable');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const hash = 'a'.repeat(64);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: new Headers({ 'content-type': 'image/png' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const storage = createDemoAssetStorage({ isSlowUpload: () => false, consumeUploadFailure: () => false });

    await storage.materializePortableAsset!(
      { assetId: String(asset.id), kind: 'durable-reference', reference: `/api/v1/media/whiteboard-asset/2/${hash}` },
      asset,
      undefined,
      new AbortController().signal,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `${window.location.origin}/api/v1/media/whiteboard-asset/2/${hash}`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('rolls back portable staging after stage failure', async () => {
    const storage = createDemoAssetStorage({ isSlowUpload: () => false, consumeUploadFailure: () => false });
    const rollback = vi.fn().mockResolvedValue(undefined);
    storage.prepare = vi.fn().mockResolvedValue({
      token: 'portable-stage',
      stage: vi.fn().mockRejectedValue(new Error('stage failed')),
      commit: vi.fn(),
      rollback,
    });

    await expect(storage.materializePortableAsset!(
      { assetId: String(asset.id), kind: 'embedded', base64: 'AQ==', byteLength: 1 },
      asset,
      undefined,
      new AbortController().signal,
    )).rejects.toThrow('stage failed');
    expect(rollback).toHaveBeenCalledOnce();
  });

  it('surfaces portable persistence and rollback failures together', async () => {
    const storage = createDemoAssetStorage({ isSlowUpload: () => false, consumeUploadFailure: () => false });
    storage.prepare = vi.fn().mockResolvedValue({
      token: 'portable-rollback-failure',
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockRejectedValue(new Error('commit failed')),
      rollback: vi.fn().mockRejectedValue(new Error('rollback failed')),
    });

    await expect(storage.materializePortableAsset!(
      { assetId: String(asset.id), kind: 'embedded', base64: 'AQ==', byteLength: 1 },
      asset,
      undefined,
      new AbortController().signal,
    )).rejects.toThrow(/persistence and rollback both failed/);
  });

  it('resets stale raster quota so a fresh C1 import can succeed', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:quota-${Math.random()}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const usageChanges: number[] = [];
    const storage = createDemoAssetStorage({
      isSlowUpload: () => false,
      consumeUploadFailure: () => false,
      quotaBytes: 3,
      onUsageChange: usage => usageChanges.push(usage),
    });
    const fullAsset = { ...asset, id: `asset:sha256:${'f'.repeat(64)}` } as GlideAsset;
    const full = await stage(storage, fullAsset, new Uint8Array([1, 2, 3]));
    await full.commit(new AbortController().signal);
    await expect(stage(storage, asset, new Uint8Array([4])))
      .rejects.toMatchObject({ category: 'limit-exceeded', retryable: false });

    storage.reset();
    expect(storage.usageBytes()).toBe(0);
    const fresh = await stage(storage, asset, new Uint8Array([4]));
    await fresh.commit(new AbortController().signal);

    expect(storage.usageBytes()).toBe(1);
    expect(usageChanges).toEqual([3, 0, 1]);
    storage.dispose();
  });

  it('ignores malformed restored entries and removes invalid persisted JSON', () => {
    const key = 'glideline-whiteboard-demo-raster-bytes-v1';
    window.localStorage.setItem(key, JSON.stringify([
      null,
      3,
      { hash: 1, mimeType: 'image/png', base64: 'AQ==' },
      { hash: 'restored', mimeType: 'image/png', base64: 'AQ==' },
    ]));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:restored-valid');
    const restored = createDemoAssetStorage({ isSlowUpload: () => false, consumeUploadFailure: () => false });
    const restoredAsset = { ...asset, props: { ...asset.props, hash: 'restored' } } as GlideAsset;
    expect(restored.resolve(restoredAsset)).toBe('blob:restored-valid');

    window.localStorage.setItem(key, '{');
    createDemoAssetStorage({ isSlowUpload: () => false, consumeUploadFailure: () => false });
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('covers cancellation and injected storage failure during staging', async () => {
    const storage = createDemoAssetStorage({ isSlowUpload: () => true, consumeUploadFailure: () => false });
    const aborted = new AbortController();
    aborted.abort();
    await expect(storage.prepare!(asset, aborted.signal)).rejects.toMatchObject({ name: 'AbortError' });

    const persistence = await storage.prepare!(asset, new AbortController().signal);
    await expect(persistence.stage(new Uint8Array([1]), aborted.signal)).rejects.toMatchObject({ name: 'AbortError' });

    vi.useFakeTimers();
    const waiting = new AbortController();
    const pending = persistence.stage(new Uint8Array([1]), waiting.signal);
    waiting.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    vi.useRealTimers();

    const failing = createDemoAssetStorage({ isSlowUpload: () => false, consumeUploadFailure: () => true });
    const failedPersistence = await failing.prepare!(asset, new AbortController().signal);
    await expect(failedPersistence.stage(new Uint8Array([1]), new AbortController().signal))
      .rejects.toMatchObject({ category: 'storage', retryable: true });
  });

  it('enforces commit guards, deduplicates bytes, and makes rollback idempotent', async () => {
    const revoke = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:guarded');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
    const storage = createDemoAssetStorage({ isSlowUpload: () => false, consumeUploadFailure: () => false });
    const unstaged = await storage.prepare!(asset, new AbortController().signal);
    await expect(unstaged.commit(new AbortController().signal)).rejects.toThrow(/has not been staged/);

    const staged = await stage(storage, asset, new Uint8Array([1]));
    const aborted = new AbortController();
    aborted.abort();
    await expect(staged.commit(aborted.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await staged.rollback();
    await staged.rollback();
    await expect(staged.commit(new AbortController().signal)).rejects.toThrow(/already rolled back/);

    const first = await stage(storage, asset, new Uint8Array([1]));
    await first.commit(new AbortController().signal);
    const duplicate = await stage(storage, asset, new Uint8Array([1]));
    await duplicate.commit(new AbortController().signal);
    expect(storage.usageBytes()).toBe(1);
    expect(revoke).toHaveBeenCalled();
  });

  it('rejects a quota race discovered at commit time', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:quota-race');
    const storage = createDemoAssetStorage({
      isSlowUpload: () => false,
      consumeUploadFailure: () => false,
      quotaBytes: 1,
    });
    const firstAsset = { ...asset, props: { ...asset.props, hash: 'first' } } as GlideAsset;
    const secondAsset = { ...asset, props: { ...asset.props, hash: 'second' } } as GlideAsset;
    const first = await stage(storage, firstAsset, new Uint8Array([1]));
    const second = await stage(storage, secondAsset, new Uint8Array([2]));
    await first.commit(new AbortController().signal);
    await expect(second.commit(new AbortController().signal))
      .rejects.toMatchObject({ category: 'limit-exceeded' });
  });

  it('reports persistence failures and validates download/materialization terminal states', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:persistence');
    const storage = createDemoAssetStorage({ isSlowUpload: () => false, consumeUploadFailure: () => false });
    const persistence = await stage(storage, asset, new Uint8Array([1]));
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    await expect(persistence.commit(new AbortController().signal))
      .rejects.toMatchObject({ category: 'limit-exceeded' });
    setItem.mockRestore();

    const aborted = new AbortController();
    aborted.abort();
    await expect(storage.download!(asset, aborted.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(storage.download!(asset, new AbortController().signal)).rejects.toThrow(/no longer in memory/);
    await expect(storage.materializePortableAsset!(
      { assetId: String(asset.id), kind: 'embedded', base64: 'AQ==', byteLength: 1 },
      asset,
      undefined,
      aborted.signal,
    )).rejects.toMatchObject({ name: 'AbortError' });

    const hash = 'b'.repeat(64);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, headers: new Headers() }));
    await expect(storage.materializePortableAsset!(
      { assetId: String(asset.id), kind: 'durable-reference', reference: `/api/v1/media/whiteboard-asset/3/${hash}` },
      asset,
      undefined,
      new AbortController().signal,
    )).rejects.toThrow(/503/);
  });

  it('rejects activation after deferred disposal completes', async () => {
    const storage = createDemoAssetStorage({ isSlowUpload: () => false, consumeUploadFailure: () => false });
    storage.dispose();
    await Promise.resolve();
    expect(() => storage.activate()).toThrow(/already disposed/);
    storage.dispose();
    await Promise.resolve();
  });
});
