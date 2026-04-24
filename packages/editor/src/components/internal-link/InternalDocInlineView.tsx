/**
 * InternalDocInlineView — inline chip for internal document/whiteboard links.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as Toolbar from '@radix-ui/react-toolbar';
import * as Separator from '@radix-ui/react-separator';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useFloating, flip, shift, offset, autoUpdate } from '@floating-ui/react';
import { FiBox, FiExternalLink, FiMaximize2, FiTrash2 } from 'react-icons/fi';
import type { InternalResourceHandler, InternalResourceType } from '../../types';
import { getBrowserAppBaseUrl, parseInternalResourceUrl } from '../../nodes/internalDocumentUrl';

function getHandler(editor: NodeViewProps['editor']): InternalResourceHandler | undefined {
  return (editor.storage as any).internalDocInline?.resourceHandler;
}

const INTERNAL_APP_NAME = 'Beskar';

function getResourceFallbackLabel(resourceType: InternalResourceType, resourceId: string): string {
  const prefix = resourceType === 'whiteboard' ? 'Whiteboard' : 'Document';
  return resourceId ? `${prefix} ${resourceId}` : prefix;
}

export function InternalDocInlineView({ node, editor, updateAttributes, getPos, selected }: NodeViewProps) {
  const resourceType = (node.attrs.resourceType || 'document') as InternalResourceType;
  const resourceId = String(node.attrs.resourceId ?? '');
  const href = String(node.attrs.href ?? '');
  const storedTitle = String(node.attrs.resourceTitle ?? '');
  const resourceIcon = String(node.attrs.resourceIcon ?? '');
  const handler = getHandler(editor);
  const appBaseUrl = handler?.appBaseUrl ?? getBrowserAppBaseUrl();
  const [draftUrl, setDraftUrl] = useState('');
  const [inputState, setInputState] = useState<'idle' | 'invalid'>('idle');
  const [isLoading, setIsLoading] = useState(!storedTitle && Boolean(resourceId && handler));
  const isInput = !resourceId && !href;

  const { refs, floatingStyles } = useFloating({
    placement: 'top',
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const deleteNode = useCallback(() => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos === undefined || pos < 0) return;
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  }, [editor, getPos, node.nodeSize]);

  const resolveUrl = useCallback(
    (value: string, showInvalid = false) => {
      if (!appBaseUrl) return false;
      const parsed = parseInternalResourceUrl(value, appBaseUrl);
      if (!parsed) {
        if (showInvalid && value.trim()) setInputState('invalid');
        return false;
      }

      updateAttributes({
        resourceType: parsed.resourceType,
        resourceId: parsed.resourceId,
        resourceTitle: '',
        resourceIcon: '',
        href: parsed.href,
      });
      setInputState('idle');
      return true;
    },
    [appBaseUrl, updateAttributes],
  );

  useEffect(() => {
    if (!handler || !resourceId || storedTitle) return;
    const activeHandler = handler;
    let cancelled = false;

    async function loadTitle() {
      setIsLoading(true);
      try {
        const metadata = await activeHandler.getResourceMetadata(resourceId, resourceType);
        if (cancelled) return;
        if (metadata?.title) {
          updateAttributes({
            resourceTitle: metadata.title,
            resourceIcon: metadata.icon || '',
          });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadTitle();
    return () => {
      cancelled = true;
    };
  }, [handler, resourceId, resourceType, storedTitle, updateAttributes]);

  const label = useMemo(() => {
    if (storedTitle) return storedTitle;
    if (isLoading) return `Loading ${resourceType}...`;
    return getResourceFallbackLabel(resourceType, resourceId);
  }, [isLoading, resourceId, resourceType, storedTitle]);

  const openDocument = useCallback(() => {
    if (handler && resourceId) {
      handler.navigateToResource(resourceId, resourceType);
      return;
    }
    if (!href) return;
    window.open(href, '_blank', 'noopener,noreferrer');
  }, [handler, href, resourceId, resourceType]);

  const convertToBlock = useCallback(() => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos === undefined || pos < 0) return;

    const schema = editor.state.schema;
    const blockNodeType = schema.nodes.internalLinkBlock;
    if (!blockNodeType) return;

    const blockNode = blockNodeType.create({
      resourceType,
      resourceId,
      resourceTitle: storedTitle,
      resourceIcon,
    });

    editor.chain().focus().command(({ tr, dispatch, state }) => {
      const $pos = state.doc.resolve(pos);
      const parent = $pos.parent;

      if ($pos.depth > 0 && parent.isTextblock) {
        const beforeContent = parent.content.cut(0, $pos.parentOffset);
        const afterContent = parent.content.cut($pos.parentOffset + node.nodeSize);
        const replacementNodes = [];

        if (beforeContent.size > 0) {
          replacementNodes.push(parent.type.create(parent.attrs, beforeContent, parent.marks));
        }

        replacementNodes.push(blockNode);

        if (afterContent.size > 0) {
          replacementNodes.push(parent.type.create(parent.attrs, afterContent, parent.marks));
        }

        tr.replaceWith($pos.before(), $pos.after(), replacementNodes);
      } else {
        tr.replaceWith(pos, pos + node.nodeSize, blockNode);
      }

      dispatch?.(tr.scrollIntoView());
      return true;
    }).run();
  }, [editor, getPos, node.nodeSize, resourceIcon, resourceId, resourceType, storedTitle]);

  const toolbar = selected && editor.isEditable && !isInput ? (
    <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 50 }}>
      <div className="image-block-toolbar-floating">
        <Toolbar.Root className="editor-floating-toolbar">
          <span className="embed-toolbar-provider">{INTERNAL_APP_NAME}</span>
          <Separator.Root className="editor-floating-toolbar-separator" orientation="vertical" />
          <Toolbar.Button className="editor-floating-toolbar-button" onClick={convertToBlock} aria-label="Display as block link preview">
            <FiMaximize2 size={16} />
            <span>Block</span>
          </Toolbar.Button>
          <Toolbar.Button className="editor-floating-toolbar-button" onClick={openDocument} aria-label="Open internal link">
            <FiExternalLink size={16} />
            <span>Open</span>
          </Toolbar.Button>
          <Toolbar.Button className="editor-floating-toolbar-button" onClick={deleteNode} aria-label="Delete internal link">
            <FiTrash2 size={16} />
            <span>Delete</span>
          </Toolbar.Button>
        </Toolbar.Root>
      </div>
    </div>
  ) : null;

  if (isInput && editor.isEditable && appBaseUrl) {
    return (
      <NodeViewWrapper as="span" className="internal-doc-inline-wrapper" contentEditable={false}>
        <span className={`internal-doc-inline-input-chip${inputState === 'invalid' ? ' is-invalid' : ''}`}>
          <FiBox aria-hidden="true" className="internal-doc-inline-icon" />
          <input
            className="internal-doc-inline-input"
            value={draftUrl}
            placeholder="Paste document or whiteboard link"
            autoFocus
            onChange={(event) => {
              const nextValue = event.target.value;
              setDraftUrl(nextValue);
              setInputState('idle');
              resolveUrl(nextValue);
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData('text/plain');
              if (resolveUrl(pasted, true)) {
                event.preventDefault();
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                resolveUrl(draftUrl, true);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                deleteNode();
              }
              if (event.key === 'Backspace' && !draftUrl) {
                event.preventDefault();
                deleteNode();
              }
            }}
          />
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <>
      <NodeViewWrapper as="span" className="internal-doc-inline-wrapper" contentEditable={false} ref={refs.setReference}>
        <button
          type="button"
          className="internal-doc-inline-chip"
          onClick={openDocument}
          title={href || label}
        >
          <span className="internal-doc-inline-app-icon" aria-hidden="true">B</span>
          <span className="internal-doc-inline-provider">{INTERNAL_APP_NAME}</span>
          <span className="internal-doc-inline-divider">·</span>
          <span className="internal-doc-inline-title">{label}</span>
          {resourceIcon ? <span className="internal-doc-inline-resource-icon" aria-hidden="true">{resourceIcon}</span> : null}
        </button>
      </NodeViewWrapper>
      {toolbar}
    </>
  );
}
