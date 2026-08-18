import React, { act } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aid, type GlideAsset } from '@durgakiran/glideline';
import {
  createAssetDragPayload,
  GLIDEBOARD_ASSET_DRAG_JSON_TYPE,
  GLIDEBOARD_ASSET_DRAG_TYPE,
} from './AssetsPanel';
import { GlideboardProvider, useGlideboardController } from './GlideboardContext';
import { GlideboardController } from './GlideboardController';
import { WhiteboardApp } from './WhiteboardApp';
import type { AssetLibraryItem, AssetLibraryProvider } from './asset-library';

vi.mock('./Canvas', () => ({
  Canvas() {
    const controller = useGlideboardController();
    return <div ref={element => {
      if (element) element.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) });
      controller.setCanvasElement(element);
    }} data-glideboard-role="canvas" tabIndex={0} />;
  },
}));
vi.mock('./ContextMenu', () => ({ ContextMenu: () => null }));
vi.mock('./StylePanel', () => ({ StylePanel: () => null, PositionSizeBar: () => null }));
vi.mock('./ZoomWidget', () => ({ ZoomWidget: () => null, fitToScreen: () => undefined }));
vi.mock('./BackToContentButton', () => ({ BackToContentButton: () => null }));
vi.mock('./CollaborationCursors', () => ({ CollaborationCursors: () => null }));

const HASH = 'd'.repeat(64);
const lambda: AssetLibraryItem = {
  id: 'aws:lambda', providerId: 'demo', sourceLibraryId: 'aws', sourceVersion: '2026.1', name: 'Lambda',
  mediaType: 'svg', width: 120, height: 80, license: 'AWS license', groupIds: ['aws'], availability: 'available', isFavorite: false,
};

function provider(): AssetLibraryProvider {
  const asset: GlideAsset = {
    id: aid(`asset:sha256:${HASH}`), kind: 'asset', type: 'sanitized-svg', schemaVersion: 1,
    props: { hash: HASH, mimeType: 'image/svg+xml', sanitizerVersion: 1, byteLength: 12, width: 120, height: 80, viewBox: [0, 0, 120, 80], paths: [{ d: 'M0 0L120 80' }] }, meta: {},
  };
  return {
    id: 'demo',
    getGroups: async () => [{ id: 'aws', providerId: 'demo', name: 'AWS', kind: 'vendor', installed: true }],
    getFavorites: async () => [], getRecents: async () => [],
    getInstallations: async () => [{ libraryId: 'aws', providerId: 'demo', sourceVersion: '2026.1', status: 'installed' }],
    search: async () => ({ items: [lambda] }), setFavorite: vi.fn(), recordRecent: vi.fn(),
    install: async libraryId => ({ libraryId, providerId: 'demo', sourceVersion: '1', status: 'installed' }),
    resolveRetainedDependency: async () => { throw new Error('not used'); },
    materialize: vi.fn(async () => ({ asset, contentHash: HASH, rollback: vi.fn() })),
  };
}

describe('WhiteboardApp assets coordination', () => {
  let controller: GlideboardController;
  beforeEach(() => {
    controller = new GlideboardController({ sessionKey: 'assets-app-test' });
    controller.editor.camera.setViewportSize(800, 600);
  });
  afterEach(async () => { cleanup(); await controller.dispose(); });

  function setup(readOnly = false, assetProvider = provider()) {
    controller.setReadOnly(readOnly);
    return render(<GlideboardProvider controller={controller}><WhiteboardApp assetLibraryProvider={assetProvider} /></GlideboardProvider>);
  }

  it('toggles Assets and Layers without overlap', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    expect(await screen.findByRole('complementary', { name: 'Assets' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
    expect(screen.queryByRole('complementary', { name: 'Assets' })).toBeNull();
    expect(screen.getByText('Layers')).toBeTruthy();
  });

  it('places a dragged catalog item through the generic asset tool', async () => {
    const assetProvider = provider();
    vi.spyOn(controller.editor, 'screenToPage').mockReturnValue({ x: 300, y: 200 });
    const { container } = setup(false, assetProvider);
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    const itemButton = await screen.findByRole('button', { name: /^Lambda,/ });
    const payload = createAssetDragPayload(lambda);
    const setData = vi.fn();
    fireEvent.dragStart(itemButton, { dataTransfer: { effectAllowed: '', setData } });
    expect(setData).toHaveBeenCalledWith(GLIDEBOARD_ASSET_DRAG_TYPE, payload);
    expect(controller.editor.currentToolId.peek()).toBe('select');
    const root = container.firstElementChild as HTMLElement;
    fireEvent.drop(root, {
      clientX: 300, clientY: 200,
      dataTransfer: {
        types: [GLIDEBOARD_ASSET_DRAG_JSON_TYPE], files: [],
        getData: (type: string) => type === GLIDEBOARD_ASSET_DRAG_JSON_TYPE ? payload : '',
      },
    });
    expect(screen.queryByRole('complementary', { name: 'Assets' })).toBeNull();
    await waitFor(() => expect(assetProvider.materialize).toHaveBeenCalledOnce());
    await waitFor(() => expect(controller.editor.getShapeIdsSignal().peek()).toHaveLength(1));
    const shapeId = controller.editor.getShapeIdsSignal().peek()[0]!;
    expect(controller.editor.getShape(shapeId)).toMatchObject({
      type: 'sanitized-svg', x: 240, y: 160, props: { w: 120, h: 80 },
    });
    expect(assetProvider.recordRecent).toHaveBeenCalledWith(lambda.id, expect.any(AbortSignal));
    expect(screen.queryByRole('complementary', { name: 'Assets' })).toBeNull();
  });

  it('restores canvas focus after card unmount so immediate Escape cancels placement', async () => {
    const { container } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    await screen.findByRole('complementary', { name: 'Assets' });
    fireEvent.click(await screen.findByRole('button', { name: /^Lambda,/ }));

    expect(screen.queryByRole('complementary', { name: 'Assets' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Placing Lambda');
    expect(screen.getByRole('status').textContent).toContain('Click or drag on the canvas to place');
    const canvas = container.querySelector('[data-glideboard-role="canvas"]') as HTMLElement;
    expect(document.activeElement).toBe(canvas);
    fireEvent.keyDown(document.activeElement! as HTMLElement, { key: 'Escape' });
    expect(screen.queryByRole('status')).toBeNull();
    expect(controller.editor.currentToolId.peek()).toBe('select');

    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    await screen.findByRole('complementary', { name: 'Assets' });
    fireEvent.click(await screen.findByRole('button', { name: /^Lambda,/ }));
    act(() => controller.editor.setCurrentTool('box'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps a delayed recordRecent rejection visible after the catalog closes', async () => {
    const assetProvider = provider();
    assetProvider.recordRecent = vi.fn().mockRejectedValue(new Error('Recent storage failed after close'));
    setup(false, assetProvider);
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Lambda,/ }));
    expect(screen.queryByRole('complementary', { name: 'Assets' })).toBeNull();

    act(() => {
      controller.editor.dispatchEvent({ type: 'pointerDown', point: { x: 100, y: 100 }, shiftKey: false, target: 'canvas' });
      controller.editor.dispatchEvent({ type: 'pointerUp', point: { x: 100, y: 100 } });
    });
    await waitFor(() => expect(assetProvider.recordRecent).toHaveBeenCalledOnce());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Recent storage failed after close');
    expect(alert.textContent).toContain('The asset was placed. Dismiss this message and reopen Assets to continue.');
  });

  it('serializes recent writes in placement order', async () => {
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>(resolve => { releaseFirst = resolve; });
    const assetProvider = provider();
    assetProvider.recordRecent = vi.fn()
      .mockImplementationOnce(() => firstWrite)
      .mockResolvedValue(undefined);
    setup(false, assetProvider);

    const place = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
      await screen.findByRole('complementary', { name: 'Assets' });
      fireEvent.click(await screen.findByRole('button', { name: /^Lambda,/ }));
      act(() => {
        controller.editor.dispatchEvent({ type: 'pointerDown', point: { x: 100, y: 100 }, shiftKey: false, target: 'canvas' });
        controller.editor.dispatchEvent({ type: 'pointerUp', point: { x: 100, y: 100 } });
      });
    };

    await place();
    await waitFor(() => expect(assetProvider.recordRecent).toHaveBeenCalledTimes(1));
    await place();
    expect(assetProvider.recordRecent).toHaveBeenCalledTimes(1);
    releaseFirst();
    await waitFor(() => expect(assetProvider.recordRecent).toHaveBeenCalledTimes(2));
  });

  it('shows persistent pending progress and lets a keyboard user cancel materialization', async () => {
    let signal: AbortSignal | undefined;
    const assetProvider = provider();
    assetProvider.materialize = vi.fn(request => {
      signal = request.signal;
      return new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => {
        reject(new DOMException('Cancelled', 'AbortError'));
      }));
    });
    setup(false, assetProvider);
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Lambda,/ }));
    act(() => {
      controller.editor.dispatchEvent({ type: 'pointerDown', point: { x: 100, y: 100 }, shiftKey: false, target: 'canvas' });
      controller.editor.dispatchEvent({ type: 'pointerUp', point: { x: 100, y: 100 } });
    });

    expect(await screen.findByText('Preparing asset...')).toBeTruthy();
    const cancel = screen.getByRole('button', { name: 'Cancel asset placement' });
    cancel.focus();
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(cancel);
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByText('Preparing asset...')).toBeNull();
  });

  it('keeps native-drop errors visible after panel unmount and offers a working retry', async () => {
    const assetProvider = provider();
    const successfulMaterialize = assetProvider.materialize;
    assetProvider.materialize = vi.fn()
      .mockRejectedValueOnce(new Error('Library download is offline'))
      .mockImplementation(successfulMaterialize as any);
    vi.spyOn(controller.editor, 'screenToPage').mockReturnValue({ x: 300, y: 200 });
    const { container } = setup(false, assetProvider);
    const payload = createAssetDragPayload(lambda);
    fireEvent.drop(container.firstElementChild as HTMLElement, {
      clientX: 300, clientY: 200,
      dataTransfer: {
        types: [GLIDEBOARD_ASSET_DRAG_TYPE], files: [],
        getData: (type: string) => type === GLIDEBOARD_ASSET_DRAG_TYPE ? payload : '',
      },
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Library download is offline');
    expect(alert.textContent).toContain('Try placement again or dismiss this message.');
    fireEvent.click(screen.getByRole('button', { name: 'Try placement again' }));
    expect(screen.getByRole('status').textContent).toContain('Placing Lambda');
    act(() => {
      controller.editor.dispatchEvent({ type: 'pointerDown', point: { x: 300, y: 200 }, shiftKey: false, target: 'canvas' });
      controller.editor.dispatchEvent({ type: 'pointerUp', point: { x: 300, y: 200 } });
    });
    await waitFor(() => expect(controller.editor.getShapeIdsSignal().peek()).toHaveLength(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps catalog browsing available but hides editing tools in read-only mode', async () => {
    setup(true);
    expect(screen.queryByRole('button', { name: 'Import image' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Layers' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    expect(await screen.findByText('View only')).toBeTruthy();
    expect((await screen.findByRole('button', { name: /^Lambda,/ })).getAttribute('aria-disabled')).toBe('true');
  });
});
