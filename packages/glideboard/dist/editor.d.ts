import { type GlideDocument } from '@durgakiran/glideline';
import type { GlideboardCollaborationConfig } from './types';
export declare function createGlideboardEditorInstance(): import("@durgakiran/glideline").GlideEditor;
export declare const wbEditor: import("@durgakiran/glideline").GlideEditor;
export declare const readOnlySignal: import("@preact/signals-core").Signal<boolean>;
export type ConnectorPreset = 'line' | 'arrow' | 'double-arrow';
export type ArrowheadStyle = 'none' | 'arrow';
export type ArrowRouteStyle = 'curve' | 'ortho' | 'smart';
export declare const arrowRouteStyleSignal: import("@preact/signals-core").Signal<ArrowRouteStyle>;
export declare const arrowPresetSignal: import("@preact/signals-core").Signal<ConnectorPreset>;
export declare const arrowheadStartSignal: import("@preact/signals-core").Signal<ArrowheadStyle>;
export declare const arrowheadEndSignal: import("@preact/signals-core").Signal<ArrowheadStyle>;
export declare function setArrowRouteStyle(routeStyle: ArrowRouteStyle): void;
export declare function setArrowheadStart(arrowheadStart: ArrowheadStyle): void;
export declare function setArrowheadEnd(arrowheadEnd: ArrowheadStyle): void;
export declare function setConnectorPreset(preset: ConnectorPreset): void;
export declare function clearWhiteboardState(): void;
export declare function initializeGlideboardSession(opts: {
    initialDocument?: GlideDocument | null;
    collaboration?: GlideboardCollaborationConfig | null;
    readOnly?: boolean;
}): void;
export declare function teardownGlideboardSession(): void;
declare global {
    interface Window {
        [key: string]: unknown;
    }
}
export declare function attachDebugApi(debugApiKey: string): () => void;
export declare function subscribeToDocumentChanges(onDocumentChange: (document: GlideDocument) => void, debounceMs?: number): () => void;
