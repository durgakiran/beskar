import React from 'react';
import { Glideboard } from '@durgakiran/glideboard';
import type { GlideDocument } from '@durgakiran/glideline';

const STORAGE_KEY = 'glideline-whiteboard-v1';

function loadInitialDocument(): GlideDocument | null {
  if (typeof window === 'undefined') return null;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as GlideDocument;
  } catch (error) {
    console.warn('[GlideboardDemo] Failed to restore session:', error);
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export default function GlideboardDemo() {
  const initialDocument = React.useMemo(() => loadInitialDocument(), []);

  return (
    <div style={{ height: 'calc(100vh - 42px)' }}>
      <Glideboard
        initialDocument={initialDocument}
        debugApiKey="__GLIDELINE_WHITEBOARD__"
        onDocumentChange={(document) => {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
        }}
      />
    </div>
  );
}
