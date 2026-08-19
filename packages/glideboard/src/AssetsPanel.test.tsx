import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssetsPanel,
  GLIDEBOARD_ASSET_DRAG_JSON_TYPE,
  GLIDEBOARD_ASSET_DRAG_TYPE,
  hasAssetDragType,
  readAssetDragData,
  readAssetDragPayload,
} from './AssetsPanel';
import { GlideboardProvider } from './GlideboardContext';
import { GlideboardController } from './GlideboardController';
import type { AssetLibraryGroup, AssetLibraryItem, AssetLibraryProvider } from './asset-library';

const groups: AssetLibraryGroup[] = [
  { id: 'mine', providerId: 'demo', name: 'My Shapes', kind: 'personal', installed: true },
  { id: 'team', providerId: 'demo', name: 'Team Library', kind: 'team', installed: true },
  { id: 'aws', providerId: 'demo', name: 'AWS', kind: 'vendor', installed: true },
  { id: 'azure', providerId: 'demo', name: 'Azure', kind: 'vendor', installed: false },
];

function item(id: string, name: string, groupId: string, overrides: Partial<AssetLibraryItem> = {}): AssetLibraryItem {
  return {
    id, providerId: 'demo', sourceLibraryId: groupId, sourceVersion: '2026.1', name,
    mediaType: 'svg', width: 120, height: 80, license: 'MIT', groupIds: [groupId],
    availability: 'available', isFavorite: false, ...overrides,
  };
}

const personal = item('personal:flow', 'Flow chart', 'mine');
const team = item('team:logo', 'Team logo', 'team', { thumbnailUrl: 'data:image/svg+xml,<svg/>' });
const aws = item('aws:lambda', 'Lambda', 'aws', {
  license: 'AWS Asset Package License',
  metadata: { category: 'Compute', vendor: 'Amazon Web Services' },
});
const missing = item('aws:missing', 'Retired service', 'aws', { availability: 'missing' });

function provider(overrides: Partial<AssetLibraryProvider> = {}): AssetLibraryProvider {
  return {
    id: 'demo',
    getGroups: vi.fn(async () => groups),
    getFavorites: vi.fn(async () => [team]),
    getRecents: vi.fn(async () => [personal]),
    getInstallations: vi.fn(async () => groups.filter(group => group.installed).map(group => ({
      libraryId: group.id, providerId: 'demo', sourceVersion: '2026.1', status: 'installed' as const,
    }))),
    search: vi.fn(async ({ query }) => ({ items: [personal, team, aws, missing].filter(candidate => candidate.name.toLowerCase().includes(query.toLowerCase())) })),
    setFavorite: vi.fn(async () => undefined),
    recordRecent: vi.fn(async () => undefined),
    install: vi.fn(async libraryId => ({ libraryId, providerId: 'demo', sourceVersion: '1', status: 'installed' })),
    resolveRetainedDependency: vi.fn(async () => { throw new Error('not used'); }),
    materialize: vi.fn(async () => { throw new Error('not used'); }),
    ...overrides,
  };
}

describe('AssetsPanel', () => {
  let controller: GlideboardController;

  beforeEach(() => {
    controller = new GlideboardController({ sessionKey: 'assets-panel-test' });
  });

  afterEach(async () => {
    cleanup();
    await controller.dispose();
  });

  function setup(assetProvider = provider(), readOnly = false) {
    const close = vi.fn();
    const onPlaced = vi.fn((placedItem: AssetLibraryItem) => {
      const operation = new AbortController();
      void assetProvider.recordRecent(placedItem.id, operation.signal).catch(() => undefined);
    });
    const view = render(
      <GlideboardProvider controller={controller}>
        <AssetsPanel
          provider={assetProvider}
          readOnly={readOnly}
          onRequestClose={close}
          onPlaced={onPlaced}
        />
      </GlideboardProvider>,
    );
    return { assetProvider, close, onPlaced, ...view };
  }

  it('loads required sections, installed vendors, useful context, and availability states', async () => {
    setup();
    expect(screen.getByText('Loading asset libraries...')).toBeTruthy();
    await screen.findByRole('heading', { name: /AWS/ });
    expect(screen.getByRole('heading', { name: /Recent/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Favorites/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /My Shapes/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Team Library/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Azure/ })).toBeNull();
    expect(screen.getAllByText(/AWS Asset Package License/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Compute · Amazon Web Services').length).toBeGreaterThan(0);
    const unavailable = screen.getByRole('button', { name: /^Retired service,.*missing$/ });
    expect(unavailable.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('missing')).toBeTruthy();
  });

  it('searches through the provider and supports keyboard navigation and escape', async () => {
    const { assetProvider, close } = setup();
    await screen.findAllByRole('button', { name: /^Flow chart,/ });
    const search = screen.getByRole('searchbox', { name: 'Search assets' });
    expect(search.hasAttribute('data-glideboard-ignore-shortcuts')).toBe(true);
    fireEvent.change(search, { target: { value: 'Lambda' } });
    await waitFor(() => expect(assetProvider.search).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'Lambda' })));
    const lambda = await screen.findByRole('button', { name: /^Lambda,/ });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(lambda);
    fireEvent.keyDown(lambda, { key: 'Home' });
    expect(document.activeElement).toBe(lambda);
    fireEvent.keyDown(search, { key: 'Escape' });
    expect((search as HTMLInputElement).value).toBe('');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('debounces and cancels search without refetching static catalog data or hiding prior results', async () => {
    let resolveSearch: ((value: { items: AssetLibraryItem[] }) => void) | undefined;
    const search = vi.fn(async ({ query }: { query: string }) => {
      if (query === 'Lambda') {
        return new Promise<{ items: AssetLibraryItem[] }>(resolve => { resolveSearch = resolve; });
      }
      return { items: [personal, team, aws, missing] };
    });
    const assetProvider = provider({ search });
    setup(assetProvider);
    await screen.findByRole('button', { name: /^Lambda,/ });

    const searchbox = screen.getByRole('searchbox', { name: 'Search assets' });
    fireEvent.change(searchbox, { target: { value: 'Lam' } });
    fireEvent.change(searchbox, { target: { value: 'Lambda' } });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));

    expect(assetProvider.getGroups).toHaveBeenCalledOnce();
    expect(assetProvider.getFavorites).toHaveBeenCalledOnce();
    expect(assetProvider.getRecents).toHaveBeenCalledOnce();
    expect(assetProvider.getInstallations).toHaveBeenCalledOnce();
    expect(screen.getByRole('complementary', { name: 'Assets' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Searching assets...');
    expect(screen.queryByText('Loading asset libraries...')).toBeNull();
    expect(screen.getByRole('button', { name: /^Lambda,/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Recent (1)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Favorites (1)' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Flow chart,/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Team logo,/ }).length).toBeGreaterThan(0);

    resolveSearch?.({ items: [aws] });
    await waitFor(() => expect(screen.getByRole('complementary', { name: 'Assets' }).getAttribute('aria-busy')).toBe('false'));
    expect(screen.getByRole('button', { name: /^Lambda,/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Recent (0)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Favorites (0)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Flow chart,/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Team logo,/ })).toBeNull();
  });

  it('keeps initially empty sections on the accepted snapshot while a debounced search is pending', async () => {
    let resolveSearch: ((value: { items: AssetLibraryItem[] }) => void) | undefined;
    const search = vi.fn(async ({ query }: { query: string }) => {
      if (query === 'Lambda') {
        return new Promise<{ items: AssetLibraryItem[] }>(resolve => { resolveSearch = resolve; });
      }
      return { items: [personal, team, aws, missing] };
    });
    setup(provider({
      getFavorites: vi.fn(async () => []),
      getRecents: vi.fn(async () => []),
      search,
    }));
    await screen.findByRole('button', { name: /^Flow chart,/ });
    expect(screen.getAllByText('No assets')).toHaveLength(2);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search assets' }), { target: { value: 'Lambda' } });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));

    expect(screen.getAllByText('No assets')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^Flow chart,/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Recent (0)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Favorites (0)' })).toBeTruthy();

    resolveSearch?.({ items: [aws] });
    await waitFor(() => expect(screen.getByRole('complementary', { name: 'Assets' }).getAttribute('aria-busy')).toBe('false'));
    expect(screen.queryByText('No assets')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Flow chart,/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Lambda,/ })).toBeTruthy();
  });

  it('keeps the global empty state on the accepted query immediately after new input', async () => {
    const search = vi.fn(async ({ query }: { query: string }) => ({
      items: query ? [] : [personal, team, aws, missing],
    }));
    setup(provider({
      getFavorites: vi.fn(async () => []),
      getRecents: vi.fn(async () => []),
      search,
    }));
    await screen.findByRole('button', { name: /^Lambda,/ });

    const searchbox = screen.getByRole('searchbox', { name: 'Search assets' });
    fireEvent.change(searchbox, { target: { value: 'accepted-empty' } });
    expect(await screen.findByText('No assets match “accepted-empty”.')).toBeTruthy();

    fireEvent.change(searchbox, { target: { value: 'raw-pending' } });
    expect(screen.getByText('No assets match “accepted-empty”.')).toBeTruthy();
    expect(screen.queryByText('No assets match “raw-pending”.')).toBeNull();
  });

  it('configures one generic placement tool for click and drag and persists recents', async () => {
    const assetProvider = provider();
    const configure = vi.spyOn(controller, 'configureAssetPlacement');
    const { close } = setup(assetProvider);
    const lambda = await screen.findByRole('button', { name: /^Lambda,/ });
    fireEvent.click(lambda);
    expect(configure).toHaveBeenCalledWith(expect.objectContaining({
      selection: expect.objectContaining({ itemId: aws.id, mediaType: 'svg', width: 120, height: 80 }),
      materializer: expect.any(Function),
    }));
    expect(controller.editor.currentToolId.peek()).toBe('asset');
    expect(close).toHaveBeenCalledOnce();
    act(() => configure.mock.calls[0]![0].callbacks?.onPlaced?.('shape:test' as any));
    await waitFor(() => expect(assetProvider.recordRecent).toHaveBeenCalledWith(aws.id, expect.any(AbortSignal)));

    const transfer = { effectAllowed: '', setData: vi.fn() };
    fireEvent.dragStart(lambda, { dataTransfer: transfer });
    const encoded = transfer.setData.mock.calls.find(([type]) => type === GLIDEBOARD_ASSET_DRAG_TYPE)?.[1];
    expect(readAssetDragPayload(encoded)).toEqual(expect.objectContaining({
      providerId: 'demo',
      selection: expect.objectContaining({ itemId: aws.id, width: 120, height: 80 }),
    }));
    expect(configure).toHaveBeenCalledTimes(1);
    expect(transfer.setData).toHaveBeenCalledWith(GLIDEBOARD_ASSET_DRAG_JSON_TYPE, encoded);
    expect(readAssetDragData({
      getData: type => type === GLIDEBOARD_ASSET_DRAG_JSON_TYPE ? encoded : '',
    })).toMatchObject({ selection: { itemId: aws.id, width: 120, height: 80 } });
  });

  it('keeps writing generic drag fallbacks when a browser rejects the custom MIME type', async () => {
    setup();
    const lambda = await screen.findByRole('button', { name: /^Lambda,/ });
    const written = new Map<string, string>();
    fireEvent.dragStart(lambda, {
      dataTransfer: {
        effectAllowed: '',
        setData: (type: string, value: string) => {
          if (type === GLIDEBOARD_ASSET_DRAG_TYPE) throw new DOMException('unsupported');
          written.set(type, value);
        },
      },
    });
    expect(readAssetDragData({ getData: type => written.get(type) ?? '' }))
      .toMatchObject({ providerId: 'demo', selection: { itemId: aws.id, width: 120, height: 80 } });
  });

  it('persists optimistic favorite changes and rolls them back on provider failure', async () => {
    const setFavorite = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Favorite storage is offline'));
    setup(provider({ setFavorite }));
    const add = await screen.findByRole('button', { name: 'Add Lambda to favorites' });
    fireEvent.click(add);
    await waitFor(() => expect(setFavorite).toHaveBeenCalledWith(aws.id, true, expect.any(AbortSignal)));
    const remove = screen.getAllByRole('button', { name: 'Remove Lambda from favorites' })[0]!;
    fireEvent.click(remove);
    await screen.findByRole('alert');
    expect(screen.getAllByRole('button', { name: 'Remove Lambda from favorites' }).length).toBeGreaterThan(0);
  });

  it('shows errors, retries loading, and makes read-only mode browse-only', async () => {
    const getGroups = vi.fn()
      .mockRejectedValueOnce(new Error('Catalog offline'))
      .mockResolvedValue(groups);
    const assetProvider = provider({ getGroups });
    const first = setup(assetProvider);
    expect(await screen.findByText('Catalog offline')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: /^Lambda,/ });
    expect(getGroups).toHaveBeenCalledTimes(2);
    first.unmount();

    setup(provider(), true);
    const readonlyItem = await screen.findByRole('button', { name: /^Lambda,/ });
    expect(readonlyItem.getAttribute('aria-disabled')).toBe('true');
    expect((screen.getByRole('button', { name: 'Add Lambda to favorites' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('View only')).toBeTruthy();
  });

  it('rejects malformed native drag payloads at every trust boundary', () => {
    expect(hasAssetDragType({ types: [GLIDEBOARD_ASSET_DRAG_TYPE.toUpperCase()] })).toBe(true);
    expect(hasAssetDragType({ types: [GLIDEBOARD_ASSET_DRAG_JSON_TYPE] })).toBe(true);
    expect(hasAssetDragType({ types: ['text/plain'] })).toBe(true);
    expect(hasAssetDragType({ types: ['Files'] })).toBe(false);
    expect(readAssetDragPayload('{')).toBeNull();
    for (const payload of [
      {},
      { version: 2, providerId: 'demo', selection: {} },
      { version: 1, providerId: 'demo', selection: { itemId: 'x', mediaType: 'gif', width: 1, height: 1, provenance: {} } },
      { version: 1, providerId: 'demo', selection: { itemId: 'x', mediaType: 'svg', width: 0, height: 1, provenance: {} } },
      { version: 1, providerId: 'demo', selection: { itemId: 'x', mediaType: 'svg', width: 1, height: 1,
        provenance: { providerId: 'other', itemId: 'x', sourceLibraryId: 'l', sourceVersion: '1', license: 'MIT' } } },
    ]) expect(readAssetDragPayload(JSON.stringify(payload))).toBeNull();
    expect(readAssetDragData({ getData: () => { throw new Error('native drag blocked'); } })).toBeNull();
    expect(readAssetDragData({ getData: type => type === 'text/plain' ? 'ordinary text' : '' })).toBeNull();
  });

  it('contains panel pointer and keyboard events and closes explicitly', async () => {
    const pointer = vi.fn();
    const keyDown = vi.fn();
    const keyUp = vi.fn();
    const assetProvider = provider();
    const close = vi.fn();
    render(
      <div onPointerDown={pointer} onKeyDown={keyDown} onKeyUp={keyUp}>
        <GlideboardProvider controller={controller}>
          <AssetsPanel provider={assetProvider} onRequestClose={close} />
        </GlideboardProvider>
      </div>,
    );
    const panel = screen.getByLabelText('Assets');
    fireEvent.pointerDown(panel);
    fireEvent.keyDown(panel, { key: 'a' });
    fireEvent.keyUp(panel, { key: 'a' });
    expect(pointer).not.toHaveBeenCalled();
    expect(keyDown).not.toHaveBeenCalled();
    expect(keyUp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close assets' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('wraps item focus, blocks unavailable drags, and keeps placement failures at app scope', async () => {
    const recordRecent = vi.fn().mockRejectedValue(new Error('Recent storage failed'));
    const configure = vi.spyOn(controller, 'configureAssetPlacement');
    const view = setup(provider({ recordRecent }));
    const first = (await screen.findAllByRole('button', { name: /^Flow chart,/ }))[0]!;
    const allItems = screen.getAllByRole('button').filter(button => button.hasAttribute('data-asset-item'));
    const last = allItems[allItems.length - 1]!;

    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'End' });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(first);

    const unavailable = screen.getByRole('button', { name: /^Retired service,.*missing$/ });
    const unavailableFavorite = screen.getByRole('button', { name: 'Add Retired service to favorites' });
    expect((unavailableFavorite as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(unavailableFavorite);
    expect(view.assetProvider.setFavorite).not.toHaveBeenCalledWith(missing.id, expect.anything(), expect.anything());
    const setData = vi.fn();
    fireEvent.dragStart(unavailable, { dataTransfer: { effectAllowed: '', setData } });
    expect(setData).not.toHaveBeenCalled();
    expect(view.close).not.toHaveBeenCalled();

    const lambda = screen.getByRole('button', { name: /^Lambda,/ });
    fireEvent.click(lambda);
    const placement = configure.mock.calls[0]![0];
    expect(controller.editor.currentToolId.peek()).toBe('asset');
    act(() => placement.callbacks?.onPlaced?.('shape:placed' as any));
    expect(view.onPlaced).toHaveBeenCalledWith(aws);
    expect(placement.callbacks?.onError).toBeUndefined();
    expect(controller.assetPlacementSignal.peek()).toMatchObject({ displayName: 'Lambda', status: 'armed' });
  });

  it('shows fallback errors and a query-specific empty result', async () => {
    const first = setup(provider({ getGroups: vi.fn().mockRejectedValue('offline') }));
    expect(await screen.findByText('The asset library could not be loaded.')).toBeTruthy();
    first.unmount();

    setup(provider({
      getFavorites: vi.fn(async () => []),
      getRecents: vi.fn(async () => []),
      search: vi.fn(async () => ({ items: [] })),
    }));
    const search = await screen.findByRole('searchbox', { name: 'Search assets' });
    fireEvent.change(search, { target: { value: 'does-not-exist' } });
    expect(await screen.findByText(/No assets match/)).toBeTruthy();
  });
});
