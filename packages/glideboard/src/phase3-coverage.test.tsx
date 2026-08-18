import React from 'react';
import { signal } from '@preact/signals';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetImportPanel, getAssetFileError, readAssetImportRequest } from './AssetImportPanel';
import { GlideboardProvider } from './GlideboardContext';
import type { GlideboardController } from './GlideboardController';
import { createAssetLibraryProvider, getRetainedAssetProvenance, uninstallAssetLibrary, type AssetLibraryItem } from './asset-library';
import type { GlideboardAssetImportJob } from './types';

const limits = {
  maxSvgBytes: 100,
  maxRasterBytes: 2 * 1024 * 1024,
  supportedMimeTypes: ['image/png', 'image/svg+xml'],
};

afterEach(cleanup);

function renderPanel(
  jobs: readonly GlideboardAssetImportJob[] | undefined,
  retryAssetImport: GlideboardController['retryAssetImport'] = vi.fn(() => ({ id: 'retry', result: Promise.resolve('shape:1') })),
) {
  const jobsSignal = signal(jobs);
  const controller = {
    assetImportJobsSignal: jobsSignal,
    cancelAssetImport: vi.fn(() => true),
    retryAssetImport,
    dismissAssetImport: vi.fn(() => true),
    domId: (suffix: string) => `coverage-${suffix}`,
  } as unknown as GlideboardController;
  const view = render(
    <GlideboardProvider controller={controller}>
      <AssetImportPanel notices={[]} onDismissNotice={vi.fn()} />
    </GlideboardProvider>,
  );
  return { ...view, controller, jobsSignal };
}

describe('Phase 3 import panel boundaries', () => {
  it('uses generic names and formats both KB and MB validation errors', async () => {
    expect(getAssetFileError({ name: '', type: 'image/gif', size: 1 }, limits)?.message).toMatch(/^This file/);
    expect(getAssetFileError({ name: '', type: 'image/png', size: 0 }, limits)?.message).toMatch(/^This file/);
    expect(getAssetFileError({ name: '', type: 'image/png', size: limits.maxRasterBytes + 1 }, limits)?.message)
      .toContain('2 MB');
    await expect(readAssetImportRequest(new File([], '', { type: 'image/png' }), { x: 0, y: 0 }, limits))
      .rejects.toMatchObject({ category: 'invalid-content' });
  });

  it('returns null without work and handles unnamed SVG and raster jobs', () => {
    const empty = renderPanel(undefined);
    expect(empty.container.innerHTML).toBe('');
    empty.unmount();

    const { jobsSignal } = renderPanel([
      { id: 'svg', kind: 'svg', status: 'queued', progress: 0, attempt: 1 },
      { id: 'raster', kind: 'raster', status: 'uploading', progress: 0.25, attempt: 1 },
    ]);
    expect(screen.getByText('SVG image')).toBeTruthy();
    expect(screen.getByText('Raster image')).toBeTruthy();
    expect(screen.getAllByLabelText('Progress for image')).toHaveLength(2);
    act(() => {
      jobsSignal.value = jobsSignal.value ? [...jobsSignal.value] : [];
    });
    expect(screen.getByText('Uploading 25%')).toBeTruthy();
  });

  it('isolates pointer events and synchronous and asynchronous retry failures', async () => {
    const parentPointer = vi.fn();
    const rejected = renderPanel([{
      id: 'cancelled', kind: 'svg', status: 'cancelled', progress: 0, attempt: 1,
    }], vi.fn(() => ({ id: 'retry', result: Promise.reject(new Error('offline')) })) as any);
    rejected.container.parentElement?.addEventListener('pointerdown', parentPointer);
    fireEvent.pointerDown(screen.getByLabelText('Image imports'));
    expect(parentPointer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry import' }));
    await act(async () => { await Promise.resolve(); });
    rejected.unmount();

    renderPanel([{
      id: 'cancelled', kind: 'svg', status: 'cancelled', progress: 0, attempt: 1,
    }], vi.fn(() => { throw new Error('stale'); }) as any);
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Retry import' }))).not.toThrow();
  });
});

describe('Phase 3 retained dependency mismatch', () => {
  it('refuses catalog removal when a resolver returns another dependency', async () => {
    const item: AssetLibraryItem = {
      id: 'item', providerId: 'provider', sourceLibraryId: 'library', sourceVersion: '1',
      name: 'Item', mediaType: 'svg', width: 10, height: 10, license: 'MIT',
      groupIds: [], availability: 'available', isFavorite: false,
    };
    const dependency = { contentHash: 'a'.repeat(64), provenance: getRetainedAssetProvenance(item) };
    const removeInstallation = vi.fn();
    const provider = createAssetLibraryProvider({
      id: 'provider',
      search: async () => ({ items: [] }),
      getGroups: async () => [],
      getFavorites: async () => [],
      setFavorite: async () => undefined,
      getRecents: async () => [],
      recordRecent: async () => undefined,
      getInstallations: async () => [],
      install: async libraryId => ({
        libraryId, providerId: 'provider', sourceVersion: '1', status: 'installed',
      }),
      getRetainedDependencies: async () => [dependency],
      resolveRetainedDependency: vi.fn(async () => ({
        dependency: { ...dependency, contentHash: 'b'.repeat(64) },
        materialize: vi.fn(),
      })),
      removeInstallation,
      materialize: async () => { throw new Error('not used'); },
    });

    await expect(uninstallAssetLibrary(provider, 'library', new AbortController().signal))
      .rejects.toThrow(/mismatched handle/);
    expect(removeInstallation).not.toHaveBeenCalled();
  });
});
