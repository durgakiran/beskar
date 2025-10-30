/**
 * TableOfContentsView - React component for rendering table of contents
 * Automatically generates from headings in the document
 */

import React, { useEffect, useState, useCallback } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';

interface HeadingItem {
  id: string;
  level: number;
  text: string;
  pos: number;
}

export const TableOfContentsView: React.FC<NodeViewProps> = ({
  node,
  editor,
}) => {
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const { title, maxLevel } = node.attrs;

  // Extract headings from the document
  const updateHeadings = useCallback(() => {
    const items: HeadingItem[] = [];
    const { doc } = editor.state;

    doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const level = node.attrs.level;
        
        // Only include headings up to maxLevel
        if (level <= maxLevel) {
          // Generate a unique ID based on the heading text
          const text = node.textContent;
          const id = text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          
          items.push({
            id: id || `heading-${pos}`,
            level,
            text,
            pos,
          });
        }
      }
    });

    setHeadings(items);
  }, [editor, maxLevel]);

  // Update headings when document changes
  useEffect(() => {
    updateHeadings();

    // Listen to document updates
    const handleUpdate = () => {
      updateHeadings();
    };

    editor.on('update', handleUpdate);
    editor.on('transaction', handleUpdate);

    return () => {
      editor.off('update', handleUpdate);
      editor.off('transaction', handleUpdate);
    };
  }, [editor, updateHeadings]);

  // Scroll to heading when clicked
  const scrollToHeading = useCallback((pos: number) => {
    // Set selection to the heading position
    editor.chain().focus().setTextSelection(pos).run();
    
    // Scroll the heading into view
    const { view } = editor;
    const dom = view.nodeDOM(pos);
    
    if (dom && dom instanceof HTMLElement) {
      dom.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'start',
      });
    }
  }, [editor]);

  // Render hierarchical structure
  const renderHeadings = () => {
    if (headings.length === 0) {
      return (
        <div className="toc-empty">
          No headings found in document
        </div>
      );
    }

    return (
      <ul className="toc-list">
        {headings.map((heading, index) => (
          <li
            key={`${heading.id}-${index}`}
            className={`toc-item toc-level-${heading.level}`}
          >
            <span
              className="toc-link"
              onClick={() => scrollToHeading(heading.pos)}
              role="link"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  scrollToHeading(heading.pos);
                }
              }}
            >
              {heading.text}
            </span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <NodeViewWrapper
      className="table-of-contents"
      data-drag-handle
    >
      <div className="toc-container">
        {title && title.trim() !== '' && (
          <div className="toc-header">
            <div className="toc-title">{title}</div>
          </div>
        )}
        <div className="toc-content">
          {renderHeadings()}
        </div>
      </div>
    </NodeViewWrapper>
  );
};

