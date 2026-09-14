import React from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import WhiteboardHistoryV2 from '../WhiteboardHistoryV2';
import WhiteboardDeleteV2 from '../WhiteboardDeleteV2';
import { Theme } from '@radix-ui/themes';
const version = (id: string, number: string) => ({ versionId: id, versionNumber: number, publishedAt: '2026-09-14T00:00:00Z', snapshot: { title: 'Board' }, preview: { url: `/api/v2/editor/space/s/whiteboard/42/published/${id}/preview` } });
const ok = (data: unknown) => new Response(JSON.stringify({ data }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const show = (canRestore = true, onRestored = vi.fn()) => { render(<Theme><WhiteboardHistoryV2 spaceId="s" pageId="42" canRestore={canRestore} onRestored={onRestored} /></Theme>); fireEvent.click(screen.getByText('Version history')); return onRestored; };
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
it('retries an ambiguous restore with identical bytes and key', async () => {
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
