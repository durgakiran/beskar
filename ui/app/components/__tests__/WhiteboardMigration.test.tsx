import React, { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import WhiteboardMigration from '../WhiteboardMigration';
import { hasLegacyRecovery, loadMigrationDocument, prepareMigration } from 'app/core/whiteboard/v2/migration';
import type { GlideboardProps } from '@durgakiran/glideboard';

const canvasProps = vi.hoisted(() => [] as GlideboardProps[]);

vi.mock('@durgakiran/glideboard', async () => {
    const React = await import('react');
    return { Glideboard: React.forwardRef((props: GlideboardProps, ref) => { canvasProps.push(props); React.useImperativeHandle(ref, () => ({}), []); return <div data-testid="canvas" />; }) };
});
vi.mock('app/core/whiteboard/v2/migration', () => ({ hasLegacyRecovery: vi.fn(), loadMigrationDocument: vi.fn(), prepareMigration: vi.fn() }));
vi.mock('../WhiteboardEditor', () => ({ default: () => <div>Legacy editor</div> }));
vi.mock('../WhiteboardEditorV2', () => ({ default: () => <div>V2 editor</div> }));
const source = { contentApiVersion: 1, sourceDocId: '10' };
const body = { sourceDocId: '10', sourceFingerprint: 'hash', state: 'AAA=', title: 'Board', updateEncoding: 'yjs-update-v1', preview: { contentType: 'image/png' as const, data: 'png' } };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(status === 200 ? { data } : data), { status });
beforeEach(() => {
    canvasProps.length = 0;
    vi.mocked(hasLegacyRecovery).mockResolvedValue(false);
    vi.mocked(loadMigrationDocument).mockImplementation(async () => new Y.Doc());
    vi.mocked(prepareMigration).mockResolvedValue(body);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
it('migrates a legacy page in StrictMode, then mounts v2', async () => {
    const fetcher = vi.fn(async (_url, init) => json(init?.method === 'POST' ? { contentApiVersion: 2 } : source)); vi.stubGlobal('fetch', fetcher);
    render(<StrictMode><WhiteboardMigration slug={['space', '42']} /></StrictMode>);
    await screen.findByText('V2 editor');
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
it('a missing original leaves v1 available and never submits a migration', async () => {
    const fetcher = vi.fn(async () => json(source)); vi.stubGlobal('fetch', fetcher);
    vi.mocked(prepareMigration).mockRejectedValue(new Error('An original whiteboard image is missing. Migration was stopped.'));
    render(<WhiteboardMigration slug={['space', '42']} />);
    await screen.findByText(/original whiteboard image is missing/); expect(prepareMigration).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Open existing editor')); await screen.findByText('Legacy editor');
    expect(fetcher).toHaveBeenCalledOnce();
});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

it('mounts a detached read-only asset preview in the legacy source context and aborts preparation on cleanup', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(source)));
    vi.mocked(prepareMigration).mockReturnValue(new Promise(() => undefined));
    const view = render(<WhiteboardMigration slug={['space', '42']} />);
    await waitFor(() => expect(prepareMigration).toHaveBeenCalledOnce());
    const props = canvasProps.at(-1)!;
    expect(props.readOnly).toBe(true); expect(props.assetResolutionContext).toEqual({ documentId: '10' });
    expect(props.collaboration).toMatchObject({ boardIdentity: 'v2:space:42', provider: { synced: true } });
    expect(Object.keys(props.collaboration!.provider!)).toEqual(['synced']);
    expect(props.assetStorage).toBeDefined(); await expect(props.assetStorage!.prepare({} as never, new AbortController().signal)).rejects.toThrow('read-only');
    const dispose = vi.spyOn(props.assetStorage as unknown as { dispose(): void }, 'dispose');
    const abort = vi.mocked(prepareMigration).mock.calls[0][3]!;
    view.unmount(); expect(abort.aborted).toBe(true); expect(dispose).toHaveBeenCalled();
});

it('never submits a stale prepared body to a newly selected board', async () => {
    const first = deferred<typeof body>(), next = deferred<typeof body>();
    vi.mocked(prepareMigration).mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    const fetcher = vi.fn(async (url, init) => json(init?.method === 'POST' ? { contentApiVersion: 2 } : { ...source, sourceDocId: String(url).includes('/43/') ? '11' : '10' })); vi.stubGlobal('fetch', fetcher);
    const view = render(<WhiteboardMigration slug={['space', '42']} />);
    await waitFor(() => expect(prepareMigration).toHaveBeenCalledOnce());
    const oldSignal = vi.mocked(prepareMigration).mock.calls[0][3]!;
    view.rerender(<WhiteboardMigration slug={['space', '43']} />);
    await waitFor(() => expect(prepareMigration).toHaveBeenCalledTimes(2)); expect(oldSignal.aborted).toBe(true);
    await act(async () => { first.resolve(body); await first.promise; });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    await act(async () => { next.resolve({ ...body, sourceDocId: '11' }); });
    await screen.findByText('V2 editor');
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1); expect(posts[0][0]).toContain('/whiteboard/43/migrate');
    expect(JSON.parse(posts[0][1].body).sourceDocId).toBe('11');
});

it('ignores a late old POST acknowledgement while another board is still migrating', async () => {
    const first = deferred<Response>(), next = deferred<Response>();
    vi.mocked(prepareMigration).mockImplementation(async (_board, _doc, source) => ({ ...body, sourceDocId: source.sourceDocId }));
    const fetcher = vi.fn(async (url, init) => {
        if (init?.method === 'POST') return String(url).includes('/42/') ? first.promise : next.promise;
        return json({ ...source, sourceDocId: String(url).includes('/43/') ? '11' : '10' });
    }); vi.stubGlobal('fetch', fetcher);
    const view = render(<WhiteboardMigration slug={['space', '42']} />);
    await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1));
    const oldPost = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
    view.rerender(<WhiteboardMigration slug={['space', '43']} />);
    await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2));
    expect(oldPost[1].signal.aborted).toBe(true);
    await act(async () => { first.resolve(json({ contentApiVersion: 2 })); });
    expect(screen.queryByText('V2 editor')).toBeNull(); expect(screen.getByRole('status').textContent).toContain('Publishing');
    await act(async () => { next.resolve(json({ contentApiVersion: 2 })); }); await screen.findByText('V2 editor');
});

it('starts migration discovery again after navigating away from an already migrated board', async () => {
    const discovery = deferred<Response>();
    const fetcher = vi.fn(async (url) => String(url).includes('/43/') ? discovery.promise : json({ contentApiVersion: 2 })); vi.stubGlobal('fetch', fetcher);
    const view = render(<WhiteboardMigration slug={['space', '42']} />); await screen.findByText('V2 editor');
    view.rerender(<WhiteboardMigration slug={['space', '43']} />);
    expect(screen.queryByText('V2 editor')).toBeNull(); expect(screen.getByRole('status').textContent).toContain('Preparing');
    await act(async () => { discovery.resolve(json({ contentApiVersion: 2 })); }); await screen.findByText('V2 editor');
});
it('does not merge or discard pending legacy browser recovery', async () => {
    vi.mocked(hasLegacyRecovery).mockResolvedValue(true); vi.stubGlobal('fetch', vi.fn(async () => json(source)));
    render(<WhiteboardMigration slug={['space', '42']} />);
    await screen.findByText(/Unsaved changes are retained/); expect(loadMigrationDocument).not.toHaveBeenCalled(); expect(prepareMigration).not.toHaveBeenCalled();
});
it('retries an uncertain POST with exactly the same payload and key', async () => {
    let posts = 0;
    const fetcher = vi.fn(async (_url, init) => {
        if (init?.method !== 'POST') return json(source);
        if (++posts === 1) throw new TypeError('Connection lost');
        return json({ contentApiVersion: 2 });
    }); vi.stubGlobal('fetch', fetcher);
    render(<WhiteboardMigration slug={['space', '42']} />);
    fireEvent.click(await screen.findByText('Retry publication')); await screen.findByText('V2 editor');
    const calls = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(calls[0][1].body).toBe(calls[1][1].body);
    expect(calls[0][1].headers).toEqual(calls[1][1].headers);
});
it('source conflict reloads and prepares a new request; existing v2 skips canvas', async () => {
    let sources = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => init?.method === 'POST'
        ? json({ error: { code: 'SOURCE_CHANGED', message: 'Source changed' } }, 409)
        : json(++sources === 1 ? source : { contentApiVersion: 2 })));
    render(<WhiteboardMigration slug={['space', '42']} />);
    fireEvent.click(await screen.findByText('Retry migration')); await screen.findByText('V2 editor');
    await waitFor(() => expect(prepareMigration).toHaveBeenCalledOnce());
});
