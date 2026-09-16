import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { prepareRasterAsset } from '@durgakiran/glideline';
import { WhiteboardMigrationAssetStorage } from './WhiteboardMigrationAssetStorage';

const api = vi.hoisted(() => ({ origin: '' }));
vi.mock('app/core/http/apiBase', () => ({ getApiOrigin: () => api.origin }));
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
const binary = (bytes = png, headers: Record<string, string> = {}) => new Response(new Uint8Array(bytes).buffer, { headers: { 'Content-Type': 'image/png', ...headers } });
const make = (signal?: AbortSignal, pageId = '42') => new WhiteboardMigrationAssetStorage({ pageId, sourceDocId: '10', signal });
const signal = () => new AbortController().signal;
beforeEach(() => { api.origin = ''; vi.stubGlobal('crypto', { subtle: { digest: (algorithm: string, data: ArrayBuffer) => webcrypto.subtle.digest(algorithm, Buffer.from(new Uint8Array(data))) } }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('reads only same-page legacy originals without an ETag, validates bytes and caches defensive copies', async () => {
    api.origin = 'https://api.example/prefix';
    const { asset } = await prepareRasterAsset(png), fetcher = vi.fn().mockResolvedValue(binary()); vi.stubGlobal('fetch', fetcher);
    const storage = make(), context = { documentId: '10' };
    const url = `https://api.example/prefix/api/v1/media/whiteboard-asset/42/${asset.props.hash}`;
    expect(storage.resolve(asset, context)).toBe(url);
    const first = await storage.download(asset, signal(), context); first.bytes.fill(0);
    expect((await storage.download(asset, signal(), context)).bytes).toEqual(png);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(url, expect.objectContaining({ method: 'GET', credentials: 'include', redirect: 'error', cache: 'no-store' }));
    await expect(storage.prepare()).rejects.toThrow('read-only'); storage.dispose(); expect(storage.resolve(asset)).toBeNull();
});
it.each([{ documentId: '11' }, { documentId: 'v2:space:42' }, { versionId: 'version' }, { snapshotId: 'snapshot' }])('rejects foreign or version source context %j without a request', async context => {
    const { asset } = await prepareRasterAsset(png), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const storage = make(); expect(storage.resolve(asset, context)).toBeNull();
    await expect(storage.download(asset, signal(), context)).rejects.toThrow('different source'); expect(fetcher).not.toHaveBeenCalled(); storage.dispose();
});
it.each(['https://user:secret@api.example', 'https://api.example?redirect=evil', 'https://api.example#part', 'data:text/plain,foo'])('rejects unsafe configured origins %s', origin => {
    api.origin = origin; expect(() => make()).toThrow('API origin');
});
it.each(['../42', '42?foo=bar', '0'])('rejects a noncanonical page identifier %s', page => { expect(() => make(undefined, page)).toThrow('source'); });
it.each(['hash', 'width', 'height', 'byteLength', 'mimeType'])('rejects recorded %s mismatch before trusting an original', async property => {
    const { asset } = await prepareRasterAsset(png);
    const value = property === 'hash' ? 'a'.repeat(64) : property === 'mimeType' ? 'image/jpeg' : Number(asset.props[property]) + 1;
    const bad = { ...asset, props: { ...asset.props, [property]: value }, ...(property === 'hash' ? { id: `asset:sha256:${value}` as typeof asset.id } : {}) };
    const fetcher = vi.fn().mockResolvedValue(binary()); vi.stubGlobal('fetch', fetcher);
    const storage = make(); await expect(storage.download(bad, signal())).rejects.toThrow(); storage.dispose();
});
it.each([403, 404, 503, 206])('blocks migration when an original returns status %s', async status => {
    const { asset } = await prepareRasterAsset(png); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
    const storage = make(); await expect(storage.download(asset, signal())).rejects.toThrow('original whiteboard image'); storage.dispose();
});
it('rejects incorrect response MIME, oversized streams and content length before caching', async () => {
    const { asset } = await prepareRasterAsset(png);
    const fetcher = vi.fn().mockResolvedValueOnce(binary(png, { 'Content-Type': 'text/html' }))
        .mockResolvedValueOnce(binary(new Uint8Array(png.length + 1)))
        .mockResolvedValueOnce(binary(png, { 'Content-Length': '999' }))
        .mockResolvedValueOnce(binary()); vi.stubGlobal('fetch', fetcher);
    const storage = make();
    await expect(storage.download(asset, signal())).rejects.toThrow('metadata');
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    await expect(storage.download(asset, signal())).rejects.toThrow('exceeds');
    await expect(storage.download(asset, signal())).rejects.toThrow('size');
    expect((await storage.download(asset, signal())).bytes).toEqual(png); expect(fetcher).toHaveBeenCalledTimes(4); storage.dispose();
});
it('rejects metadata containing remote sources before any network access', async () => {
    const { asset } = await prepareRasterAsset(png), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const storage = make();
    await expect(storage.download({ ...asset, props: { ...asset.props, url: 'https://foreign.example/image' } }, signal())).rejects.toThrow('not allowed');
    expect(fetcher).not.toHaveBeenCalled(); storage.dispose();
});
it('aborts a stuck source fetch on session disposal and bounds a stuck transport timeout', async () => {
    vi.useFakeTimers(); const { asset } = await prepareRasterAsset(png);
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => undefined)); vi.stubGlobal('fetch', fetcher);
    const lifetime = new AbortController(), storage = make(lifetime.signal);
    const reading = storage.download(asset, signal()), cancelled = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    lifetime.abort(); await cancelled; expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    await expect(storage.download(asset, signal())).rejects.toMatchObject({ name: 'AbortError' });
    const next = make(), timed = expect(next.download(asset, signal())).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(30_001); await timed; next.dispose();
});
it('aborts an in-progress response stream and never transfers a cached image to another board', async () => {
    const { asset } = await prepareRasterAsset(png), cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(png.slice(0, 4)); }, cancel });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(stream, { headers: { 'Content-Type': 'image/png' } })).mockImplementation(async () => binary()); vi.stubGlobal('fetch', fetcher);
    const storage = make(), abort = new AbortController();
    const rejected = expect(storage.download(asset, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(stream.locked).toBe(true)); abort.abort(); await rejected; expect(cancel).toHaveBeenCalledOnce();
    await storage.download(asset, signal()); storage.dispose(); const next = make(undefined, '43'); await next.download(asset, signal());
    expect(fetcher.mock.calls.at(-1)![0]).toContain('/whiteboard-asset/43/'); next.dispose();
});
