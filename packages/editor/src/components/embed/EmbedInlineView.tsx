import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import * as Toolbar from '@radix-ui/react-toolbar';
import * as Separator from '@radix-ui/react-separator';
import { useFloating, flip, shift, offset, autoUpdate } from '@floating-ui/react';
import { FiExternalLink, FiMaximize2, FiTrash2, FiBox } from 'react-icons/fi';
import {
  SiAirtable,
  SiExcalidraw,
  SiFigma,
  SiFramer,
  SiGoogledrive,
  SiGooglesheets,
  SiLoom,
  SiMiro,
  SiTypeform,
  SiVimeo,
  SiYoutube,
} from 'react-icons/si';
import { getProviderName, parseHttpsUrl, resolveEmbedTitle } from '../../nodes/embed/embed-providers';

function getHostLabel(rawUrl: string): string {
  const url = parseHttpsUrl(rawUrl);
  return url?.hostname.replace(/^www\./, '') || 'external content';
}

function ProviderIcon({ provider }: { provider: string }) {
  switch (provider) {
    case 'youtube':
      return <SiYoutube className="embed-inline-icon" aria-hidden="true" />;
    case 'vimeo':
      return <SiVimeo className="embed-inline-icon" aria-hidden="true" />;
    case 'loom':
      return <SiLoom className="embed-inline-icon" aria-hidden="true" />;
    case 'figma':
      return <SiFigma className="embed-inline-icon" aria-hidden="true" />;
    case 'miro':
      return <SiMiro className="embed-inline-icon" aria-hidden="true" />;
    case 'airtable':
      return <SiAirtable className="embed-inline-icon" aria-hidden="true" />;
    case 'typeform':
      return <SiTypeform className="embed-inline-icon" aria-hidden="true" />;
    case 'gdrive':
      return <SiGoogledrive className="embed-inline-icon" aria-hidden="true" />;
    case 'gsheets':
      return <SiGooglesheets className="embed-inline-icon" aria-hidden="true" />;
    case 'framer':
      return <SiFramer className="embed-inline-icon" aria-hidden="true" />;
    case 'excalidraw':
      return <SiExcalidraw className="embed-inline-icon" aria-hidden="true" />;
    default:
      return <FiBox className="embed-inline-icon" aria-hidden="true" />;
  }
}

export function EmbedInlineView({ node, editor, updateAttributes, selected, getPos }: NodeViewProps) {
  const { src, embedUrl, provider, title, error } = node.attrs as {
    src: string;
    embedUrl: string;
    provider: string;
    title: string;
    error: string;
  };
  const [resolvedTitle, setResolvedTitle] = useState(title || '');
  const [isLoadingTitle, setIsLoadingTitle] = useState(Boolean(src && !title));
  const providerName = getProviderName(provider);

  const { refs, floatingStyles } = useFloating({
    placement: 'top',
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (!src || title) {
      setResolvedTitle(title || '');
      setIsLoadingTitle(false);
      return;
    }

    let cancelled = false;

    async function loadTitle() {
      setIsLoadingTitle(true);
      const nextTitle = await resolveEmbedTitle(src, provider);
      if (cancelled) return;

      if (nextTitle) {
        setResolvedTitle(nextTitle);
        updateAttributes({ title: nextTitle });
      }
      setIsLoadingTitle(false);
    }

    void loadTitle();
    return () => {
      cancelled = true;
    };
  }, [provider, src, title, updateAttributes]);

  const label = useMemo(() => {
    if (resolvedTitle) return resolvedTitle;
    if (isLoadingTitle) return 'Resolving title...';
    return getHostLabel(src);
  }, [isLoadingTitle, resolvedTitle, src]);

  const deleteNode = useCallback(() => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos === undefined || pos < 0) return;
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  }, [editor, getPos, node.nodeSize]);

  const openInNewTab = useCallback(() => {
    if (!src) return;
    window.open(src, '_blank', 'noopener,noreferrer');
  }, [src]);

  const convertToBlock = useCallback(() => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos === undefined || pos < 0) return;

    const schema = editor.state.schema;
    const blockNodeType = schema.nodes.embedBlock;
    if (!blockNodeType) return;

    const blockNode = blockNodeType.create({
      src,
      embedUrl,
      provider,
      title: resolvedTitle,
      align: 'center',
      height: 480,
      error,
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
  }, [editor, embedUrl, error, getPos, node.nodeSize, provider, resolvedTitle, src]);

  const toolbar = selected && editor.isEditable ? (
    <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 50 }}>
      <div className="image-block-toolbar-floating embed-block-toolbar-floating">
        <Toolbar.Root className="editor-floating-toolbar">
          <span className="embed-toolbar-provider">{providerName}</span>
          <Separator.Root className="editor-floating-toolbar-separator" orientation="vertical" />
          <Toolbar.Button className="editor-floating-toolbar-button" onClick={convertToBlock} aria-label="Display as block embed">
            <FiMaximize2 size={16} />
            <span>Block</span>
          </Toolbar.Button>
          <Toolbar.Button className="editor-floating-toolbar-button" onClick={openInNewTab} aria-label="Open embed in new tab">
            <FiExternalLink size={16} />
            <span>Open</span>
          </Toolbar.Button>
          <Toolbar.Button className="editor-floating-toolbar-button" onClick={deleteNode} aria-label="Delete inline embed">
            <FiTrash2 size={16} />
            <span>Delete</span>
          </Toolbar.Button>
        </Toolbar.Root>
      </div>
    </div>
  ) : null;

  return (
    <>
      <NodeViewWrapper as="span" className="embed-inline-wrapper" contentEditable={false} ref={refs.setReference}>
        <button
          type="button"
          className={`embed-inline-chip${error ? ' is-error' : ''}`}
          onClick={openInNewTab}
          title={src || label}
        >
          <ProviderIcon provider={provider} />
          <span className="embed-inline-provider">{providerName}</span>
          <span className="embed-inline-divider">·</span>
          <span className="embed-inline-title">{label}</span>
        </button>
      </NodeViewWrapper>
      {toolbar}
    </>
  );
}
