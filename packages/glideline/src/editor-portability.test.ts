// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEditor,
  getMutableStoreForTesting,
  PortablePasteRollbackError,
  PORTABLE_BOARD_FRAGMENT_LIMITS,
  validatePortableBoardFragmentStructure,
  type AssetResolutionContext,
  type GlidePlugin,
  type PortableBoardFragment,
} from './editor';
import { aid, sid, type GlideAsset, type ShapeId } from './types';
import { GroupUtil } from './shapes/GroupUtil';
import { RasterImageUtil } from './shapes/RasterImageUtil';

const plugin: GlidePlugin = {
  id: 'portability-test',
  shapes: [GroupUtil, RasterImageUtil],
};

const PNG_BYTES = new Uint8Array([137, 80, 78, 71]);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function rasterHash(name: string): string {
  return Array.from(name).map(character => character.charCodeAt(0).toString(16)).join('').padEnd(64, '0').slice(0, 64);
}

function rasterAssetId(name: string): string {
  return `asset:sha256:${rasterHash(name)}`;
}

function addRaster(
  editor: ReturnType<typeof createEditor>,
  name: string,
  parentId: ShapeId | string = editor.getDefaultPageId(),
  canonical = true,
): ShapeId {
  const hash = rasterHash(name);
  const assetId = aid(canonical ? rasterAssetId(name) : `asset:${name}`);
  getMutableStoreForTesting(editor).transact({ origin: 'system', history: 'ignore' }, tx => {
    tx.insert({
      id: assetId,
      kind: 'asset',
      type: 'raster-image',
      schemaVersion: 1,
      props: {
        hash,
        mimeType: 'image/png',
        byteLength: PNG_BYTES.byteLength,
        width: 1,
        height: 1,
      },
      meta: { sourceLibrary: 'fixtures', sourceVersion: 'v3', license: 'test' },
    });
  });
  return editor.createShape({
    id: sid(`shape:${name}`),
    type: 'raster-image',
    parentId: parentId as any,
    x: 4,
    y: 6,
    props: { w: 30, h: 20, assetId },
  });
}

describe('P3-C6 portable board fragments', () => {
  it('exports and materializes canonical raster identities in lexical order', async () => {
    const source = createEditor({ plugins: [plugin] });
    const second = addRaster(source, 'z-order');
    const first = addRaster(source, 'a-order');
    const exported: string[] = [];
    const fragment = await source.createPortableBoardFragment([second, first], {
      exportRasterAsset: async asset => {
        exported.push(String(asset.id));
        return { kind: 'self-contained', bytes: PNG_BYTES };
      },
      retainAssetReferences: async () => undefined,
    });
    expect(exported).toEqual([...exported].sort());
    expect(fragment!.rasterPayloads.map(payload => payload.assetId)).toEqual([...exported].sort());

    const materialized: string[] = [];
    const destination = createEditor({ plugins: [plugin] });
    await destination.pastePortableBoardFragment(fragment!, {
      materializeRasterAsset: async payload => {
        materialized.push(payload.assetId);
        return { rollback: async () => undefined };
      },
    });
    expect(materialized).toEqual([...materialized].sort());
  });

  it('exports a nested hierarchy with self-contained raster data and provenance', async () => {
    const source = createEditor({ plugins: [plugin] });
    const groupId = source.createShape({ id: sid('shape:group'), type: 'group', x: 10, y: 20, props: {} });
    addRaster(source, 'a', groupId);
    const exportRasterAsset = vi.fn(async () => ({ kind: 'self-contained' as const, bytes: PNG_BYTES }));
    const retainAssetReferences = vi.fn(async () => undefined);
    const context = { documentId: 'board-a', versionId: 'version-7' };

    const fragment = await source.createPortableBoardFragment([groupId], {
      exportRasterAsset,
      retainAssetReferences,
      resolutionContext: context,
    });

    expect(fragment?.schema.portableBoardFragmentVersion).toBe(1);
    expect(fragment?.rootIds).toEqual([groupId]);
    expect(fragment?.rasterPayloads[0]).toMatchObject({
      assetId: rasterAssetId('a'), kind: 'embedded', byteLength: PNG_BYTES.byteLength,
    });
    expect(fragment?.records.find(record => record['id'] === rasterAssetId('a'))?.['meta']).toEqual({
      sourceLibrary: 'fixtures', sourceVersion: 'v3', license: 'test',
    });
    expect(exportRasterAsset).toHaveBeenCalledWith(expect.objectContaining({ id: rasterAssetId('a') }), context);
    expect(retainAssetReferences).toHaveBeenCalledWith([rasterAssetId('a')], context);

    const destination = createEditor({ plugins: [plugin] });
    const materialize = vi.fn(async () => ({ rollback: vi.fn() }));
    const [pastedGroupId] = await destination.pastePortableBoardFragment(fragment!, {
      materializeRasterAsset: materialize,
      point: { x: 100, y: 120 },
    });
    const [pastedChild] = destination.store.getChildren(pastedGroupId!);
    const pastedAssetId = (pastedChild!['props'] as Record<string, unknown>)['assetId'] as string;

    expect(pastedChild!['parentId']).toBe(pastedGroupId);
    expect(destination.store.get(pastedAssetId)?.['meta']).toEqual({
      sourceLibrary: 'fixtures', sourceVersion: 'v3', license: 'test',
    });
    expect(materialize).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'embedded', assetId: rasterAssetId('a') }),
      expect.objectContaining({ id: rasterAssetId('a') }),
      context,
    );
    expect(destination.store.assertIntegrity().ok).toBe(true);
  });

  it('keeps duplicate synchronous and reuses immutable content-addressed assets', () => {
    const editor = createEditor({ plugins: [plugin] });
    const groupId = editor.createShape({ id: sid('shape:group'), type: 'group', x: 0, y: 0, props: {} });
    addRaster(editor, 'duplicate', groupId, true);
    const assetId = `asset:sha256:${rasterHash('duplicate')}`;

    const [copyId] = editor.duplicateShapes([groupId]);
    const [copyChild] = editor.store.getChildren(copyId!);
    const copiedAssetId = (copyChild!['props'] as Record<string, unknown>)['assetId'] as string;

    expect(copyChild!['parentId']).toBe(copyId);
    expect(copiedAssetId).toBe(assetId);
    expect(editor.store.get(copiedAssetId)?.['kind']).toBe('asset');
  });

  it('reuses a same-board raster on portable paste and rejects immutable collisions', async () => {
    const source = createEditor({ plugins: [plugin] });
    const shapeId = addRaster(source, 'same-board', source.getDefaultPageId(), true);
    const assetId = `asset:sha256:${rasterHash('same-board')}`;
    const fragment = await source.createPortableBoardFragment([shapeId], {
      exportRasterAsset: async () => ({ kind: 'self-contained', bytes: PNG_BYTES }),
      retainAssetReferences: async () => undefined,
    });
    const materialize = vi.fn(async () => ({ rollback: vi.fn() }));

    const [pastedId] = await source.pastePortableBoardFragment(fragment!, {
      materializeRasterAsset: materialize,
    });
    const pasted = source.getShape(pastedId!);
    expect((pasted?.props as Record<string, unknown>)['assetId']).toBe(assetId);
    expect(source.store.get(assetId)?.['kind']).toBe('asset');

    const conflicting = {
      ...fragment!,
      records: fragment!.records.map(record => record['id'] === assetId
        ? { ...record, props: { ...(record['props'] as Record<string, unknown>), width: 2 } }
        : record),
    } as PortableBoardFragment;
    await expect(source.pastePortableBoardFragment(conflicting, {
      materializeRasterAsset: materialize,
    })).rejects.toThrow(/conflicting content/);
  });

  it('rejects partial materialization and rolls back without committing records', async () => {
    const source = createEditor({ plugins: [plugin] });
    const first = addRaster(source, 'first');
    const second = addRaster(source, 'second');
    const fragment = await source.createPortableBoardFragment([first, second], {
      exportRasterAsset: async asset => ({ kind: 'durable-reference', reference: `retained://${asset.id}` }),
      retainAssetReferences: async () => undefined,
    });
    const destination = createEditor({ plugins: [plugin] });
    const before = destination.store.serialize();
    const rollback = vi.fn();
    let calls = 0;

    await expect(destination.pastePortableBoardFragment(fragment!, {
      materializeRasterAsset: async () => {
        calls += 1;
        if (calls === 2) throw new Error('destination unavailable');
        return { rollback };
      },
    })).rejects.toThrow('destination unavailable');

    expect(rollback).toHaveBeenCalledOnce();
    expect(destination.store.serialize()).toEqual(before);
    expect(destination.history.undoStack).toHaveLength(0);
  });

  it('passes historical context to durable export, materialization, and URL resolution', async () => {
    const context: AssetResolutionContext = {
      documentId: 'board-history', snapshotId: 'snapshot-42', createdAt: '2026-08-01T00:00:00Z',
    };
    const resolvedContexts: Array<AssetResolutionContext | undefined> = [];
    const source = createEditor({
      plugins: [plugin],
      assetResolver: (_asset, resolutionContext) => {
        resolvedContexts.push(resolutionContext);
        return 'https://assets.example.test/immutable.png';
      },
    });
    const shapeId = addRaster(source, 'historical');
    const asset = source.store.get(rasterAssetId('historical')) as unknown as GlideAsset;
    expect(source.resolveAssetUrl(asset, context)).toContain('immutable.png');

    const exportRasterAsset = vi.fn(async () => ({
      kind: 'durable-reference' as const,
      reference: 'retained://snapshot-42/historical',
    }));
    const fragment = await source.createPortableBoardFragment([shapeId], {
      exportRasterAsset,
      resolutionContext: context,
      retainAssetReferences: async () => undefined,
    });
    const destination = createEditor({ plugins: [plugin] });
    const materialize = vi.fn(async () => ({ rollback: vi.fn() }));
    await destination.pastePortableBoardFragment(fragment as PortableBoardFragment, {
      materializeRasterAsset: materialize,
    });

    expect(resolvedContexts).toEqual([context]);
    expect(exportRasterAsset).toHaveBeenCalledWith(expect.anything(), context);
    expect(materialize).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'retained://snapshot-42/historical' }),
      expect.anything(),
      context,
    );
  });

  it('rejects oversized and non-canonical fragments before authorization or materialization', async () => {
    const source = createEditor({ plugins: [plugin] });
    const shapeId = addRaster(source, 'bounded');
    const fragment = await source.createPortableBoardFragment([shapeId], {
      exportRasterAsset: async () => ({ kind: 'self-contained', bytes: PNG_BYTES }),
      retainAssetReferences: async () => undefined,
    });
    const malformed = {
      ...fragment!,
      rasterPayloads: [{
        ...fragment!.rasterPayloads[0],
        base64: 'iVBORw',
      }],
    } as PortableBoardFragment;
    const authorize = vi.fn(() => 'allow' as const);
    const destination = createEditor({ plugins: [plugin], mutationPolicy: { authorize } });
    const materialize = vi.fn();

    await expect(destination.pastePortableBoardFragment(malformed, {
      materializeRasterAsset: materialize,
    })).rejects.toThrow(/canonical base64|length mismatch/);
    expect(authorize).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
  });

  it('rejects inconsistent payload sets and missing materialization compensation', async () => {
    const source = createEditor({ plugins: [plugin] });
    const shapeId = addRaster(source, 'payload-guards');
    const fragment = (await source.createPortableBoardFragment([shapeId], {
      exportRasterAsset: async () => ({ kind: 'durable-reference', reference: 'https://assets.example.test/payload.png' }),
      retainAssetReferences: async () => undefined,
    }))!;
    const destination = createEditor({ plugins: [plugin] });
    const materializeRasterAsset = vi.fn(async () => ({ rollback: async () => undefined }));

    await expect(destination.pastePortableBoardFragment({
      ...fragment,
      rasterPayloads: [...fragment.rasterPayloads, fragment.rasterPayloads[0]!],
    }, { materializeRasterAsset })).rejects.toThrow(/Duplicate raster payload/);
    await expect(destination.pastePortableBoardFragment({
      ...fragment,
      rasterPayloads: [],
    }, { materializeRasterAsset })).rejects.toThrow(/Missing raster payload/);
    await expect(destination.pastePortableBoardFragment({
      ...fragment,
      records: [],
      rootIds: [],
      assetRefs: [],
    }, { materializeRasterAsset })).rejects.toThrow(/unknown asset/);
    await expect(destination.pastePortableBoardFragment({
      ...fragment,
      rasterPayloads: [{ ...fragment.rasterPayloads[0]!, reference: '' }],
    }, { materializeRasterAsset })).rejects.toThrow(/empty durable reference|invalid durable reference/);
    await expect(destination.pastePortableBoardFragment(fragment, {
      materializeRasterAsset: async () => ({} as never),
    })).rejects.toThrow(/required compensation/);
  });

  it('enforces export byte and durable-reference bounds before retention', async () => {
    const source = createEditor({ plugins: [plugin] });
    const shapeId = addRaster(source, 'export-bounds');
    const retainAssetReferences = vi.fn(async () => undefined);
    for (const reference of ['', 'x'.repeat(PORTABLE_BOARD_FRAGMENT_LIMITS.maxStringBytes + 1)]) {
      await expect(source.createPortableBoardFragment([shapeId], {
        exportRasterAsset: async () => ({ kind: 'durable-reference', reference }),
        retainAssetReferences,
      })).rejects.toThrow(/empty durable reference/);
    }
    await expect(source.createPortableBoardFragment([shapeId], {
      exportRasterAsset: async () => ({
        kind: 'self-contained',
        bytes: new Uint8Array(PORTABLE_BOARD_FRAGMENT_LIMITS.maxEmbeddedAssetBytes + 1),
      }),
      retainAssetReferences,
    })).rejects.toThrow(/embedded-byte limit/);
    expect(retainAssetReferences).not.toHaveBeenCalled();
  });

  it('uses the browser base64 path when Node Buffer is unavailable', async () => {
    vi.stubGlobal('Buffer', undefined);
    const source = createEditor({ plugins: [plugin] });
    const shapeId = addRaster(source, 'browser-base64');
    const fragment = await source.createPortableBoardFragment([shapeId], {
      exportRasterAsset: async () => ({ kind: 'self-contained', bytes: PNG_BYTES }),
      retainAssetReferences: async () => undefined,
    });
    expect(fragment!.rasterPayloads[0]).toMatchObject({ kind: 'embedded', base64: 'iVBORw==' });
  });

  it('ignores missing roots during portable SVG asset discovery', async () => {
    const editor = createEditor({ plugins: [plugin] });
    const exportRasterAsset = vi.fn();
    await expect(editor.exportToPortableSvg([sid('shape:missing')], { exportRasterAsset }))
      .resolves.toContain('<svg');
    expect(exportRasterAsset).not.toHaveBeenCalled();
  });

  it('rejects every non-canonical raster identity before host hooks', async () => {
    const source = createEditor({ plugins: [plugin] });
    const legacyShapeId = addRaster(source, 'legacy-portable', source.getDefaultPageId(), false);
    const exportRasterAsset = vi.fn(async () => ({ kind: 'self-contained' as const, bytes: PNG_BYTES }));
    const retainAssetReferences = vi.fn();
    await expect(source.createPortableBoardFragment([legacyShapeId], {
      exportRasterAsset,
      retainAssetReferences,
    })).rejects.toThrow(/64 lowercase hex/);
    expect(exportRasterAsset).not.toHaveBeenCalled();
    expect(retainAssetReferences).not.toHaveBeenCalled();

    const canonicalShapeId = addRaster(source, 'identity-boundary');
    const fragment = await source.createPortableBoardFragment([canonicalShapeId], {
      exportRasterAsset,
      retainAssetReferences: async () => undefined,
    });
    const authorize = vi.fn(() => 'allow' as const);
    const materialize = vi.fn();
    const destination = createEditor({ plugins: [plugin], mutationPolicy: { authorize } });
    const invalidIds = [
      '',
      'asset:a',
      `asset:sha256:${'A'.repeat(64)}`,
      `asset:sha256:${'é'.repeat(64)}`,
      `asset:sha256:${'a'.repeat(63)}`,
      `asset:sha256:${'a'.repeat(65)}`,
      `asset:sha256:${'a'.repeat(256 * 1024)}`,
    ];
    for (const assetId of invalidIds) {
      await expect(destination.pastePortableBoardFragment({
        ...fragment!,
        rasterPayloads: fragment!.rasterPayloads.map(payload => ({ ...payload, assetId })),
      }, { materializeRasterAsset: materialize })).rejects.toThrow(/assetId|lowercase hex|string limit/);
    }
    expect(authorize).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
  });

  it('rejects a non-canonical lowercase raster ID before the portable SVG host hook', async () => {
    const editor = createEditor({ plugins: [plugin] });
    const shapeId = addRaster(editor, 'legacy-svg', editor.getDefaultPageId(), false);
    const exportRasterAsset = vi.fn(async () => ({ kind: 'self-contained' as const, bytes: PNG_BYTES }));

    await expect(editor.exportToPortableSvg([shapeId], { exportRasterAsset }))
      .rejects.toThrow(/64 lowercase hex/);
    expect(exportRasterAsset).not.toHaveBeenCalled();
  });

  it('bounds complete base64-expanded fragment JSON before authorization or materialization', async () => {
    const bounds = { x: 0, y: 0, w: 1, h: 1, minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const reference = 'x'.repeat(PORTABLE_BOARD_FRAGMENT_LIMITS.maxStringBytes);
    const payloadCount = PORTABLE_BOARD_FRAGMENT_LIMITS.maxEncodedFragmentBytes / reference.length;
    const rasterPayloads = Array.from({ length: payloadCount }, (_, index) => ({
      assetId: `asset:sha256:${index.toString(16).padStart(64, '0')}`,
      kind: 'durable-reference' as const,
      reference,
    }));
    const fragment = {
      schema: { portableBoardFragmentVersion: 1 as const, storeVersion: 6 },
      rootIds: [], records: [], assetRefs: [], rasterPayloads, sourceBounds: bounds,
    } as PortableBoardFragment;
    const authorize = vi.fn(() => 'allow' as const);
    const materializeRasterAsset = vi.fn();
    const editor = createEditor({ plugins: [plugin], mutationPolicy: { authorize } });

    expect(() => validatePortableBoardFragmentStructure(fragment)).toThrow(/encoded JSON.*size limit/);
    await expect(editor.pastePortableBoardFragment(fragment, { materializeRasterAsset }))
      .rejects.toThrow(/encoded JSON.*size limit/);
    expect(authorize).not.toHaveBeenCalled();
    expect(materializeRasterAsset).not.toHaveBeenCalled();
  }, 30_000);

  it('strictly validates historical context while allowing legacy non-raster asset IDs', () => {
    const bounds = { x: 0, y: 0, w: 1, h: 1, minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const base = {
      schema: { portableBoardFragmentVersion: 1 as const, storeVersion: 6 },
      rootIds: [],
      records: [{
        id: 'asset:a', kind: 'asset', type: 'sanitized-svg', schemaVersion: 1,
        props: {}, meta: {},
      }],
      assetRefs: ['asset:a'],
      rasterPayloads: [],
      sourceBounds: bounds,
    };
    expect(() => validatePortableBoardFragmentStructure({
      ...base,
      resolutionContext: {
        documentId: '文档-1', versionId: 'version-2', snapshotId: 'snapshot-3',
        createdAt: '2026-08-11T12:30:45.123Z', metadata: { locale: '日本語', sequence: 2, retained: true, note: null },
      },
    })).not.toThrow();

    const invalidContexts = [
      { documentId: '' },
      { documentId: 1 },
      { versionId: false },
      { snapshotId: [] },
      { createdAt: 1 },
      { createdAt: '11 August 2026' },
      { metadata: [] },
      { metadata: { nested: {} } },
      { metadata: { list: [] } },
      { metadata: { missing: undefined } },
      { metadata: { infinite: Number.POSITIVE_INFINITY } },
      { documentId: 'é'.repeat(128 * 1024 + 1) },
    ];
    for (const resolutionContext of invalidContexts) {
      expect(() => validatePortableBoardFragmentStructure({ ...base, resolutionContext })).toThrow();
    }
  });

  it('counts complete serialized UTF-8 JSON before materialization', async () => {
    const source = createEditor({ plugins: [plugin] });
    const shapeId = addRaster(source, 'json-bytes');
    const fragment = await source.createPortableBoardFragment([shapeId], {
      exportRasterAsset: async () => ({ kind: 'self-contained', bytes: PNG_BYTES }),
      retainAssetReferences: async () => undefined,
    });
    const metadata = Object.fromEntries(Array.from({ length: 7000 }, (_, index) => [`k${index}`, true]));
    const oversized = { ...fragment!, resolutionContext: { metadata } } as PortableBoardFragment;
    const materialize = vi.fn();
    await expect(source.pastePortableBoardFragment(oversized, {
      materializeRasterAsset: materialize,
    })).rejects.toThrow(/size limit/);
    expect(materialize).not.toHaveBeenCalled();
  });

  it('preflights authorization before materialization', async () => {
    const source = createEditor({ plugins: [plugin] });
    const shapeId = addRaster(source, 'denied');
    const fragment = await source.createPortableBoardFragment([shapeId], {
      exportRasterAsset: async () => ({ kind: 'self-contained', bytes: PNG_BYTES }),
      retainAssetReferences: async () => undefined,
    });
    const destination = createEditor({
      plugins: [plugin],
      mutationPolicy: { authorize: () => 'deny' },
    });
    const materialize = vi.fn();

    await expect(destination.pastePortableBoardFragment(fragment!, {
      materializeRasterAsset: materialize,
    })).rejects.toThrow(/not permitted/i);
    expect(materialize).not.toHaveBeenCalled();
  });

  it('surfaces compensation failure together with the import failure', async () => {
    const source = createEditor({ plugins: [plugin] });
    const first = addRaster(source, 'rollback-first');
    const second = addRaster(source, 'rollback-second');
    const fragment = await source.createPortableBoardFragment([first, second], {
      exportRasterAsset: async asset => ({ kind: 'durable-reference', reference: `https://assets.test/${asset.id}` }),
      retainAssetReferences: async () => undefined,
    });
    const destination = createEditor({ plugins: [plugin] });
    let calls = 0;

    const paste = destination.pastePortableBoardFragment(fragment!, {
      materializeRasterAsset: async () => {
        calls += 1;
        if (calls === 2) throw new Error('materialization failed');
        return { rollback: async () => { throw new Error('rollback failed'); } };
      },
    });
    await expect(paste).rejects.toBeInstanceOf(PortablePasteRollbackError);
    await expect(paste).rejects.toMatchObject({
      importError: expect.objectContaining({ message: 'materialization failed' }),
      rollbackErrors: [expect.objectContaining({ message: 'rollback failed' })],
    });
  });

  it('embeds immutable raster bytes in portable SVG export with historical context', async () => {
    const context = { documentId: 'board-a', versionId: '9' };
    const editor = createEditor({
      plugins: [plugin],
      assetResolver: () => 'https://signed.example.test/runtime.png',
    });
    const shapeId = addRaster(editor, 'svg');
    const exportRasterAsset = vi.fn(async () => ({ kind: 'self-contained' as const, bytes: PNG_BYTES }));

    const svg = await editor.exportToPortableSvg([shapeId], { exportRasterAsset, resolutionContext: context });

    expect(svg).toContain('data:image/png;base64,iVBORw==');
    expect(svg).not.toContain('signed.example.test');
    expect(exportRasterAsset).toHaveBeenCalledWith(expect.objectContaining({ id: rasterAssetId('svg') }), context);
  });

  it('rejects oversized embedded bytes and invalid durable SVG references', async () => {
    const editor = createEditor({ plugins: [plugin] });
    const shapeId = addRaster(editor, 'svg-export-boundaries');

    await expect(editor.exportToPortableSvg([shapeId], {
      exportRasterAsset: async () => ({ kind: 'self-contained', bytes: new Uint8Array(20 * 1024 * 1024 + 1) }),
    })).rejects.toThrow(/embedded-byte limit/);

    for (const reference of ['', 'file:///tmp/private.png', 'x'.repeat(256 * 1024 + 1)]) {
      await expect(editor.exportToPortableSvg([shapeId], {
        exportRasterAsset: async () => ({ kind: 'durable-reference', reference }),
      })).rejects.toThrow(/invalid durable export reference/);
    }

    const svg = await editor.exportToPortableSvg([shapeId], {
      exportRasterAsset: async () => ({ kind: 'durable-reference', reference: 'https://assets.example.test/a.png' }),
    });
    expect(svg).toContain('https://assets.example.test/a.png');
  });

  it('renders PNG exports through canvas and reports each browser conversion failure', async () => {
    const editor = createEditor({ plugins: [plugin] });
    const shapeId = addRaster(editor, 'png-export');
    const originalCreateElement = document.createElement.bind(document);
    const scale = vi.fn();
    const drawImage = vi.fn();
    const revokeObjectURL = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:svg-export');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);

    class SuccessfulImage {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', SuccessfulImage);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'canvas'
      ? ({ width: 0, height: 0, getContext: () => ({ scale, drawImage }), toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['png'], { type: 'image/png' })) } as any)
      : originalCreateElement(tag)) as typeof document.createElement);

    await expect(editor.exportToPng([shapeId], { scale: 2 })).resolves.toBeInstanceOf(Blob);
    expect(scale).toHaveBeenCalledWith(2, 2);
    expect(drawImage).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:svg-export');

    await expect((editor as any)._svgToPngBlob('<svg></svg>')).rejects.toThrow(/Invalid SVG bounds/);

    vi.mocked(document.createElement).mockImplementation(((tag: string) => tag === 'canvas'
      ? ({ getContext: () => null } as any)
      : originalCreateElement(tag)) as typeof document.createElement);
    await expect(editor.exportToPng([shapeId])).rejects.toThrow(/No 2d context/);

    class FailedImage extends SuccessfulImage {
      set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    }
    vi.stubGlobal('Image', FailedImage);
    await expect(editor.exportToPng([shapeId])).rejects.toThrow(/Failed to load SVG/);
  });
});
