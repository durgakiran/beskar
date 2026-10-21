import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { DocumentRealtimeRelay } from './DocumentRealtimeRelay';

// Implements the existing Go signaling server's subscribe/publish envelope.
// Each client has a separate doc and awareness; no WebRTC or BroadcastChannel.
class RelaySocket extends EventTarget {
    readyState = 0;
    onopen?: () => void;
    onclose?: () => void;
    onerror?: () => void;
    onmessage?: (event: { data: string }) => void;
    rooms: string[] = [];
    constructor(private hub: RelaySocket[]) { super(); hub.push(this); }
    open() { this.readyState = 1; this.onopen?.(); this.dispatchEvent(new Event('open')); }
    send(payload: string) {
        const message = JSON.parse(payload);
        if (message.type === 'subscribe') this.rooms = message.topics;
        if (message.type === 'ping') queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'pong', isLeader: false }) }));
        if (message.type === 'publish') this.hub.forEach(peer => {
            if (peer !== this && peer.readyState === 1 && peer.rooms.includes(message.topic)) {
                queueMicrotask(() => { if (peer.readyState === 1) peer.onmessage?.({ data: payload }); });
            }
        });
    }
    close() { this.readyState = 3; this.rooms = []; this.onclose?.(); this.dispatchEvent(new CloseEvent('close')); }
}

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(dispose => dispose()); vi.useRealTimers(); });
async function delivered() { for (let step = 0; step < 12; step++) await Promise.resolve(); }

function client(hub: RelaySocket[], name: string, room = 'document-v2:space:42') {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField('user', { id: 'same-account', name, color: '#aabbcc' });
    const status = vi.fn();
    const relay = new DocumentRealtimeRelay(doc, awareness, room, 'ws://test/ws', status,
        () => new RelaySocket(hub) as unknown as WebSocket);
    cleanup.push(() => { relay.destroy(); awareness.destroy(); doc.destroy(); });
    return { doc, awareness, relay, status, socket: hub.at(-1)! };
}

describe('document WebSocket relay', () => {
    it('keeps its session identity when Yjs changes the document client ID during hydration', async () => {
        const hub: RelaySocket[] = [];
        const first = client(hub, 'First');
        // Yjs can rotate doc.clientID when applying a recovered update. Awareness
        // retains its original clientID and has no metadata for the new one.
        first.doc.clientID = (first.doc.clientID + 1) % 0x100000000;
        expect(() => first.socket.open()).not.toThrow();
        const second = client(hub, 'Second'); second.socket.open();
        await delivered();
        first.awareness.setLocalStateField('user', { name: 'After hydration' });
        first.doc.getText('title').insert(0, 'Hydrated title');
        await delivered();
        expect(second.doc.getText('title').toString()).toBe('Hydrated title');
        expect(second.awareness.getStates().get(first.awareness.clientID)?.user.name).toBe('After hydration');
        expect(first.status).toHaveBeenLastCalledWith(true);
    });

    it('sends title/body edits and both cursor fields immediately between isolated sessions of the same user', async () => {
        const hub: RelaySocket[] = [];
        const first = client(hub, 'First window');
        first.socket.open();
        first.doc.getText('title').insert(0, 'Shared title');
        const second = client(hub, 'Incognito window');
        second.socket.open();
        await delivered();
        expect(second.doc.getText('title').toString()).toBe('Shared title');
        first.doc.getText('body').insert(0, 'Live body');
        first.awareness.setLocalStateField('titleSelection', {
            anchor: Y.createRelativePositionFromTypeIndex(first.doc.getText('title'), 3),
            head: Y.createRelativePositionFromTypeIndex(first.doc.getText('title'), 5),
        });
        await delivered();
        expect(second.doc.getText('body').toString()).toBe('Live body');
        const remote = second.awareness.getStates().get(first.doc.clientID)!;
        expect(remote.user.name).toBe('First window');
        expect(Y.createAbsolutePositionFromRelativePosition(remote.titleSelection.head, second.doc)?.index).toBe(5);
        first.awareness.setLocalStateField('cursor', { anchor: { tname: 'body', assoc: 0 }, head: { tname: 'body', assoc: 0 } });
        await delivered();
        expect(second.awareness.getStates().get(first.doc.clientID)?.cursor).toBeTruthy();
        expect(second.awareness.getStates()).toHaveLength(2);
    });

    it('merges offline changes in both directions when the socket reconnects', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const hub: RelaySocket[] = [];
        const first = client(hub, 'First'); first.socket.open();
        first.doc.getText('title').insert(0, 'Title');
        const second = client(hub, 'Second'); second.socket.open();
        await delivered();
        second.socket.close();
        first.doc.getText('title').insert(0, 'New ');
        second.doc.getText('title').insert(5, '!');
        vi.advanceTimersByTime(500);
        hub.at(-1)!.open();
        await delivered();
        expect(first.doc.getText('title').toString()).toBe('New Title!');
        expect(second.doc.getText('title').toString()).toBe('New Title!');
        expect(second.status.mock.calls.map(call => call[0])).toEqual([true, false, true]);
    });

    it('does not relay updates across document rooms', async () => {
        const hub: RelaySocket[] = [];
        const first = client(hub, 'First'); first.socket.open();
        const second = client(hub, 'Second', 'document-v2:space:43'); second.socket.open();
        first.doc.getText('title').insert(0, 'Private to this room');
        await delivered();
        expect(second.doc.getText('title').toString()).toBe('');
        expect(second.awareness.getStates()).toHaveLength(1);
    });

    it('removes presence on disconnect and stops sending after disposal', async () => {
        const hub: RelaySocket[] = [];
        const first = client(hub, 'First'); first.socket.open();
        const second = client(hub, 'Second'); second.socket.open();
        await delivered();
        expect(second.awareness.getStates().has(first.doc.clientID)).toBe(true);
        first.relay.destroy();
        await delivered();
        expect(second.awareness.getStates().has(first.doc.clientID)).toBe(false);
        first.doc.getText('title').insert(0, 'After leaving');
        await delivered();
        expect(second.doc.getText('title').toString()).toBe('');
    });

    it('ignores malformed/unrelated signaling messages and still accepts subsequent updates', async () => {
        const hub: RelaySocket[] = [];
        const first = client(hub, 'First'); first.socket.open();
        const second = client(hub, 'Second'); second.socket.open();
        second.socket.onmessage?.({ data: '{broken' });
        second.socket.onmessage?.({ data: JSON.stringify({ type: 'publish', topic: 'document-v2:space:42', data: { type: 'announce' } }) });
        first.doc.getText('title').insert(0, 'Still connected');
        await delivered();
        expect(second.doc.getText('title').toString()).toBe('Still connected');
    });
});
