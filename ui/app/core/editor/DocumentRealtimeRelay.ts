import * as Y from 'yjs';
import { applyAwarenessUpdate, encodeAwarenessUpdate, type Awareness } from 'y-protocols/awareness';
import { base64ToUint8Array, uint8ArrayToBase64 } from 'app/core/utils/base64';
import { createDocumentSocketObserver } from './documentSocketLogging';

type RelayMessage = {
    type: 'document-realtime-v1';
    kind: 'request' | 'response' | 'update' | 'awareness';
    from: number;
    to?: number;
    update?: string;
    vector?: string;
};

/** Relay live Yjs updates and presence over the existing signaling protocol.
 * WebRTC remains connected, but NAT/ICE failure cannot force collaboration to
 * wait for a persisted draft. This service holds no authoritative document state.
 */
export class DocumentRealtimeRelay {
    private socket?: WebSocket;
    private retry?: ReturnType<typeof setTimeout>;
    private heartbeat?: ReturnType<typeof setInterval>;
    private disposed = false;
    private retryDelay = 500;
    private observeSocket: ReturnType<typeof createDocumentSocketObserver>;

    constructor(
        private doc: Y.Doc,
        private awareness: Awareness,
        private room: string,
        private url: string,
        private status: (connected: boolean) => void = () => {},
        private createSocket: (url: string) => WebSocket = url => new WebSocket(url),
    ) {
        this.observeSocket = createDocumentSocketObserver(room, 'relay', () => ({
            leavingEdit: this.disposed, reconnectEnabled: !this.disposed,
        }));
        doc.on('update', this.onDocumentUpdate);
        awareness.on('update', this.onAwarenessUpdate);
        this.connect();
    }

    private send(message: Omit<RelayMessage, 'type' | 'from'>) {
        if (this.socket?.readyState !== 1) return;
        // Awareness owns the session ID even if Yjs rotates doc.clientID on recovery.
        this.socket.send(JSON.stringify({ type: 'publish', topic: this.room,
            data: { ...message, type: 'document-realtime-v1', from: this.awareness.clientID } }));
    }

    private sendAwareness(to?: number) {
        this.send({ kind: 'awareness', to,
            update: uint8ArrayToBase64(encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])) });
    }

    private onDocumentUpdate = (update: Uint8Array, origin: unknown) => {
        if (origin !== this) this.send({ kind: 'update', update: uint8ArrayToBase64(update) });
    };

    private onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        if ([...added, ...updated, ...removed].includes(this.awareness.clientID)) this.sendAwareness();
    };

    private onMessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return;
        try {
            const envelope = JSON.parse(event.data);
            const message = envelope.data as RelayMessage | undefined;
            if (envelope.type !== 'publish' || envelope.topic !== this.room ||
                message?.type !== 'document-realtime-v1' || !Number.isSafeInteger(message.from) ||
                message.from === this.awareness.clientID || (message.to !== undefined && message.to !== this.awareness.clientID)) return;
            switch (message.kind) {
                case 'request':
                    if (typeof message.vector !== 'string') return;
                    this.send({ kind: 'response', to: message.from,
                        vector: uint8ArrayToBase64(Y.encodeStateVector(this.doc)),
                        update: uint8ArrayToBase64(Y.encodeStateAsUpdate(this.doc, base64ToUint8Array(message.vector))) });
                    this.sendAwareness(message.from);
                    break;
                case 'response':
                    if (typeof message.update !== 'string' || typeof message.vector !== 'string') return;
                    Y.applyUpdate(this.doc, base64ToUint8Array(message.update), this);
                    // Exchange both directions, including offline edits made before reconnect.
                    this.send({ kind: 'update', to: message.from,
                        update: uint8ArrayToBase64(Y.encodeStateAsUpdate(this.doc, base64ToUint8Array(message.vector))) });
                    break;
                case 'update':
                    if (typeof message.update === 'string') Y.applyUpdate(this.doc, base64ToUint8Array(message.update), this);
                    break;
                case 'awareness':
                    if (typeof message.update === 'string') applyAwarenessUpdate(this.awareness, base64ToUint8Array(message.update), this);
                    break;
            }
        } catch {
            // Ignore unrelated/malformed signaling messages without breaking the connection.
        }
    };

    private connect() {
        if (this.disposed) return;
        let socket: WebSocket;
        try { socket = this.createSocket(this.url); }
        catch { this.reconnect(); return; }
        this.socket = socket;
        this.observeSocket(socket);
        socket.onmessage = this.onMessage;
        socket.onopen = () => {
            if (this.disposed || this.socket !== socket) return;
            this.retryDelay = 500;
            socket.send(JSON.stringify({ type: 'subscribe', topics: [this.room] }));
            this.send({ kind: 'request', vector: uint8ArrayToBase64(Y.encodeStateVector(this.doc)) });
            this.sendAwareness();
            // Keep idle relays alive through proxies, and detect half-open connections.
            let pongReceived = true;
            socket.onmessage = event => {
                try { if (JSON.parse(event.data).type === 'pong') pongReceived = true; } catch { /* Not JSON. */ }
                this.onMessage(event);
            };
            this.heartbeat = setInterval(() => {
                if (!pongReceived) { socket.close(); return; }
                pongReceived = false;
                socket.send(JSON.stringify({ type: 'ping' }));
            }, 20_000);
            this.status(true);
        };
        socket.onerror = () => { socket.close(); };
        socket.onclose = () => {
            if (this.socket !== socket) return;
            if (this.heartbeat) clearInterval(this.heartbeat);
            this.socket = undefined;
            this.reconnect();
        };
    }

    private reconnect() {
        if (this.disposed) return;
        this.status(false);
        this.retry = setTimeout(() => this.connect(), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 10_000);
    }

    destroy() {
        if (this.disposed) return;
        // Broadcast removal while the socket can still write, before detaching it.
        this.awareness.setLocalState(null);
        this.disposed = true;
        this.doc.off('update', this.onDocumentUpdate);
        this.awareness.off('update', this.onAwarenessUpdate);
        if (this.retry) clearTimeout(this.retry);
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.socket?.close();
    }
}
