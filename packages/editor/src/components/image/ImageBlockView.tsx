/**
 * ImageBlockView - React component for rendering image blocks
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { ImageFloatingMenu } from './ImageFloatingMenu';
import { useFloating, flip, shift, offset, autoUpdate } from '@floating-ui/react';

export function ImageBlockView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const { src, alt, title, align, width, height, isUploading } = node.attrs;
  const [isResizing, setIsResizing] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  
  const { refs, floatingStyles } = useFloating({
    placement: 'bottom',
    middleware: [offset(10), flip({ padding: 10 }), shift({ padding: 10 })],
    whileElementsMounted: autoUpdate,
    open: showToolbar,
  });

  const imageRef = useRef<HTMLImageElement>(null);
  const resizeStartRef = useRef<{ startX: number; startY: number; width: number; height: number; aspectRatio: number; direction: string } | null>(null);

  // Get dynamic max width based on the parent container
  const getMaxWidth = useCallback(() => {
    // We walk up to find the closest appropriate constraint container
    // Either the column or the editor text area itself
    const container = imageRef.current?.closest('.editor-column') || imageRef.current?.closest('.ProseMirror');
    return container?.clientWidth || 800;
  }, []);

  // Debug: Log when node attributes change
  useEffect(() => {
    console.log('[ImageBlockView] Node attrs changed:', { width, height, align, src: src.substring(0, 50) });
  }, [width, height, align, src]);

  // Monitor selection to show/hide toolbar
  useEffect(() => {
    setShowToolbar(selected && editor.isEditable);
  }, [selected, editor.isEditable]);

  // Handle image load to set initial dimensions
  const handleImageLoad = () => {
    if (imageRef.current && (!width || !height)) {
      const img = imageRef.current;
      const aspectRatio = img.naturalWidth / img.naturalHeight;
      const currentMaxWidth = getMaxWidth();
      const constrainedWidth = Math.min(img.naturalWidth, currentMaxWidth);
      const constrainedHeight = constrainedWidth / aspectRatio;

      updateAttributes({
        width: Math.round(constrainedWidth),
        height: Math.round(constrainedHeight),
      });
    }
  };

  // Resize handlers
  const handleResizeStart = (e: React.MouseEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!imageRef.current) return;

    const img = imageRef.current;
    const currentWidth = width || img.width;
    const currentHeight = height || img.height;
    const aspectRatio = currentWidth / currentHeight;

    resizeStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      width: currentWidth,
      height: currentHeight,
      aspectRatio,
      direction,
    };

    setIsResizing(true);
    
    console.log('[ImageResize] Started resizing:', resizeStartRef.current);

    let latestWidth = currentWidth;
    let latestHeight = currentHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeStartRef.current || !imageRef.current) return;

      const { startX, width: initialWidth, aspectRatio, direction } = resizeStartRef.current;
      const deltaX = moveEvent.clientX - startX;
      const currentMaxWidth = getMaxWidth();
      
      let newWidth = initialWidth;

      if (direction.includes('left')) {
        newWidth = initialWidth - deltaX;
      } else { // 'right'
        newWidth = initialWidth + deltaX;
      }

      newWidth = Math.max(100, Math.min(newWidth, currentMaxWidth));
      const newHeight = newWidth / aspectRatio;

      latestWidth = Math.round(newWidth);
      latestHeight = Math.round(newHeight);

      // Temporarily update the image element's style for visual feedback
      imageRef.current.style.width = `${latestWidth}px`;
      imageRef.current.style.height = `${latestHeight}px`;
    };

    const handleMouseUp = () => {
      console.log('[ImageResize] Mouse up, final dimensions:', { width: latestWidth, height: latestHeight });
      setIsResizing(false);
      
      if (resizeStartRef.current && latestWidth && latestHeight) {
        // Update attributes with the final dimensions
        console.log('[ImageResize] About to update attributes with:', { width: latestWidth, height: latestHeight });
        console.log('[ImageResize] Current node attrs before update:', { width, height });
        updateAttributes({
          width: latestWidth,
          height: latestHeight,
        });
        console.log('[ImageResize] updateAttributes called');
      }

      // Reset image element style
      if (imageRef.current) {
        imageRef.current.style.width = '100%';
        imageRef.current.style.height = height ? `${height}px` : 'auto';
      }

      resizeStartRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleTitleChange = (newTitle: string) => {
    updateAttributes({ title: newTitle });
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
            title={title || ''}
            style={{ 
              width: '100%',
              height: height ? `${height}px` : 'auto' 
            }}
            onLoad={handleImageLoad}
            draggable={false}
            loading="lazy"
          />

          {!isUploading && editor.isEditable && selected && (
            <>
              {/* Resize handles */}
              <div 
                className="image-resize-handle top-left" 
                onMouseDown={(e) => handleResizeStart(e, 'top-left')}
              />
              <div 
                className="image-resize-handle top-right" 
                onMouseDown={(e) => handleResizeStart(e, 'top-right')}
              />
              <div 
                className="image-resize-handle bottom-left" 
                onMouseDown={(e) => handleResizeStart(e, 'bottom-left')}
              />
              <div 
                className="image-resize-handle bottom-right" 
                onMouseDown={(e) => handleResizeStart(e, 'bottom-right')}
              />
            </>
          )}
        </div>

        {/* Caption */}
        {(title || selected) && (
          <div className={`image-caption ${!title && selected ? 'is-empty' : ''}`}>
            {title || (selected ? 'Add a caption...' : '')}
          </div>
        )}
      </div>

      {/* Floating Toolbar */}
      {showToolbar && !isResizing && !isUploading && editor.isEditable && (
        <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 50, pointerEvents: 'auto' }}>
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
