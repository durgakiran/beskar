/**
 * ImageBlockView - React component for rendering image blocks
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { ImageFloatingMenu } from './ImageFloatingMenu';
import { useFloating, flip, shift, offset, autoUpdate } from '@floating-ui/react';

export function ImageBlockView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const { src, alt, caption, align, width, height, isUploading } = node.attrs;
  const [isResizing, setIsResizing] = useState(false);
  const [isToolbarHovered, setIsToolbarHovered] = useState(false);
  
  const { refs, floatingStyles } = useFloating({
    placement: 'bottom',
    middleware: [offset(10), flip({ padding: 10 }), shift({ padding: 10 })],
    whileElementsMounted: autoUpdate,
  });

  const showToolbar = (selected || isToolbarHovered) && !isResizing && editor.isEditable;

  const imageRef = useRef<HTMLImageElement>(null);
  // containerRef is the element whose width we update live during drag.
  // Updating the container (not the <img>) means:
  //   • img (width:100%) follows automatically
  //   • handles stay on the container edges — they move with it
  //   • margin:0 auto keeps centred images centred throughout the drag
  const containerRef = useRef<HTMLDivElement>(null);

  const getMaxWidth = useCallback(() => {
    const el = containerRef.current ?? imageRef.current;
    const scope = el?.closest('.editor-column') ?? el?.closest('.ProseMirror');
    return (scope as HTMLElement | null)?.clientWidth ?? 800;
  }, []);

  const handleImageLoad = () => {
    if (imageRef.current && (!width || !height)) {
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

  const handleResizeStart = (e: React.MouseEvent, direction: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();

    if (!containerRef.current) return;

    const startX = e.clientX;
    const initWidth = width || containerRef.current.offsetWidth;
    const initHeight = height || (imageRef.current?.offsetHeight ?? initWidth);
    const aspectRatio = initWidth / initHeight;

    setIsResizing(true);

    let latestWidth = initWidth;
    let latestHeight = initHeight;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const maxW = getMaxWidth();
      // Left handle dragged right → shrink; right handle dragged right → grow
      const raw = direction === 'left' ? initWidth - delta : initWidth + delta;
      const newW = Math.max(100, Math.min(raw, maxW));
      const newH = newW / aspectRatio;

      latestWidth = Math.round(newW);
      latestHeight = Math.round(newH);

      // Drive the container width live — <img width:100%> and handles follow
      if (containerRef.current) {
        containerRef.current.style.width = `${latestWidth}px`;
      }
    };

    const onUp = () => {
      setIsResizing(false);
      // Remove inline override before React re-renders with committed attr value
      if (containerRef.current) {
        containerRef.current.style.width = '';
      }
      if (latestWidth && latestHeight) {
        updateAttributes({ width: latestWidth, height: latestHeight });
      }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleCaptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
              <div
                className="image-resize-handle image-resize-handle--left"
                onMouseDown={(e) => handleResizeStart(e, 'left')}
              />
              <div
                className="image-resize-handle image-resize-handle--right"
                onMouseDown={(e) => handleResizeStart(e, 'right')}
              />
            </>
          )}
        </div>

        {/* Caption — editable input, shown when selected or already has content */}
        {(caption || selected) && editor.isEditable && (
          <div className="image-caption-wrapper" contentEditable={false}>
            <input
              type="text"
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
          />
        </div>
      )}
    </NodeViewWrapper>
  );
}
