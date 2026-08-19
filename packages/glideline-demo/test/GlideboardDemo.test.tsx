// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const portableFragment = { schema: { portableBoardFragmentVersion: 1, storeVersion: 1 }, rootIds: [] };
const createPortableFragment = vi.fn(async () => portableFragment);
const clearAssetImportHistory = vi.fn();
const pastePortableFragment = vi.fn(async () => ['shape:pasted']);
const exportSvg = vi.fn(async () => '<svg/>');
const flush = vi.fn(async () => undefined);
const setCurrentTool = vi.fn();
const setReadOnly = vi.fn();
const replaceDocument = vi.fn();
const importRaster = vi.fn(async () => 'shape:source-raster');
const glideboardProps: Array<Record<string, unknown>> = [];
let serializedRecords: Array<Record<string, unknown>> = [{ id: 'shape:one', kind: 'shape' }];
let sourceRecords: Array<Record<string, unknown>> = [];
let destinationRecords: Array<Record<string, unknown>> = [];

const mainGlideboardProps = () => glideboardProps.findLast(props => props.sessionKey === 'glideline-whiteboard-demo');

vi.mock('@durgakiran/glideboard', () => ({
  createAssetLibraryProvider: (provider: unknown) => provider,
  createSvgPathShape: (config: { getPathD(w: number, h: number): string }) => {
    config.getPathD(160, 80);
    return { plugin: { type: 'aws-lambda' } };
  },
  Glideboard: React.forwardRef(function MockGlideboard(props, ref) {
    glideboardProps.push(props as Record<string, unknown>);
    const sessionKey = String((props as { sessionKey?: string }).sessionKey);
    const isSource = sessionKey === 'glideline-p3-c6-source';
    const isDestination = sessionKey === 'glideline-p3-c6-destination';
    const records = () => isSource ? sourceRecords : isDestination ? destinationRecords : serializedRecords;
    React.useImperativeHandle(ref, () => ({
      serialize: () => ({ storeVersion: 6, records: records() }),
      replaceDocument: (document: { records: Array<Record<string, unknown>> }) => {
        replaceDocument(sessionKey, document);
        if (isSource) sourceRecords = [...document.records];
        if (isDestination) destinationRecords = [...document.records];
      },
      importRaster: async (...args: unknown[]) => {
        await importRaster(...args);
        sourceRecords = [
          { id: 'asset:sha256:' + 'a'.repeat(64), kind: 'asset', type: 'raster-image' },
          { id: 'shape:source-raster', kind: 'shape', type: 'raster-image', props: { assetId: 'asset:sha256:' + 'a'.repeat(64) } },
        ];
        return 'shape:source-raster';
      },
      createPortableFragment,
      pastePortableFragment: async (...args: unknown[]) => {
        const ids = await pastePortableFragment(...args);
        if (isDestination) {
          destinationRecords = [
            { id: 'asset:sha256:' + 'a'.repeat(64), kind: 'asset', type: 'raster-image' },
            { id: 'shape:pasted', kind: 'shape', type: 'raster-image', props: { assetId: 'asset:sha256:' + 'a'.repeat(64) } },
          ];
        }
        return ids;
      },
      exportSvg: async (...args: unknown[]) => {
        if (isDestination) {
          exportSvg(...args);
          return '<svg><image href="data:image/png;base64,AA=="/></svg>';
        }
        return exportSvg(...args);
      },
      flush,
      clearAssetImportHistory,
		setCurrentTool,
		setReadOnly,
    }));
    const shapeId = isSource ? 'shape:source-raster' : isDestination ? 'shape:pasted' : undefined;
    return React.createElement('div', { 'data-testid': 'demo-board' }, shapeId
      ? React.createElement('div', { 'data-shape-id': shapeId }, React.createElement('image', { href: `blob:${sessionKey}` }))
      : null);
  }),
}));

import GlideboardDemo, { createDemoAssetLibraryProvider } from '../src/GlideboardDemo';
import type { DemoAssetStorage } from '../src/demo-asset-storage';

const rasterAsset = {
  id: `asset:sha256:${'c'.repeat(64)}`,
  kind: 'asset',
  type: 'raster-image',
  props: { hash: 'c'.repeat(64), mimeType: 'image/png' },
  meta: {},
};

describe('GlideboardDemo portable export verification', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.__GLIDELINE_PORTABLE_EXPORT__;
    createPortableFragment.mockClear();
    clearAssetImportHistory.mockClear();
    pastePortableFragment.mockClear();
    exportSvg.mockClear();
    flush.mockClear();
	setCurrentTool.mockClear();
    setReadOnly.mockClear();
	replaceDocument.mockClear();
	importRaster.mockClear();
    glideboardProps.length = 0;
    serializedRecords = [{ id: 'shape:one', kind: 'shape' }];
    sourceRecords = [];
    destinationRecords = [];
  });

  afterEach(() => cleanup());

  it('exposes a browser-verifiable portable export action', async () => {
    render(<GlideboardDemo />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export portable' }));
      await Promise.resolve();
    });

    expect(window.__GLIDELINE_PORTABLE_EXPORT__).toBe(portableFragment);
    expect(createPortableFragment).toHaveBeenCalledWith({ shapeIds: ['shape:one'] });
    expect(document.querySelector('#demo-export-portable')?.getAttribute('data-export-status')).toBe('ready');
  });

  it('clears all persisted and injected demo state when demo data is reset', () => {
    window.localStorage.setItem('glideline-whiteboard-v1', JSON.stringify({ records: [] }));
    window.localStorage.setItem('glideline-whiteboard-demo-raster-bytes-v1', '[]');
    window.localStorage.setItem('glideline-whiteboard-demo-asset-favorites', '["aws:lambda"]');
    window.localStorage.setItem('glideline-whiteboard-demo-asset-recents', '["aws:lambda"]');
    window.__GLIDELINE_PORTABLE_EXPORT__ = portableFragment;
    render(<GlideboardDemo />);
    fireEvent.click(screen.getByRole('button', { name: 'Slow upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fail next upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hold placement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Read-only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset demo data' }));

	expect(clearAssetImportHistory).toHaveBeenCalledOnce();
	expect(setReadOnly).toHaveBeenCalledWith(false);
	expect(setReadOnly.mock.invocationCallOrder[0]).toBeLessThan(clearAssetImportHistory.mock.invocationCallOrder[0]!);
    expect(window.localStorage.getItem('glideline-whiteboard-v1')).toBeNull();
    expect(window.localStorage.getItem('glideline-whiteboard-demo-raster-bytes-v1')).toBeNull();
    expect(window.localStorage.getItem('glideline-whiteboard-demo-asset-favorites')).toBeNull();
    expect(window.localStorage.getItem('glideline-whiteboard-demo-asset-recents')).toBeNull();
    expect(window.__GLIDELINE_PORTABLE_EXPORT__).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Slow upload' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Fail next upload' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Hold placement' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Read-only' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('invalidates the catalog provider on reset when demo toggles are already at defaults', () => {
    render(<GlideboardDemo />);
    const initialProvider = mainGlideboardProps()?.assetLibraryProvider;

    fireEvent.click(screen.getByRole('button', { name: 'Reset demo data' }));

    expect(mainGlideboardProps()?.assetLibraryProvider).not.toBe(initialProvider);
    expect(screen.getByRole('button', { name: 'Slow upload' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Fail next upload' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Read-only' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('implements the complete catalog persistence and materialization contract', async () => {
    const provider = createDemoAssetLibraryProvider();
    const signal = new AbortController().signal;
    expect((await provider.getGroups(signal)).map(group => group.id)).toContain('aws');
    expect((await provider.search({ query: 'lambda', groupIds: ['aws'], signal })).items).toHaveLength(1);
    expect((await provider.search({ query: 'missing', signal })).items).toHaveLength(0);
    await provider.setFavorite('aws:lambda', true, signal);
    expect((await provider.getFavorites(signal))[0]).toMatchObject({ id: 'aws:lambda', isFavorite: true });
    await provider.setFavorite('aws:lambda', false, signal);
    expect(await provider.getFavorites(signal)).toEqual([]);
    await provider.recordRecent('aws:lambda', signal);
    await provider.recordRecent('azure:functions', signal);
    await provider.recordRecent('aws:lambda', signal);
    expect((await provider.getRecents(signal)).map(item => item.id)).toEqual(['aws:lambda', 'azure:functions']);
    expect(await provider.getInstallations(signal)).toHaveLength(6);
    await expect(provider.install('aws', signal)).resolves.toMatchObject({ libraryId: 'aws', status: 'installed' });
    await expect(provider.getRetainedDependencies(signal)).resolves.toEqual([]);
    await expect(provider.resolveRetainedDependency({} as never, signal)).rejects.toThrow(/no retained/);
    await expect(provider.removeInstallation('aws', signal)).rejects.toThrow(/cannot be removed/);
    const materialized = await provider.materialize({ itemId: 'aws:lambda', signal } as never);
    expect(materialized).toMatchObject({ contentHash: 'f'.repeat(64) });
    await materialized.rollback();
    await expect(provider.materialize({ itemId: 'team:legacy', signal } as never)).rejects.toThrow(/unavailable/);
    await expect(provider.materialize({ itemId: 'absent', signal } as never)).rejects.toThrow(/unavailable/);
  });

  it('holds materialization until release and rejects cancellation while held', async () => {
    render(<GlideboardDemo />);
    fireEvent.click(screen.getByRole('button', { name: 'Hold placement' }));
    const provider = mainGlideboardProps()?.assetLibraryProvider as ReturnType<typeof createDemoAssetLibraryProvider>;
    const releasedController = new AbortController();
    const released = provider.materialize({ itemId: 'aws:lambda', signal: releasedController.signal } as never);
    let settled = false;
    void released.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    const cancelledController = new AbortController();
    const cancelled = provider.materialize({ itemId: 'aws:lambda', signal: cancelledController.signal } as never);
    cancelledController.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });

    fireEvent.click(screen.getByRole('button', { name: 'Hold placement' }));
    await expect(released).resolves.toMatchObject({ contentHash: 'f'.repeat(64) });
  });

  it('fails once, filters malformed storage, and honors cancellation', async () => {
    window.localStorage.setItem('glideline-whiteboard-demo-asset-favorites', '{');
    window.localStorage.setItem('glideline-whiteboard-demo-asset-recents', '[1,"aws:lambda",null]');
    const provider = createDemoAssetLibraryProvider({ failFirstSearch: true });
    const signal = new AbortController().signal;
    await expect(provider.search({ query: '', signal })).rejects.toThrow(/unavailable/);
    await expect(provider.search({ query: '', signal })).resolves.toMatchObject({ items: expect.any(Array) });
    expect(await provider.getFavorites(signal)).toEqual([]);
    expect((await provider.getRecents(signal)).map(item => item.id)).toEqual(['aws:lambda']);
    const aborted = new AbortController();
    aborted.abort();
    await expect(provider.getGroups(aborted.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(provider.setFavorite('aws:lambda', true, aborted.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(provider.recordRecent('aws:lambda', aborted.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(provider.materialize({ itemId: 'aws:lambda', signal: aborted.signal } as never)).rejects.toMatchObject({ name: 'AbortError' });

    const loading = createDemoAssetLibraryProvider({ loading: true });
    const pendingAbort = new AbortController();
    const pending = loading.getGroups(pendingAbort.signal);
    pendingAbort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('covers catalog edge cases and placement failure controls', async () => {
    window.localStorage.setItem('glideline-whiteboard-demo-asset-favorites', '{}');
    const signal = new AbortController().signal;
    const provider = createDemoAssetLibraryProvider();
    expect(await provider.getFavorites(signal)).toEqual([]);

    let abortedReads = 0;
    const changesToAborted = {
      get aborted() { return abortedReads++ > 0; },
      addEventListener: vi.fn(),
    } as unknown as AbortSignal;
    await expect(createDemoAssetLibraryProvider({ loading: true }).getGroups(changesToAborted))
      .rejects.toMatchObject({ name: 'AbortError' });

    const abortAfterRead = new AbortController();
    const abortingProvider = createDemoAssetLibraryProvider({
      beforeMaterialize: async () => { abortAfterRead.abort(); },
    });
    await expect(abortingProvider.materialize({ itemId: 'aws:lambda', signal: abortAfterRead.signal } as never))
      .rejects.toMatchObject({ name: 'AbortError' });

    render(<GlideboardDemo />);
    const readyProvider = mainGlideboardProps()?.assetLibraryProvider as ReturnType<typeof createDemoAssetLibraryProvider>;
    await expect(readyProvider.materialize({ itemId: 'aws:lambda', signal } as never)).resolves.toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Fail next placement' }));
    await expect(readyProvider.materialize({ itemId: 'aws:lambda', signal } as never)).rejects.toThrow(/placement failed/);
  });

  it('exercises upload and download injection through the rendered demo storage', async () => {
    render(<GlideboardDemo />);
    const storage = mainGlideboardProps()?.assetStorage as DemoAssetStorage;
    const signal = new AbortController().signal;
    const successful = await storage.prepare!(rasterAsset as never, signal);
    const progress = vi.fn();
    await successful.stage(new Uint8Array([1, 2]), signal, progress);
    await successful.commit(signal);
    expect(progress).toHaveBeenLastCalledWith(1);
    await expect(storage.download!(rasterAsset as never, signal)).resolves.toMatchObject({ mimeType: 'image/png' });

    fireEvent.click(screen.getByRole('button', { name: 'Fail next download' }));
    await expect(storage.download!(rasterAsset as never, signal)).rejects.toMatchObject({ category: 'storage' });

    fireEvent.click(screen.getByRole('button', { name: 'Fail next upload' }));
    const failing = await storage.prepare!(
      { ...rasterAsset, id: `asset:sha256:${'d'.repeat(64)}`, props: { ...rasterAsset.props, hash: 'd'.repeat(64) } } as never,
      signal,
    );
    await expect(failing.stage(new Uint8Array([3]), signal)).rejects.toMatchObject({ category: 'storage' });
  });

  it('restores valid sessions, removes corrupt sessions, and exposes the browser acceptance API', async () => {
    serializedRecords = [
      { id: 'shape:raster', kind: 'shape', type: 'raster-image', props: { assetId: 'asset:raster' } },
      { id: 'asset:raster', kind: 'asset', type: 'raster-image' },
    ];
    Object.defineProperty(window, 'CSS', { configurable: true, value: { escape: (value: string) => value } });
    window.localStorage.setItem('glideline-whiteboard-v1', JSON.stringify({ storeVersion: 1, records: [] }));
    const { unmount } = render(<GlideboardDemo />);
    const image = document.createElement('image');
    image.setAttribute('href', 'blob:resolved');
    const shape = document.createElement('div');
    shape.setAttribute('data-shape-id', 'shape:raster');
    shape.append(image);
    document.querySelector('[data-demo-role="board"]')!.append(shape);
    expect(mainGlideboardProps()?.initialDocument).toEqual({ storeVersion: 1, records: [] });
    expect(mainGlideboardProps()?.initialDocumentDisposition).toMatchObject({ kind: 'local-recovery' });
    const api = window.__GLIDELINE_P3_C6__!;
    expect(api.getAcceptanceState()).toMatchObject({ recordCount: 2, shapeCount: 1, assetCount: 1, rasterShapeCount: 1 });
    expect(api.getAcceptanceState().assets[0]?.resolvedUrls).toEqual(['blob:resolved']);
    await expect(api.createPortableFragment(['shape:one'])).resolves.toBe(portableFragment);
    await expect(api.pastePortableFragment(portableFragment as never, { x: 4, y: 5 })).resolves.toEqual(['shape:pasted']);
    await expect(api.exportSvg(['shape:one'])).resolves.toBe('<svg/>');
    expect(api.getRequestEvidence()).toEqual([
      { sequence: 1, operation: 'createPortableFragment', shapeIds: ['shape:one'] },
      { sequence: 2, operation: 'pastePortableFragment', point: { x: 4, y: 5 } },
      { sequence: 3, operation: 'exportSvg', shapeIds: ['shape:one'] },
    ]);
    await api.flush();
    await api.resetDestination();
    expect(api.getRequestEvidence()).toHaveLength(3);
    expect(clearAssetImportHistory).toHaveBeenCalled();
    expect(flush).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'AWS Lambda' }));
    expect(setCurrentTool).toHaveBeenCalledWith('aws-lambda');
    (mainGlideboardProps()?.onDocumentChange as (document: unknown) => void)({ records: [] });
    expect(window.localStorage.getItem('glideline-whiteboard-v1')).toContain('records');
    shape.remove();
    unmount();
    expect(window.__GLIDELINE_P3_C6__).toBeUndefined();

    window.localStorage.setItem('glideline-whiteboard-v1', '{');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<GlideboardDemo />);
    expect(window.localStorage.getItem('glideline-whiteboard-v1')).toBeNull();
    expect(warning).toHaveBeenCalled();
  });

  it('runs the deterministic P3-C6 operation across distinct production handles', async () => {
    render(<GlideboardDemo />);

    const result = await window.__GLIDELINE_P3_C6__!.runCrossBoardAcceptance();

    expect(importRaster).toHaveBeenCalledOnce();
    expect(createPortableFragment).toHaveBeenCalledWith({
      shapeIds: ['shape:source-raster'],
      resolutionContext: { documentId: 'glideline-p3-c6-source' },
    });
    expect(pastePortableFragment).toHaveBeenCalledWith(portableFragment, { point: { x: 240, y: 180 } });
    expect(exportSvg).toHaveBeenCalledWith({
      shapeIds: ['shape:pasted'],
      resolutionContext: { documentId: 'glideline-p3-c6-destination' },
    });
    expect(importRaster.mock.invocationCallOrder[0]).toBeLessThan(createPortableFragment.mock.invocationCallOrder[0]!);
    expect(createPortableFragment.mock.invocationCallOrder[0]).toBeLessThan(pastePortableFragment.mock.invocationCallOrder[0]!);
    expect(pastePortableFragment.mock.invocationCallOrder[0]).toBeLessThan(exportSvg.mock.invocationCallOrder[0]!);
    expect(result).toMatchObject({
      source: { shapeCount: 1, assetCount: 1, rasterShapeCount: 1 },
      destination: { shapeCount: 1, assetCount: 1, rasterShapeCount: 1 },
      renderedAssetUrlState: {
        source: [{ urls: ['blob:glideline-p3-c6-source'], allBlobUrls: true }],
        destination: [{ urls: ['blob:glideline-p3-c6-destination'], allBlobUrls: true }],
      },
      svg: { containsEmbeddedPng: true, containsBlobUrl: false },
      requests: [
        { sequence: 1, board: 'source', operation: 'createPortableFragment' },
        { sequence: 2, board: 'destination', operation: 'pastePortableFragment' },
        { sequence: 3, board: 'destination', operation: 'exportSvg' },
      ],
    });
    expect(window.__GLIDELINE_P3_C6__!.getLastCrossBoardAcceptance()).toEqual(result);
  });

  it('supports optional acceptance arguments and the successful P3-C6 control', async () => {
    render(<GlideboardDemo />);
    const api = window.__GLIDELINE_P3_C6__!;
    const context = { documentId: 'portable-test' };
    await api.createPortableFragment(['shape:one'], context);
    await api.pastePortableFragment(portableFragment as never);
    await api.exportSvg(undefined, context);
    expect(api.getRequestEvidence()).toEqual([
      expect.objectContaining({ operation: 'createPortableFragment', context }),
      { sequence: 2, operation: 'pastePortableFragment' },
      expect.objectContaining({ operation: 'exportSvg', context }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Run P3-C6' }));
    await waitFor(() => expect(document.querySelector('#demo-run-p3-c6')?.getAttribute('data-acceptance-status')).toBe('ready'));
    expect(screen.getByRole('status').textContent).toContain('3 requests');
  });

  it('reports Error and non-Error failures from the P3-C6 control', async () => {
    createPortableFragment.mockResolvedValueOnce(null);
    render(<GlideboardDemo />);
    fireEvent.click(screen.getByRole('button', { name: 'Run P3-C6' }));
    await waitFor(() => expect(document.querySelector('#demo-run-p3-c6')?.getAttribute('data-acceptance-status')).toBe('error'));
    expect(document.querySelector('[data-demo-role="p3-c6-result"]')?.textContent).toContain('did not produce');

    createPortableFragment.mockRejectedValueOnce('string failure');
    fireEvent.click(screen.getByRole('button', { name: 'Run P3-C6' }));
    await waitFor(() => expect(document.querySelector('[data-demo-role="p3-c6-result"]')?.textContent).toBe('string failure'));
  });

  it('surfaces portable export failure and updates demo control props', async () => {
    createPortableFragment.mockRejectedValueOnce(new Error('export failed'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<GlideboardDemo />);
    fireEvent.click(screen.getByRole('button', { name: 'Catalog loading' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fail catalog load' }));
    fireEvent.click(screen.getByRole('button', { name: 'Slow upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fail next upload' }));
    expect(mainGlideboardProps()).toMatchObject({ readOnly: false });
    fireEvent.click(screen.getByRole('button', { name: 'Export portable' }));
    await waitFor(() => expect(document.querySelector('#demo-export-portable')?.getAttribute('data-export-status')).toBe('error'));
    expect(error).toHaveBeenCalled();
  });
});
