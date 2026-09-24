import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlideboardController } from './GlideboardController';

const controllers: GlideboardController[] = [];

afterEach(async () => {
  await Promise.all(controllers.splice(0).map(controller => controller.dispose().catch(() => undefined)));
});

function create(options: ConstructorParameters<typeof GlideboardController>[0]) {
  const controller = new GlideboardController(options);
  controllers.push(controller);
  return controller;
}

function createPng(width = 8, height = 8): Uint8Array {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(png.buffer).setUint32(16, width);
  new DataView(png.buffer).setUint32(20, height);
  return png;
}

function persistence(overrides: Record<string, unknown> = {}) {
  return {
    token: '99999999-9999-4999-8999-999999999999',
    stage: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('GlideboardController Phase 3 lifecycle guards', () => {
  it('rejects missing and illegal job transitions while allowing cancelled jobs to be dismissed', async () => {
    const controller = create({ sessionKey: 'phase3-job-guards' });
    expect(controller.cancelAssetImport('missing')).toBe(false);
    expect(controller.dismissAssetImport('missing')).toBe(false);
    expect(() => controller.retryAssetImport('missing')).toThrow(/unavailable/);

    const task = controller.queueAssetImport({
      kind: 'svg', source: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>',
      correlationToken: 'phase3-job-guard-token',
    });
    expect(() => controller.retryAssetImport(task.id)).toThrow(/cannot be retried/);
    expect(controller.dismissAssetImport(task.id)).toBe(false);
    expect(controller.cancelAssetImport(task.id)).toBe(true);
    await expect(task.result).rejects.toMatchObject({ name: 'AbortError' });
    expect(controller.cancelAssetImport(task.id)).toBe(false);
    expect(controller.dismissAssetImport(task.id)).toBe(true);
  });

  it('fails closed after disposal and when trusted asset download is unavailable or missing', async () => {
    const withoutStorage = create({ sessionKey: 'phase3-no-storage' });
    await expect(withoutStorage.downloadAsset('asset:missing')).rejects.toMatchObject({ category: 'unavailable' });

    const withStorage = create({
      sessionKey: 'phase3-missing-record',
      assetStorage: {
        prepare: async () => { throw new Error('not used'); },
        download: async () => ({ bytes: new Uint8Array(), mimeType: 'image/png' }),
      },
    });
    await expect(withStorage.downloadAsset('asset:missing')).rejects.toMatchObject({ category: 'not-found' });

    await withStorage.dispose();
    expect(() => withStorage.queueAssetImport({ kind: 'svg', source: '<svg />' })).toThrow(/disposing/);
  });

  it('categorizes unsupported, invalid, empty-message, and unavailable imports', async () => {
    const controller = create({ sessionKey: 'phase3-error-categories' });
    const unsupported = controller.queueAssetImport({
      kind: 'svg', source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><image /></svg>',
    });
    await expect(unsupported.result).rejects.toThrow();
    expect(controller.getAssetImportJob(unsupported.id)?.error).toMatchObject({ category: 'unsupported-format' });

    const invalid = controller.queueAssetImport({
      kind: 'svg', source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
    });
    await expect(invalid.result).rejects.toThrow();
    expect(controller.getAssetImportJob(invalid.id)?.error).toMatchObject({ category: 'invalid-content' });

    await expect(controller.importRaster(createPng(), 'image/png')).rejects.toMatchObject({
      category: 'unavailable',
    });

    const emptyMessage = create({
      sessionKey: 'phase3-empty-storage-error',
      assetStorage: { prepare: async () => { throw { category: 'network', message: '' }; } },
    });
    const failed = emptyMessage.queueAssetImport({ kind: 'raster', bytes: createPng() });
    await expect(failed.result).rejects.toBeTruthy();
    expect(emptyMessage.getAssetImportJob(failed.id)?.error).toEqual({
      category: 'network', message: 'Asset operation failed', retryable: true,
    });
  });

  it('enforces read-only, retained-source, and disposal guards', async () => {
    const readOnly = create({ sessionKey: 'phase3-readonly-placement', readOnly: true });
    expect(() => readOnly.configureAssetPlacement({} as never)).toThrow();
    expect(readOnly.retryAssetPlacement()).toBe(false);

    const missingSource = create({ sessionKey: 'phase3-missing-retained-source' });
    const task = missingSource.queueAssetImport({ kind: 'svg', source: '<svg />' });
    const entry = (missingSource as any).assetImportEntries.get(task.id);
    delete entry.request;
    await expect(task.result).rejects.toThrow(/no retained source/);
    entry.job = Object.freeze({ ...entry.job, status: 'error' });
    expect(() => missingSource.retryAssetImport(task.id)).toThrow(/no retained source/);

    const disposed = create({ sessionKey: 'phase3-retry-after-disposal' });
    await disposed.dispose();
    expect(() => disposed.retryAssetImport('missing')).toThrow(/disposing/);
  });

  it('rejects mismatched and locked replacements and ignores invalid progress', async () => {
    let progress: ((value: number) => void) | undefined;
    const controller = create({
      sessionKey: 'phase3-replacement-validation',
      assetStorage: {
        prepare: async () => persistence({
          stage: vi.fn(async (_bytes: Uint8Array, _signal: AbortSignal, report?: (value: number) => void) => {
            progress = report;
            report?.(Number.NaN);
          }),
        }),
      },
    });
    const raster = await controller.importRaster(createPng(), 'image/png');
    expect(progress).toBeTypeOf('function');

    await expect(controller.replaceAsset(raster, {
      kind: 'svg',
      source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>',
    })).rejects.toMatchObject({ category: 'unsupported-format' });

    controller.editor.updateShape(raster, { isLocked: true } as any);
    await expect(controller.replaceAsset(raster, { kind: 'raster', bytes: createPng(9, 9) }))
      .rejects.toMatchObject({ category: 'permission' });
  });

  it('checks both sides of a requested collaboration projection', async () => {
    const controller = create({ sessionKey: 'phase3-projection-target' });
    const doc = new Y.Doc();
    try {
      controller.attachCollaboration({ doc });
      const target = await controller.captureProjectionTarget();
      await expect(controller.exportSvgAtTarget({ target, shapeIds: [] })).resolves.toContain('<svg');
    } finally {
      doc.destroy();
    }
  });
});
