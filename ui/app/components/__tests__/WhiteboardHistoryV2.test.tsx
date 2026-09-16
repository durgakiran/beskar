import React from 'react';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import WhiteboardHistoryV2 from '../WhiteboardHistoryV2';
import WhiteboardDeleteV2 from '../WhiteboardDeleteV2';
import { Theme } from '@radix-ui/themes';
const version = (id: string, number: string) => ({ versionId: id, versionNumber: number, publishedAt: '2026-09-14T00:00:00Z', snapshot: { title: 'Board' }, preview: { url: `/api/v2/editor/space/s/whiteboard/42/published/${id}/preview` } });
const ok = (data: unknown) => new Response(JSON.stringify({ data }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const show = (canRestore = true, onRestored = vi.fn()) => { render(<Theme><WhiteboardHistoryV2 spaceId="s" pageId="42" canRestore={canRestore} onRestored={onRestored} /></Theme>); fireEvent.click(screen.getByText('Version history')); return onRestored; };
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(complete => { resolve = complete; });
    return { promise, resolve };
}
it('loads paginated history and fetches selected immutable version metadata', async () => {
    const fetcher = vi.fn(async (url: string) => url.endsWith('/versions') ? ok({ versions: [version('v2', '2')], nextBefore: '2' }) : url.includes('?before=2') ? ok({ versions: [version('v1', '1')] }) : ok(version(url.endsWith('v1') ? 'v1' : 'v2', url.endsWith('v1') ? '1' : '2')));
    vi.stubGlobal('fetch', fetcher); show(false);
    await screen.findByAltText('Version 2 preview');
    fireEvent.click(screen.getByText('Load older versions'));
    fireEvent.click(await screen.findByText('Version 1 — Board'));
    await screen.findByAltText('Version 1 preview');
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/versions/v1'))).toBe(true);
    expect(screen.queryByText('Restore to draft')).toBeNull();
});
it('preserves an ambiguous restore across dialog close and retries identical bytes and key', async () => {
    const writes: RequestInit[] = []; let fails = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith('/restore')) { writes.push(init); if (fails) { fails = false; throw new TypeError('Connection lost'); } return ok({}); }
        if (url.endsWith('/draft')) return ok({ headSequence: '9007199254740993' });
        if (url.endsWith('/versions')) return ok({ versions: [version('v1', '1')] });
        return ok(version('v1', '1'));
    }));
    const restored = show(); await screen.findByAltText('Version 1 preview');
    fireEvent.click(screen.getByText('Restore to draft')); fireEvent.click(await screen.findByText('Confirm restore'));
    await screen.findByText('Connection lost');
    fireEvent.click(screen.getByText('Close history'));
    expect(writes[0].signal?.aborted).toBe(false);
    fireEvent.click(screen.getByText('Version history'));
    await screen.findByAltText('Version 1 preview');
    fireEvent.click(screen.getByText('Retry restore'));
    await waitFor(() => expect(restored).toHaveBeenCalledOnce());
    expect(writes[0].body).toBe(writes[1].body); expect(writes[0].headers).toEqual(writes[1].headers);
    expect(JSON.parse(writes[0].body as string).expectedHeadSequence).toBe('9007199254740993');
});
it('requires a fresh review after a concurrent draft change', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/restore') ? new Response(JSON.stringify({ error: { code: 'DRAFT_HEAD_CHANGED', message: 'changed' } }), { status: 409 }) : url.endsWith('/draft') ? ok({ headSequence: '4' }) : url.endsWith('/versions') ? ok({ versions: [version('v1', '1')] }) : ok(version('v1', '1'))));
    const restored = show(); await screen.findByAltText('Version 1 preview'); fireEvent.click(screen.getByText('Restore to draft')); fireEvent.click(await screen.findByText('Confirm restore'));
    await screen.findByText('The draft changed. Review the version and choose Restore to draft again.');
    expect(restored).not.toHaveBeenCalled(); expect(screen.queryByText('Confirm restore')).toBeNull(); expect(screen.getByText('Restore to draft')).toBeTruthy();
});
it('shows empty history', async () => { vi.stubGlobal('fetch', vi.fn(async () => ok({ versions: [] }))); show(); await screen.findByText('No published versions yet.'); expect(screen.queryByText('Restore to draft')).toBeNull(); });
it('keeps failed deletion visible and accepts a no-content retry response', async () => {
    const deleted = vi.fn(), changed = vi.fn(); const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Move child pages first' } }), { status: 409 })).mockResolvedValueOnce(new Response(null, { status: 204 })); vi.stubGlobal('fetch', fetcher);
    render(<Theme><WhiteboardDeleteV2 spaceId="s" pageId="42" open onOpenChange={changed} onDeleted={deleted} /></Theme>);
    fireEvent.click(screen.getByRole('button', { name: 'Delete whiteboard' })); await screen.findByText('Move child pages first'); expect(deleted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete whiteboard' })); await waitFor(() => expect(deleted).toHaveBeenCalledOnce());
    expect(fetcher.mock.calls[1][0]).toContain('/api/v2/editor/space/s/whiteboard/42'); expect(fetcher.mock.calls[1][1].method).toBe('DELETE');
});

it('cancels a prepared restore without sending a write', async () => {
    const fetcher = vi.fn(async (url: string) => url.endsWith('/draft') ? ok({ headSequence: '4' }) : url.endsWith('/versions') ? ok({ versions: [version('v1', '1')] }) : ok(version('v1', '1')));
    vi.stubGlobal('fetch', fetcher); show(); await screen.findByAltText('Version 1 preview'); fireEvent.click(screen.getByText('Restore to draft')); fireEvent.click(await screen.findByText('Cancel restore'));
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/restore'))).toBe(false);
    expect(screen.getByText('Restore to draft')).toBeTruthy();
});
it('offers retry after history loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('History unavailable')).mockResolvedValueOnce(ok({ versions: [] })));
    show(); await screen.findByText('History unavailable'); fireEvent.click(screen.getByText('Reload history')); await screen.findByText('No published versions yet.');
});

it.each(['unmount', 'parent abort'] as const)('aborts restore and ignores a late success after %s', async stop => {
    const restored = vi.fn();
    const response = deferred<Response>();
    let writeSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith('/restore')) { writeSignal = init.signal as AbortSignal; return response.promise; }
        if (url.endsWith('/draft')) return ok({ headSequence: '4' });
        if (url.endsWith('/versions')) return ok({ versions: [version('v1', '1')] });
        return ok(version('v1', '1'));
    }));
    const parent = new AbortController();
    const view = render(<React.StrictMode><Theme><WhiteboardHistoryV2 spaceId="s" pageId="42" canRestore onRestored={restored} {...(stop === 'parent abort' ? { signal: parent.signal } : {})} /></Theme></React.StrictMode>);
    fireEvent.click(screen.getByText('Version history'));
    await screen.findByAltText('Version 1 preview');
    fireEvent.click(screen.getByText('Restore to draft')); fireEvent.click(await screen.findByText('Confirm restore'));
    await waitFor(() => expect(writeSignal).toBeDefined());
    expect(writeSignal!.aborted).toBe(false);
    if (stop === 'unmount') view.unmount();
    else act(() => parent.abort());
    expect(writeSignal!.aborted).toBe(true);
    // A transport may still deliver an acknowledgement after cancellation.
    await act(async () => { response.resolve(ok({})); await response.promise; });
    expect(restored).not.toHaveBeenCalled();
});

it.each([
    ['board', true],
    ['session signal', false],
] as const)('keeps a new restore untouched when the old %s response arrives', async (replacement, success) => {
    const oldRestored = vi.fn(), newRestored = vi.fn();
    const writes: { init: RequestInit; response: ReturnType<typeof deferred<Response>> }[] = [];
    let generation = '1';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith('/restore')) { const response = deferred<Response>(); writes.push({ init, response }); return response.promise; }
        if (url.endsWith('/draft')) return ok({ headSequence: generation });
        if (url.endsWith('/versions')) return ok({ versions: [version(`v${generation}`, generation)] });
        return ok(version(`v${generation}`, generation));
    }));
    const oldSession = new AbortController(), newSession = new AbortController();
    const view = render(<Theme><WhiteboardHistoryV2 spaceId="s" pageId="42" canRestore signal={oldSession.signal} onRestored={oldRestored} /></Theme>);
    fireEvent.click(screen.getByText('Version history'));
    await screen.findByAltText('Version 1 preview');
    fireEvent.click(screen.getByText('Restore to draft')); fireEvent.click(await screen.findByText('Confirm restore'));
    await waitFor(() => expect(writes).toHaveLength(1));

    generation = '2';
    view.rerender(<Theme><WhiteboardHistoryV2 spaceId="s" pageId={replacement === 'board' ? '43' : '42'} canRestore signal={replacement === 'board' ? oldSession.signal : newSession.signal} onRestored={newRestored} /></Theme>);
    expect(writes[0].init.signal?.aborted).toBe(true);
    fireEvent.click(screen.getByText('Version history'));
    await screen.findByAltText('Version 2 preview');
    fireEvent.click(screen.getByText('Restore to draft')); fireEvent.click(await screen.findByText('Confirm restore'));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(JSON.parse(writes[1].init.body as string)).toEqual({ expectedHeadSequence: '2' });
    expect(writes[1].init.headers).not.toEqual(writes[0].init.headers);

    await act(async () => {
        writes[0].response.resolve(success ? ok({}) : new Response(JSON.stringify({ error: { code: 'DRAFT_HEAD_CHANGED', message: 'Old restore failed' } }), { status: 409 }));
        await writes[0].response.promise;
    });
    expect(oldRestored).not.toHaveBeenCalled();
    expect(newRestored).not.toHaveBeenCalled();
    expect(screen.queryByText('Old restore failed')).toBeNull();
    expect(screen.getByText('Please wait…').closest('button')?.disabled).toBe(true);
    expect(writes[1].init.signal?.aborted).toBe(false);

    await act(async () => { writes[1].response.resolve(ok({})); await writes[1].response.promise; });
    await waitFor(() => expect(newRestored).toHaveBeenCalledOnce());
    expect(oldRestored).not.toHaveBeenCalled();
});
