import React from 'react';
import { WhiteboardApp } from './WhiteboardApp';
import {
  attachDebugApi,
  initializeGlideboardSession,
  subscribeToDocumentChanges,
  teardownGlideboardSession,
  registerCustomShapes,
} from './editor';
import type { GlideboardProps } from './types';

export function Glideboard({
  initialDocument,
  collaboration,
  readOnly = false,
  onDocumentChange,
  documentChangeDebounceMs = 500,
  debugApiKey,
  customShapes,
}: GlideboardProps) {
  const customShapesRegisteredRef = React.useRef(false);
  if (!customShapesRegisteredRef.current && customShapes && customShapes.length > 0) {
    customShapesRegisteredRef.current = true;
    registerCustomShapes(customShapes);
  }

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
