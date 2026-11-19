import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { base64ToUint8Array } from 'app/core/utils/base64';
import { CHECKPOINT_MAX_BYTES, IncrementalCheckpointSession, SERVER_REPLAY_ORIGIN } from './IncrementalCheckpointSession';
import type { RecoveryJournal, JournalUpdate } from './IncrementalRecoveryJournal';
import { post } from './api';

vi.mock('./api', async importOriginal => ({ ...await importOriginal<typeof import('./api')>(), post: vi.fn() }));

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
    const body = vi.mocked(post).mock.calls[call]![1] as { update: string };
    return base64ToUint8Array(body.update);
}

describe('IncrementalCheckpointSession', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.resetAllMocks();
    });

    it('journals every edit and waits for five uninterrupted seconds before saving', async () => {
        vi.useFakeTimers();
        const { doc, session, journal } = open();
        vi.mocked(post).mockResolvedValue({ pageId: 7, sequence: '1' });
        const board = doc.getMap('records');
        for (let i = 0; i < 4; i++) {
            if (i > 0) await vi.advanceTimersByTimeAsync(4000);
            board.set(String(i), true);
            await session.retryPending();
            expect(post).not.toHaveBeenCalled();
        }
        expect(journal.append).toHaveBeenCalledTimes(4);
        await vi.advanceTimersByTimeAsync(4999);
        expect(post).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(post).toHaveBeenCalledTimes(1);
        expect(journal.prepare).toHaveBeenCalledWith([1, 2, 3, 4], expect.any(Uint8Array), expect.any(String));
        expect(session.getSnapshot().phase).toBe('clean');
        await session.dispose();
        doc.destroy();
    });

    it('waits for inactivity after an edit made during an in-flight save', async () => {
        vi.useFakeTimers();
        const { doc, session } = open();
        let finishFirstSave!: (receipt: { pageId: number; sequence: string }) => void;
        const firstSave = new Promise<{ pageId: number; sequence: string }>(resolve => { finishFirstSave = resolve; });
        vi.mocked(post).mockReturnValueOnce(firstSave).mockResolvedValueOnce({ pageId: 7, sequence: '2' });
        const board = doc.getMap('records');
        board.set('first', true);
        await vi.advanceTimersByTimeAsync(5000);
        expect(post).toHaveBeenCalledTimes(1);

        board.set('second', true);
        await vi.advanceTimersByTimeAsync(2000);
        finishFirstSave({ pageId: 7, sequence: '1' });
        await vi.advanceTimersByTimeAsync(2999);
        expect(post).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(post).toHaveBeenCalledTimes(2);
        expect(session.getSnapshot().phase).toBe('clean');
        await session.dispose();
        doc.destroy();
    });

    it('journals transaction updates and sends a backlog across ordered bounded requests', async () => {
        const { doc, session, journal } = open();
        vi.mocked(post).mockResolvedValue({ pageId: 7, sequence: '1' });
        const board = doc.getMap('records');
        for (let i = 0; i < 3; i++) board.set(String(i), new Uint8Array(450 * 1024));
        expect(journal.append).toHaveBeenCalledTimes(3);
        await session.flush();

        expect(post).toHaveBeenCalledTimes(2);
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
        vi.mocked(post).mockRejectedValueOnce(new Error('lost acknowledgement'))
            .mockResolvedValueOnce({ pageId: 7, sequence: '4' });
        await expect(session.flush()).rejects.toThrow('lost acknowledgement');
        expect(journal.acknowledge).not.toHaveBeenCalled();
        await session.flush();
        expect(journal.prepare).not.toHaveBeenCalled();
        expect(journal.acknowledge).toHaveBeenCalledWith('prior-request');
        for (const [i, args] of vi.mocked(post).mock.calls.entries()) {
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

        doc.getMap('records').set('oversize', new Uint8Array(CHECKPOINT_MAX_BYTES + 1));
        await expect(session.flush()).rejects.toThrow('remains in local recovery');
        expect(journal.append).toHaveBeenCalledTimes(1);
        expect(post).not.toHaveBeenCalled();
        expect(journal.acknowledge).not.toHaveBeenCalled();
        await session.dispose();
        remote.destroy();
        doc.destroy();
    });
});
