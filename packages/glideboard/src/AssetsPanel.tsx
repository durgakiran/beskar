import React from 'react';
import type { AssetPlacementSelection } from '@durgakiran/glideline';
import {
  FiAlertCircle,
  FiBox,
  FiImage,
  FiRefreshCw,
  FiSearch,
  FiStar,
  FiX,
} from 'react-icons/fi';
import { useGlideboardController } from './GlideboardContext.js';
import {
  getRetainedAssetProvenance,
  type AssetLibraryGroup,
  type AssetLibraryItem,
  type AssetLibraryProvider,
} from './asset-library.js';
import { wbTheme } from './theme.js';

export const GLIDEBOARD_ASSET_DRAG_TYPE = 'application/x-glideboard-library-asset';
export const GLIDEBOARD_ASSET_DRAG_JSON_TYPE = 'application/json';
const GLIDEBOARD_ASSET_DRAG_TEXT_PREFIX = 'glideboard-library-asset:';
const SEARCH_DEBOUNCE_MS = 200;

interface AssetDragPayload {
  readonly version: 1;
  readonly providerId: string;
  readonly displayName: string;
  readonly selection: AssetPlacementSelection;
}

export function createAssetDragPayload(item: AssetLibraryItem): string {
  return JSON.stringify({
    version: 1,
    providerId: item.providerId,
    displayName: item.name,
    selection: {
      itemId: item.id,
      mediaType: item.mediaType,
      width: item.width,
      height: item.height,
      provenance: getRetainedAssetProvenance(item),
    },
  } satisfies AssetDragPayload);
}

export function readAssetDragPayload(value: string): AssetDragPayload | null {
  try {
    const payload = JSON.parse(value) as Partial<AssetDragPayload>;
    const selection = payload.selection;
    const provenance = selection?.provenance;
    if (payload.version !== 1 || typeof payload.providerId !== 'string'
      || typeof payload.displayName !== 'string' || !payload.displayName.trim()
      || typeof selection?.itemId !== 'string'
      || (selection.mediaType !== 'svg' && selection.mediaType !== 'raster')
      || typeof selection.width !== 'number' || !(selection.width > 0)
      || typeof selection.height !== 'number' || !(selection.height > 0)
      || typeof provenance?.providerId !== 'string'
      || typeof provenance.itemId !== 'string'
      || typeof provenance.sourceLibraryId !== 'string'
      || typeof provenance.sourceVersion !== 'string'
      || typeof provenance.license !== 'string'
      || payload.providerId !== provenance.providerId
      || selection.itemId !== provenance.itemId) return null;
    return payload as AssetDragPayload;
  } catch {
    return null;
  }
}

type AssetDragDataTransfer = Pick<DataTransfer, 'getData' | 'setData' | 'types'>;

export function writeAssetDragPayload(dataTransfer: Pick<AssetDragDataTransfer, 'setData'>, item: AssetLibraryItem): void {
  const payload = createAssetDragPayload(item);
  const values: readonly [string, string][] = [
    [GLIDEBOARD_ASSET_DRAG_TYPE, payload],
    [GLIDEBOARD_ASSET_DRAG_JSON_TYPE, payload],
    ['text/plain', `${GLIDEBOARD_ASSET_DRAG_TEXT_PREFIX}${payload}`],
  ];
  for (const [type, value] of values) {
    try {
      dataTransfer.setData(type, value);
    } catch {
      // Some native drag implementations reject custom MIME types; keep writing fallbacks.
    }
  }
}

export function hasAssetDragType(dataTransfer: Pick<AssetDragDataTransfer, 'types'>): boolean {
  const types = Array.from(dataTransfer.types, type => type.toLocaleLowerCase());
  return types.includes(GLIDEBOARD_ASSET_DRAG_TYPE)
    || types.includes(GLIDEBOARD_ASSET_DRAG_JSON_TYPE)
    || types.includes('text/plain');
}

export function readAssetDragData(dataTransfer: Pick<AssetDragDataTransfer, 'getData'>): AssetDragPayload | null {
  for (const type of [GLIDEBOARD_ASSET_DRAG_TYPE, GLIDEBOARD_ASSET_DRAG_JSON_TYPE]) {
    try {
      const payload = readAssetDragPayload(dataTransfer.getData(type));
      if (payload) return payload;
    } catch {
      // Continue to the browser-compatible text fallback.
    }
  }
  try {
    const text = dataTransfer.getData('text/plain');
    if (!text.startsWith(GLIDEBOARD_ASSET_DRAG_TEXT_PREFIX)) return null;
    return readAssetDragPayload(text.slice(GLIDEBOARD_ASSET_DRAG_TEXT_PREFIX.length));
  } catch {
    return null;
  }
}

interface AssetSection {
  id: string;
  name: string;
  items: readonly AssetLibraryItem[];
}

interface CatalogState {
  groups: readonly AssetLibraryGroup[];
  favorites: readonly AssetLibraryItem[];
  recents: readonly AssetLibraryItem[];
  results: readonly AssetLibraryItem[];
}

const EMPTY_CATALOG: CatalogState = {
  groups: [],
  favorites: [],
  recents: [],
  results: [],
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The asset library could not be loaded.';
}

function matchesQuery(item: AssetLibraryItem, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [item.name, item.sourceLibraryId, item.license, ...Object.values(item.metadata ?? {})]
    .some(value => value.toLocaleLowerCase().includes(needle));
}

function uniqueItems(items: readonly AssetLibraryItem[]): readonly AssetLibraryItem[] {
  return Array.from(new Map(items.map(item => [item.id, item])).values());
}

function buildSections(catalog: CatalogState, query: string): readonly AssetSection[] {
  const filteredRecents = uniqueItems(catalog.recents).filter(item => matchesQuery(item, query));
  const filteredFavorites = uniqueItems(catalog.favorites).filter(item => matchesQuery(item, query));
  const sections: AssetSection[] = [
    { id: 'recent', name: 'Recent', items: filteredRecents },
    { id: 'favorites', name: 'Favorites', items: filteredFavorites },
  ];

  const regularGroups = catalog.groups.filter(group => group.installed && group.kind !== 'recent' && group.kind !== 'favorites');
  const addKind = (kind: AssetLibraryGroup['kind'], fallbackName: string) => {
    const groups = regularGroups.filter(group => group.kind === kind);
    const groupIds = new Set(groups.map(group => group.id));
    const items = uniqueItems(catalog.results.filter(item => item.groupIds.some(id => groupIds.has(id))));
    sections.push({ id: kind, name: groups[0]?.name ?? fallbackName, items });
  };
  addKind('personal', 'My Shapes');
  addKind('team', 'Team Library');

  for (const group of regularGroups.filter(candidate => candidate.kind === 'vendor')) {
    sections.push({
      id: `vendor:${group.id}`,
      name: group.name,
      items: uniqueItems(catalog.results.filter(item => item.groupIds.includes(group.id))),
    });
  }
  return sections;
}

export function AssetsPanel({
  provider,
  readOnly,
  onRequestClose,
  onPlaced,
}: {
  provider: AssetLibraryProvider;
  readOnly: boolean;
  onRequestClose: () => void;
  onPlaced: (item: AssetLibraryItem) => void;
}) {
  const controller = useGlideboardController();
  const panelRef = React.useRef<HTMLElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState('');
  const [acceptedQuery, setAcceptedQuery] = React.useState('');
  const [catalog, setCatalog] = React.useState<CatalogState>(EMPTY_CATALOG);
  const [staticLoading, setStaticLoading] = React.useState(true);
  const [searching, setSearching] = React.useState(true);
  const [staticLoaded, setStaticLoaded] = React.useState(false);
  const [searchLoaded, setSearchLoaded] = React.useState(false);
  const [staticError, setStaticError] = React.useState<string | null>(null);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [placementError, setPlacementError] = React.useState<string | null>(null);
  const [favoriteOverrides, setFavoriteOverrides] = React.useState<ReadonlyMap<string, boolean>>(new Map());
  const [staticRetryKey, setStaticRetryKey] = React.useState(0);
  const [searchRetryKey, setSearchRetryKey] = React.useState(0);

  React.useEffect(() => {
    const operation = new AbortController();
    setStaticLoading(true);
    setStaticError(null);
    void Promise.all([
      provider.getGroups(operation.signal),
      provider.getFavorites(operation.signal),
      provider.getRecents(operation.signal),
      provider.getInstallations(operation.signal),
    ]).then(([groups, favorites, recents, installations]) => {
      if (operation.signal.aborted) return;
      const installationByLibrary = new Map(installations.map(installation => [installation.libraryId, installation]));
      const visibleGroups = groups.filter(group => {
        const installation = installationByLibrary.get(group.id);
        return group.installed && (!installation || installation.status === 'installed');
      });
      setCatalog(value => ({ ...value, groups: visibleGroups, favorites, recents }));
      setStaticLoaded(true);
      setStaticLoading(false);
    }).catch(reason => {
      if (operation.signal.aborted) return;
      setStaticError(errorMessage(reason));
      setStaticLoading(false);
    });
    return () => operation.abort();
  }, [provider, staticRetryKey]);

  React.useEffect(() => {
    const operation = new AbortController();
    setSearching(true);
    setSearchError(null);
    const timer = window.setTimeout(() => {
      void provider.search({ query, signal: operation.signal }).then(result => {
        if (operation.signal.aborted) return;
        setCatalog(value => ({ ...value, results: result.items }));
        setAcceptedQuery(query);
        setSearchLoaded(true);
        setSearching(false);
      }).catch(reason => {
        if (operation.signal.aborted) return;
        setSearchError(errorMessage(reason));
        setSearching(false);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      operation.abort();
    };
  }, [provider, query, searchRetryKey]);

  React.useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const sections = React.useMemo(() => buildSections(catalog, acceptedQuery), [acceptedQuery, catalog]);
  const itemCount = sections.reduce((count, section) => count + section.items.length, 0);
  const busy = staticLoading || searching;
  const initialLoading = !staticLoaded || !searchLoaded;
  const error = staticError ?? searchError;

  const focusItem = (current: HTMLElement | null, direction: -1 | 1 | 'first' | 'last') => {
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[data-asset-item]') ?? []);
    if (items.length === 0) return;
    const currentIndex = current ? items.indexOf(current) : -1;
    const index = direction === 'first' ? 0
      : direction === 'last' ? items.length - 1
      : (currentIndex + direction + items.length) % items.length;
    items[index]?.focus();
  };

  const recordRecent = (item: AssetLibraryItem) => {
    onPlaced(item);
  };

  const activate = (item: AssetLibraryItem): boolean => {
    if (readOnly || item.availability !== 'available') return false;
    setPlacementError(null);
    controller.configureAssetPlacement({
      displayName: item.name,
      selection: {
        itemId: item.id,
        mediaType: item.mediaType,
        width: item.width,
        height: item.height,
        provenance: getRetainedAssetProvenance(item),
      },
      materializer: request => provider.materialize(request),
      callbacks: {
        onPlaced: () => recordRecent(item),
      },
    });
    return true;
  };

  const toggleFavorite = (item: AssetLibraryItem) => {
    if (readOnly || item.availability !== 'available') return;
    const current = favoriteOverrides.get(item.id) ?? (
      item.isFavorite || catalog.favorites.some(favorite => favorite.id === item.id)
    );
    const next = !current;
    setFavoriteOverrides(overrides => new Map(overrides).set(item.id, next));
    setCatalog(value => ({
      ...value,
      favorites: next
        ? uniqueItems([item, ...value.favorites])
        : value.favorites.filter(favorite => favorite.id !== item.id),
    }));
    const operation = new AbortController();
    void provider.setFavorite(item.id, next, operation.signal).catch(reason => {
      setFavoriteOverrides(overrides => new Map(overrides).set(item.id, current));
      setCatalog(value => ({
        ...value,
        favorites: current
          ? uniqueItems([item, ...value.favorites])
          : value.favorites.filter(favorite => favorite.id !== item.id),
      }));
      setPlacementError(errorMessage(reason));
    });
  };

  return (
    <aside
      ref={panelRef}
      id={controller.domId('assets-panel')}
      data-glideboard-role="assets-panel"
      data-glideboard-ignore-shortcuts
      aria-label="Assets"
      aria-busy={busy}
      style={{
        position: 'absolute', left: 78, top: 'var(--glideboard-floating-panel-top, 12px)', bottom: 54, width: 336, maxWidth: 'calc(100% - 90px)', zIndex: 96,
        display: 'flex', flexDirection: 'column', overflow: 'hidden', background: wbTheme.surface,
        border: `1px solid ${wbTheme.border}`, borderRadius: 8, boxShadow: wbTheme.shadow,
        color: wbTheme.text, fontFamily: 'inherit',
      }}
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
      onKeyUp={event => event.stopPropagation()}
    >
      <div style={{ minHeight: 42, padding: '0 10px 0 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${wbTheme.border}` }}>
        <strong style={{ flex: 1, minWidth: 0, fontSize: 12 }}>Assets</strong>
        {readOnly ? <span style={{ fontSize: 10, color: wbTheme.textSoft }}>View only</span> : null}
        <IconButton label="Close assets" onClick={onRequestClose}><FiX size={15} /></IconButton>
      </div>
      <label style={{ margin: 10, height: 34, display: 'flex', alignItems: 'center', gap: 7, padding: '0 9px', border: `1px solid ${wbTheme.borderStrong}`, borderRadius: 6, background: wbTheme.surfaceInset }}>
        <FiSearch aria-hidden size={14} color={wbTheme.textSoft} />
        <input
          ref={searchRef}
          type="search"
          data-glideboard-ignore-shortcuts
          aria-label="Search assets"
          placeholder="Search assets"
          value={query}
          onChange={event => setQuery(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              focusItem(null, 'first');
            } else if (event.key === 'Escape') {
              event.preventDefault();
              if (query) setQuery(''); else onRequestClose();
            }
          }}
          style={{ minWidth: 0, flex: 1, border: 0, outline: 0, background: 'transparent', color: wbTheme.text, font: 'inherit', fontSize: 12 }}
        />
      </label>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 12px' }}>
        <div role="status" aria-live="polite" style={visuallyHiddenStyle}>
          {searching && searchLoaded ? 'Searching assets...' : busy ? 'Asset catalog is busy.' : ''}
        </div>
        {initialLoading && busy ? <PanelMessage>Loading asset libraries...</PanelMessage> : null}
        {error ? (
          <PanelMessage>
            <FiAlertCircle aria-hidden size={18} color={wbTheme.dangerText} />
            <span>{error}</span>
            <button
              type="button"
              onClick={() => {
                if (staticError) setStaticRetryKey(key => key + 1);
                if (searchError) setSearchRetryKey(key => key + 1);
              }}
              style={retryButtonStyle}
            >
              <FiRefreshCw aria-hidden size={13} /> Retry
            </button>
          </PanelMessage>
        ) : null}
        {!initialLoading && !error && itemCount === 0 && acceptedQuery ? <PanelMessage>No assets match “{acceptedQuery}”.</PanelMessage> : null}
        {!initialLoading && !error ? sections.map(section => (
          <section key={section.id} aria-labelledby={controller.domId(`assets-section-${section.id}`)} style={{ marginTop: 8 }}>
            <h2 id={controller.domId(`assets-section-${section.id}`)} style={{ margin: '0 2px 7px', fontSize: 10, lineHeight: '18px', color: wbTheme.textMuted, textTransform: 'uppercase', letterSpacing: 0, fontWeight: 700 }}>
              {section.name} <span style={{ color: wbTheme.textSoft }}>({section.items.length})</span>
            </h2>
            {section.items.length > 0 ? (
              <div role="list" aria-label={section.name} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
                {section.items.map(item => {
                  const favorite = favoriteOverrides.get(item.id) ?? (
                    item.isFavorite || catalog.favorites.some(candidate => candidate.id === item.id)
                  );
                  const available = item.availability === 'available';
                  const metadata = Object.values(item.metadata ?? {}).filter(Boolean).join(' · ');
                  return (
                    <div key={item.id} role="listitem" data-asset-availability={item.availability} style={{ position: 'relative', minWidth: 0 }}>
                      <button
                        type="button"
                        data-asset-item={item.id}
                        aria-disabled={!available || readOnly}
                        draggable={available && !readOnly}
                        aria-label={`${item.name}, ${item.sourceLibraryId}, ${item.license}${available ? '' : `, ${item.availability}`}`}
                        onClick={() => { if (activate(item)) onRequestClose(); }}
                        onDragStart={event => {
                          if (readOnly || !available) {
                            event.preventDefault();
                            return;
                          }
                          event.dataTransfer.effectAllowed = 'copy';
                          writeAssetDragPayload(event.dataTransfer, item);
                        }}
                        onKeyDown={event => {
                          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                            event.preventDefault(); focusItem(event.currentTarget, 1);
                          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                            event.preventDefault(); focusItem(event.currentTarget, -1);
                          } else if (event.key === 'Home') {
                            event.preventDefault(); focusItem(event.currentTarget, 'first');
                          } else if (event.key === 'End') {
                            event.preventDefault(); focusItem(event.currentTarget, 'last');
                          }
                        }}
                        style={{
                          width: '100%', minHeight: 138, padding: 7, display: 'flex', flexDirection: 'column', gap: 5,
                          overflow: 'hidden', textAlign: 'left', border: `1px solid ${wbTheme.border}`, borderRadius: 6,
                          background: wbTheme.surface, color: wbTheme.text, cursor: available && !readOnly ? 'grab' : 'not-allowed',
                          opacity: available ? 1 : 0.62,
                        }}
                      >
                        <span style={{ width: '100%', height: 72, flex: '0 0 72px', display: 'grid', placeItems: 'center', overflow: 'hidden', borderRadius: 4, background: wbTheme.surfaceInset }}>
                          {item.thumbnailUrl ? (
                            <img src={item.thumbnailUrl} alt="" draggable={false} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
                          ) : item.mediaType === 'raster' ? <FiImage aria-hidden size={24} color={wbTheme.textSoft} /> : <FiBox aria-hidden size={24} color={wbTheme.textSoft} />}
                        </span>
                        <strong title={item.name} style={{ width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, lineHeight: '15px' }}>{item.name}</strong>
                        <span title={`${item.sourceLibraryId} · ${item.license}`} style={{ width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 22, color: wbTheme.textSoft, fontSize: 9, lineHeight: '13px' }}>
                          {item.sourceLibraryId} · {item.license}
                        </span>
                        {metadata ? <span title={metadata} style={{ width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 22, color: wbTheme.textMuted, fontSize: 9, lineHeight: '13px' }}>{metadata}</span> : null}
                        {!available ? <span style={{ color: wbTheme.dangerText, fontSize: 9, lineHeight: '12px', textTransform: 'capitalize' }}>{item.availability}</span> : null}
                      </button>
                      <button
                        type="button"
                        aria-label={`${favorite ? 'Remove' : 'Add'} ${item.name} ${favorite ? 'from' : 'to'} favorites`}
                        aria-pressed={favorite}
                        disabled={readOnly || !available}
                        title={!available ? 'Unavailable assets cannot be favorited' : favorite ? 'Remove from favorites' : 'Add to favorites'}
                        onClick={() => toggleFavorite(item)}
                        style={{ position: 'absolute', right: 7, bottom: 7, width: 24, height: 24, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 4, background: wbTheme.surface, color: favorite ? '#b45309' : wbTheme.textSoft, cursor: readOnly || !available ? 'not-allowed' : 'pointer' }}
                      ><FiStar aria-hidden size={13} fill={favorite ? 'currentColor' : 'none'} /></button>
                    </div>
                  );
                })}
              </div>
            ) : !acceptedQuery ? <div style={{ minHeight: 28, padding: '4px 2px 8px', color: wbTheme.textSoft, fontSize: 10 }}>No assets</div> : null}
          </section>
        )) : null}
      </div>
      {placementError ? (
        <div role="alert" style={{ padding: '8px 10px', borderTop: `1px solid ${wbTheme.border}`, color: wbTheme.dangerText, fontSize: 10, lineHeight: 1.4 }}>
          {placementError}
        </div>
      ) : null}
    </aside>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} style={{ width: 28, height: 28, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 4, background: 'transparent', color: wbTheme.textSoft, cursor: 'pointer' }}>{children}</button>;
}

function PanelMessage({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: 120, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', color: wbTheme.textMuted, fontSize: 11, lineHeight: 1.45 }}>{children}</div>;
}

const retryButtonStyle: React.CSSProperties = {
  height: 30, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 6,
  border: `1px solid ${wbTheme.borderStrong}`, borderRadius: 5, background: wbTheme.surface,
  color: wbTheme.text, cursor: 'pointer', fontSize: 11, fontWeight: 600,
};

const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0,
};
