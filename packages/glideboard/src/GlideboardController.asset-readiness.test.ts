import * as Y from 'yjs';
import { aid, AssetPlacementTool, MutationPermissionError, type ShapeId } from '@durgakiran/glideline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlideboardController } from './GlideboardController';
import type { GlideboardAssetPersistence, GlideboardAssetStorage } from './types';

const controllers: GlideboardController[] = [];
const releasePending: Array<() => void> = [];
const documents: Y.Doc[] = [];

afterEach(async () => {
  releasePending.splice(0).forEach(release => release());
  await Promise.all(controllers.splice(0).map(controller => controller.dispose().catch(() => undefined)));
  documents.splice(0).forEach(doc => doc.destroy());
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createPng(width = 32, height = 16): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
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

function pendingCommit() {
  const started = deferred();
  const pending = deferred();
  releasePending.push(pending.resolve);
  const transaction = {
    ...persistence(),
    commit: vi.fn(async () => {
      started.resolve();
      await pending.promise;
    }),
  };
  return { ...pending, started: started.promise, transaction };
}

function create(assetStorage?: GlideboardAssetStorage) {
  const controller = new GlideboardController({
    sessionKey: `asset-readiness-${controllers.length}`,
    ...(assetStorage ? { assetStorage } : {}),
  });
  controllers.push(controller);
  return controller;
}

function storage(transaction: GlideboardAssetPersistence): GlideboardAssetStorage {
  return {
    commitOrder: 'before-document',
    prepare: vi.fn(async () => transaction),
    resolve: () => null,
  };
}

function assetRecords(controller: GlideboardController) {
  return controller.editor.serialize().records.filter(record => record.kind === 'asset');
}

function imageRecords(controller: GlideboardController) {
  return controller.editor.serialize().records.filter(record => record.kind === 'shape' && record.type === 'raster-image');
}

function addBox(controller: GlideboardController, label = 'Unrelated edit'): ShapeId {
  return controller.editor.createShape({
    type: 'box', x: 50, y: 60, props: { w: 100, h: 80, label },
  });
}

function linkControllers(first: GlideboardController, second: GlideboardController) {
  const firstDoc = new Y.Doc();
  const secondDoc = new Y.Doc();
  documents.push(firstDoc, secondDoc);
  firstDoc.on('update', (update, origin) => {
    if (origin !== secondDoc) Y.applyUpdate(secondDoc, update, firstDoc);
  });
  secondDoc.on('update', (update, origin) => {
    if (origin !== firstDoc) Y.applyUpdate(firstDoc, update, secondDoc);
  });
  first.attachCollaboration({ doc: firstDoc });
  second.attachCollaboration({ doc: secondDoc });
  return { firstDoc, secondDoc };
}

async function portableRasterFragment() {
  const bytes = createPng();
  const source = create({
    ...storage(persistence()),
    download: async () => ({ bytes, mimeType: 'image/png' }),
    retainReferences: async () => undefined,
  });
  const shapeId = await source.importRaster(bytes);
  return (await source.createPortableFragment({ shapeIds: [shapeId] }))!;
}

describe('Glideboard asset storage readiness', () => {
  it('shares no image records until commit confirmation while unrelated edits continue syncing', async () => {
    const commit = pendingCommit();
    const uploader = create(storage(commit.transaction));
    const collaborator = create();
    const { secondDoc } = linkControllers(uploader, collaborator);
    const remoteRecords = secondDoc.getMap<Record<string, unknown>>('glideboard-records-v2');
    const danglingReferences: string[] = [];
    remoteRecords.observe(() => {
      for (const record of remoteRecords.values()) {
        if (record['kind'] !== 'shape' || record['type'] !== 'raster-image') continue;
        const assetId = (record['props'] as Record<string, unknown>)['assetId'] as string;
        if (!remoteRecords.has(assetId)) danglingReferences.push(assetId);
      }
    });

    const task = uploader.queueAssetImport({ kind: 'raster', bytes: createPng() });
    await commit.started;
    expect(uploader.getAssetImportJob(task.id)).toMatchObject({ status: 'finalizing', progress: 1 });
    expect(uploader.dismissAssetImport(task.id)).toBe(false);
    expect(assetRecords(uploader)).toEqual([]);
    expect(imageRecords(uploader)).toEqual([]);
    expect(assetRecords(collaborator)).toEqual([]);
    expect(imageRecords(collaborator)).toEqual([]);

    const uploaderBox = addBox(uploader);
    const collaboratorBox = addBox(collaborator, 'Collaborator edit');
    expect(collaborator.editor.getShape(uploaderBox)).toBeDefined();
    expect(uploader.editor.getShape(collaboratorBox)).toBeDefined();

    commit.resolve();
    const shapeId = await task.result;
    expect(collaborator.editor.getShape(shapeId)).toMatchObject({ type: 'raster-image' });
    expect(assetRecords(collaborator)).toHaveLength(1);
    expect(danglingReferences).toEqual([]);
    expect(uploader.getAssetImportJob(task.id)).toMatchObject({ status: 'complete', shapeId });
  });

  it('keeps the existing insertion order when commitOrder is omitted', async () => {
    const commit = pendingCommit();
    const controller = create({ prepare: async () => commit.transaction, resolve: () => null });
    const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng() });
    await commit.started;
    expect(assetRecords(controller)).toHaveLength(1);
    expect(imageRecords(controller)).toHaveLength(1);
    commit.resolve();
    await task.result;
  });

  it('retains a confirmed file when cancellation arrives during commit and never inserts it', async () => {
    const commit = pendingCommit();
    const controller = create(storage(commit.transaction));
    const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng() });
    const rejected = expect(task.result).rejects.toMatchObject({ name: 'AbortError' });
    await commit.started;
    expect(controller.cancelAssetImport(task.id)).toBe(true);
    commit.resolve();
    await rejected;
    expect(commit.transaction.rollback).not.toHaveBeenCalled();
    expect(assetRecords(controller)).toEqual([]);
    expect(imageRecords(controller)).toEqual([]);
    expect(controller.getAssetImportJob(task.id)?.status).toBe('cancelled');
  });

  it('settles a late successful commit during disposal without inserting or deleting its durable file', async () => {
    const commit = pendingCommit();
    const controller = create(storage(commit.transaction));
    const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng() });
    const rejected = expect(task.result).rejects.toMatchObject({ name: 'AbortError' });
    await commit.started;
    const disposed = controller.dispose();
    commit.resolve();
    await Promise.all([disposed, rejected]);
    expect(commit.transaction.rollback).not.toHaveBeenCalled();
    expect(assetRecords(controller)).toEqual([]);
    expect(imageRecords(controller)).toEqual([]);
  });

  it('asks the host to cancel uncommitted staging after an ambiguous commit failure', async () => {
    const commit = pendingCommit();
    const controller = create(storage(commit.transaction));
    const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng() });
    const rejected = expect(task.result).rejects.toThrow('Commit response lost');
    await commit.started;
    commit.reject(new Error('Commit response lost'));
    await rejected;
    expect(commit.transaction.rollback).toHaveBeenCalledOnce();
    expect(assetRecords(controller)).toEqual([]);
    expect(imageRecords(controller)).toEqual([]);
    expect(controller.getAssetImportJob(task.id)?.status).toBe('error');
  });

  it('preserves geometry and crop edited while a replacement waits for storage', async () => {
    const commit = pendingCommit();
    let preparations = 0;
    const controller = create({
      ...storage(commit.transaction),
      prepare: async () => ++preparations === 1 ? persistence() : commit.transaction,
    });
    const shapeId = await controller.importRaster(createPng());
    const oldAssetId = controller.editor.getShape(shapeId)!.props['assetId'];
    const replacement = controller.replaceAsset(shapeId, { kind: 'raster', bytes: createPng(64, 32) });
    await commit.started;
    expect(controller.editor.getShape(shapeId)!.props['assetId']).toBe(oldAssetId);
    controller.editor.updateShape(shapeId, {
      x: 211, y: 322, rotation: Math.PI / 3,
      props: { w: 200, h: 123, crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.7 }, altText: 'Edited during upload' },
    });
    commit.resolve();
    await replacement;
    expect(controller.editor.getShape(shapeId)).toMatchObject({
      x: 211, y: 322, rotation: Math.PI / 3,
      props: { w: 200, h: 123, crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.7 }, altText: 'Edited during upload' },
    });
    expect(controller.editor.getShape(shapeId)!.props['assetId']).not.toBe(oldAssetId);
    expect(commit.transaction.rollback).not.toHaveBeenCalled();
  });

  it.each(['deleted', 'locked'] as const)('rejects a replacement whose target becomes %s after commit starts', async change => {
    const commit = pendingCommit();
    let preparations = 0;
    const controller = create({
      ...storage(commit.transaction),
      prepare: async () => ++preparations === 1 ? persistence() : commit.transaction,
    });
    const shapeId = await controller.importRaster(createPng());
    const oldAssetId = controller.editor.getShape(shapeId)!.props['assetId'];
    const replacement = controller.replaceAsset(shapeId, { kind: 'raster', bytes: createPng(64, 32) });
    const rejected = expect(replacement).rejects.toMatchObject({
      category: change === 'deleted' ? 'not-found' : 'permission',
    });
    await commit.started;
    if (change === 'deleted') controller.editor.deleteShapes([shapeId]);
    else controller.editor.updateShape(shapeId, { isLocked: true });
    commit.resolve();
    await rejected;
    expect(assetRecords(controller)).toHaveLength(1);
    expect(commit.transaction.rollback).not.toHaveBeenCalled();
    if (change === 'locked') expect(controller.editor.getShape(shapeId)!.props['assetId']).toBe(oldAssetId);
  });

  it('does not overwrite a newer replacement when an earlier commit finishes late', async () => {
    const commit = pendingCommit();
    let preparations = 0;
    const controller = create({
      ...storage(commit.transaction),
      prepare: async () => ++preparations === 2 ? commit.transaction : persistence(),
    });
    const shapeId = await controller.importRaster(createPng());
    const earlier = controller.replaceAsset(shapeId, { kind: 'raster', bytes: createPng(64, 32) });
    const rejected = expect(earlier).rejects.toMatchObject({ category: 'conflict' });
    await commit.started;
    await controller.replaceAsset(shapeId, { kind: 'raster', bytes: createPng(96, 48) });
    const newestAssetId = controller.editor.getShape(shapeId)!.props['assetId'];
    commit.resolve();
    await rejected;
    expect(controller.editor.getShape(shapeId)!.props['assetId']).toBe(newestAssetId);
    expect(assetRecords(controller)).toHaveLength(2);
    expect(commit.transaction.rollback).not.toHaveBeenCalled();
  });

  it('inserts at the original drop position and page without stealing a later tool or selection', async () => {
    const commit = pendingCommit();
    const controller = create(storage(commit.transaction));
    const originalPage = controller.editor.getActivePageId();
    const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng(), point: { x: 123, y: 456 } });
    await commit.started;
    const nextPage = controller.editor.createPage('Other work');
    const selected = addBox(controller);
    controller.editor.setCurrentTool('box');
    controller.editor.setSelectedShapeIds([selected]);
    controller.editor.camera.setCamera({ x: 900, y: 700, z: 2 });
    commit.resolve();
    const shapeId = await task.result;
    expect(controller.editor.getShape(shapeId)).toMatchObject({ parentId: originalPage, x: 123, y: 456 });
    expect(controller.editor.getActivePageId()).toBe(nextPage);
    expect(controller.editor.currentToolId.peek()).toBe('box');
    expect(controller.editor.getSelectedShapeIds()).toEqual([selected]);
  });

  it('retains committed storage if the original destination page was deleted', async () => {
    const commit = pendingCommit();
    const controller = create(storage(commit.transaction));
    const destination = controller.editor.getActivePageId();
    const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng() });
    const rejected = expect(task.result).rejects.toThrow();
    await commit.started;
    controller.editor.createPage('Remaining page');
    controller.editor.deletePage(destination);
    commit.resolve();
    await rejected;
    expect(assetRecords(controller)).toEqual([]);
    expect(imageRecords(controller)).toEqual([]);
    expect(commit.transaction.rollback).not.toHaveBeenCalled();
  });

  it('uses the original viewport for an import without an explicit drop point', async () => {
    const commit = pendingCommit();
    const controller = create(storage(commit.transaction));
    const viewport = controller.editor.camera.getViewportBounds();
    const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng() });
    await commit.started;
    controller.editor.camera.setCamera({ x: 500, y: 600, z: 2 });
    commit.resolve();
    const shape = controller.editor.getShape(await task.result)!;
    expect(shape.x + (shape.props['w'] as number) / 2).toBeCloseTo(viewport.x + viewport.w / 2);
    expect(shape.y + (shape.props['h'] as number) / 2).toBeCloseTo(viewport.y + viewport.h / 2);
  });

  it.each(['document replacement', 'read-only downgrade'] as const)('prevents a late insertion after %s', async change => {
    const commit = pendingCommit();
    const controller = create(storage(commit.transaction));
    const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng() });
    const rejected = expect(task.result).rejects.toMatchObject({ name: 'AbortError' });
    await commit.started;
    if (change === 'document replacement') controller.replaceDocument(controller.editor.serialize());
    else controller.setReadOnly(true);
    commit.resolve();
    await rejected;
    expect(assetRecords(controller)).toEqual([]);
    expect(imageRecords(controller)).toEqual([]);
    expect(commit.transaction.rollback).not.toHaveBeenCalled();
  });
});

describe('Glideboard capture preparation', () => {
  it('gates new imports immediately, drains existing imports, and only then fences editing', async () => {
    const commit = pendingCommit();
    const controller = create(storage(commit.transaction));
    const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng() });
    await commit.started;
    const capture = controller.prepareForCapture('publish');
    let ready = false;
    void capture.then(() => { ready = true; });
    expect(() => controller.queueAssetImport({ kind: 'raster', bytes: createPng(8, 8) })).toThrow();
    expect(controller.mutationFenceDepthSignal.peek()).toBe(0);
    const editedWhileUploading = addBox(controller);
    await Promise.resolve();
    expect(ready).toBe(false);

    commit.resolve();
    const [shapeId, fence] = await Promise.all([task.result, capture]);
    expect(fence.reason).toBe('publish');
    expect(controller.editor.getShape(shapeId)).toBeDefined();
    expect(controller.editor.getShape(editedWhileUploading)).toBeDefined();
    expect(controller.mutationFenceDepthSignal.peek()).toBe(1);
    expect(() => addBox(controller)).toThrow(MutationPermissionError);
    expect(() => controller.queueAssetImport({ kind: 'raster', bytes: createPng(8, 8) })).toThrow();

    fence.release();
    fence.release();
    expect(controller.mutationFenceDepthSignal.peek()).toBe(0);
    expect(addBox(controller)).toBeTruthy();
    await expect(controller.importRaster(createPng(8, 8))).resolves.toBeTruthy();
  });

  it('reports a pending upload failure and reopens imports and editing', async () => {
    const commit = pendingCommit();
    const controller = create(storage(commit.transaction));
    const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng() });
    const taskRejected = expect(task.result).rejects.toThrow('Storage unavailable');
    await commit.started;
    const capture = controller.prepareForCapture('export');
    const captureRejected = expect(capture).rejects.toThrow();
    commit.reject(new Error('Storage unavailable'));
    await Promise.all([taskRejected, captureRejected]);
    expect(controller.mutationFenceDepthSignal.peek()).toBe(0);
    expect(addBox(controller)).toBeTruthy();
    // A local SVG proves the import gate was released without reusing the failed host request.
    await expect(controller.importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M0 0h8v8z"/></svg>'))
      .resolves.toBeTruthy();
  });

  it('gates retry attempts for the duration of capture', async () => {
    let attempts = 0;
    const controller = create({
      ...storage(persistence()),
      prepare: async () => {
        if (++attempts === 1) throw new Error('Transient failure');
        return persistence();
      },
    });
    const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng() });
    await expect(task.result).rejects.toThrow('Transient failure');
    const capture = controller.prepareForCapture('publish');
    expect(() => controller.retryAssetImport(task.id)).toThrow();
    const fence = await capture;
    expect(() => controller.retryAssetImport(task.id)).toThrow();
    fence.release();
    await expect(controller.retryAssetImport(task.id).result).resolves.toBeTruthy();
  });

  it('waits for portable paste insertion and rejects a new paste while draining', async () => {
    const fragment = await portableRasterFragment();
    const started = deferred();
    const materialized = deferred();
    releasePending.push(materialized.resolve);
    const rollback = vi.fn(async () => undefined);
    const destination = create({
      ...storage(persistence()),
      materializePortableAsset: async () => {
        started.resolve();
        await materialized.promise;
        return { rollback };
      },
    });
    const paste = destination.pastePortableFragment(fragment, { point: { x: 44, y: 55 } });
    await started.promise;
    const capture = destination.prepareForCapture('export');
    await expect(destination.pastePortableFragment(fragment)).rejects.toThrow();
    expect(destination.mutationFenceDepthSignal.peek()).toBe(0);
    expect(imageRecords(destination)).toEqual([]);
    expect(addBox(destination)).toBeTruthy();
    materialized.resolve();
    const [pastedIds, fence] = await Promise.all([paste, capture]);
    expect(pastedIds).toHaveLength(1);
    expect(destination.editor.getShape(pastedIds[0]!)).toMatchObject({ type: 'raster-image' });
    expect(destination.mutationFenceDepthSignal.peek()).toBe(1);
    expect(rollback).not.toHaveBeenCalled();
    fence.release();
    await expect(destination.pastePortableFragment(fragment)).resolves.toHaveLength(1);
  });

  it('cancels portable paste during disposal and waits for its cleanup', async () => {
    const fragment = await portableRasterFragment();
    const started = deferred();
    const materialized = deferred();
    releasePending.push(materialized.resolve);
    const rollback = vi.fn(async () => undefined);
    let materializationSignal: AbortSignal | undefined;
    const controller = create({
      ...storage(persistence()),
      materializePortableAsset: async (_payload, _asset, _context, signal) => {
        materializationSignal = signal;
        started.resolve();
        await materialized.promise;
        return { rollback };
      },
    });
    const paste = controller.pastePortableFragment(fragment);
    const rejected = expect(paste).rejects.toMatchObject({ name: 'AbortError' });
    await started.promise;
    const disposed = controller.dispose();
    expect(materializationSignal?.aborted).toBe(true);
    materialized.resolve();
    await Promise.all([disposed, rejected]);
    expect(rollback).toHaveBeenCalledOnce();
    expect(assetRecords(controller)).toEqual([]);
    expect(imageRecords(controller)).toEqual([]);
  });

  it('waits for library placement to insert its shape before fencing the canvas', async () => {
    const controller = create();
    const started = deferred();
    const materialized = deferred();
    releasePending.push(materialized.resolve);
    const hash = 'c'.repeat(64);
    const rollback = vi.fn();
    const config = {
      selection: {
        itemId: 'library:mark', mediaType: 'svg' as const, width: 100, height: 50,
        provenance: { providerId: 'library', itemId: 'library:mark', sourceLibraryId: 'marks', sourceVersion: '1', license: 'MIT' },
      },
      materializer: async () => {
        started.resolve();
        await materialized.promise;
        return {
          asset: {
            id: aid(`asset:sha256:${hash}`), kind: 'asset' as const, type: 'sanitized-svg', schemaVersion: 1,
            props: {
              hash, mimeType: 'image/svg+xml', sanitizerVersion: 1, byteLength: 8,
              width: 100, height: 50, viewBox: [0, 0, 100, 50], paths: [{ d: 'M0 0 L100 50' }],
            },
            meta: {},
          },
          contentHash: hash,
          rollback,
        };
      },
    };
    controller.configureAssetPlacement(config);
    const placement = (controller.editor.getCurrentTool() as AssetPlacementTool).place({ x: 10, y: 20, w: 100, h: 50 });
    await started.promise;
    const capture = controller.prepareForCapture('publish');
    expect(() => controller.configureAssetPlacement(config)).toThrow();
    expect(controller.mutationFenceDepthSignal.peek()).toBe(0);
    expect(assetRecords(controller)).toEqual([]);
    materialized.resolve();
    const [shapeId, fence] = await Promise.all([placement, capture]);
    expect(shapeId).toBeTruthy();
    expect(controller.editor.getShape(shapeId!)).toMatchObject({ type: 'sanitized-svg' });
    expect(controller.mutationFenceDepthSignal.peek()).toBe(1);
    expect(rollback).not.toHaveBeenCalled();
    fence.release();
    expect(() => controller.configureAssetPlacement(config)).not.toThrow();
  });

  it('aborts capture preparation without cancelling the ongoing upload', async () => {
    const commit = pendingCommit();
    const controller = create(storage(commit.transaction));
    const task = controller.queueAssetImport({ kind: 'raster', bytes: createPng() });
    await commit.started;
    const signal = new AbortController();
    const capture = controller.prepareForCapture('close', { signal: signal.signal });
    const rejected = expect(capture).rejects.toMatchObject({ name: 'AbortError' });
    signal.abort();
    await rejected;
    expect(controller.mutationFenceDepthSignal.peek()).toBe(0);
    expect(controller.getAssetImportJob(task.id)?.status).toBe('finalizing');
    expect(addBox(controller)).toBeTruthy();
    await expect(controller.importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M0 0h8v8z"/></svg>'))
      .resolves.toBeTruthy();
    commit.resolve();
    await task.result;
    expect(commit.transaction.rollback).not.toHaveBeenCalled();
  });
});
