import { useEffect, useState } from 'react';
import type { Doc } from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { getSignalingUrl } from 'app/core/signaling';
import { isDesktop } from 'app/core/desktop/isDesktop';
import { DocumentRealtimeRelay } from './DocumentRealtimeRelay';
import { createDocumentSocketObserver } from './documentSocketLogging';

export function useDocumentCollaboration(doc: Doc, spaceId: string, pageId: string) {
    const [provider, setProvider] = useState<WebrtcProvider>();
    const [notice, setNotice] = useState<string>();

    useEffect(() => {
        let active = true;
        let currentProvider: WebrtcProvider | undefined;
        let relay: DocumentRealtimeRelay | undefined;

        const connect = async () => {
            // y-webrtc removes its global room in a promise callback on destroy.
            // Let that finish before reopening the same room, including effect replay.
            await Promise.resolve();
            if (!active) return;
            let url = getSignalingUrl();
            if (isDesktop) {
                const { GetAccessToken } = await import('../../../wailsjs/beskar/desktop/auth/authservice');
                const token = await GetAccessToken();
                if (token) url += `${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
            }
            if (!active) return;
            const room = `document-v2:${spaceId}:${pageId}`;
            currentProvider = new WebrtcProvider(room, doc, { signaling: [url], filterBcConns: false });
            for (const connection of currentProvider.signalingConns) {
                const observe = createDocumentSocketObserver(room, 'signaling', () => ({
                    leavingEdit: !active, reconnectEnabled: connection.shouldConnect,
                }));
                observe(connection.ws);
                // y-webrtc creates a new native socket on each reconnect.
                connection.on('connect', () => observe(connection.ws));
            }
            relay = new DocumentRealtimeRelay(doc, currentProvider.awareness, room, url,
                connected => { if (active) setNotice(connected ? undefined : 'Reconnecting live collaboration…'); });
            setProvider(currentProvider);
        };

        void connect().catch(error => {
            if (!active) return;
            console.error('Unable to start document collaboration', error);
            setNotice('Unable to start live collaboration. Reload to retry.');
        });

        return () => {
            active = false;
            if (currentProvider) console.info('[document-collaboration]', {
                room: currentProvider.roomName, event: 'leaving-edit',
            });
            // Dispose the provider owned by this effect, even after React unmounts.
            relay?.destroy();
            currentProvider?.disconnect();
            currentProvider?.destroy();
            currentProvider?.awareness.destroy();
        };
    }, [doc, spaceId, pageId]);

    return { provider, notice };
}
