import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import { WhiteboardApp } from './WhiteboardApp';
import { attachDebugApi, initializeGlideboardSession, subscribeToDocumentChanges, teardownGlideboardSession, } from './editor';
export function Glideboard({ initialDocument, collaboration, readOnly = false, onDocumentChange, documentChangeDebounceMs = 500, debugApiKey, }) {
    React.useEffect(() => {
        initializeGlideboardSession({
            initialDocument,
            collaboration,
            readOnly,
        });
        const detachDebugApi = debugApiKey ? attachDebugApi(debugApiKey) : () => { };
        const unsubscribeDocumentChanges = onDocumentChange
            ? subscribeToDocumentChanges(onDocumentChange, documentChangeDebounceMs)
            : () => { };
        return () => {
            detachDebugApi();
            unsubscribeDocumentChanges();
            teardownGlideboardSession();
        };
    }, [collaboration, debugApiKey, documentChangeDebounceMs, initialDocument, onDocumentChange, readOnly]);
    return _jsx(WhiteboardApp, {});
}
//# sourceMappingURL=Glideboard.js.map