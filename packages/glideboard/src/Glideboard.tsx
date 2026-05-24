import React from 'react';
import { WhiteboardApp } from './WhiteboardApp';
import {
  attachDebugApi,
  initializeGlideboardSession,
  subscribeToDocumentChanges,
  teardownGlideboardSession,
} from './editor';
import type { GlideboardProps } from './types';

export function Glideboard({
  initialDocument,
  collaboration,
  readOnly = false,
  onDocumentChange,
  documentChangeDebounceMs = 500,
  debugApiKey,
}: GlideboardProps) {
  React.useEffect(() => {
    initializeGlideboardSession({
      initialDocument,
      collaboration,
      readOnly,
    });

    const detachDebugApi = debugApiKey ? attachDebugApi(debugApiKey) : () => {};
    const unsubscribeDocumentChanges = onDocumentChange
      ? subscribeToDocumentChanges(onDocumentChange, documentChangeDebounceMs)
      : () => {};

    return () => {
      detachDebugApi();
      unsubscribeDocumentChanges();
      teardownGlideboardSession();
    };
  }, [collaboration, debugApiKey, documentChangeDebounceMs, initialDocument, onDocumentChange, readOnly]);

  return <WhiteboardApp />;
}
