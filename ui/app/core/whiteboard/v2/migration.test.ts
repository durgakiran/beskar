import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { webcrypto } from 'node:crypto';
import { createPublishPreview, type GlideboardHandle } from '@durgakiran/glideboard';
import { digest } from './api';
import { loadMigrationDocument, prepareMigration, type MigrationSource } from './migration';
import { uint8ArrayToBase64 } from 'app/core/utils/base64';
import { createSanitizedSvgAsset, prepareRasterAsset } from '@durgakiran/glideline';

vi.mock('@durgakiran/glideboard', () => ({ createPublishPreview: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
async function fixture() {
    vi.stubGlobal('crypto', { subtle: { digest: (algorithm: string, data: ArrayBuffer) => webcrypto.subtle.digest(algorithm, Buffer.from(new Uint8Array(data))) } });
    const doc = new Y.Doc(); doc.getMap('glideboard-meta').set('boardIdentity', 'space:42');
    const state = Y.encodeStateAsUpdate(doc); doc.destroy();
    return { contentApiVersion: 1, sourceDocId: '10', sourceFingerprint: 'fingerprint', state: uint8ArrayToBase64(state), stateDigest: await digest(state), title: 'Board', updateEncoding: 'yjs-update-v1' } satisfies MigrationSource;
}
it('verifies source bytes, changes only the detached identity and rejects corrupted input', async () => {
    const source = await fixture(); const doc = await loadMigrationDocument(source, 'space', '42');
    expect(doc.getMap('glideboard-meta').get('boardIdentity')).toBe('v2:space:42');
    await expect(loadMigrationDocument({ ...source, stateDigest: 'bad' }, 'space', '42')).rejects.toThrow('checksum');
    expect(source.stateDigest).not.toBe(await digest(Y.encodeStateAsUpdate(doc))); doc.destroy();
});
it('captures matching state and preview, releases its fence, and rejects changes during rendering', async () => {
    const source = await fixture(); const doc = await loadMigrationDocument(source, 'space', '42');
    const target = { storeRevision: 1, yjs: { transactionSequence: 1, stateDigest: await digest(Y.encodeStateAsUpdate(doc)) } };
    const release = vi.fn(); const records: unknown[] = [];
    const board = { prepareForCapture: async () => ({ release }), captureProjectionTarget: async () => target,
        checkpoints: { status: { value: 'healthy' } }, serialize: () => ({ records }) } as unknown as GlideboardHandle;
    vi.mocked(createPublishPreview).mockResolvedValue({ contentType: 'image/png', data: 'png' });
    const result = await prepareMigration(board, doc, source);
    expect(result.state).toBe(uint8ArrayToBase64(Y.encodeStateAsUpdate(doc)));
    expect(result.sourceFingerprint).toBe(source.sourceFingerprint); expect(release).toHaveBeenCalledOnce();
    records.push({ kind: 'asset' }); await expect(prepareMigration(board, doc, source)).rejects.toThrow('asset is invalid'); records.length = 0;
    records.push({ kind: 'opaque' }); await expect(prepareMigration(board, doc, source)).rejects.toThrow('cannot be rendered'); records.length = 0;
    vi.mocked(createPublishPreview).mockImplementation(async () => { doc.getMap('glideboard-meta').set('title', 'Changed'); return { contentType: 'image/png', data: 'png' }; });
    await expect(prepareMigration(board, doc, source)).rejects.toThrow('changed');
    expect(release).toHaveBeenCalledTimes(4); doc.destroy();
});

async function assetFixture() {
    const source = await fixture(), doc = await loadMigrationDocument(source, 'space', '42');
    const { asset } = await prepareRasterAsset(Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')));
    const { asset: vector } = await createSanitizedSvgAsset('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 10" /></svg>');
    const target = { storeRevision: 1, yjs: { transactionSequence: 1, stateDigest: await digest(Y.encodeStateAsUpdate(doc)) } };
    const records = [asset, vector] as unknown as Array<Record<string, unknown>>;
    const release = vi.fn(), download = vi.fn().mockResolvedValue({ bytes: new Uint8Array(), mimeType: 'image/png' });
    const ready = vi.fn().mockResolvedValue({ release });
    const board = { prepareForCapture: ready, captureProjectionTarget: async () => target, downloadAsset: download,
        checkpoints: { status: { value: 'healthy' } }, serialize: () => ({ records }) } as unknown as GlideboardHandle;
    vi.mocked(createPublishPreview).mockResolvedValue({ contentType: 'image/png', data: 'png' });
    return { source, doc, asset, vector, records, board, release, download, ready };
}
it('waits for asset readiness, verifies unreferenced raster originals and preserves inline vector assets', async () => {
    const f = await assetFixture(), abort = new AbortController();
    f.records.push({ id: 'shape:image', kind: 'shape', type: 'raster-image', props: { assetId: f.asset.id } });
    let ready!: (value: unknown) => void;
    f.ready.mockImplementationOnce(() => new Promise(resolve => { ready = resolve; }));
    const pending = prepareMigration(f.board, f.doc, f.source, abort.signal);
    expect(f.download).not.toHaveBeenCalled(); expect(createPublishPreview).not.toHaveBeenCalled();
    ready({ release: f.release });
    await pending;
    expect(f.ready).toHaveBeenCalledWith('publish', { signal: abort.signal });
    expect(f.download).toHaveBeenCalledExactlyOnceWith(f.asset.id, abort.signal, { documentId: '10' });
    expect(f.release).toHaveBeenCalledOnce(); f.doc.destroy();
});
it('stops before PNG capture when an original is missing, including unused assets', async () => {
    const f = await assetFixture(); f.download.mockRejectedValue(new Error('Original missing'));
    await expect(prepareMigration(f.board, f.doc, f.source)).rejects.toThrow('Original missing');
    expect(createPublishPreview).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledOnce(); f.doc.destroy();
});
it('rejects dangling, mismatched, unsupported and altered inline asset records', async () => {
    const f = await assetFixture();
    f.records.push({ id: 'shape:missing', kind: 'shape', type: 'raster-image', props: { assetId: 'asset:missing' } });
    await expect(prepareMigration(f.board, f.doc, f.source)).rejects.toThrow('missing its asset record'); f.records.pop();
    f.records.push({ id: 'shape:wrong', kind: 'shape', type: 'raster-image', props: { assetId: f.vector.id } });
    await expect(prepareMigration(f.board, f.doc, f.source)).rejects.toThrow('missing its asset record'); f.records.pop();
    f.records.push({ ...f.asset, type: 'external-image' });
    await expect(prepareMigration(f.board, f.doc, f.source)).rejects.toThrow('asset is invalid'); f.records.pop();
    f.records[1] = { ...f.vector, props: { ...f.vector.props, width: 11 } };
    await expect(prepareMigration(f.board, f.doc, f.source)).rejects.toThrow('vector image');
    expect(createPublishPreview).not.toHaveBeenCalled(); f.doc.destroy();
});
it('cancels after readiness and after PNG capture without returning a migration request', async () => {
    const f = await assetFixture(), first = new AbortController(); first.abort();
    await expect(prepareMigration(f.board, f.doc, f.source, first.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.ready).not.toHaveBeenCalled();
    const second = new AbortController();
    f.ready.mockImplementationOnce(async () => { second.abort(); return { release: f.release }; });
    await expect(prepareMigration(f.board, f.doc, f.source, second.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.release).toHaveBeenCalledOnce();
    const third = new AbortController();
    vi.mocked(createPublishPreview).mockImplementationOnce(async () => { third.abort(); return { contentType: 'image/png', data: 'png' }; });
    await expect(prepareMigration(f.board, f.doc, f.source, third.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.release).toHaveBeenCalledTimes(2); f.doc.destroy();
});
it('retains the dropped source guard for raster and inline vector records, while ignoring tombstones', async () => {
    const f = await assetFixture(), original = new Y.Doc();
    const live = new Y.Map(); live.set('id', f.vector.id); original.getMap('glideboard-records-v2').set(f.vector.id, live);
    const removed = new Y.Map(); removed.set('$tombstone', true); original.getMap('glideboard-records-v2').set('deleted', removed);
    f.source.state = uint8ArrayToBase64(Y.encodeStateAsUpdate(original));
    await prepareMigration(f.board, f.doc, f.source);
    f.records.splice(1, 1);
    await expect(prepareMigration(f.board, f.doc, f.source)).rejects.toThrow('were not loaded');
    original.destroy(); f.doc.destroy();
});
it('rejects an adopted empty v2 map with stale legacy records instead of silently dropping them', async () => {
    const f = await assetFixture(), original = new Y.Doc();
    original.getMap('glideboard-meta').set('schemaVersion', 2);
    original.getMap('glideboard-records').set('old', { id: 'old' });
    f.source.state = uint8ArrayToBase64(Y.encodeStateAsUpdate(original));
    await expect(prepareMigration(f.board, f.doc, f.source)).rejects.toThrow('ambiguous'); original.destroy(); f.doc.destroy();
});
it('counts both inline vectors and raster records toward the 10,000 asset limit before downloading', async () => {
    const f = await assetFixture(); f.records.splice(0, f.records.length, f.vector as unknown as Record<string, unknown>);
    for (let i = 0; i < 10_000; i++) {
        const hash = i.toString(16).padStart(64, '0');
        f.records.push({ ...f.asset, id: `asset:sha256:${hash}`, props: { ...f.asset.props, hash } });
    }
    await expect(prepareMigration(f.board, f.doc, f.source)).rejects.toThrow('10,000 assets');
    expect(f.download).not.toHaveBeenCalled(); expect(createPublishPreview).not.toHaveBeenCalled(); f.doc.destroy();
});
