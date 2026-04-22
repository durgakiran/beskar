/**
 * EmbedBlockView — external iframe embed with themed input, toolbar, and height resize.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Flex, Text, TextField } from '@radix-ui/themes';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useFloating, flip, shift, offset, autoUpdate } from '@floating-ui/react';
import * as Toolbar from '@radix-ui/react-toolbar';
import * as Separator from '@radix-ui/react-separator';
import {
  FiAlignCenter,
  FiAlignLeft,
  FiAlignRight,
  FiEdit2,
  FiExternalLink,
  FiTrash2,
} from 'react-icons/fi';
import {
  getEmbedUrlAndProvider,
  getProviderName,
  parseHttpsUrl,
} from '../../nodes/embed/embed-providers';

const MIN_EMBED_HEIGHT = 120;
const DEFAULT_EMBED_HEIGHT = 480;

function getHostLabel(rawUrl: string): string {
  const url = parseHttpsUrl(rawUrl);
  return url?.hostname.replace(/^www\./, '') || 'external content';
}

export function EmbedBlockView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const { src, embedUrl, provider, align, height, error } = node.attrs as {
    src: string;
    embedUrl: string;
    provider: string;
    align: 'left' | 'center' | 'right';
    height: number;
    error: string;
  };
  const [inputValue, setInputValue] = useState(src || '');
  const [inputError, setInputError] = useState('');
  const [isEditing, setIsEditing] = useState(!src);
  const [isInViewport, setIsInViewport] = useState(false);
  const [iframeStatus, setIframeStatus] = useState<'idle' | 'loading' | 'loaded' | 'blocked'>('idle');
  const [isResizing, setIsResizing] = useState(false);
  const [toolbarHovered, setToolbarHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizePreviewRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const providerName = getProviderName(provider);
  const hasLiveEmbed = Boolean(src && embedUrl && !error && !isEditing);
  const showToolbar = editor.isEditable && (selected || toolbarHovered) && !isResizing && !isEditing;

  const { refs, floatingStyles } = useFloating({
    placement: 'top',
    middleware: [offset(10), flip({ padding: 10 }), shift({ padding: 10 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (isEditing) {
      setInputValue(src || '');
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [isEditing, src]);

  useEffect(() => {
    if (!hasLiveEmbed || !containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [hasLiveEmbed]);

  useEffect(() => {
    if (!hasLiveEmbed || !isInViewport) {
      setIframeStatus('idle');
      return;
    }

    setIframeStatus('loading');
    const id = window.setTimeout(() => {
      setIframeStatus((current) => (current === 'loading' ? 'blocked' : current));
    }, 4500);

    return () => window.clearTimeout(id);
  }, [embedUrl, hasLiveEmbed, isInViewport]);

  const selectNode = useCallback(() => {
    if (!selected && typeof getPos === 'function') {
      const pos = getPos();
      if (pos !== undefined && pos >= 0) {
        editor.commands.setNodeSelection(pos);
      }
    }
  }, [editor, getPos, selected]);

  const commitUrl = useCallback(() => {
    const result = getEmbedUrlAndProvider(inputValue);
    if (!result) {
      setInputError('Enter a supported HTTPS embed URL.');
      return false;
    }

    setInputError('');
    updateAttributes({
      src: inputValue.trim(),
      embedUrl: result.embedUrl,
      provider: result.provider,
      error: '',
      height: height || DEFAULT_EMBED_HEIGHT,
    });
    setIsEditing(false);
    return true;
  }, [height, inputValue, updateAttributes]);

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

  const handleResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const startY = event.clientY;
      const initialHeight = height || DEFAULT_EMBED_HEIGHT;
      let latestHeight = initialHeight;
      setIsResizing(true);

      const onMove = (moveEvent: PointerEvent) => {
        latestHeight = Math.max(MIN_EMBED_HEIGHT, Math.round(initialHeight + moveEvent.clientY - startY));
        if (resizePreviewRef.current) {
          resizePreviewRef.current.style.height = `${latestHeight}px`;
        }
      };

      const onUp = () => {
        setIsResizing(false);
        if (resizePreviewRef.current) {
          resizePreviewRef.current.style.height = '';
        }
        updateAttributes({ height: latestHeight });
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [height, updateAttributes],
  );

  const toolbar = showToolbar ? (
    <div
      ref={refs.setFloating}
      style={{ ...floatingStyles, zIndex: 50, pointerEvents: 'auto' }}
      onMouseEnter={() => setToolbarHovered(true)}
      onMouseLeave={() => setToolbarHovered(false)}
    >
      <div className="image-block-toolbar-floating embed-block-toolbar-floating">
        <Toolbar.Root className="editor-floating-toolbar">
          <span className="embed-toolbar-provider">{providerName}</span>
          <Separator.Root className="editor-floating-toolbar-separator" orientation="vertical" />
          <Toolbar.Button className="editor-floating-toolbar-button" onClick={() => setIsEditing(true)} aria-label="Change embed URL">
            <FiEdit2 size={16} />
            <span>Change</span>
          </Toolbar.Button>
          <Toolbar.Button className="editor-floating-toolbar-button" onClick={openInNewTab} aria-label="Open embed in new tab">
            <FiExternalLink size={16} />
            <span>Open</span>
          </Toolbar.Button>
          <Toolbar.Button className="editor-floating-toolbar-button" onClick={deleteNode} aria-label="Delete embed">
            <FiTrash2 size={16} />
            <span>Delete</span>
          </Toolbar.Button>
          <Separator.Root className="editor-floating-toolbar-separator" orientation="vertical" />
          <Toolbar.Button className={`editor-floating-toolbar-button ${align === 'left' ? 'active' : ''}`} onClick={() => updateAttributes({ align: 'left' })} aria-label="Align left">
            <FiAlignLeft size={16} />
          </Toolbar.Button>
          <Toolbar.Button className={`editor-floating-toolbar-button ${align === 'center' ? 'active' : ''}`} onClick={() => updateAttributes({ align: 'center' })} aria-label="Align center">
            <FiAlignCenter size={16} />
          </Toolbar.Button>
          <Toolbar.Button className={`editor-floating-toolbar-button ${align === 'right' ? 'active' : ''}`} onClick={() => updateAttributes({ align: 'right' })} aria-label="Align right">
            <FiAlignRight size={16} />
          </Toolbar.Button>
        </Toolbar.Root>
      </div>
    </div>
  ) : null;

  const inputState = (
    <div className="embed-block-input-card" contentEditable={false}>
      <Flex direction="column" gap="3">
        <Text size="2" weight="medium">Embed external content</Text>
        <TextField.Root
          ref={inputRef}
          value={inputValue}
          placeholder="Paste a YouTube, Loom, Figma, Miro, Airtable, or Google link..."
          onChange={(event) => {
            setInputValue(event.target.value);
            if (inputError) setInputError('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitUrl();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              if (src) setIsEditing(false);
            }
          }}
        />
        {(inputError || error) && (
          <Text size="1" color="red">{inputError || error}</Text>
        )}
        <Flex gap="2" align="center">
          <Button type="button" size="2" onClick={commitUrl}>Embed</Button>
          {src && (
            <Button type="button" size="2" variant="soft" color="gray" onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
          )}
          {!src && (
            <Button type="button" size="2" variant="soft" color="red" onClick={deleteNode}>
              Remove
            </Button>
          )}
        </Flex>
      </Flex>
    </div>
  );

  const errorState = (
    <div className="embed-block-error-card" contentEditable={false}>
      <Text size="2" weight="medium">This link can’t be embedded</Text>
      <Text size="2" color="gray">{src || 'Unsupported embed URL'}</Text>
      <Flex gap="2">
        <Button type="button" size="2" variant="soft" onClick={() => setIsEditing(true)}>Change link</Button>
        {src && <Button type="button" size="2" variant="soft" color="gray" onClick={openInNewTab}>Open link</Button>}
        {editor.isEditable && <Button type="button" size="2" variant="soft" color="red" onClick={deleteNode}>Remove</Button>}
      </Flex>
    </div>
  );

  const liveState = (
    <div className="embed-block-live" ref={resizePreviewRef} style={{ height: `${height || DEFAULT_EMBED_HEIGHT}px` }} contentEditable={false}>
      {!isInViewport || iframeStatus === 'blocked' ? (
        <div className="embed-block-placeholder">
          <Text size="2" weight="medium">{providerName}</Text>
          <Text size="2" color="gray">
            {iframeStatus === 'blocked'
              ? 'This provider may require a public embed link or may block iframe display.'
              : getHostLabel(src)}
          </Text>
          {iframeStatus === 'blocked' && (
            <Button type="button" size="2" variant="soft" onClick={openInNewTab}>
              Open in new tab
            </Button>
          )}
        </div>
      ) : (
        <iframe
          title={`${providerName} embed`}
          src={embedUrl}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="fullscreen; clipboard-write; encrypted-media; picture-in-picture"
          onLoad={() => setIframeStatus('loaded')}
          onError={() => setIframeStatus('blocked')}
        />
      )}
      {editor.isEditable && selected && (
        <div
          className="embed-block-resize-handle"
          role="separator"
          aria-label="Resize embed height"
          onPointerDown={handleResizeStart}
        />
      )}
    </div>
  );

  const readOnlyEmptyState = (
    <div className="embed-block-empty-readonly" contentEditable={false}>
      <Text size="2" color="gray">Embed unavailable</Text>
    </div>
  );

  const content = isEditing
    ? inputState
    : error
      ? errorState
      : hasLiveEmbed
        ? liveState
        : editor.isEditable
          ? inputState
          : readOnlyEmptyState;

  return (
    <NodeViewWrapper
      ref={refs.setReference}
      className={`embed-block-wrapper align-${align || 'center'} ${selected ? 'ProseMirror-selectednode' : ''}`}
      data-align={align}
      data-drag-handle
      onClick={selectNode}
    >
      <div ref={containerRef} className="embed-block-container">
        {content}
      </div>
      {toolbar}
    </NodeViewWrapper>
  );
}
