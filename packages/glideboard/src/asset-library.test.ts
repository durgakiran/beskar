import { describe, expect, it, vi } from 'vitest';
import type {
  AssetLibraryItem,
  AssetLibraryProvider,
  RetainedAssetDependency,
  RetainedAssetDependencyHandle,
} from './asset-library';
import {
  createAssetLibraryProvider,
  getRetainedAssetProvenance,
  uninstallAssetLibrary,
} from './asset-library';

const item: AssetLibraryItem = {
  id: 'icon:bolt',
  providerId: 'vendor',
  sourceLibraryId: 'icons',
  sourceVersion: '2026.4',
  name: 'Bolt',
  mediaType: 'svg',
  width: 24,
  height: 24,
  license: 'MIT',
  groupIds: ['symbols'],
  availability: 'available',
  isFavorite: false,
};

function createProviderBackend(overrides: {
  getRetainedDependencies: () => Promise<readonly RetainedAssetDependency[]>;
  resolveRetainedDependency: (
    dependency: RetainedAssetDependency,
    signal: AbortSignal,
  ) => Promise<RetainedAssetDependencyHandle>;
  removeInstallation: (libraryId: string, signal: AbortSignal) => Promise<void>;
}) {
  return {
    id: 'vendor',
    search: async () => ({ items: [] }),
    getGroups: async () => [],
    getFavorites: async () => [],
    setFavorite: async () => undefined,
    getRecents: async () => [],
    recordRecent: async () => undefined,
    getInstallations: async () => [],
    install: async (libraryId: string) => ({
      libraryId, providerId: 'vendor', sourceVersion: '1', status: 'installed' as const,
    }),
    materialize: async () => { throw new Error('not used'); },
    ...overrides,
  };
}

describe('asset library contracts', () => {
  it('forwards the complete current provider contract through the frozen facade', async () => {
    const signal = new AbortController().signal;
    const backend = createProviderBackend({
      getRetainedDependencies: vi.fn(async () => []),
      resolveRetainedDependency: vi.fn(),
      removeInstallation: vi.fn(async () => undefined),
    });
    for (const key of [
      'search', 'getGroups', 'getFavorites', 'setFavorite', 'getRecents',
      'recordRecent', 'getInstallations', 'install', 'materialize',
    ] as const) {
      backend[key] = vi.fn(backend[key] as never) as never;
    }
    const provider = createAssetLibraryProvider(backend);

    await provider.search({ query: 'bolt', signal });
    await provider.getGroups(signal);
    await provider.getFavorites(signal);
    await provider.setFavorite(item.id, true, signal);
    await provider.getRecents(signal);
    await provider.recordRecent(item.id, signal);
    await provider.getInstallations(signal);
    await provider.install(item.sourceLibraryId, signal);
    await expect(provider.materialize({
      selection: { itemId: item.id, providerId: item.providerId },
      signal,
    } as never)).rejects.toThrow('not used');

    expect(Object.isFrozen(provider)).toBe(true);
    expect(backend.search).toHaveBeenCalledOnce();
    expect(backend.getGroups).toHaveBeenCalledWith(signal);
    expect(backend.getFavorites).toHaveBeenCalledWith(signal);
    expect(backend.setFavorite).toHaveBeenCalledWith(item.id, true, signal);
    expect(backend.getRecents).toHaveBeenCalledWith(signal);
    expect(backend.recordRecent).toHaveBeenCalledWith(item.id, signal);
    expect(backend.getInstallations).toHaveBeenCalledWith(signal);
    expect(backend.install).toHaveBeenCalledWith(item.sourceLibraryId, signal);
    expect(backend.materialize).toHaveBeenCalledOnce();
  });

  it('derives complete immutable retained provenance from a catalog item', () => {
    const provenance = getRetainedAssetProvenance(item);
    expect(provenance).toEqual({
      providerId: 'vendor',
      itemId: 'icon:bolt',
      sourceLibraryId: 'icons',
      sourceVersion: '2026.4',
      license: 'MIT',
    });
    expect(Object.isFrozen(provenance)).toBe(true);
  });

  it('resolves retained handles before uninstall and keeps them usable afterward', async () => {
    const dependency: RetainedAssetDependency = {
      contentHash: 'a'.repeat(64),
      provenance: getRetainedAssetProvenance(item),
    };
    let installed = true;
    const materialize = vi.fn(async () => ({ id: 'retained-content' })) as unknown as RetainedAssetDependencyHandle['materialize'];
    const handle: RetainedAssetDependencyHandle = { dependency, materialize };
    const resolveRetainedDependency = vi.fn(async () => handle);
    const getRetainedDependencies = vi.fn(async () => [dependency]);
    const removeInstallation = vi.fn(async () => { installed = false; });
    const provider = createAssetLibraryProvider(createProviderBackend({
      getRetainedDependencies,
      resolveRetainedDependency,
      removeInstallation,
    }));

    const handles = await uninstallAssetLibrary(
      provider,
      'icons',
      new AbortController().signal,
    );

    expect(getRetainedDependencies).toHaveBeenCalledWith('icons', expect.any(AbortSignal));
    expect(resolveRetainedDependency.mock.invocationCallOrder[0])
      .toBeLessThan(removeInstallation.mock.invocationCallOrder[0]!);
    expect(installed).toBe(false);
    await handles[0]!.materialize(new AbortController().signal);
    expect(materialize).toHaveBeenCalledOnce();
  });

  it('does not uninstall when a retained dependency cannot be resolved', async () => {
    const removeInstallation = vi.fn(async () => undefined);
    const dependency = {
      contentHash: 'b'.repeat(64),
      provenance: getRetainedAssetProvenance(item),
    };
    const provider = createAssetLibraryProvider(createProviderBackend({
      getRetainedDependencies: vi.fn(async () => [dependency]),
      resolveRetainedDependency: vi.fn(async () => { throw new Error('missing retained bytes'); }),
      removeInstallation,
    }));

    await expect(uninstallAssetLibrary(provider, 'icons', new AbortController().signal))
      .rejects.toThrow('missing retained bytes');
    expect(removeInstallation).not.toHaveBeenCalled();
  });

  it('does not expose or accept a direct catalog-removal bypass', async () => {
    const directRemove = vi.fn(async () => undefined);
    const backend = createProviderBackend({
      getRetainedDependencies: vi.fn(async () => []),
      resolveRetainedDependency: vi.fn(),
      removeInstallation: directRemove,
    });
    const provider = createAssetLibraryProvider(backend);

    expect('removeInstallation' in provider).toBe(false);
    expect((provider as AssetLibraryProvider & { removeInstallation?: unknown }).removeInstallation)
      .toBeUndefined();
    await expect(uninstallAssetLibrary(
      { ...provider },
      'icons',
      new AbortController().signal,
    )).rejects.toThrow(/createAssetLibraryProvider/);
    expect(directRemove).not.toHaveBeenCalled();
  });

  it('rejects a legacy false-empty dependency list instead of uninstalling', async () => {
    const dependency: RetainedAssetDependency = {
      contentHash: 'c'.repeat(64),
      provenance: getRetainedAssetProvenance(item),
    };
    const removeInstallation = vi.fn(async () => undefined);
    const provider = createAssetLibraryProvider(createProviderBackend({
      getRetainedDependencies: vi.fn(async () => [dependency]),
      resolveRetainedDependency: vi.fn(async () => ({ dependency, materialize: vi.fn() })),
      removeInstallation,
    }));
    const legacyUninstall = uninstallAssetLibrary as unknown as (
      provider: AssetLibraryProvider,
      libraryId: string,
      dependencies: readonly RetainedAssetDependency[],
      signal: AbortSignal,
    ) => Promise<readonly RetainedAssetDependencyHandle[]>;

    await expect(legacyUninstall(provider, 'icons', [], new AbortController().signal))
      .rejects.toThrow(/derived internally/);
    expect(removeInstallation).not.toHaveBeenCalled();
  });

  it('rejects retained dependencies from another library', async () => {
    const dependency: RetainedAssetDependency = {
      contentHash: 'd'.repeat(64),
      provenance: { ...getRetainedAssetProvenance(item), sourceLibraryId: 'other-library' },
    };
    const removeInstallation = vi.fn(async () => undefined);
    const provider = createAssetLibraryProvider(createProviderBackend({
      getRetainedDependencies: vi.fn(async () => [dependency]),
      resolveRetainedDependency: vi.fn(),
      removeInstallation,
    }));

    await expect(uninstallAssetLibrary(provider, 'icons', new AbortController().signal))
      .rejects.toThrow(/belongs to another library/);
    expect(removeInstallation).not.toHaveBeenCalled();
  });
});
