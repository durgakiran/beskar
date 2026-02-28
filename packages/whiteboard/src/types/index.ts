import type { Editor as TldrawEditor } from 'tldraw';
import type { CollaborationConfig } from '../collaboration';

export interface WhiteboardProps {
    /**
     * Disable all editing — canvas becomes a read-only viewer.
     */
    readOnly?: boolean;

    /**
     * LocalStorage key for single-user persistence.
     * Pass a unique key per document.
     */
    persistenceKey?: string;

    /**
     * Called once the tldraw Editor instance is ready.
     */
    onMount?: (editor: TldrawEditor) => void;

    /**
     * Collaboration config stub. Pass a Y.Doc + provider to enable
     * real-time sync (yjs adapter wiring comes in a future release).
     */
    collaboration?: CollaborationConfig;

    /**
     * A custom tldraw store. Specifically used for Yjs/WebRTC sync.
     * When provided, `persistenceKey` should generally be ignored.
     */
    store?: any;

    className?: string;

    style?: React.CSSProperties;
}
