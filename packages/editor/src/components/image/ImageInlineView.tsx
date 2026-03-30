/**
 * ImageInlineView — React NodeView for inline images.
 * Renders as a <span> so it flows within text content.
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useFloating, flip, shift, offset, autoUpdate } from '@floating-ui/react';
import { FiTrash2, FiCopy } from 'react-icons/fi';
import * as Toolbar from '@radix-ui/react-toolbar';
import * as Separator from '@radix-ui/react-separator';

const DEFAULT_INLINE_HEIGHT = 24;
const MIN_HEIGHT = 16;
const MAX_HEIGHT = 600;

export function ImageInlineView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
  deleteNode,
}: NodeViewProps) {
  const { src, alt, width, height, uploadStatus } = node.attrs;
  const imgRef = useRef<HTMLImageElement>(null);
  const [isResizing, setIsResizing] = useState(false);

  // ── Hover-based toolbar visibility ──────────────────────────────────────────
  // We track hover on BOTH the image element and the toolbar with a shared
  // debounced hide so the mouse can cross the floating gap without the toolbar
  // collapsing.  The toolbar is always mounted (opacity/pointer-events only),
  // which avoids the race where conditional rendering unmounts it before
  // onMouseEnter can fire.
  const [isHovered, setIsHovered] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleMouseEnter = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    setIsHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    hideTimerRef.current = setTimeout(() => setIsHovered(false), 150);
  }, []);

  useEffect(() => () => { clearTimeout(hideTimerRef.current); }, []);

  const toolbarVisible = isHovered && editor.isEditable && !isResizing;

  const { refs, floatingStyles } = useFloating({
    placement: 'top',
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleImageLoad = useCallback(() => {
    if (!imgRef.current || width || height) return;
    const img = imgRef.current;
    const naturalH = img.naturalHeight || DEFAULT_INLINE_HEIGHT;
    const naturalW = img.naturalWidth || DEFAULT_INLINE_HEIGHT;
    const targetH = Math.min(naturalH, DEFAULT_INLINE_HEIGHT);
    updateAttributes({
      width: Math.round((naturalW / naturalH) * targetH),
      height: targetH,
    });
  }, [width, height, updateAttributes]);

  const handleClick = useCallback(() => {
    if (!selected && typeof getPos === 'function') {
      const pos = getPos();
      if (pos !== undefined && pos >= 0) editor.commands.setNodeSelection(pos);
    }
  }, [selected, getPos, editor]);

  const handleCopy = useCallback(() => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos === undefined) return;
    editor.chain().setNodeSelection(pos).run();
    setTimeout(() => {
      document.execCommand('copy');
      editor.commands.focus();
    }, 10);
  }, [getPos, editor]);

  const handleDelete = useCallback(() => deleteNode(), [deleteNode]);

  /** Convert this inline image to a block image placed after the parent paragraph. */
  const handleConvertToBlock = useCallback(() => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos === undefined) return;

    const { schema } = editor.state;
    const blockNode = schema.nodes.imageBlock?.create({ src, alt, width, height, uploadStatus });
    if (!blockNode) return;

    editor
      .chain()
      .focus()
      .command(({ tr, state }) => {
        const $pos = state.doc.resolve(pos);
        const afterParent = $pos.after($pos.depth);
        tr.delete(pos, pos + node.nodeSize);
        tr.insert(afterParent - node.nodeSize, blockNode);
        return true;
      })
      .run();
  }, [getPos, editor, src, alt, width, height, uploadStatus, node.nodeSize]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!imgRef.current) return;

      const startX = e.clientX;
      const startW = width || imgRef.current.offsetWidth || DEFAULT_INLINE_HEIGHT;
      const startH = height || imgRef.current.offsetHeight || DEFAULT_INLINE_HEIGHT;
      const aspectRatio = startW / startH;

      setIsResizing(true);
      let latestW = startW;
      let latestH = startH;

      const onMove = (ev: MouseEvent) => {
        const newW = Math.max(MIN_HEIGHT, startW + (ev.clientX - startX));
        const newH = Math.max(MIN_HEIGHT, Math.min(Math.round(newW / aspectRatio), MAX_HEIGHT));
        latestW = Math.round(newH * aspectRatio);
        latestH = newH;
        if (imgRef.current) {
          imgRef.current.style.width = `${latestW}px`;
          imgRef.current.style.height = `${latestH}px`;
        }
      };

      const onUp = () => {
        setIsResizing(false);
        updateAttributes({ width: latestW, height: latestH });
        if (imgRef.current) {
          imgRef.current.style.width = '';
          imgRef.current.style.height = '';
        }
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [width, height, updateAttributes],
  );

  // ── Render states ────────────────────────────────────────────────────────────

  const imgStyle: React.CSSProperties = {
    width: width ? `${width}px` : undefined,
    height: height ? `${height}px` : `${DEFAULT_INLINE_HEIGHT}px`,
    display: 'inline-block',
    verticalAlign: 'middle',
  };

  if (uploadStatus === 'uploading') {
    return (
      <NodeViewWrapper as="span" className="image-inline-wrapper image-inline-uploading">
        <span className="image-inline-upload-spinner" contentEditable={false} title="Uploading…" />
      </NodeViewWrapper>
    );
  }

  if (uploadStatus === 'error') {
    return (
      <NodeViewWrapper as="span" className="image-inline-wrapper image-inline-error">
        <span className="image-inline-error-chip" contentEditable={false}>
          <span className="image-inline-error-icon">⚠</span>
          <button type="button" className="image-inline-remove-btn" onClick={handleDelete} title="Remove">
            ✕
          </button>
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      ref={refs.setReference}
      className={`image-inline-wrapper${selected ? ' image-inline-selected' : ''}`}
    >
      {/* Image + resize handle */}
      <span
        className={`image-inline-inner${isResizing ? ' image-inline-resizing' : ''}`}
        contentEditable={false}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt || ''}
          style={imgStyle}
          onLoad={handleImageLoad}
          draggable={false}
          loading="lazy"
          className="image-inline-img"
        />
        {selected && editor.isEditable && !isResizing && (
          <span
            className="image-inline-resize-handle"
            onMouseDown={handleResizeStart}
            title="Drag to resize"
          />
        )}
      </span>

      {/* Floating toolbar — always mounted when editable so onMouseEnter can fire.
          Visibility + pointer-events controlled via inline styles. */}
      {editor.isEditable && uploadStatus === 'idle' && (
        <div
          ref={refs.setFloating}
          style={{
            ...floatingStyles,
            zIndex: 50,
            opacity: toolbarVisible ? 1 : 0,
            pointerEvents: toolbarVisible ? 'auto' : 'none',
            transition: 'opacity 0.12s ease',
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="image-block-toolbar-floating">
            <Toolbar.Root className="editor-floating-toolbar">

              <Toolbar.Button
                className="editor-floating-toolbar-button"
                onClick={handleCopy}
                aria-label="Copy image"
                title="Copy"
              >
                <FiCopy size={15} />
                <span>Copy</span>
              </Toolbar.Button>

              <Separator.Root className="editor-floating-toolbar-separator" orientation="vertical" />

              {/* Convert to block */}
              <Toolbar.Button
                className="editor-floating-toolbar-button"
                onClick={handleConvertToBlock}
                aria-label="Convert to block image"
                title="Convert to block image"
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="3" width="14" height="10" rx="1.5" />
                  <path d="M1 6h14" />
                </svg>
                <span>Block</span>
              </Toolbar.Button>

              <Separator.Root className="editor-floating-toolbar-separator" orientation="vertical" />

              <Toolbar.Button
                className="editor-floating-toolbar-button danger"
                onClick={handleDelete}
                aria-label="Delete image"
                title="Delete"
              >
                <FiTrash2 size={15} />
                <span>Delete</span>
              </Toolbar.Button>

            </Toolbar.Root>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}
