import React, { useState, useEffect } from 'react';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useFloating, flip, shift, offset, autoUpdate } from '@floating-ui/react';
import { ColumnsFloatingMenu } from './ColumnsFloatingMenu';

export function ColumnsView({ node, editor, getPos }: NodeViewProps) {
  const [showToolbar, setShowToolbar] = useState(false);

  const { refs, floatingStyles, isPositioned } = useFloating({
    placement: 'bottom',
    middleware: [offset(10), flip({ padding: 10 }), shift({ padding: 10 })],
    whileElementsMounted: autoUpdate,
    open: showToolbar,
  });

  useEffect(() => {
    if (node.attrs.columnCount !== node.childCount && typeof getPos === 'function') {
      const pos = getPos();
      if (pos !== undefined && pos >= 0) {
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            columnCount: node.childCount,
          })
        );
      }
    }
  }, [editor, getPos, node.attrs.columnCount, node.childCount]);

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

      const isInside =
        (from >= nodeStart && to <= nodeEnd) ||
        from === nodeStart;

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

  const columnCount = node.attrs.columnCount === 3 ? 3 : 2;

  const columnPlaceholderText =
    (editor.storage as { editorUi?: { columnLayoutPlaceholder?: string } }).editorUi
      ?.columnLayoutPlaceholder ?? '/ to insert';

  return (
    <NodeViewWrapper
      ref={(el: HTMLElement | null) => {
        refs.setReference(el);
      }}
      className={`columns-wrapper ${showToolbar ? 'selected' : ''}`}
      role="group"
      aria-label={`${columnCount}-column layout`}
      style={
        {
          ['--editor-column-placeholder' as string]: JSON.stringify(columnPlaceholderText),
        } as React.CSSProperties
      }
    >
      <div className="columns-container">
        <NodeViewContent className="editor-columns columns-content" />
      </div>

      {showToolbar && editor.isEditable && (
        <div
          ref={refs.setFloating}
          style={{
            ...floatingStyles,
            zIndex: 50,
            pointerEvents: 'auto',
            visibility: isPositioned ? 'visible' : 'hidden',
          }}
          className="image-block-toolbar-floating"
        >
          <ColumnsFloatingMenu editor={editor} getPos={getPos} columnsNode={node} />
        </div>
      )}
    </NodeViewWrapper>
  );
}

export default ColumnsView;
