import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import * as Y from 'yjs';
import { GlideboardController } from '@durgakiran/glideboard';
import { base64ToUint8Array } from 'app/core/utils/base64';
import { IncrementalCheckpointSession, SERVER_REPLAY_ORIGIN } from './IncrementalCheckpointSession';
import { CHECKPOINT_MAX_BYTES, encodeCheckpointBatch, type CheckpointEncodingRequest } from './encodeCheckpointBatch';
import type { RecoveryJournal, JournalUpdate } from './IncrementalRecoveryJournal';
import { jsonRequest, postJsonBody } from './api';
import { MAX_ASSEMBLED_CHECKPOINT_BYTES } from './uploadCheckpoint';

vi.mock('./api', async importOriginal => ({
    ...await importOriginal<typeof import('./api')>(), postJsonBody: vi.fn(), jsonRequest: vi.fn(),
}));

function open(recovered: JournalUpdate[] = [], journal?: RecoveryJournal) {
    const doc = new Y.Doc();
    for (const row of recovered) Y.applyUpdate(doc, row.bytes);
    let id = 0;
    const storage = journal ?? {
        read: vi.fn(async () => recovered),
        append: vi.fn(async () => ++id),
        prepare: vi.fn(async () => {}),
        acknowledge: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
    };
    const session = new IncrementalCheckpointSession({
        doc, base: '/board', draftId: '7', restoreGeneration: '2', durableRevision: '0',
        journal: storage, recovered, signal: new AbortController().signal, onSaved: vi.fn(),
    });
    session.attach({ subscribe: () => () => {}, captureTarget: vi.fn() });
    return { doc, session, journal: storage };
}

function updateBody(call: number): Uint8Array {
    const body = JSON.parse(vi.mocked(postJsonBody).mock.calls[call]![1]) as { update: string };
    return base64ToUint8Array(body.update);
}

function checkpointBackend(interruptOffset: number) {
    vi.stubGlobal('crypto', webcrypto);
    const doc = new Y.Doc();
    let sequence = 0;
    const uploads = new Map<string, { bytes: Uint8Array; offset: number; receipt?: { pageId: number; sequence: string } }>();
    const offsets: number[] = [];
    const save = (bytes: Uint8Array) => {
        Y.applyUpdate(doc, bytes);
        return { pageId: 7, sequence: String(++sequence) };
    };
    vi.mocked(postJsonBody).mockImplementation(async (_url, body) => save(base64ToUint8Array(JSON.parse(body).update)));
    vi.mocked(jsonRequest).mockImplementation(async (url, init) => {
        const target = new URL(url, 'https://example.test');
        const id = target.pathname.split('/').at(-1)!;
        let upload = uploads.get(id);
        if (!upload) {
            upload = { bytes: new Uint8Array(Number(target.searchParams.get('size'))), offset: 0 };
            uploads.set(id, upload);
        }
        if (init?.method === 'PUT') {
            const offset = Number(target.searchParams.get('offset'));
            const bytes = init.body as Uint8Array;
            expect(offset).toBe(upload.offset);
            expect(bytes.byteLength).toBeLessThanOrEqual(CHECKPOINT_MAX_BYTES);
            upload.bytes.set(bytes, offset);
            upload.offset += bytes.byteLength;
            offsets.push(offset);
            if (upload.offset === upload.bytes.byteLength) upload.receipt = save(upload.bytes);
            if (offset === interruptOffset) {
                interruptOffset = -1;
                throw new TypeError('Connection lost after storing chunk');
            }
        }
        return { nextOffset: upload.offset, receipt: upload.receipt };
    });
    return { doc, offsets, uploads };
}

describe('IncrementalCheckpointSession', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.resetAllMocks();
    });

    it('sends worker-encoded JSON and journals the same merged bytes before the request', async () => {
        const terminate = vi.fn();
        const encode = vi.fn(encodeCheckpointBatch);
        vi.stubGlobal('Worker', class extends EventTarget {
            postMessage(request: CheckpointEncodingRequest) {
                const result = encode(request.updates, request.restoreGeneration);
                queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { result } })));
            }
            terminate = terminate;
        });
        vi.mocked(postJsonBody).mockResolvedValue({ pageId: 7, sequence: '1' });
        const { doc, session, journal } = open();
        const board = doc.getMap('records');
        board.set('first', true);
        board.set('second', true);
        await session.flush();

        expect(encode).toHaveBeenCalledWith([expect.any(Uint8Array), expect.any(Uint8Array)], '2');
        const encoded = encode.mock.results[0]!.value!;
        expect(journal.prepare).toHaveBeenCalledWith([1, 2], encoded.bytes, expect.any(String));
        expect(vi.mocked(journal.prepare).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(postJsonBody).mock.invocationCallOrder[0]!);
        expect(vi.mocked(postJsonBody).mock.calls[0]![1]).toBe(encoded.body);
        expect(updateBody(0)).toEqual(encoded.bytes);
        await session.dispose();
        expect(terminate).toHaveBeenCalledTimes(1);
        doc.destroy();
    });

    it('keeps saving if the worker cannot load', async () => {
        vi.stubGlobal('Worker', class extends EventTarget {
            postMessage() { queueMicrotask(() => this.dispatchEvent(new Event('error'))); }
            terminate() {}
        });
        vi.mocked(postJsonBody).mockResolvedValue({ pageId: 7, sequence: '1' });
        const { doc, session } = open();
        doc.getMap('records').set('first', true);
        await session.flush();
        expect(postJsonBody).toHaveBeenCalledTimes(1);
        expect(session.getSnapshot().phase).toBe('clean');
        await session.dispose();
        doc.destroy();
    });

    it('resumes a large Glideboard edit at the next chunk, saves later edits, and preserves one-step undo', async () => {
        const backend = checkpointBackend(0);
        const { doc, session } = open();
        const board = new GlideboardController({ sessionKey: 'large-edit-test' });
        const detach = board.attachCollaboration({ doc });
        try {
            await session.flush();
            const editor = board.editor;
            const shape = (x: number) => ({ type: 'box', x, y: 0 });
            editor.batch('Paste shapes', () => {
                for (let i = 0; i < 25; i++) {
                    editor.createShape({ ...shape(i), meta: { note: String(i) + 'x'.repeat(48 * 1024) } });
                }
            });
            expect(editor.history.undoStack).toHaveLength(1);
            await expect(session.flush()).rejects.toThrow('Connection lost');
            expect(backend.offsets).toEqual([0]);
            const serverRecords = backend.doc.getMap<Y.Map<unknown>>('glideboard-records-v2');
            const serverShapes = () => [...serverRecords.values()]
                .filter(record => record.get('kind') === 'shape' && record.get('$tombstone') !== true);
            expect(serverShapes()).toHaveLength(0);

            editor.setCurrentTool('draw');
            editor.dispatchEvent({ type: 'pointerDown', point: { x: 100, y: 20 }, shiftKey: false, target: 'canvas' });
            editor.dispatchEvent({ type: 'pointerMove', point: { x: 110, y: 30 } });
            editor.dispatchEvent({ type: 'pointerUp', point: { x: 120, y: 40 } });
            await session.flush();
            expect(backend.offsets).toEqual([0, CHECKPOINT_MAX_BYTES]);
            expect(backend.uploads.size).toBe(1);
            expect(serverShapes()).toHaveLength(26);
            expect(session.getSnapshot().phase).toBe('clean');

            editor.undo();
            expect(editor.getShapes()).toHaveLength(25);
            editor.undo();
            expect(editor.getShapes()).toHaveLength(0);
            await session.flush();
            expect(serverShapes()).toHaveLength(0);
        } finally {
            await session.dispose();
            detach();
            await board.dispose();
            doc.destroy();
            backend.doc.destroy();
        }
    });

    it.each([
        { description: 'a stored first chunk', offset: 0, sentBeforeReload: [0] },
        { description: 'a lost final acknowledgement', offset: CHECKPOINT_MAX_BYTES, sentBeforeReload: [0, CHECKPOINT_MAX_BYTES] },
    ])('recovers $description after reopening without resending stored chunks', async ({ offset, sentBeforeReload }) => {
        const backend = checkpointBackend(offset);
        const { doc, session, journal } = open();
        doc.getMap('records').set('large', new Uint8Array(CHECKPOINT_MAX_BYTES + 1));
        await expect(session.flush()).rejects.toThrow('Connection lost');
        const [, bytes, requestId] = vi.mocked(journal.prepare).mock.calls[0]!;
        expect(journal.acknowledge).not.toHaveBeenCalled();
        expect(backend.offsets).toEqual(sentBeforeReload);
        doc.getMap('records').set('later', 'still saved');
        const [later] = vi.mocked(journal.append).mock.calls[1]!;
        await session.dispose();
        doc.destroy();

        const reopened = open([{ id: 1, bytes, requestId }, { id: 2, bytes: later }]);
        await reopened.session.flush();
        expect(backend.offsets).toEqual([0, CHECKPOINT_MAX_BYTES]);
        expect(reopened.journal.acknowledge).toHaveBeenCalledTimes(2);
        expect(reopened.journal.acknowledge).toHaveBeenCalledWith(requestId);
        expect(reopened.doc.getMap('records').get('large')).toEqual(backend.doc.getMap('records').get('large'));
        expect(backend.doc.getMap('records').get('later')).toBe('still saved');
        await reopened.session.dispose();
        reopened.doc.destroy();
        backend.doc.destroy();
    });

    it('saves every five seconds during continuous editing and skips empty windows', async () => {
        vi.useFakeTimers();
        const { doc, session, journal } = open();
        vi.mocked(postJsonBody).mockResolvedValue({ pageId: 7, sequence: '1' });
        const board = doc.getMap('records');
        for (let window = 0; window < 2; window++) {
            for (let edit = 0; edit < 3; edit++) {
                if (edit > 0) await vi.advanceTimersByTimeAsync(2000);
                board.set(`${window}:${edit}`, true);
                await session.retryPending();
                expect(postJsonBody).toHaveBeenCalledTimes(window);
            }
            expect(journal.append).toHaveBeenCalledTimes((window + 1) * 3);
            await vi.advanceTimersByTimeAsync(999);
            expect(postJsonBody).toHaveBeenCalledTimes(window);
            await vi.advanceTimersByTimeAsync(1);
            expect(postJsonBody).toHaveBeenCalledTimes(window + 1);
        }
        await vi.advanceTimersByTimeAsync(10000);
        expect(postJsonBody).toHaveBeenCalledTimes(2);
        expect(vi.mocked(journal.prepare).mock.calls.map(([ids]) => ids)).toEqual([[1, 2, 3], [4, 5, 6]]);
        expect(session.getSnapshot().phase).toBe('clean');
        await session.dispose();
        doc.destroy();
    });

    it('runs an elapsed save window after the previous request completes', async () => {
        vi.useFakeTimers();
        const { doc, session } = open();
        let finishFirstSave!: (receipt: { pageId: number; sequence: string }) => void;
        const firstSave = new Promise<{ pageId: number; sequence: string }>(resolve => { finishFirstSave = resolve; });
        vi.mocked(postJsonBody).mockReturnValueOnce(firstSave).mockResolvedValueOnce({ pageId: 7, sequence: '2' });
        const board = doc.getMap('records');
        board.set('first', true);
        await vi.advanceTimersByTimeAsync(5000);
        expect(postJsonBody).toHaveBeenCalledTimes(1);

        board.set('second', true);
        await vi.advanceTimersByTimeAsync(6000);
        expect(postJsonBody).toHaveBeenCalledTimes(1);
        finishFirstSave({ pageId: 7, sequence: '1' });
        await vi.advanceTimersByTimeAsync(1);
        expect(postJsonBody).toHaveBeenCalledTimes(2);
        expect(session.getSnapshot().phase).toBe('clean');
        await session.dispose();
        doc.destroy();
    });

    it('journals transaction updates and sends a backlog across ordered bounded requests', async () => {
        const { doc, session, journal } = open();
        vi.mocked(postJsonBody).mockResolvedValue({ pageId: 7, sequence: '1' });
        const board = doc.getMap('records');
        for (let i = 0; i < 3; i++) board.set(String(i), new Uint8Array(450 * 1024));
        expect(journal.append).toHaveBeenCalledTimes(3);
        await session.flush();

        expect(postJsonBody).toHaveBeenCalledTimes(2);
        expect(vi.mocked(journal.prepare).mock.calls.map(([ids]) => ids)).toEqual([[1, 2], [3]]);
        expect(journal.acknowledge).toHaveBeenCalledTimes(2);
        const saved = new Y.Doc();
        for (const i of [0, 1]) {
            const update = updateBody(i);
            expect(update.length).toBeLessThanOrEqual(CHECKPOINT_MAX_BYTES);
            Y.applyUpdate(saved, update);
            expect(saved.store.pendingStructs).toBeNull();
        }
        expect(saved.getMap('records').size).toBe(3);
        expect(session.getSnapshot().phase).toBe('clean');
        await session.dispose();
        saved.destroy();
        doc.destroy();
    });

    it('replays an immutable prepared batch after restart and keeps the same bytes and request ID on retry', async () => {
        const prior = new Y.Doc();
        prior.getMap('records').set('recovered', true);
        const bytes = Y.encodeStateAsUpdate(prior);
        const { doc, session, journal } = open([{ id: 33, bytes, requestId: 'prior-request' }]);
        vi.mocked(postJsonBody).mockRejectedValueOnce(new Error('lost acknowledgement'))
            .mockResolvedValueOnce({ pageId: 7, sequence: '4' });
        await expect(session.flush()).rejects.toThrow('lost acknowledgement');
        expect(journal.acknowledge).not.toHaveBeenCalled();
        await session.flush();
        expect(journal.prepare).not.toHaveBeenCalled();
        expect(journal.acknowledge).toHaveBeenCalledWith('prior-request');
        for (const [i, args] of vi.mocked(postJsonBody).mock.calls.entries()) {
            expect(args[2]).toBe('prior-request');
            expect(updateBody(i)).toEqual(bytes);
        }
        expect(doc.getMap('records').get('recovered')).toBe(true);
        await session.dispose();
        prior.destroy();
        doc.destroy();
    });

    it('does not journal verified server replay and keeps an oversized atomic update recoverable', async () => {
        const { doc, session, journal } = open();
        const remote = new Y.Doc();
        remote.getMap('records').set('server', true);
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), SERVER_REPLAY_ORIGIN);
        expect(journal.append).not.toHaveBeenCalled();

        doc.getMap('records').set('oversize', new Uint8Array(MAX_ASSEMBLED_CHECKPOINT_BYTES + 1));
        await expect(session.flush()).rejects.toThrow('remains in local recovery');
        expect(journal.append).toHaveBeenCalledTimes(1);
        expect(postJsonBody).not.toHaveBeenCalled();
        expect(journal.acknowledge).not.toHaveBeenCalled();
        await session.dispose();
        remote.destroy();
        doc.destroy();
    });
});
