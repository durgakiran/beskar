/**
 * ImageBlockView - React component for rendering image blocks
 */

import React, { useState, useLayoutEffect, useRef, useCallback } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { ImageFloatingMenu } from './ImageFloatingMenu';
import { useFloating, flip, shift, offset, autoUpdate } from '@floating-ui/react';
import { getImagePasteStorage } from '../../extensions/image-paste-drop';

export function ImageBlockView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  let { src, alt, caption, align, width, height, isUploading } = node.attrs;
  if (typeof src === 'string') {
    const imageHandler = getImagePasteStorage(editor)?.imageHandler;
    if (imageHandler?.getImageUrl) {
      src = imageHandler.getImageUrl(src);
    }
  }
  const [isResizing, setIsResizing] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isToolbarHovered, setIsToolbarHovered] = useState(false);
  
  const { refs, floatingStyles } = useFloating({
    placement: 'bottom',
    middleware: [offset(10), flip({ padding: 10 }), shift({ padding: 10 })],
    whileElementsMounted: autoUpdate,
  });

  const showToolbar = (selected || isToolbarHovered || isMenuOpen) && !isResizing;

  const imageRef = useRef<HTMLImageElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const textarea = captionRef.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = '0px';
      const border = textarea.offsetHeight - textarea.clientHeight;
      textarea.style.height = `${textarea.scrollHeight + border}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    // Observe the image width, not the textarea height that this callback changes.
    if (textarea.parentElement) observer.observe(textarea.parentElement);
    return () => observer.disconnect();
  }, [caption, width, selected, editor.isEditable]);
  // containerRef is the element whose width we update live during drag.
  // Updating the container (not the <img>) means:
  //   • img (width:100%) follows automatically
  //   • handles stay on the container edges — they move with it
  //   • margin:0 auto keeps centred images centred throughout the drag
  const containerRef = useRef<HTMLDivElement>(null);

  const getMaxWidth = useCallback(() => {
    // The block wrapper already reflects cell, callout, list and column constraints.
    return containerRef.current?.parentElement?.clientWidth || 800;
  }, []);
  const resizeSession = useRef<{
    pointerId: number; startX: number; width: number; ratio: number;
    direction: 'left' | 'right'; factor: number; latest: number;
  } | null>(null);
  const clampWidth = (value: number) => Math.min(getMaxWidth(), Math.max(50, value));
  const commitWidth = (value: number, ratio: number) => {
    const nextWidth = Math.round(clampWidth(value));
    updateAttributes({ width: nextWidth, height: Math.max(1, nextWidth / ratio) });
  };

  const handleImageLoad = () => {
    if (editor.isEditable && imageRef.current && (!width || !height)) {
      const img = imageRef.current;
      const aspectRatio = img.naturalWidth / img.naturalHeight;
      const maxW = getMaxWidth();
      const constrainedWidth = Math.min(img.naturalWidth, maxW);
      updateAttributes({
        width: Math.round(constrainedWidth),
        height: Math.round(constrainedWidth / aspectRatio),
      });
    }
  };

  const getAspectRatio = (rect: DOMRect) => {
    const image = imageRef.current;
    return image?.naturalWidth && image.naturalHeight
      ? image.naturalWidth / image.naturalHeight
      : rect.width / rect.height;
  };

  const handleResizeStart = (e: React.PointerEvent<HTMLButtonElement>, direction: 'left' | 'right') => {
    if (!editor.isEditable || e.button !== 0 || resizeSession.current) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = imageRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeSession.current = {
      pointerId: e.pointerId, startX: e.clientX, width: rect.width,
      ratio: getAspectRatio(rect), direction,
      factor: !align || align === 'center' ? 2 : 1, latest: rect.width,
    };
    setIsResizing(true);
  };
  const handleResizeMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const session = resizeSession.current;
    if (!session || session.pointerId !== e.pointerId) return;
    const delta = (e.clientX - session.startX) * (session.direction === 'left' ? -1 : 1);
    session.latest = clampWidth(session.width + delta * session.factor);
    if (containerRef.current) containerRef.current.style.width = `${session.latest}px`;
  };
  const finishResize = (commit: boolean) => {
    const session = resizeSession.current;
    if (!session) return;
    resizeSession.current = null;
    if (containerRef.current) containerRef.current.style.width = width ? `${width}px` : 'auto';
    setIsResizing(false);
    if (commit && editor.isEditable) commitWidth(session.latest, session.ratio);
  };
  const handleResizeKey = (e: React.KeyboardEvent<HTMLButtonElement>, direction: 'left' | 'right') => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finishResize(false);
      return;
    }
    if (!editor.isEditable || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = imageRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    const delta = (e.key === 'ArrowRight' ? 1 : -1) * (direction === 'left' ? -1 : 1) * (e.shiftKey ? 25 : 10);
    commitWidth(e.key === 'Home' ? 50 : e.key === 'End' ? getMaxWidth() : rect.width + delta, getAspectRatio(rect));
  };

  const handleCaptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateAttributes({ caption: e.target.value });
  };

  const handleClick = () => {
    // This is needed to ensure the node is selected when clicking the image itself
    // as opposed to just the wrapper. Tiptap's NodeViewWrapper handles selection
    // but sometimes direct clicks on content inside might not register.
    if (!selected && typeof getPos === 'function') {
      const pos = getPos();
      if (pos !== undefined && pos !== null && pos >= 0) {
        editor.commands.setNodeSelection(pos);
      }
    }
  };

  // Render loading state
  if (isUploading) {
    return (
      <NodeViewWrapper className="image-block-wrapper">
        <div className="image-block-loading">
          <div className="image-loading-spinner" />
          <span>Uploading image...</span>
        </div>
      </NodeViewWrapper>
    );
  }

  // Render image
  return (
    <NodeViewWrapper
      ref={refs.setReference}
      className={`image-block-wrapper ${align ? `align-${align}` : ''} ${selected ? 'ProseMirror-selectednode' : ''}`}
      data-align={align}
    >
      <div
        ref={containerRef}
        className="image-block-container"
        style={{
          width: width ? `${width}px` : 'auto',
          maxWidth: '100%',
        }}
      >
        <div className="image-wrapper" onClick={handleClick}>
          {isUploading && (
            <div className="image-uploading-overlay">
              <div className="image-uploading-spinner" />
            </div>
          )}
          
          <img
            ref={imageRef}
            src={src}
            alt={alt || ''}
            style={{
              display: 'block',
              width: '100%',
              height: 'auto',
              // Reserve the right aspect-ratio slot before load so there's no layout jump.
              // The browser uses this to compute height from the container width on every
              // frame — including during drag — so resize is always smooth.
              aspectRatio: (width && height) ? `${width} / ${height}` : undefined,
            }}
            onLoad={handleImageLoad}
            draggable={false}
            loading="lazy"
          />

          {!isUploading && editor.isEditable && selected && (
            <>
              {(['left', 'right'] as const).filter(direction =>
                align === 'left' ? direction === 'right' : align === 'right' ? direction === 'left' : true
              ).map(direction => (
                <button
                  key={direction}
                  type="button"
                  className={`image-resize-handle image-resize-handle--${direction}`}
                  aria-label={`Resize image from ${direction}`}
                  title="Resize image. Arrow keys adjust width; Shift makes larger steps; Home sets minimum; End fits container."
                  onPointerDown={e => handleResizeStart(e, direction)}
                  onPointerMove={handleResizeMove}
                  onPointerUp={() => finishResize(true)}
                  onPointerCancel={() => finishResize(false)}
                  onLostPointerCapture={() => finishResize(false)}
                  onKeyDown={e => handleResizeKey(e, direction)}
                  onClick={e => e.stopPropagation()}
                />
              ))}
            </>
          )}
        </div>

        {/* Caption — editable input, shown when selected or already has content */}
        {(caption || selected) && editor.isEditable && (
          <div className="image-caption-wrapper" contentEditable={false}>
            <textarea
              ref={captionRef}
              rows={1}
              aria-label="Image caption"
              className={`image-caption-input${!caption ? ' is-empty' : ''}`}
              value={caption || ''}
              placeholder="Add a caption…"
              onChange={handleCaptionChange}
              onKeyDown={(e) => e.stopPropagation()}
              onKeyUp={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
        {caption && !editor.isEditable && (
          <div className="image-caption-readonly">{caption}</div>
        )}
      </div>

      {/* Floating Toolbar */}
      {showToolbar && !isUploading && (
        <div
          ref={refs.setFloating}
          style={{ ...floatingStyles, zIndex: 50, pointerEvents: 'auto' }}
          onMouseEnter={() => setIsToolbarHovered(true)}
          onMouseLeave={() => setIsToolbarHovered(false)}
        >
          <ImageFloatingMenu 
            editor={editor}
            getPos={getPos}
            currentAlign={align || 'center'}
            updateAttributes={updateAttributes}
            src={src}
            onMenuOpenChange={setIsMenuOpen}
          />
        </div>
      )}
    </NodeViewWrapper>
  );
}
