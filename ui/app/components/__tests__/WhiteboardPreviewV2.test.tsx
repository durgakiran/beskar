import React from 'react';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import WhiteboardPreviewV2 from '../WhiteboardPreviewV2';
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const previewPath = '/api/v2/editor/space/s/whiteboard/42/published/v/preview';
const publishedPreview = () => new Response(JSON.stringify({
    data: { snapshot: { title: 'Published diagram' }, preview: { url: previewPath } },
}));

it('renders the version-pinned preview and published title', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(publishedPreview()));
    const onPublished = vi.fn();
    render(<WhiteboardPreviewV2 spaceId="s" pageId="42" onPublished={onPublished} />);
    const img = await screen.findByAltText('Published diagram');
    expect(img.getAttribute('src')).toContain('/published/v/preview');
    expect(onPublished).toHaveBeenCalledWith(expect.objectContaining({ snapshot: { title: 'Published diagram' } }));
    fireEvent.error(img);
    expect(screen.getByText('Unable to load the published preview.')).toBeTruthy();
});

it('animates zoom controls and fits a panned view, counting rapid presses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(publishedPreview()));
    render(<WhiteboardPreviewV2 spaceId="s" pageId="42" />);
    const image = await screen.findByRole('img');
    const viewport = screen.getByRole('region', { name: /whiteboard image/i });
    viewport.setPointerCapture = vi.fn();
    vi.useFakeTimers({ toFake: ['performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });

    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    fireEvent.click(zoomIn);
    fireEvent.click(zoomIn);
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1)');
    act(() => vi.advanceTimersByTime(96));
    const zoomingIn = parseInt(screen.getByRole('status').textContent!);
    expect(zoomingIn).toBeGreaterThan(100);
    expect(zoomingIn).toBeLessThan(156);
    act(() => vi.advanceTimersByTime(250));
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1.5625)');
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 40, clientY: 60 });
    fireEvent.pointerUp(viewport, { pointerId: 1 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 50, clientY: 70 });
    expect(image.style.transform).toBe('translate(30px, 40px) scale(1.5625)');

    fireEvent.keyDown(viewport, { key: 'ArrowRight' });
    expect(image.style.transform).toBe('translate(-10px, 40px) scale(1.5625)');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    act(() => vi.advanceTimersByTime(96));
    const zoomingOut = parseInt(screen.getByRole('status').textContent!);
    expect(zoomingOut).toBeGreaterThan(125);
    expect(zoomingOut).toBeLessThan(156);
    act(() => vi.advanceTimersByTime(250));
    expect(image.style.transform).toBe('translate(-8px, 32px) scale(1.25)');
    fireEvent.click(screen.getByRole('button', { name: 'Fit to view' }));
    act(() => vi.advanceTimersByTime(96));
    const fitting = parseInt(screen.getByRole('status').textContent!);
    expect(fitting).toBeGreaterThan(100);
    expect(fitting).toBeLessThan(125);
    act(() => vi.advanceTimersByTime(250));
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1)');
});

it('pinches around the touch midpoint and continues panning with the remaining finger', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(publishedPreview()));
    render(<WhiteboardPreviewV2 spaceId="s" pageId="42" />);
    const image = await screen.findByRole('img');
    const viewport = screen.getByRole('region', { name: /whiteboard image/i });
    viewport.setPointerCapture = vi.fn();
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 300));
    const touch = (pointerId: number, clientX: number, clientY: number) => ({
        pointerId, pointerType: 'touch', button: 0, clientX, clientY,
    });

    fireEvent.pointerDown(viewport, touch(1, 100, 100));
    fireEvent.pointerMove(viewport, touch(1, 120, 110));
    expect(image.style.transform).toBe('translate(20px, 10px) scale(1)');

    fireEvent.pointerDown(viewport, touch(2, 220, 110));
    expect(image.style.transform).toBe('translate(20px, 10px) scale(1)');
    fireEvent.pointerMove(viewport, touch(2, 320, 110));
    expect(image.style.transform).toBe('translate(120px, 60px) scale(2)');
    fireEvent.pointerMove(viewport, touch(2, 220, 110));
    expect(image.style.transform).toBe('translate(20px, 10px) scale(1)');
    fireEvent.pointerMove(viewport, touch(2, 320, 110));

    fireEvent.pointerUp(viewport, touch(2, 320, 110));
    expect(image.style.transform).toBe('translate(120px, 60px) scale(2)');
    fireEvent.pointerMove(viewport, touch(1, 140, 130));
    expect(image.style.transform).toBe('translate(140px, 80px) scale(2)');
    fireEvent.pointerCancel(viewport, touch(1, 140, 130));
    fireEvent.pointerMove(viewport, touch(1, 160, 150));
    expect(image.style.transform).toBe('translate(140px, 80px) scale(2)');
});

it('zooms around two nearby touch taps, and fits on the next double-tap', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(publishedPreview()));
    render(<WhiteboardPreviewV2 spaceId="s" pageId="42" />);
    const image = await screen.findByRole('img');
    const viewport = screen.getByRole('region', { name: /whiteboard image/i });
    vi.useFakeTimers({ toFake: ['performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    viewport.setPointerCapture = vi.fn();
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 400, 300));
    const tap = (pointerId: number, clientX: number, pointerType = 'touch') => {
        const pointer = { pointerId, pointerType, button: 0, clientX, clientY: 100 };
        fireEvent.pointerDown(viewport, pointer);
        fireEvent.pointerMove(viewport, { ...pointer, clientY: 102 });
        fireEvent.pointerUp(viewport, pointer);
        fireEvent.lostPointerCapture(viewport, pointer);
    };

    tap(1, 40);
    tap(2, 120);
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1)');
    tap(3, 120);
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1)');
    act(() => vi.advanceTimersByTime(96));
    const zoomingIn = parseInt(screen.getByRole('status').textContent!);
    expect(zoomingIn).toBeGreaterThan(100);
    expect(zoomingIn).toBeLessThan(200);
    act(() => vi.advanceTimersByTime(250));
    expect(image.style.transform).toBe('translate(100px, 80px) scale(2)');

    tap(4, 120);
    expect(image.style.transform).toBe('translate(100px, 80px) scale(2)');
    tap(5, 120);
    act(() => vi.advanceTimersByTime(96));
    const zoomingOut = parseInt(screen.getByRole('status').textContent!);
    expect(zoomingOut).toBeGreaterThan(100);
    expect(zoomingOut).toBeLessThan(200);
    act(() => vi.advanceTimersByTime(250));
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1)');

    tap(6, 120, 'mouse');
    tap(7, 120, 'mouse');
    expect(screen.getByRole('status').textContent).toBe('100%');
});

it('lets a touch gesture take over the current frame of a zoom-button animation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(publishedPreview()));
    render(<WhiteboardPreviewV2 spaceId="s" pageId="42" />);
    const image = await screen.findByRole('img');
    const viewport = screen.getByRole('region', { name: /whiteboard image/i });
    vi.useFakeTimers({ toFake: ['performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    viewport.setPointerCapture = vi.fn();
    const touch = (pointerId: number, clientX: number) => ({
        pointerId, pointerType: 'touch', button: 0, clientX, clientY: 100,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    act(() => vi.advanceTimersByTime(80));
    const inFlight = image.style.transform;
    const inFlightZoom = screen.getByRole('status').textContent;
    expect(parseInt(inFlightZoom!)).toBeGreaterThan(100);
    expect(parseInt(inFlightZoom!)).toBeLessThan(125);

    fireEvent.pointerDown(viewport, touch(3, 100));
    expect(image.style.transform).toBe(inFlight);
    fireEvent.pointerMove(viewport, touch(3, 130));
    expect(image.style.transform).not.toBe(inFlight);
    expect(screen.getByRole('status').textContent).toBe(inFlightZoom);
    fireEvent.pointerDown(viewport, touch(4, 230));
    fireEvent.pointerMove(viewport, touch(4, 280));
    const pinched = image.style.transform;
    expect(parseInt(screen.getByRole('status').textContent!)).toBeGreaterThan(parseInt(inFlightZoom!));
    act(() => vi.advanceTimersByTime(400));
    expect(image.style.transform).toBe(pinched);
});

it('smooths consecutive wheel input around the current cursor and lets a drag take over', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(publishedPreview()));
    render(<WhiteboardPreviewV2 spaceId="s" pageId="42" />);
    const image = await screen.findByRole('img');
    const viewport = screen.getByRole('region', { name: /whiteboard image/i });
    viewport.setPointerCapture = vi.fn();
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 400, 300));
    vi.useFakeTimers({ toFake: ['performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const readView = () => {
        const [, x, y, scale] = image.style.transform.match(/^translate\((.+)px, (.+)px\) scale\((.+)\)$/)!;
        return { x: Number(x), y: Number(y), scale: Number(scale) };
    };

    fireEvent.wheel(viewport, { clientX: 120, clientY: 100, deltaY: -100 });
    fireEvent.wheel(viewport, { clientX: 120, clientY: 100, deltaY: -50 });
    expect(readView().scale).toBe(1);
    act(() => vi.advanceTimersByTime(80));
    const first = readView();
    expect(first.scale).toBeGreaterThan(1);
    expect(first.scale).toBeLessThan(Math.exp(0.3));
    expect(first.x).toBeCloseTo(100 * (first.scale - 1));
    expect(first.y).toBeCloseTo(80 * (first.scale - 1));

    fireEvent.wheel(viewport, { clientX: 320, clientY: 250, deltaY: -100 });
    act(() => vi.advanceTimersByTime(48));
    const second = readView();
    expect(second.scale).toBeGreaterThan(first.scale);
    expect(second.scale).toBeLessThan(Math.exp(0.5));
    expect(second.x).toBeCloseTo(100 + (first.x - 100) * (second.scale / first.scale));
    expect(second.y).toBeCloseTo(70 + (first.y - 70) * (second.scale / first.scale));
    act(() => vi.advanceTimersByTime(250));
    expect(readView().scale).toBeCloseTo(Math.exp(0.5));

    fireEvent.wheel(viewport, { clientX: 320, clientY: 250, deltaY: 100 });
    act(() => vi.advanceTimersByTime(64));
    const interrupted = readView();
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 130, clientY: 120 });
    act(() => vi.advanceTimersByTime(300));
    expect(readView()).toEqual({ ...interrupted, x: interrupted.x + 30, y: interrupted.y + 20 });
});

it('applies zoom controls and double-tap immediately when reduced motion is preferred', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(publishedPreview()));
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    render(<WhiteboardPreviewV2 spaceId="s" pageId="42" />);
    await screen.findByRole('img');
    const viewport = screen.getByRole('region', { name: /whiteboard image/i });
    viewport.setPointerCapture = vi.fn();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('status').textContent).toBe('125%');
    fireEvent.click(screen.getByRole('button', { name: 'Fit to view' }));
    expect(screen.getByRole('status').textContent).toBe('100%');
    fireEvent.wheel(viewport, { deltaY: -100 });
    expect(screen.getByRole('status').textContent).toBe('122%');
    fireEvent.click(screen.getByRole('button', { name: 'Fit to view' }));
    const touch = { pointerId: 1, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 };
    for (let i = 0; i < 2; i++) {
        fireEvent.pointerDown(viewport, touch);
        fireEvent.pointerUp(viewport, touch);
    }
    expect(screen.getByRole('status').textContent).toBe('200%');
});

it('does not use a drag or either finger of a pinch as a tap', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(publishedPreview()));
    render(<WhiteboardPreviewV2 spaceId="s" pageId="42" />);
    const image = await screen.findByRole('img');
    const viewport = screen.getByRole('region', { name: /whiteboard image/i });
    viewport.setPointerCapture = vi.fn();
    const touch = (pointerId: number, clientX: number) => ({
        pointerId, pointerType: 'touch', button: 0, clientX, clientY: 100,
    });
    const tap = (pointerId: number) => {
        fireEvent.pointerDown(viewport, touch(pointerId, 120));
        fireEvent.pointerUp(viewport, touch(pointerId, 120));
    };

    tap(1);
    fireEvent.pointerDown(viewport, touch(2, 100));
    fireEvent.pointerMove(viewport, touch(2, 120));
    fireEvent.pointerUp(viewport, touch(2, 120));
    tap(3);
    expect(image.style.transform).toBe('translate(20px, 0px) scale(1)');

    fireEvent.pointerDown(viewport, touch(4, 120));
    fireEvent.pointerDown(viewport, touch(5, 140));
    fireEvent.pointerUp(viewport, touch(4, 120));
    fireEvent.pointerUp(viewport, touch(5, 140));
    tap(6);
    expect(image.style.transform).toBe('translate(20px, 0px) scale(1)');
});

it('keeps the current view and wheel zoom when switching to and from the fullscreen fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(publishedPreview()));
    const { container } = render(<WhiteboardPreviewV2 spaceId="s" pageId="42" />);
    await screen.findByRole('img');
    const dialog = container.querySelector('dialog')!;
    vi.useFakeTimers({ toFake: ['performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    dialog.showModal = () => dialog.setAttribute('open', '');
    dialog.close = () => {
        dialog.removeAttribute('open');
        fireEvent(dialog, new Event('close'));
    };

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    act(() => vi.advanceTimersByTime(300));
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
    expect(screen.getByRole('dialog', { name: 'Whiteboard fullscreen view' })).toBe(dialog);
    expect(screen.getByRole('status').textContent).toBe('125%');
    const viewport = screen.getByRole('region', { name: /whiteboard image/i });
    fireEvent.wheel(viewport, { deltaY: -100 });
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('status').textContent).toBe('153%');

    fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('153%');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fullscreen' }));
});

it('shows an unpublished state instead of loading a draft canvas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'WHITEBOARD_NOT_PUBLISHED', message: 'Unpublished' } }), { status: 404 })));
    render(<WhiteboardPreviewV2 spaceId="s" pageId="42" />);
    await screen.findByText('This whiteboard has not been published yet.');
    expect(screen.queryByRole('img')).toBeNull();
});
