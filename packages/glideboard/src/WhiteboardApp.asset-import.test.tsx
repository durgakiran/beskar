import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentIngressError } from '@durgakiran/glideline';
import { GlideboardController } from './GlideboardController';
import { GlideboardProvider, useGlideboardController } from './GlideboardContext';
import { WhiteboardApp } from './WhiteboardApp';

vi.mock('./Canvas', () => ({
  Canvas() {
    const controller = useGlideboardController();
    return <div
      ref={element => {
        if (element) {
          element.getBoundingClientRect = () => ({
            x: 10, y: 20, left: 10, top: 20, right: 810, bottom: 620,
            width: 800, height: 600, toJSON: () => ({}),
          });
        }
        controller.setCanvasElement(element);
      }}
      data-glideboard-role="canvas"
    />;
  },
}));

vi.mock('./ContextMenu', () => ({
  ContextMenu: ({ position, onClose }: { position: unknown; onClose: () => void }) => (
    position ? <button type="button" onClick={onClose}>Close context menu</button> : null
  ),
}));
vi.mock('./StylePanel', () => ({ StylePanel: () => null, PositionSizeBar: () => null }));
vi.mock('./ZoomWidget', () => ({ ZoomWidget: () => null, fitToScreen: () => undefined }));
vi.mock('./BackToContentButton', () => ({ BackToContentButton: () => null }));
vi.mock('./CollaborationCursors', () => ({ CollaborationCursors: () => null }));
vi.mock('./LayersPanel', () => ({ LayersPanel: () => null }));

describe('WhiteboardApp unified asset ingress', () => {
  let controller: GlideboardController;

  beforeEach(() => {
    controller = new GlideboardController({ sessionKey: 'asset-ui-test' });
    controller.editor.camera.setViewportSize(800, 600);
  });

  afterEach(async () => {
    cleanup();
    await controller.dispose();
  });

  function setup() {
    const queue = vi.spyOn(controller, 'queueAssetImport').mockImplementation(request => ({
      id: `test:${request.name}`,
      result: Promise.resolve(`shape:${request.name}` as any),
    }));
    const view = render(
      <GlideboardProvider controller={controller}>
        <WhiteboardApp />
      </GlideboardProvider>,
    );
    return { queue, ...view };
  }

  it('uses one ordered placement pipeline for picker, paste, and drop', async () => {
    const { queue, container } = setup();
    const importButton = screen.getByRole('button', { name: 'Import image' });
    importButton.focus();
    fireEvent.click(importButton);
    const input = container.querySelector<HTMLInputElement>('[data-glideboard-role="asset-file-input"]')!;
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain('image/svg+xml');

    fireEvent.change(input, { target: { files: [
      new File(['<svg/>'], 'first.svg', { type: 'image/svg+xml' }),
      new File(['<svg/>'], 'second.svg', { type: 'image/svg+xml' }),
    ] } });
    await waitFor(() => expect(queue).toHaveBeenCalledTimes(2));
    expect(queue.mock.calls.map(call => call[0].point)).toEqual([
      { x: 240, y: 180 },
      { x: 264, y: 204 },
    ]);
    await waitFor(() => expect(document.activeElement).toBe(importButton));

    fireEvent.paste(container.firstElementChild as Element, {
      clipboardData: {
        files: [new File(['<svg/>'], 'pasted.svg', { type: 'image/svg+xml' })],
        getData: () => '',
      },
    });
    await waitFor(() => expect(queue).toHaveBeenCalledTimes(3));
    expect(queue.mock.calls[2]![0].point).toEqual({ x: 240, y: 180 });

    const root = container.firstElementChild as HTMLElement;
    const dropped = new File(['<svg/>'], 'dropped.svg', { type: 'image/svg+xml' });
    vi.spyOn(controller.editor, 'screenToPage').mockReturnValue({ x: 100, y: 200 });
    fireEvent.dragEnter(root, { dataTransfer: { types: ['Files'], files: [dropped] } });
    expect(screen.getByText('Drop images to import')).toBeTruthy();
    fireEvent.drop(root, {
      clientX: 110,
      clientY: 220,
      dataTransfer: { types: ['Files'], files: [dropped] },
    });
    await waitFor(() => expect(queue).toHaveBeenCalledTimes(4));
    expect(queue.mock.calls[3]![0].point).toEqual({ x: 100, y: 200 });
    expect(screen.queryByText('Drop images to import')).toBeNull();
  });

  it('exposes the multi-file picker from the image control', async () => {
    const { queue, container } = setup();
    const input = container.querySelector<HTMLInputElement>('[data-glideboard-role="asset-file-input"]')!;
    const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);

    const mediaButton = screen.getByTitle('Import image');
    fireEvent.click(mediaButton);
    expect(click).toHaveBeenCalledTimes(1);
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe('image/png,image/jpeg,image/webp,image/svg+xml');

    fireEvent.change(input, { target: { files: [
      new File(['<svg/>'], 'one.svg', { type: 'image/svg+xml' }),
      new File(['<svg/>'], 'two.svg', { type: 'image/svg+xml' }),
    ] } });
    await waitFor(() => expect(queue).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.activeElement).toBe(mediaButton));
    expect(screen.queryByRole('button', { name: 'Main menu' })).toBeNull();
  });

  it('blocks dropped files in read-only mode and shows an actionable permission message', () => {
    const { queue, container } = setup();
    act(() => controller.setReadOnly(true));
    const root = container.firstElementChild as HTMLElement;
    fireEvent.drop(root, {
      clientX: 110,
      clientY: 220,
      dataTransfer: {
        types: ['Files'],
        files: [new File(['<svg/>'], 'blocked.svg', { type: 'image/svg+xml' })],
      },
    });
    expect(queue).not.toHaveBeenCalled();
    expect(screen.getAllByText(/This board is read-only/)).toHaveLength(2);
    expect(screen.getByText(/Request edit access/)).toBeTruthy();
  });

  it('handles portable, SVG, text, and internal clipboard representations', async () => {
    const { queue, container } = setup();
    const root = container.firstElementChild as HTMLElement;
    const portable = vi.spyOn(controller, 'pastePortableFragment').mockResolvedValue([]);
    const plainText = vi.spyOn(controller, 'importPlainText').mockReturnValue([]);
    const internalPaste = vi.spyOn(controller.editor, 'paste');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const prefix = 'application/x-glideboard-fragment+json\n';
    const paste = (values: Record<string, string>, files: File[] = []) => fireEvent.paste(root, {
      clipboardData: { files, getData: (type: string) => values[type] ?? '' },
    });

    paste({ 'text/plain': `${prefix}${JSON.stringify({ version: 1, records: [] })}` });
    await waitFor(() => expect(portable).toHaveBeenCalledOnce());
    paste({ 'text/plain': `${prefix}{invalid` });
    expect(warn).toHaveBeenCalledWith('[Glideboard] Invalid portable clipboard data', expect.anything());

    paste({ 'image/svg+xml': '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    await waitFor(() => expect(queue).toHaveBeenCalledOnce());
    expect(queue.mock.calls[0]![0]).toMatchObject({ kind: 'svg', name: 'Pasted SVG.svg' });

    paste({ 'text/html': '<p>Hello <b>board</b></p>', 'text/plain': 'Hello board' });
    expect(plainText).toHaveBeenCalledOnce();
    paste({});
    expect(internalPaste).toHaveBeenCalledOnce();

    act(() => controller.setReadOnly(true));
    paste({ 'text/plain': `${prefix}${JSON.stringify({ version: 1, records: [] })}` });
    expect(portable).toHaveBeenCalledOnce();
    paste({ 'text/html': '<svg></svg>' });
    expect(screen.getByText('Image import blocked')).toBeTruthy();
    warn.mockRestore();
  });

  it('tracks nested file drags, ignores unrelated drags, and validates failed files', async () => {
    const { queue, container } = setup();
    const root = container.firstElementChild as HTMLElement;
    const file = new File(['not an image'], 'notes.txt', { type: 'text/plain' });

    fireEvent.dragEnter(root, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(screen.queryByText('Drop images to import')).toBeNull();
    fireEvent.dragEnter(root, { dataTransfer: { types: ['Files'], files: [file] } });
    fireEvent.dragEnter(root, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(screen.getByText('Drop images to import')).toBeTruthy();
    fireEvent.dragLeave(root, { dataTransfer: { types: ['Files'] } });
    expect(screen.getByText('Drop images to import')).toBeTruthy();
    fireEvent.dragLeave(root, { dataTransfer: { types: ['Files'] } });
    expect(screen.queryByText('Drop images to import')).toBeNull();

    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' };
    fireEvent.dragOver(root, { dataTransfer });
    fireEvent.drop(root, { clientX: 20, clientY: 30, dataTransfer });
    await waitFor(() => expect(screen.getByText('notes.txt')).toBeTruthy());
    expect(queue).not.toHaveBeenCalled();

    fireEvent.contextMenu(root, { clientX: 12, clientY: 34 });
    act(() => controller.setReadOnly(true));
    await waitFor(() => expect(screen.getByText(/Read-only/)).toBeTruthy());
    const blockedTransfer = { types: ['Files'], files: [file], dropEffect: 'copy' };
    fireEvent.dragOver(root, { dataTransfer: blockedTransfer });
    fireEvent.dragEnter(root, { dataTransfer: blockedTransfer });
    expect(screen.queryByText('Drop images to import')).toBeNull();
  });

  it('fits initial asset geometry within the viewport without changing its aspect ratio', async () => {
    controller.editor.camera.setViewportSize(400, 300);
    const shapeId = await controller.importSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="1000" viewBox="0 0 100 1000"><path d="M0 0L100 1000"/></svg>',
    );
    const shape = controller.editor.getShape(shapeId)!;
    expect(shape.props['w']).toBeCloseTo(25.2);
    expect(shape.props['h']).toBeCloseTo(252);
    expect((shape.props['h'] as number) / (shape.props['w'] as number)).toBeCloseTo(10);
  });

  it('handles failed queue results, picker window focus, and dismissible validation notices', async () => {
    const queue = vi.spyOn(controller, 'queueAssetImport').mockImplementation(request => ({
      id: `failed:${request.name}`,
      result: Promise.reject(new Error('upload rejected')),
    }));
    const view = render(
      <GlideboardProvider controller={controller}><WhiteboardApp /></GlideboardProvider>,
    );
    const media = screen.getByRole('button', { name: 'Import image' });
    media.focus();
    fireEvent.click(media);
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(document.activeElement).toBe(media));

    const input = view.container.querySelector<HTMLInputElement>('[data-glideboard-role="asset-file-input"]')!;
    fireEvent.change(input, { target: { files: [new File(['<svg/>'], 'failed.svg', { type: 'image/svg+xml' })] } });
    await waitFor(() => expect(queue).toHaveBeenCalledOnce());

    fireEvent.change(input, { target: { files: [new File([], '', { type: 'image/png' })] } });
    const notice = await screen.findByText('This file is empty.');
    expect(notice).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(screen.queryByText('This file is empty.')).toBeNull();
  });

  it('covers guarded commands, local deletion, clipboard fallbacks, and paste failures', async () => {
    const view = setup();
    const app = view.container.querySelector<HTMLElement>('[data-glideboard-role="app"]')!;
    const shapeId = controller.editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 40, h: 30 } });
    controller.editor.setSelectedShapeIds([shapeId]);
    fireEvent.keyDown(app, { key: 'Delete' });
    expect(controller.editor.getShape(shapeId)).toBeUndefined();

    const ignored = document.createElement('input');
    app.append(ignored);
    fireEvent.keyDown(ignored, { key: 'r' });
    expect(controller.editor.currentToolId.peek()).toBe('select');

    const second = controller.editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 40, h: 30 } });
    controller.editor.setSelectedShapeIds([second]);
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    fireEvent.keyDown(app, { key: 'c', ctrlKey: true });
    vi.spyOn(controller, 'createPortableFragment').mockResolvedValue(null);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn() } });
    fireEvent.keyDown(app, { key: 'c', ctrlKey: true });

    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(controller, 'pastePortableFragment').mockRejectedValue(new Error('portable failed'));
    fireEvent.paste(app, {
      clipboardData: {
        files: [],
        getData: (type: string) => type === 'text/plain'
          ? 'application/x-glideboard-fragment+json\n{"version":1,"records":[]}'
          : '',
      },
    });
    await waitFor(() => expect(warning).toHaveBeenCalledWith(
      '[Glideboard] Unable to paste portable clipboard data', expect.any(Error),
    ));
    vi.spyOn(controller, 'importPlainText').mockImplementation(() => { throw new Error('plain failed'); });
    fireEvent.paste(app, {
      clipboardData: { files: [], getData: (type: string) => type === 'text/plain' ? 'plain text' : '' },
    });
    expect(warning).toHaveBeenCalledWith('[Glideboard] Unable to import clipboard content');
    warning.mockRestore();
    vi.unstubAllGlobals();
  });

  it('handles inert and unavailable drops plus context-menu dismissal', () => {
    const { container } = setup();
    const root = container.firstElementChild as HTMLElement;
    const inert = { types: ['text/plain'], files: [], getData: () => '', dropEffect: 'none' };
    fireEvent.dragOver(root, { dataTransfer: inert });
    fireEvent.dragLeave(root, { dataTransfer: inert });
    fireEvent.drop(root, { dataTransfer: inert });

    controller.setCanvasElement(null);
    fireEvent.drop(root, {
      clientX: 10, clientY: 10,
      dataTransfer: { types: ['Files'], files: [new File(['x'], 'image.png', { type: 'image/png' })] },
    });

    controller.setReadOnly(true);
    fireEvent.drop(root, {
      dataTransfer: {
        types: ['application/x-glideboard-asset+json'], files: [],
        getData: () => JSON.stringify({ version: 1, providerId: 'missing', displayName: 'Missing', selection: { itemId: 'x' } }),
      },
    });

    controller.setReadOnly(false);
    fireEvent.contextMenu(root, { clientX: 12, clientY: 34 });
    fireEvent.click(screen.getByRole('button', { name: 'Close context menu' }));
    expect(screen.queryByRole('button', { name: 'Close context menu' })).toBeNull();
  });

  it('covers read-only transitions and alternate keyboard, paste, and drop policies', async () => {
    const cancel = vi.spyOn(controller, 'cancelAssetImport').mockReturnValue(true);
    controller.assetImportJobsSignal.value = [
      { id: 'queued', kind: 'svg', status: 'queued', progress: 0, attempt: 1 },
      { id: 'uploading', kind: 'raster', status: 'uploading', progress: 0.5, attempt: 1 },
      { id: 'complete', kind: 'svg', status: 'complete', progress: 1, attempt: 1 },
    ];
    const view = setup();
    const app = view.container.querySelector<HTMLElement>('[data-glideboard-role="app"]')!;
    const input = view.container.querySelector<HTMLInputElement>('[data-glideboard-role="asset-file-input"]')!;
    fireEvent.change(input, { target: { files: [] } });
    fireEvent(window, new Event('focus'));
    fireEvent.keyDown(document.body, { key: ' ' });
    fireEvent.keyUp(app, { key: 'a' });

    controller.editor.setCurrentTool('hand');
    fireEvent.keyDown(app, { key: ' ', code: 'Space' });
    fireEvent.keyUp(app, { key: ' ', code: 'Space' });
    controller.editor.setCurrentTool('asset');
    fireEvent.keyDown(app, { key: ' ', code: 'Space' });
    fireEvent.keyUp(app, { key: ' ', code: 'Space' });
    expect(controller.editor.currentToolId.peek()).toBe('select');

    const one = controller.editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 30, h: 30 } });
    controller.editor.setSelectedShapeIds([one]);
    fireEvent.keyDown(app, { key: 'g', ctrlKey: true });
    fireEvent.keyDown(app, { key: 'ArrowLeft' });
    controller.editor.setSelectedShapeIds([]);
    fireEvent.keyDown(app, { key: 'Delete' });
    fireEvent.keyDown(app, { key: 'ArrowRight' });

    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(controller, 'importPlainText').mockImplementation(() => { throw new ContentIngressError('unsafe text'); });
    fireEvent.paste(app, {
      clipboardData: { files: [], getData: (type: string) => type === 'text/plain' ? 'unsafe' : '' },
    });
    expect(warning).toHaveBeenCalledWith('[Glideboard] unsafe text');

    act(() => controller.setReadOnly(true));
    expect(cancel).toHaveBeenCalledWith('queued');
    expect(cancel).toHaveBeenCalledWith('uploading');
    expect(cancel).not.toHaveBeenCalledWith('complete');
    fireEvent.contextMenu(app, { clientX: 1, clientY: 2 });
    fireEvent.paste(app, {
      clipboardData: { files: [], getData: (type: string) => type === 'text/plain' ? 'browse text' : '' },
    });
    fireEvent.drop(app, {
      dataTransfer: {
        types: ['application/x-glideboard-asset+json'], files: [],
        getData: () => JSON.stringify({ version: 1, providerId: 'other', displayName: 'Other', selection: { itemId: 'x' } }),
      },
    });
    warning.mockRestore();
  });
});
