import React, { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { useDocumentCollaboration } from './useDocumentCollaboration';

// Keep the real y-webrtc provider: a mock would miss its global room registry
// and asynchronous room creation/destruction, which caused Edit reentry failures.
class Socket extends EventTarget {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 0;
    onopen?: () => void;
    onclose?: () => void;
    onmessage?: (event: { data: string }) => void;
    sent: any[] = [];
    constructor(readonly url: string) { super(); Socket.instances.push(this); }
    open() { this.readyState = 1; this.onopen?.(); this.dispatchEvent(new Event('open')); }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() {
        if (this.readyState >= 2) return;
        this.readyState = 2;
        queueMicrotask(() => {
            this.readyState = 3;
            this.onclose?.();
            this.dispatchEvent(new CloseEvent('close', { code: 1000, reason: '', wasClean: true }));
        });
    }
}

const docs: Y.Doc[] = [];
function document() { const doc = new Y.Doc(); docs.push(doc); return doc; }
async function settle() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }

beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    Socket.instances = [];
    vi.stubGlobal('WebSocket', Socket);
    vi.stubEnv('VITE_SIGNALING_URL', 'ws://test/ws');
});
afterEach(async () => {
    cleanup();
    await settle();
    docs.splice(0).forEach(doc => doc.destroy());
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('document collaboration lifecycle', () => {
    it('logs a new signaling socket if the provider reconnects while Edit is active', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        const doc = document();
        renderHook(() => useDocumentCollaboration(doc, 'space', '42'));
        await settle();
        act(() => Socket.instances.forEach(socket => socket.open()));
        act(() => Socket.instances[0].close());
        await settle();
        act(() => vi.advanceTimersByTime(1));
        expect(Socket.instances).toHaveLength(3);
        act(() => Socket.instances[2].open());
        const events = vi.mocked(console.info).mock.calls.map(call => call[1])
            .filter(event => event.transport === 'signaling');
        const opened = events.filter(event => event.event === 'open');
        expect(opened).toHaveLength(2);
        expect(opened[0].socketId).not.toBe(opened[1].socketId);
        expect(events.find(event => event.event === 'close')).toMatchObject({
            leavingEdit: false, reconnectEnabled: true,
        });
    });

    it('logs actual close events for both sockets and does not reconnect during 60 seconds after leaving Edit', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        const doc = document();
        const { unmount } = renderHook(() => useDocumentCollaboration(doc, 'space', '42'));
        await settle();
        act(() => Socket.instances.forEach(socket => socket.open()));
        const events = () => vi.mocked(console.info).mock.calls
            .filter(call => call[0] === '[document-collaboration]')
            .map(call => call[1]);
        expect(events().filter(event => event.event === 'open')).toHaveLength(2);
        unmount();
        // Calling close() isn't completion: no close log until the native event.
        expect(Socket.instances.every(socket => socket.readyState === 2)).toBe(true);
        expect(events().filter(event => event.event === 'close')).toHaveLength(0);
        await settle();
        const closed = events().filter(event => event.event === 'close');
        expect(closed.map(event => event.transport).sort()).toEqual(['relay', 'signaling']);
        for (const event of closed) expect(event).toMatchObject({
            room: 'document-v2:space:42', readyState: 3, code: 1000,
            wasClean: true, leavingEdit: true, reconnectEnabled: false,
        });
        const count = events().length;
        act(() => vi.advanceTimersByTime(60_000));
        await settle();
        expect(Socket.instances).toHaveLength(2);
        expect(events()).toHaveLength(count);
    });

    it('subscribes and announces immediately, and starts the state exchange without another editor', async () => {
        const doc = document();
        const { result } = renderHook(() => useDocumentCollaboration(doc, 'space', '42'));
        await settle();
        expect(result.current.provider?.room).toBeTruthy();
        act(() => Socket.instances.forEach(socket => socket.open()));
        await settle();
        const messages = Socket.instances.flatMap(socket => socket.sent);
        expect(messages).toContainEqual({ type: 'subscribe', topics: ['document-v2:space:42'] });
        expect(messages).toContainEqual(expect.objectContaining({ type: 'publish', topic: 'document-v2:space:42',
            data: expect.objectContaining({ type: 'announce' }) }));
        expect(messages).toContainEqual(expect.objectContaining({ type: 'publish', topic: 'document-v2:space:42',
            data: expect.objectContaining({ type: 'document-realtime-v1', kind: 'request' }) }));
        act(() => doc.getText('title').insert(0, 'Live title'));
        expect(Socket.instances.flatMap(socket => socket.sent)).toContainEqual(expect.objectContaining({
            data: expect.objectContaining({ type: 'document-realtime-v1', kind: 'update' }),
        }));
    });

    it('reopens the same room after leaving Edit, even before asynchronous destruction finishes', async () => {
        const documentA = document();
        const documentB = document();
        const first = renderHook(() => useDocumentCollaboration(documentA, 'space', '42'));
        await settle();
        const previous = first.result.current.provider!;
        act(() => Socket.instances.forEach(socket => socket.open()));
        first.unmount();
        const second = renderHook(() => useDocumentCollaboration(documentB, 'space', '42'));
        await settle();
        expect(previous.connected).toBe(false);
        expect(second.result.current.provider?.room).toBeTruthy();
        expect(second.result.current.provider).not.toBe(previous);
        expect(second.result.current.notice).toBeUndefined();
        act(() => Socket.instances.filter(socket => socket.readyState === 0).forEach(socket => socket.open()));
        await settle();
        expect(Socket.instances.filter(socket => socket.readyState === 1).flatMap(socket => socket.sent))
            .toContainEqual(expect.objectContaining({ data: expect.objectContaining({ type: 'announce' }) }));
    });

    it('starts one provider under StrictMode effect replay and closes every socket on unmount', async () => {
        const doc = document();
        const { result, unmount } = renderHook(() => useDocumentCollaboration(doc, 'space', '42'), {
            wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
        });
        await settle();
        expect(result.current.provider?.room).toBeTruthy();
        expect(Socket.instances).toHaveLength(2);
        unmount();
        await settle();
        expect(Socket.instances.every(socket => socket.readyState === 3)).toBe(true);
    });
});
