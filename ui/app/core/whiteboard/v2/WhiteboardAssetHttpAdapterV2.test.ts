import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import type { GlideboardAssetStorage } from '@durgakiran/glideboard';
import { WhiteboardAssetHttpAdapterV2 } from './WhiteboardAssetHttpAdapterV2';
const api = vi.hoisted(() => ({ origin: '' }));
vi.mock('app/core/http/apiBase', () => ({ getApiOrigin: () => api.origin }));
type Asset = Parameters<GlideboardAssetStorage['prepare']>[0];
const space = '11111111-1111-4111-8111-111111111111', sourceSpace = '22222222-2222-4222-8222-222222222222';
const uploadId = '33333333-3333-4333-8333-333333333333', otherUpload = '44444444-4444-4444-8444-444444444444', version = '55555555-5555-4555-8555-555555555555';
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
const hash = createHash('sha256').update(png).digest('hex');
const base = () => `${api.origin || window.location.origin}/api/v2/editor/space/${space}/whiteboard/42`;
const descriptor = () => ({ id: `asset:sha256:${hash}`, pageId: 42, contentHash: hash, contentType: 'image/png', byteLength: png.length, width: 1, height: 1, downloadUrl: 'https://evil.example/ignored' });
const asset = (): Asset => ({ id: `asset:sha256:${hash}`, kind: 'asset', type: 'raster-image', schemaVersion: 1, props: { hash, mimeType: 'image/png', byteLength: png.length, width: 1, height: 1 }, meta: {} } as unknown as Asset);
const signal = () => new AbortController().signal;
const receipt = (state = 'prepared', id = uploadId, extra = {}) => new Response(JSON.stringify({ status: 'success', data: { uploadId: id, state, expiresAt: '2030-01-01T00:00:00Z', uploadUrl: 'https://evil.example/ignored', statusUrl: 'https://evil.example/ignored', commitUrl: 'https://evil.example/ignored', ...(state === 'committed' ? { asset: descriptor() } : {}), ...extra } }), { status: state === 'prepared' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
const failure = (status: number, code: string, retryAfter?: string) => new Response(JSON.stringify({ error: { code, message: `Safe ${code} detail` } }), { status, headers: { 'Content-Type': 'application/json', ...(retryAfter ? { 'Retry-After': retryAfter } : {}) } });
const binary = (bytes = png, headers: Record<string, string> = {}) => new Response(Uint8Array.from(bytes).buffer, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length), ETag: `"${hash}"`, ...headers } });
const make = (abort?: AbortSignal) => new WhiteboardAssetHttpAdapterV2({ spaceId: space, pageId: '42', signal: abort });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const embedded = () => ({ assetId: asset().id, kind: 'embedded' as const, byteLength: png.length, base64: Buffer.from(png).toString('base64') });
beforeEach(() => { api.origin = ''; vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('uploads immutable bytes, verifies commit, builds URLs locally and retains committed bytes', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(receipt()).mockResolvedValueOnce(receipt('staged')).mockResolvedValueOnce(receipt('committed'));
    vi.stubGlobal('fetch', fetcher);
    const adapter = make(), transaction = await adapter.prepare(asset(), signal());
    expect(adapter.commitOrder).toBe('before-document'); expect(transaction.token).toBe(uploadId);
    const mutable = Uint8Array.from(png), progress = vi.fn(), staging = transaction.stage(mutable, signal(), progress);
    mutable.fill(0); await staging; await transaction.commit(signal()); await transaction.rollback(); await adapter.dispose();
    expect(fetcher.mock.calls.map(c => c[0])).toEqual([`${base()}/assets/uploads`, `${base()}/assets/uploads/${uploadId}/content`, `${base()}/assets/uploads/${uploadId}/commit`]);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ contentHash: hash, contentType: 'image/png', byteLength: png.length });
    expect(fetcher.mock.calls[0][1].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Uint8Array(fetcher.mock.calls[1][1].body)).toEqual(png); expect(progress.mock.calls).toEqual([[0], [1]]);
    for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({ credentials: 'include', redirect: 'error', cache: 'no-store' });
});
it('reuses exact prepare key/body after a lost acknowledgement and after bounded explicit retry', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('offline')); vi.stubGlobal('fetch', fetcher);
    const adapter = make(); await expect(adapter.prepare(asset(), signal())).rejects.toMatchObject({ category: 'network', retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(3); fetcher.mockResolvedValueOnce(receipt()); await adapter.prepare(asset(), signal());
    for (const call of fetcher.mock.calls) { expect(call[1].body).toBe(fetcher.mock.calls[0][1].body); expect(call[1].headers).toEqual(fetcher.mock.calls[0][1].headers); }
});
it('retries staging the identical body after a transient error', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(receipt()).mockResolvedValueOnce(failure(503, 'ASSET_UPLOAD_BUSY', '0')).mockResolvedValueOnce(receipt('staged')); vi.stubGlobal('fetch', fetcher);
    const transaction = await make().prepare(asset(), signal()); await transaction.stage(png, signal());
    expect(fetcher.mock.calls[1][0]).toBe(fetcher.mock.calls[2][0]); expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[2][1].body);
});
it('resolves a lost commit from status without another commit or cancellation', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(receipt()).mockRejectedValueOnce(new TypeError('lost')).mockResolvedValueOnce(receipt('committed')); vi.stubGlobal('fetch', fetcher);
    const adapter = make(), transaction = await adapter.prepare(asset(), signal()); await transaction.commit(signal()); await transaction.rollback(); await adapter.dispose();
    expect(fetcher.mock.calls.map(c => c[1].method)).toEqual(['POST', 'POST', 'GET']);
});
it('retries commit with the same session after status says staged', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(receipt()).mockResolvedValueOnce(failure(503, 'ASSET_UPLOAD_BUSY', '0')).mockResolvedValueOnce(receipt('staged')).mockResolvedValueOnce(receipt('committed')); vi.stubGlobal('fetch', fetcher);
    const transaction = await make().prepare(asset(), signal()); await transaction.commit(signal());
    expect(fetcher.mock.calls.map(c => c[1].method)).toEqual(['POST', 'POST', 'GET', 'POST']); expect(fetcher.mock.calls[1][0]).toBe(fetcher.mock.calls[3][0]);
});
it.each([[403, 'WHITEBOARD_FORBIDDEN', 'permission', undefined], [409, 'ASSET_QUOTA_EXCEEDED', 'limit-exceeded', undefined], [429, 'RATE_LIMITED', 'rate-limit', '60']] as const)('does not retry permanent or long backoff status %s', async (status, code, category, retryAfter) => {
    const fetcher = vi.fn().mockResolvedValue(failure(status, code, retryAfter)); vi.stubGlobal('fetch', fetcher);
    await expect(make().prepare(asset(), signal())).rejects.toMatchObject({ category, code, status }); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('gives simultaneous identical imports independent sessions so one cancellation cannot affect the other', async () => {
    const first = deferred<Response>(), second = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValueOnce(receipt('cancelled')).mockResolvedValueOnce(receipt('committed', otherUpload)); vi.stubGlobal('fetch', fetcher);
    const adapter = make(), a = adapter.prepare(asset(), signal()), b = adapter.prepare(asset(), signal());
    expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls[0][1].headers['Idempotency-Key']).not.toBe(fetcher.mock.calls[1][1].headers['Idempotency-Key']);
    first.resolve(receipt()); second.resolve(receipt('prepared', otherUpload)); const [left, right] = await Promise.all([a, b]);
    await left.rollback(); await right.commit(signal()); expect(fetcher.mock.calls[2][0]).toBe(`${base()}/assets/uploads/${uploadId}`); expect(fetcher.mock.calls[3][0]).toBe(`${base()}/assets/uploads/${otherUpload}/commit`);
});
it('does not discard a sibling unresolved prepare when an older upload is cancelled', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(receipt()).mockRejectedValue(new TypeError('offline')); vi.stubGlobal('fetch', fetcher);
    const adapter = make(), first = await adapter.prepare(asset(), signal()); await expect(adapter.prepare(asset(), signal())).rejects.toMatchObject({ retryable: true });
    const retryKey = fetcher.mock.calls[1][1].headers['Idempotency-Key']; fetcher.mockResolvedValueOnce(receipt('cancelled')).mockResolvedValueOnce(receipt('prepared', otherUpload));
    await first.rollback(); await adapter.prepare(asset(), signal()); expect(fetcher.mock.calls.at(-1)![1].headers['Idempotency-Key']).toBe(retryKey);
});
it('uses a fresh cleanup signal after aborted commit, preserving a server commit that won', async () => {
    const pending = deferred<Response>(); const fetcher = vi.fn().mockResolvedValueOnce(receipt()).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(receipt('committed', uploadId, { retained: true })); vi.stubGlobal('fetch', fetcher);
    const adapter = make(), transaction = await adapter.prepare(asset(), signal()), abort = new AbortController();
    const committing = transaction.commit(abort.signal), rejected = expect(committing).rejects.toMatchObject({ name: 'AbortError' }); abort.abort(); await rejected; await transaction.rollback();
    expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true); expect(fetcher.mock.calls[2][1].signal.aborted).toBe(false); expect(fetcher.mock.calls[2][1].method).toBe('DELETE');
    await transaction.rollback(); await adapter.dispose(); expect(fetcher).toHaveBeenCalledTimes(3); pending.resolve(receipt('committed'));
});
it('recovers aborted prepare with the original key before cancelling an unknown session', async () => {
    const pending = deferred<Response>(); const fetcher = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(receipt()).mockResolvedValueOnce(receipt('cancelled')); vi.stubGlobal('fetch', fetcher);
    const abort = new AbortController(), adapter = make(), preparing = adapter.prepare(asset(), abort.signal), rejected = expect(preparing).rejects.toMatchObject({ name: 'AbortError' }); abort.abort(); await rejected;
    expect(fetcher.mock.calls.map(c => c[1].method)).toEqual(['POST', 'POST', 'DELETE']); expect(fetcher.mock.calls[0][1].headers).toEqual(fetcher.mock.calls[1][1].headers); expect(fetcher.mock.calls[1][1].signal.aborted).toBe(false); pending.resolve(receipt());
});
it('bounds disposal cleanup even when the transport never settles and rejects future ingress', async () => {
    vi.useFakeTimers(); const fetcher = vi.fn().mockResolvedValueOnce(receipt()).mockImplementation(() => new Promise(() => undefined)); vi.stubGlobal('fetch', fetcher);
    const lifetime = new AbortController(), adapter = make(lifetime.signal); await adapter.prepare(asset(), signal()); lifetime.abort(); const disposal = adapter.dispose();
    await vi.advanceTimersByTimeAsync(16_000); await expect(disposal).resolves.toBeUndefined(); expect(adapter.resolve(asset())).toBeNull(); await expect(adapter.prepare(asset(), signal())).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher.mock.calls.filter(c => c[1].method === 'DELETE').length).toBeLessThanOrEqual(3);
});
it.each(['pageId', 'id', 'contentHash', 'contentType', 'byteLength', 'width', 'height'])('rejects committed metadata mismatch in %s', async key => {
    const bad = { ...descriptor(), [key]: ['pageId', 'byteLength', 'width', 'height'].includes(key) ? 999 : 'invalid' };
    const fetcher = vi.fn().mockResolvedValueOnce(receipt()).mockResolvedValueOnce(receipt('committed', uploadId, { asset: bad })); vi.stubGlobal('fetch', fetcher);
    const transaction = await make().prepare(asset(), signal()); await expect(transaction.commit(signal())).rejects.toMatchObject({ category: 'invalid-content', retryable: false }); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('rejects byte mutation before PUT and wrong session receipts', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(receipt()).mockResolvedValueOnce(receipt('committed', otherUpload)); vi.stubGlobal('fetch', fetcher);
    const transaction = await make().prepare(asset(), signal()), corrupt = Uint8Array.from(png); corrupt[20] ^= 1;
    await expect(transaction.stage(corrupt, signal())).rejects.toThrow('hash'); expect(fetcher).toHaveBeenCalledTimes(1); await expect(transaction.commit(signal())).rejects.toThrow('ownership');
});
it('resolves current/exact published assets while rejecting foreign or incomplete contexts', async () => {
    const adapter = make(), context = { documentId: `v2:${space}:42`, versionId: version };
    expect(adapter.resolve(asset())).toBe(`${base()}/assets/${hash}/content`); expect(adapter.resolve(asset(), context)).toBe(`${base()}/published/${version}/assets/${hash}/content`);
    expect(adapter.resolve(asset(), { documentId: `v2:${sourceSpace}:42` })).toBeNull(); expect(adapter.resolve(asset(), { snapshotId: version })).toBeNull(); expect(adapter.resolve(asset(), { versionId: 'invalid' })).toBeNull();
    const fetcher = vi.fn().mockResolvedValue(binary()); vi.stubGlobal('fetch', fetcher); expect((await adapter.download(asset(), signal(), context)).bytes).toEqual(png); expect(fetcher.mock.calls[0][0]).toBe(`${base()}/published/${version}/assets/${hash}/content`);
});
it('checks authenticated exact-version membership before releasing portable references', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(png.length), ETag: `"${hash}"` } })); vi.stubGlobal('fetch', fetcher);
    const adapter = make(); await adapter.retainReferences([asset().id, asset().id], { documentId: `v2:${space}:42`, versionId: version }, signal()); expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1].method).toBe('HEAD'); expect(fetcher.mock.calls[0][0]).toContain(`/published/${version}/assets/`);
    fetcher.mockResolvedValue(failure(404, 'ASSET_NOT_FOUND')); await expect(adapter.retainReferences([asset().id], undefined, signal())).rejects.toMatchObject({ status: 404 });
});
it.each([{ 'Content-Type': 'text/html' }, { 'Content-Length': '999999999' }])('rejects mismatched download headers %j', async headers => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(binary(png, headers))); await expect(make().download(asset(), signal())).rejects.toMatchObject({ category: 'invalid-content' });
});
it('rejects a downloaded hash mismatch', async () => {
    const corrupt = Uint8Array.from(png); corrupt[20] ^= 1; vi.stubGlobal('fetch', vi.fn().mockResolvedValue(binary(corrupt))); await expect(make().download(asset(), signal())).rejects.toThrow('hash');
});
it('commits portable embedded bytes to the destination and retains them on record rollback', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(receipt()).mockResolvedValueOnce(receipt('staged')).mockResolvedValueOnce(receipt('committed')); vi.stubGlobal('fetch', fetcher);
    const result = await make().materializePortableAsset(embedded(), asset(), { documentId: `v2:${sourceSpace}:91`, versionId: version }, signal()); await result.rollback();
    expect(fetcher.mock.calls.map(c => c[1].method)).toEqual(['POST', 'PUT', 'POST']); expect(fetcher.mock.calls.every(c => c[0].startsWith(base()))).toBe(true);
});
it('copies an authorized source version on the configured API origin into the destination', async () => {
    api.origin = 'https://api.example.test'; const source = `${api.origin}/api/v2/editor/space/${sourceSpace}/whiteboard/91/published/${version}/assets/${hash}/content`;
    const fetcher = vi.fn().mockResolvedValueOnce(binary()).mockResolvedValueOnce(receipt()).mockResolvedValueOnce(receipt('staged')).mockResolvedValueOnce(receipt('committed')); vi.stubGlobal('fetch', fetcher);
    await make().materializePortableAsset({ kind: 'durable-reference', assetId: asset().id, reference: source }, asset(), { documentId: `v2:${sourceSpace}:91`, versionId: version }, signal());
    expect(fetcher.mock.calls[0][0]).toBe(source); expect(fetcher.mock.calls.slice(1).every(c => c[0].startsWith(base()))).toBe(true); expect(fetcher.mock.calls.every(c => c[1].credentials === 'include' && c[1].redirect === 'error')).toBe(true);
});
it('supports only the exact trusted v1 source route', async () => {
    const source = `${window.location.origin}/api/v1/media/whiteboard-asset/91/${hash}`;
    const fetcher = vi.fn().mockResolvedValueOnce(binary()).mockResolvedValueOnce(receipt()).mockResolvedValueOnce(receipt('staged')).mockResolvedValueOnce(receipt('committed')); vi.stubGlobal('fetch', fetcher);
    await make().materializePortableAsset({ kind: 'durable-reference', assetId: asset().id, reference: source }, asset(), undefined, signal()); expect(fetcher.mock.calls[0][0]).toBe(source);
});
it.each([
    'https://evil.example/api/v2/editor/space/SPACE/whiteboard/91/assets/HASH/content',
    'https://user:password@localhost/api/v2/editor/space/SPACE/whiteboard/91/assets/HASH/content',
    '/api/v2/editor/space/SPACE/whiteboard/91/assets/HASH/content?token=x',
    '/api/v2/editor/space/SPACE/whiteboard/91/assets/HASH/content#fragment',
    '/api/v2/editor/space/SPACE/whiteboard/91/assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/content',
    '/api/v2/editor/space/SPACE/whiteboard/91/assets/HASH/../HASH/content',
    '/api/v2/editor/space/SPACE/whiteboard/91/assets/%61/content',
    '/api/v2/editor/space/SPACE/whiteboard/91/assets/uploads',
    '/api/v1/media/whiteboard-asset/91/HASH/staging', '//localhost/api/v1/media/whiteboard-asset/91/HASH', 'data:image/png;base64,AAAA', 'blob:https://localhost/image',
])('rejects untrusted source %s before fetching', async source => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const reference = source.split('SPACE').join(sourceSpace).split('HASH').join(hash);
    await expect(make().materializePortableAsset({ kind: 'durable-reference', assetId: asset().id, reference }, asset(), undefined, signal())).rejects.toMatchObject({ category: 'invalid-content' }); expect(fetcher).not.toHaveBeenCalled();
});
it('rejects source-version mismatch and malformed embedded data before destination prepare', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const adapter = make(), source = `/api/v2/editor/space/${sourceSpace}/whiteboard/91/assets/${hash}/content`;
    await expect(adapter.materializePortableAsset({ kind: 'durable-reference', assetId: asset().id, reference: source }, asset(), { documentId: `v2:${sourceSpace}:91`, versionId: version }, signal())).rejects.toThrow('published context');
    for (const payload of [{ ...embedded(), base64: '%%%%' }, { ...embedded(), assetId: 'asset:wrong' }, { ...embedded(), byteLength: png.length + 1 }]) await expect(adapter.materializePortableAsset(payload, asset(), undefined, signal())).rejects.toMatchObject({ category: 'invalid-content' }); expect(fetcher).not.toHaveBeenCalled();
});

it('validates maximum-size embedded images without overflowing the regular-expression stack', async () => {
    const bytes = new Uint8Array(20 * 1024 * 1024); bytes.set(png);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const large = asset(); large.props = { ...large.props, hash: digest, byteLength: bytes.length };
    const record = { ...large, id: `asset:sha256:${digest}` } as unknown as Asset;
    const fetcher = vi.fn().mockResolvedValue(failure(403, 'WHITEBOARD_FORBIDDEN')); vi.stubGlobal('fetch', fetcher);
    await expect(make().materializePortableAsset({ kind: 'embedded', assetId: record.id, byteLength: bytes.length, base64: Buffer.from(bytes).toString('base64') }, record, undefined, signal())).rejects.toMatchObject({ status: 403, category: 'permission' });
    expect(fetcher).toHaveBeenCalledTimes(1);
});
