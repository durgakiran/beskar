/**
 * InternalDocInlineView — simple inline chip for an internal document link.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiFileText } from 'react-icons/fi';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import type { InternalResourceHandler } from '../../types';

function getHandler(editor: NodeViewProps['editor']): InternalResourceHandler | undefined {
  return editor.storage.internalDocInline?.resourceHandler;
}

export function InternalDocInlineView({ node, editor, updateAttributes }: NodeViewProps) {
  const resourceId = String(node.attrs.resourceId ?? '');
  const href = String(node.attrs.href ?? '');
  const storedTitle = String(node.attrs.resourceTitle ?? '');
  const handler = getHandler(editor);
  const [isLoading, setIsLoading] = useState(!storedTitle && Boolean(resourceId && handler));

  useEffect(() => {
    if (!handler || !resourceId || storedTitle) return;
    let cancelled = false;

    async function loadTitle() {
      setIsLoading(true);
      try {
        const metadata = await handler.getResourceMetadata(resourceId, 'document');
        if (cancelled) return;
        if (metadata?.title) {
          updateAttributes({ resourceTitle: metadata.title });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadTitle();
    return () => {
      cancelled = true;
    };
  }, [handler, resourceId, storedTitle, updateAttributes]);

  const label = useMemo(() => {
    if (storedTitle) return storedTitle;
    if (isLoading) return 'Loading document...';
    return resourceId ? `Document ${resourceId}` : 'Document';
  }, [isLoading, resourceId, storedTitle]);

  const openDocument = useCallback(() => {
    if (!href) return;
    window.open(href, '_blank', 'noopener,noreferrer');
  }, [href]);

  return (
    <NodeViewWrapper as="span" className="internal-doc-inline-wrapper" contentEditable={false}>
      <button
        type="button"
        className="internal-doc-inline-chip"
        onClick={openDocument}
        title={href || label}
      >
        <FiFileText aria-hidden="true" className="internal-doc-inline-icon" />
        <span className="internal-doc-inline-title">{label}</span>
      </button>
    </NodeViewWrapper>
  );
}
