import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import * as Y from 'yjs';
import { loadDraft } from './replay';
import { CheckpointAdapter } from './CheckpointAdapter';
import { digest, sequence } from './api';
import { base64ToUint8Array, uint8ArrayToBase64 } from 'app/core/utils/base64';
const base = '/api/v2/editor/space/space/whiteboard/42';
const response = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
    const doc = new Y.Doc();
    const initial = Y.encodeStateAsUpdate(doc);
    const vector = Y.encodeStateVector(doc);
    doc.getMap('records').set('box', { x: 20 });
    const update = Y.encodeStateAsUpdate(doc, vector);
    const manifest = { pageId: 42, spaceId: 'space', title: 'Board', headSequence: '1', baseSnapshot: { id: 'snapshot', throughSequence: '0', updateEncoding: 'yjs-update-v1', byteLength: initial.length, stateDigest: await digest(initial), downloadUrl: base + '/snapshots/s/content' }, updatesUrl: base + '/draft/updates?cursor=first' };
    return { doc, initial, update, manifest };
}
it('verifies and replays the complete draft', async () => {
    const f = await fixture();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(f.manifest)).mockResolvedValueOnce(new Response(Uint8Array.from(f.initial).buffer)).mockResolvedValueOnce(response({ headSequence: '1', updates: [{ sequence: '1', updateEncoding: 'yjs-update-v1', update: uint8ArrayToBase64(f.update) }], complete: true, nextCursor: null })));
    const result = await loadDraft(base);
    const replay = new Y.Doc(); Y.applyUpdate(replay, result.state);
    expect(replay.getMap('records').get('box')).toEqual({ x: 20 });
    replay.destroy(); f.doc.destroy();
});
it('rejects corrupt snapshot bytes before applying updates', async () => {
    const f = await fixture();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(f.manifest)).mockResolvedValueOnce(new Response(new Uint8Array([1, 2]))));
    await expect(loadDraft(base)).rejects.toThrow('verification'); f.doc.destroy();
});
it('rejects sequence gaps and truncated replay', async () => {
    const f = await fixture();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(f.manifest)).mockResolvedValueOnce(new Response(Uint8Array.from(f.initial).buffer)).mockResolvedValueOnce(response({ headSequence: '1', updates: [], complete: true, nextCursor: null })));
    await expect(loadDraft(base)).rejects.toThrow('Incomplete'); f.doc.destroy();
});
it('retains the exact checkpoint body and key after a lost acknowledgement, then sends an incremental edit', async () => {
    const f = await fixture(); const adapter = new CheckpointAdapter(base, f.initial, '7');
    const state = Y.encodeStateAsUpdate(f.doc);
    const request = { sessionKey: 's', draftId: '42', generation: 1, clientId: 'c', expectedDurableRevision: '0', requestId: 'key1', signal: new AbortController().signal, encodedState: state, target: { storeRevision: 1, yjs: { transactionSequence: 1, stateDigest: await digest(state) } } };
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('connection lost')).mockResolvedValueOnce(response({ pageId: 42, sequence: '9007199254740993' })).mockResolvedValueOnce(response({ pageId: 42, sequence: '9007199254740994' }));
    vi.stubGlobal('fetch', fetcher);
    await expect(adapter.save(request)).rejects.toThrow('connection lost');
    expect((await adapter.save(request)).durableRevision).toBe('9007199254740993');
    expect(JSON.parse(fetcher.mock.calls[0][1].body).restoreGeneration).toBe('7');
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(fetcher.mock.calls[0][1].headers).toEqual(fetcher.mock.calls[1][1].headers);
    f.doc.getMap('records').delete('box');
    await adapter.save({ ...request, requestId: 'key2', encodedState: Y.encodeStateAsUpdate(f.doc) });
    const server = new Y.Doc();
    for (const i of [1, 2]) Y.applyUpdate(server, base64ToUint8Array(JSON.parse(fetcher.mock.calls[i][1].body).update));
    expect(server.getMap('records').has('box')).toBe(false);
    expect(sequence('9007199254740994')).toBe(9007199254740994n);
    server.destroy(); f.doc.destroy();
});
