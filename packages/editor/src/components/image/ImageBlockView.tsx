/**
 * ImageBlockView - React component for rendering image blocks
 */

import React, { useState, useEffect, useRef } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { ImageCaption } from './ImageCaption';
import { ImageFloatingMenu } from './ImageFloatingMenu';

const MAX_WIDTH = 800;

export function ImageBlockView({ node, editor, updateAttributes, getPos }: NodeViewProps) {
  const { src, alt, width, height, caption, uploadStatus, align } = node.attrs;
  const [showToolbar, setShowToolbar] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dimensions, setDimensions] = useState({ width, height });
  const imageRef = useRef<HTMLImageElement>(null);
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // Debug: Log when node attributes change
  useEffect(() => {
    console.log('[ImageBlockView] Node attrs changed:', { width, height, align, src: src.substring(0, 50) });
  }, [width, height, align, src]);

  // Monitor selection to show/hide toolbar
  useEffect(() => {
    const checkSelection = () => {
      if (!editor.isEditable) {
        setShowToolbar(false);
        return;
      }

      if (typeof getPos !== 'function') {
        setShowToolbar(false);
        return;
      }

      const pos = getPos();
      if (pos === undefined || pos === null || pos < 0) {
        setShowToolbar(false);
        return;
      }

      const { from, to } = editor.state.selection;
      const nodeStart = pos;
      const nodeEnd = pos + node.nodeSize;

      const isInside = from >= nodeStart && to <= nodeEnd;
      setShowToolbar(isInside);
    };

    checkSelection();

    editor.on('selectionUpdate', checkSelection);
    editor.on('transaction', checkSelection);

    return () => {
      editor.off('selectionUpdate', checkSelection);
      editor.off('transaction', checkSelection);
    };
  }, [editor, getPos, node.nodeSize]);

  // Update dimensions when attributes change
  useEffect(() => {
    console.log('[ImageBlockView] Syncing dimensions from node attrs:', { width, height });
    setDimensions({ width, height });
  }, [width, height]);

  // Handle image load to set initial dimensions
  const handleImageLoad = () => {
    if (imageRef.current && (!width || !height)) {
      const img = imageRef.current;
      const aspectRatio = img.naturalWidth / img.naturalHeight;
      const constrainedWidth = Math.min(img.naturalWidth, MAX_WIDTH);
      const constrainedHeight = constrainedWidth / aspectRatio;

      updateAttributes({
        width: Math.round(constrainedWidth),
        height: Math.round(constrainedHeight),
      });
    }
  };

  // Resize handlers
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!imageRef.current) return;

    const img = imageRef.current;
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: dimensions.width || img.width,
      height: dimensions.height || img.height,
    };

    setIsResizing(true);
    
    console.log('[ImageResize] Started resizing:', resizeStartRef.current);

    // Store the latest dimensions during resize
    let latestWidth = resizeStartRef.current.width;
    let latestHeight = resizeStartRef.current.height;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeStartRef.current || !imageRef.current) return;

      const deltaX = moveEvent.clientX - resizeStartRef.current.x;
      const aspectRatio = resizeStartRef.current.width / resizeStartRef.current.height;
      
      let newWidth = resizeStartRef.current.width + deltaX;
      newWidth = Math.max(100, Math.min(newWidth, MAX_WIDTH));
      const newHeight = newWidth / aspectRatio;

      latestWidth = Math.round(newWidth);
      latestHeight = Math.round(newHeight);

      setDimensions({
        width: latestWidth,
        height: latestHeight,
      });
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

      resizeStartRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleCaptionChange = (newCaption: string) => {
    updateAttributes({ caption: newCaption });
  };

  // Render loading state
  if (uploadStatus === 'uploading') {
    return (
      <NodeViewWrapper className="image-block-wrapper">
        <div className="image-block-loading">
          <div className="image-loading-spinner" />
          <span>Uploading image...</span>
        </div>
      </NodeViewWrapper>
    );
  }

  // Render error state
  if (uploadStatus === 'error') {
    return (
      <NodeViewWrapper className="image-block-wrapper">
        <div className="image-block-error">
          <span>Failed to upload image</span>
        </div>
      </NodeViewWrapper>
    );
  }

  // Render image
  return (
    <NodeViewWrapper
      className={`image-block-wrapper image-align-${align || 'center'} ${showToolbar ? 'selected' : ''} ${isResizing ? 'resizing' : ''}`}
      data-align={align || 'center'}
    >
      <div className="image-block-container">
        <div className="image-block-image-wrapper">
          <img
            ref={imageRef}
            src={src}
            alt={alt}
            width={dimensions.width || undefined}
            height={dimensions.height || undefined}
            className="image-block-img"
            onLoad={handleImageLoad}
            draggable={false}
          />
          {showToolbar && editor.isEditable && (
            <div
              className="image-resize-handle image-resize-handle-right"
              onMouseDown={startResize}
            />
          )}
        </div>
        <ImageCaption
          caption={caption}
          editor={editor}
          onCaptionChange={handleCaptionChange}
        />
      </div>
      {showToolbar && editor.isEditable && (
        <ImageFloatingMenu 
          editor={editor} 
          getPos={getPos}
          currentAlign={align || 'center'}
          updateAttributes={updateAttributes}
        />
      )}
    </NodeViewWrapper>
  );
}

