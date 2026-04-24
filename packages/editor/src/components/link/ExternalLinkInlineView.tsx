import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as Toolbar from '@radix-ui/react-toolbar';
import * as Separator from '@radix-ui/react-separator';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useFloating, flip, shift, offset, autoUpdate } from '@floating-ui/react';
import { FiExternalLink, FiGlobe, FiTrash2 } from 'react-icons/fi';
import type { ExternalLinkHandler } from '../../types';

function getHandler(editor: NodeViewProps['editor']): ExternalLinkHandler | undefined {
  return (editor.storage as any).externalLinkInline?.linkHandler;
}

function getHostnameLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '') || 'external';
  } catch {
    return 'external';
  }
}

export function ExternalLinkInlineView({ node, editor, updateAttributes, getPos, selected }: NodeViewProps) {
  const href = String(node.attrs.href ?? '');
  const title = String(node.attrs.title ?? '');
  const siteName = String(node.attrs.siteName ?? '');
  const error = String(node.attrs.error ?? '');
  const handler = getHandler(editor);

  const [resolvedTitle, setResolvedTitle] = useState(title || '');
  const [resolvedSiteName, setResolvedSiteName] = useState(siteName || '');
  const [isLoading, setIsLoading] = useState(Boolean(href && !title));

  const { refs, floatingStyles } = useFloating({
    placement: 'top',
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (!handler || !href || title) {
      setResolvedTitle(title || '');
      setResolvedSiteName(siteName || '');
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function loadMetadata() {
      setIsLoading(true);
      try {
        const metadata = await handler.getLinkMetadata(href);
        if (cancelled || !metadata) return;

        setResolvedTitle(metadata.title || '');
        setResolvedSiteName(metadata.siteName || '');
        updateAttributes({
          title: metadata.title || '',
          siteName: metadata.siteName || '',
          error: '',
        });
      } catch {
        if (!cancelled) {
          updateAttributes({ error: 'Could not resolve link metadata' });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadMetadata();
    return () => {
      cancelled = true;
    };
  }, [handler, href, siteName, title, updateAttributes]);

  const providerLabel = useMemo(() => {
    return resolvedSiteName || siteName || getHostnameLabel(href);
  }, [href, resolvedSiteName, siteName]);

  const titleLabel = useMemo(() => {
    if (resolvedTitle) return resolvedTitle;
    if (isLoading) return 'Resolving title...';
    return href;
  }, [href, isLoading, resolvedTitle]);

  const openInNewTab = useCallback(() => {
    if (!href) return;
    window.open(href, '_blank', 'noopener,noreferrer');
  }, [href]);

  const deleteNode = useCallback(() => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos === undefined || pos < 0) return;
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  }, [editor, getPos, node.nodeSize]);

  const toolbar = selected && editor.isEditable ? (
    <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 50 }}>
      <div className="image-block-toolbar-floating">
        <Toolbar.Root className="editor-floating-toolbar">
          <span className="embed-toolbar-provider">{providerLabel}</span>
          <Separator.Root className="editor-floating-toolbar-separator" orientation="vertical" />
          <Toolbar.Button className="editor-floating-toolbar-button" onClick={openInNewTab} aria-label="Open link">
            <FiExternalLink size={16} />
            <span>Open</span>
          </Toolbar.Button>
          <Toolbar.Button className="editor-floating-toolbar-button" onClick={deleteNode} aria-label="Delete link chip">
            <FiTrash2 size={16} />
            <span>Delete</span>
          </Toolbar.Button>
        </Toolbar.Root>
      </div>
    </div>
  ) : null;

  return (
    <>
      <NodeViewWrapper as="span" className="external-link-inline-wrapper" contentEditable={false} ref={refs.setReference}>
        <button
          type="button"
          className={`external-link-inline-chip${error ? ' is-error' : ''}`}
          onClick={openInNewTab}
          title={href || titleLabel}
        >
          <FiGlobe aria-hidden="true" className="external-link-inline-icon" />
          <span className="external-link-inline-site">{providerLabel}</span>
          <span className="external-link-inline-divider">·</span>
          <span className="external-link-inline-title">{titleLabel}</span>
        </button>
      </NodeViewWrapper>
      {toolbar}
    </>
  );
}
