import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Toolbar from '@radix-ui/react-toolbar';
import * as Separator from '@radix-ui/react-separator';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useFloating, flip, shift, offset, autoUpdate } from '@floating-ui/react';
import { FiExternalLink, FiGlobe, FiTrash2, FiRefreshCw } from 'react-icons/fi';
import { resolveLinkMetadata } from '../../utils/linkMetadata';
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
  const [error, setError] = useState('');
  const handler = getHandler(editor);

  const [resolvedTitle, setResolvedTitle] = useState(title || '');
  const [resolvedSiteName, setResolvedSiteName] = useState(siteName || '');
  const [isLoading, setIsLoading] = useState(Boolean(href && !title));

  const { refs, floatingStyles } = useFloating({
    placement: 'top',
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const current = useRef({ node, updateAttributes });
  current.current = { node, updateAttributes };
  const generation = useRef(0);
  const previousHref = useRef(href);

  const loadMetadata = useCallback(async (force = false) => {
    if (!handler || !href) return;
    const request = ++generation.current;
    setIsLoading(true);
    setError('');
    try {
      const metadata = await resolveLinkMetadata(handler, href, force);
      if (request !== generation.current) return;
      setResolvedTitle(metadata.title || '');
      setResolvedSiteName(metadata.siteName || '');
      if (editor.isEditable) {
        current.current.updateAttributes({
          title: metadata.title || '', siteName: metadata.siteName || '',
          metadataHref: href, metadataResolved: true, error: '',
        });
      }
    } catch {
      if (request === generation.current) setError('Preview unavailable');
    } finally {
      if (request === generation.current) setIsLoading(false);
    }
  }, [handler, href, editor]);

  useEffect(() => {
    const attrs = current.current.node.attrs;
    const changed = previousHref.current !== href || Boolean(attrs.metadataHref && attrs.metadataHref !== href);
    previousHref.current = href;
    setResolvedTitle(changed ? '' : attrs.title || '');
    setResolvedSiteName(changed ? '' : attrs.siteName || '');
    setError('');
    setIsLoading(false);
    if (changed && editor.isEditable) {
      current.current.updateAttributes({ title: '', siteName: '', metadataHref: href, metadataResolved: false, error: '' });
    }
    if (changed || !(attrs.title || attrs.metadataResolved)) void loadMetadata();
    return () => { generation.current++; };
  }, [href, handler, editor, loadMetadata]);

  // Metadata can also arrive through collaboration without starting another fetch.
  useEffect(() => {
    if (node.attrs.metadataHref !== href) return;
    if (title || node.attrs.metadataResolved) {
      setResolvedTitle(title);
      setResolvedSiteName(siteName);
    }
  }, [href, title, siteName, node.attrs.metadataHref, node.attrs.metadataResolved]);

  const providerLabel = useMemo(() => {
    return resolvedSiteName || getHostnameLabel(href);
  }, [href, resolvedSiteName, siteName]);

  const titleLabel = useMemo(() => {
    if (resolvedTitle) return resolvedTitle;
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
          {handler && <Toolbar.Button className="editor-floating-toolbar-button" onClick={() => void loadMetadata(true)} disabled={isLoading} aria-label={error ? 'Retry link preview' : 'Refresh link preview'}>
            <FiRefreshCw size={16} />
            <span>{isLoading ? 'Loading preview…' : error ? 'Retry preview' : 'Refresh preview'}</span>
          </Toolbar.Button>}
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
          className={`external-link-inline-chip${error && editor.isEditable ? ' is-error' : ''}`}
          onClick={openInNewTab}
          title={`${href || titleLabel}${error && editor.isEditable ? ' — Preview unavailable; select to retry' : ''}`}
          aria-busy={isLoading}
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
