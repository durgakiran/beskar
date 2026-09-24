import type {
  AssetMaterialization,
  AssetMaterializationRequest,
  AssetMaterializer,
  AssetPlacementCallbacks,
  AssetPlacementSelection,
  RetainedAssetProvenance,
} from '@durgakiran/glideline';

export type AssetLibraryMediaType = 'svg' | 'raster';
export type AssetLibraryAvailability = 'available' | 'unavailable' | 'missing';
export type AssetLibraryGroupKind = 'recent' | 'favorites' | 'personal' | 'team' | 'vendor';

export interface AssetLibraryItem {
  readonly id: string;
  readonly providerId: string;
  readonly sourceLibraryId: string;
  readonly sourceVersion: string;
  readonly name: string;
  readonly mediaType: AssetLibraryMediaType;
  readonly width: number;
  readonly height: number;
  readonly license: string;
  readonly thumbnailUrl?: string;
  readonly groupIds: readonly string[];
  readonly availability: AssetLibraryAvailability;
  readonly isFavorite: boolean;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface AssetLibraryGroup {
  readonly id: string;
  readonly providerId: string;
  readonly name: string;
  readonly kind: AssetLibraryGroupKind;
  readonly installed: boolean;
  readonly sourceVersion?: string;
}

export interface AssetLibrarySearchRequest {
  readonly query: string;
  readonly groupIds?: readonly string[];
  readonly cursor?: string;
  readonly limit?: number;
  readonly signal: AbortSignal;
}

export interface AssetLibrarySearchResult {
  readonly items: readonly AssetLibraryItem[];
  readonly nextCursor?: string;
}

export interface AssetLibraryInstallation {
  readonly libraryId: string;
  readonly providerId: string;
  readonly sourceVersion: string;
  readonly status: 'installed' | 'installing' | 'uninstalling' | 'error';
  readonly error?: string;
}

export interface RetainedAssetDependency {
  readonly contentHash: string;
  readonly provenance: RetainedAssetProvenance;
}

export interface RetainedAssetDependencyHandle {
  readonly dependency: RetainedAssetDependency;
  /** Resolves immutable content without depending on catalog installation state. */
  materialize(signal: AbortSignal): Promise<AssetMaterialization>;
}

export interface AssetLibraryProvider {
  readonly id: string;
  search(request: AssetLibrarySearchRequest): Promise<AssetLibrarySearchResult>;
  getGroups(signal: AbortSignal): Promise<readonly AssetLibraryGroup[]>;
  getFavorites(signal: AbortSignal): Promise<readonly AssetLibraryItem[]>;
  setFavorite(itemId: string, favorite: boolean, signal: AbortSignal): Promise<void>;
  getRecents(signal: AbortSignal): Promise<readonly AssetLibraryItem[]>;
  recordRecent(itemId: string, signal: AbortSignal): Promise<void>;
  getInstallations(signal: AbortSignal): Promise<readonly AssetLibraryInstallation[]>;
  install(libraryId: string, signal: AbortSignal): Promise<AssetLibraryInstallation>;
  resolveRetainedDependency(
    dependency: RetainedAssetDependency,
    signal: AbortSignal,
  ): Promise<RetainedAssetDependencyHandle>;
  /** Resolves only after immutable content is durable; abort/failure must expose no partial content. */
  materialize(request: AssetMaterializationRequest): Promise<AssetMaterialization>;
}

interface AssetLibraryProviderBackend extends AssetLibraryProvider {
  /** Derives dependencies from authoritative retained board state. */
  getRetainedDependencies(
    libraryId: string,
    signal: AbortSignal,
  ): Promise<readonly RetainedAssetDependency[]>;
  removeInstallation(libraryId: string, signal: AbortSignal): Promise<void>;
}

const uninstallBackends = new WeakMap<AssetLibraryProvider, AssetLibraryProviderBackend>();

/**
 * Creates the public provider surface while retaining destructive catalog
 * operations as module-private capabilities.
 */
export function createAssetLibraryProvider(
  backend: AssetLibraryProviderBackend,
): AssetLibraryProvider {
  const provider: AssetLibraryProvider = {
    id: backend.id,
    search: request => backend.search(request),
    getGroups: signal => backend.getGroups(signal),
    getFavorites: signal => backend.getFavorites(signal),
    setFavorite: (itemId, favorite, signal) => backend.setFavorite(itemId, favorite, signal),
    getRecents: signal => backend.getRecents(signal),
    recordRecent: (itemId, signal) => backend.recordRecent(itemId, signal),
    getInstallations: signal => backend.getInstallations(signal),
    install: (libraryId, signal) => backend.install(libraryId, signal),
    resolveRetainedDependency: (dependency, signal) => (
      backend.resolveRetainedDependency(dependency, signal)
    ),
    materialize: request => backend.materialize(request),
  };
  Object.freeze(provider);
  uninstallBackends.set(provider, backend);
  return provider;
}

function matchesDependency(
  expected: RetainedAssetDependency,
  actual: RetainedAssetDependency,
): boolean {
  return expected.contentHash === actual.contentHash
    && expected.provenance.providerId === actual.provenance.providerId
    && expected.provenance.itemId === actual.provenance.itemId
    && expected.provenance.sourceLibraryId === actual.provenance.sourceLibraryId
    && expected.provenance.sourceVersion === actual.provenance.sourceVersion
    && expected.provenance.license === actual.provenance.license;
}

/** Resolve every retained dependency before removing a library from the catalog. */
export async function uninstallAssetLibrary(
  provider: AssetLibraryProvider,
  libraryId: string,
  signal: AbortSignal,
): Promise<readonly RetainedAssetDependencyHandle[]> {
  if (!signal
    || typeof signal.aborted !== 'boolean'
    || typeof signal.addEventListener !== 'function') {
    throw new TypeError('uninstallAssetLibrary requires an AbortSignal; dependency IDs are derived internally.');
  }
  const backend = uninstallBackends.get(provider);
  if (!backend) {
    throw new Error('Asset library provider must be created with createAssetLibraryProvider().');
  }

  const dependencies = await backend.getRetainedDependencies(libraryId, signal);
  const handles: RetainedAssetDependencyHandle[] = [];
  for (const dependency of dependencies) {
    if (dependency.provenance.sourceLibraryId !== libraryId) {
      throw new Error(`Retained dependency "${dependency.contentHash}" belongs to another library`);
    }
    const handle = await provider.resolveRetainedDependency(dependency, signal);
    if (!matchesDependency(dependency, handle.dependency)) {
      throw new Error(`Retained dependency resolver returned a mismatched handle for "${dependency.contentHash}"`);
    }
    handles.push(handle);
  }
  await backend.removeInstallation(libraryId, signal);
  return Object.freeze(handles);
}

/** Build the immutable provenance copied onto both the asset and placed shape records. */
export function getRetainedAssetProvenance(item: AssetLibraryItem): RetainedAssetProvenance {
  return Object.freeze({
    providerId: item.providerId,
    itemId: item.id,
    sourceLibraryId: item.sourceLibraryId,
    sourceVersion: item.sourceVersion,
    license: item.license,
  });
}

export type {
  AssetMaterialization,
  AssetMaterializationRequest,
  AssetMaterializer,
  AssetPlacementCallbacks,
  AssetPlacementSelection,
  RetainedAssetProvenance,
};
