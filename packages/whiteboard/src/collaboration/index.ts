// Collaboration types
export interface WhiteboardUser {
    id: string;
    name: string;
    color: string;
}

/**
 * Stub collaboration config — mirrors the editor's y-webrtc pattern.
 * Wire a Y.Doc + WebrtcProvider here when enabling real-time collab.
 */
export interface CollaborationConfig {
    /** The yjs document shared across peers */
    ydoc: unknown; // typed as `unknown` so this package doesn't hard-dep on yjs at runtime
    /** y-webrtc (or any yjs provider) instance */
    provider: unknown;
    /** Current user info for awareness */
    user: WhiteboardUser;
}

export type WhiteboardSnapshot = Record<string, unknown>;
