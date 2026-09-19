import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlideboardController } from './GlideboardController';
import type { GlideboardAssetPersistence, GlideboardAssetStorage } from './types';

const controllers: GlideboardController[] = [];
const releasePending: Array<() => void> = [];

afterEach(async () => {
  releasePending.splice(0).forEach(release => release());
  await Promise.all(controllers.splice(0).map(controller => controller.dispose()));
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

function png(): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, 32);
  new DataView(bytes.buffer).setUint32(20, 16);
  return bytes;
}

function persistence(): GlideboardAssetPersistence {
  return {
    token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    stage: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
  };
}

function create(assetStorage: GlideboardAssetStorage) {
  const controller = new GlideboardController({
    sessionKey: `asset-lifecycle-${controllers.length}`, assetStorage,
  });
  controllers.push(controller);
  return controller;
}

describe('asset lifecycle regressions', () => {
  it('captures portable source records before synchronous cut removes them', async () => {
    const controller = create({
      prepare: async () => persistence(), resolve: () => null,
      download: async () => ({ bytes: png(), mimeType: 'image/png' }),
      retainReferences: async () => undefined,
    });
    const shapeId = controller.editor.createShape({
      type: 'box', x: 10, y: 20, props: { w: 40, h: 30, label: 'Cut this shape' },
    });
    const fragment = controller.createPortableFragment({ shapeIds: [shapeId] });
    controller.editor.deleteShapes([shapeId]);

    expect(controller.editor.getShape(shapeId)).toBeUndefined();
    const copied = await fragment;
    expect(copied).not.toBeNull();
    expect(copied?.rootIds).toEqual([shapeId]);
    expect(copied?.records.find(record => record.id === shapeId)).toMatchObject({
      id: shapeId, kind: 'shape', type: 'box', x: 10, y: 20,
      props: { label: 'Cut this shape' },
    });
  });

  it('keeps replacement snapshot records when a legacy commit settles after document replacement', async () => {
    const started = deferred();
    const commit = deferred();
    releasePending.push(commit.resolve);
    const transaction = {
      ...persistence(),
      commit: vi.fn(async () => {
        started.resolve();
        await commit.promise;
      }),
    };
    const controller = create({ prepare: async () => transaction, resolve: () => null });
    const task = controller.queueAssetImport({ kind: 'raster', bytes: png() });
    const rejected = expect(task.result).rejects.toMatchObject({ name: 'AbortError' });
    await started.promise;
    const snapshot = controller.editor.serialize();
    const shape = snapshot.records.find(record => record.kind === 'shape' && record.type === 'raster-image')!;
    const assetId = (shape.props as Record<string, unknown>)['assetId'] as string;
    const shapeId = String(shape.id);
    const replacement = {
      ...snapshot,
      records: snapshot.records.map(record => record.id === shapeId ? { ...record, x: 700 } : record),
    };

    controller.replaceDocument(replacement);
    commit.resolve();
    await rejected;

    expect(controller.editor.store.get(shapeId)).toMatchObject({ id: shapeId, x: 700 });
    expect(controller.editor.store.get(assetId)).toBeDefined();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });
});
