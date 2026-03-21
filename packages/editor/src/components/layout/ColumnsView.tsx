import React, { useCallback, useRef, useState, useEffect } from 'react';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useFloating, flip, shift, offset, autoUpdate } from '@floating-ui/react';
import { ColumnsFloatingMenu } from './ColumnsFloatingMenu';

export function ColumnsView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const latestWidthsRef = useRef<{ left: number, right: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);

  const { refs, floatingStyles } = useFloating({
    placement: 'bottom',
    middleware: [offset(10), flip({ padding: 10 }), shift({ padding: 10 })],
    whileElementsMounted: autoUpdate,
    open: showToolbar,
  });

  // Default widths are 50/50 initially
  const leftWidth = node.child(0)?.attrs.width || 50;
  const rightWidth = node.child(1)?.attrs.width || 50;

  // Monitor selection to show/hide handler or selection state
  useEffect(() => {
    const checkSelection = () => {
      if (!editor.isEditable) {
        setShowToolbar(false);
        return;
      }

      if (typeof getPos !== 'function') return;

      const pos = getPos();
      if (pos === undefined || pos === null || pos < 0) return;

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

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (!containerRef.current || !editor.isEditable) return;
      if (typeof getPos !== 'function') return;

      setIsResizing(true);
      const startX = e.clientX;
      const initialLeftWidth = leftWidth;
      const initialRightWidth = rightWidth;

      const containerWidth = containerRef.current.getBoundingClientRect().width;

      const handleMouseMove = (mouseEvent: MouseEvent) => {
        const deltaX = mouseEvent.clientX - startX;
        const deltaPercent = (deltaX / containerWidth) * 100;

        let newLeftWidth = initialLeftWidth + deltaPercent;
        let newRightWidth = initialRightWidth - deltaPercent;

        // Constraint minimum widths (e.g., min 10%)
        if (newLeftWidth < 10) {
          newRightWidth -= 10 - newLeftWidth;
          newLeftWidth = 10;
        } else if (newRightWidth < 10) {
          newLeftWidth -= 10 - newRightWidth;
          newRightWidth = 10;
        }

        // Update CSS variables on the wrapper to prevent ProseMirror from reverting DOM nodes for silky smooth dragging
        if (containerRef.current) {
          containerRef.current.style.setProperty('--left-column-width', `${newLeftWidth}%`);
          containerRef.current.style.setProperty('--right-column-width', `${newRightWidth}%`);
          
          const handle = containerRef.current.querySelector('.columns-resize-handle') as HTMLElement;
          if (handle) {
            handle.style.left = `calc(${newLeftWidth}% - 8px)`;
          }
        }
        
        // Save latest values to ref for mouseup to use
        latestWidthsRef.current = { left: newLeftWidth, right: newRightWidth };
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        
        // Clean up CSS variables to return control to React/Tiptap state
        if (containerRef.current) {
          containerRef.current.style.removeProperty('--left-column-width');
          containerRef.current.style.removeProperty('--right-column-width');
          
          const handle = containerRef.current.querySelector('.columns-resize-handle') as HTMLElement;
          if (handle) {
            handle.style.removeProperty('left');
          }
        }
        
        const finalWidths = latestWidthsRef.current;
        if (!finalWidths) return;

        // Update Tiptap only on mouseup
        const pos = getPos();
        if (pos !== undefined) {
           const transaction = editor.state.tr;
           const leftNodeSize = node.child(0).nodeSize;
           const leftNodePos = pos + 1;
           const rightNodePos = pos + 1 + leftNodeSize;

           transaction.setNodeMarkup(leftNodePos, undefined, {
             ...node.child(0).attrs,
             width: finalWidths.left,
           });

           transaction.setNodeMarkup(rightNodePos, undefined, {
             ...node.child(1).attrs,
             width: finalWidths.right,
           });

           editor.view.dispatch(transaction);
        }
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [editor, getPos, leftWidth, rightWidth, node]
  );

  return (
    <NodeViewWrapper
      ref={(node: HTMLElement | null) => {
        containerRef.current = node as HTMLDivElement;
        refs.setReference(node);
      }}
      className={`columns-wrapper ${showToolbar ? 'selected' : ''} ${isResizing ? 'resizing' : ''}`}
    >
      <div className="columns-container" style={{ display: 'flex', gap: '1rem', width: '100%', overflowX: 'auto', position: 'relative' }}>
        <NodeViewContent className="editor-columns columns-content" style={{ display: 'flex', width: '100%', gap: '1rem' }} />
      </div>
      
      <div 
        className="columns-resize-handle"
        onMouseDown={editor.isEditable ? startResize : undefined}
        contentEditable={false}
        style={{
          position: 'absolute',
          left: `calc(${leftWidth}% - 8px)`,
          top: 0,
          bottom: 0,
          width: '16px',
          cursor: editor.isEditable ? 'col-resize' : 'default',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ width: '2px', height: '100%', backgroundColor: '#e2e8f0', transition: 'background-color 0.15s ease' }} />
      </div>
      
      {showToolbar && editor.isEditable && (
        <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 50, pointerEvents: 'auto' }} className="image-block-toolbar-floating">
          <ColumnsFloatingMenu editor={editor} getPos={getPos} />
        </div>
      )}
    </NodeViewWrapper>
  );
}

export default ColumnsView;
