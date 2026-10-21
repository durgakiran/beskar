let nextSocketId = 0;

/** Observe native events without replacing the transport's own handlers. */
export function createDocumentSocketObserver(
    room: string,
    transport: 'signaling' | 'relay',
    state: () => { leavingEdit: boolean; reconnectEnabled: boolean },
) {
    const observed = new WeakSet<WebSocket>();
    return (socket: WebSocket | null) => {
        if (!socket || observed.has(socket)) return;
        observed.add(socket);
        const socketId = ++nextSocketId;
        const log = (event: string, details = {}) => console.info('[document-collaboration]', {
            room, transport, socketId, event, readyState: socket.readyState, ...state(), ...details,
        });
        log(socket.readyState === WebSocket.OPEN ? 'open' : 'connecting');
        if (socket.readyState !== WebSocket.OPEN) {
            socket.addEventListener('open', () => log('open'), { once: true });
        }
        // Keep this listener through disposal: close() only starts the handshake.
        socket.addEventListener('close', event => log('close', {
            code: event.code, reason: event.reason, wasClean: event.wasClean,
        }), { once: true });
    };
}
