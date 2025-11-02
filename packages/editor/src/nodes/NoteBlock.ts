/**
 * NoteBlock - A custom block node for displaying highlighted notes with icons
 * Supports rich text content, predefined themes, and custom styling
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
import { NoteBlockView } from '../components/note/NoteBlockView';

export interface NoteBlockAttributes {
  icon: 'info' | 'note' | 'success' | 'warning' | 'error' | 'emoji';
  emoji: string;
  backgroundColor: string;
  theme: 'info' | 'note' | 'success' | 'warning' | 'error' | 'custom';
}

export const NoteBlock = Node.create({
  name: 'noteBlock',
  group: 'block',
  content: 'inline*',
  draggable: true,
  
  addAttributes() {
    return {
      icon: {
        default: 'note',
        parseHTML: (element) => element.getAttribute('data-icon') || 'note',
        renderHTML: (attributes) => {
          return { 'data-icon': attributes.icon };
        },
      },
      emoji: {
        default: '📝',
        parseHTML: (element) => element.getAttribute('data-emoji') || '📝',
        renderHTML: (attributes) => {
          return { 'data-emoji': attributes.emoji };
        },
      },
      backgroundColor: {
        default: '#f3f0ff',
        parseHTML: (element) => element.getAttribute('data-background-color') || '#f3f0ff',
        renderHTML: (attributes) => {
          return { 'data-background-color': attributes.backgroundColor };
        },
      },
      theme: {
        default: 'note',
        parseHTML: (element) => element.getAttribute('data-theme') || 'note',
        renderHTML: (attributes) => {
          return { 'data-theme': attributes.theme };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="note-block"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    // Exclude blockId from serialization (it should be unique per block)
    // Extract blockId from both node.attrs and HTMLAttributes to ensure it's not serialized
    const { blockId: blockIdFromAttrs, ...nodeAttrsWithoutBlockId } = node.attrs;
    const { blockId: blockIdFromHTML, ...cleanHTMLAttributes } = HTMLAttributes as any;
    
    // Also remove data-block-id and block-node class if they exist in HTMLAttributes (following Table pattern)
    delete cleanHTMLAttributes['data-block-id'];
    delete cleanHTMLAttributes['draggable'];
    delete cleanHTMLAttributes['class']; // Remove block-node class if present
    
    return [
      'div',
      mergeAttributes(
        cleanHTMLAttributes,
        {
          'data-type': 'note-block',
          'data-icon': node.attrs.icon,
          'data-emoji': node.attrs.emoji,
          'data-background-color': node.attrs.backgroundColor,
          'data-theme': node.attrs.theme,
          class: 'note-block-wrapper',
        }
      ),
      [
        'div',
        {
          class: 'note-block-content-wrapper',
          style: `background-color: ${node.attrs.backgroundColor}`,
        },
        [
          'span',
          { class: node.attrs.icon === 'emoji' ? 'note-block-emoji' : 'note-block-icon' },
          node.attrs.icon === 'emoji' ? node.attrs.emoji : '',
        ],
        ['div', { class: 'note-block-content' }, 0],
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteBlockView);
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-n': () => {
        return this.editor
          .chain()
          .focus()
          .insertContent({
            type: this.name,
          })
          .run();
      },
    };
  },

  addProseMirrorPlugins() {
    const { isEditable } = this.editor;

    if (!isEditable) {
      return [];
    }

    return [
      // Plugin to sync blockId attribute to the React wrapper DOM
      new Plugin({
        view: (view) => {
          const updateNoteBlockWrappers = () => {
            // Find all noteBlock nodes and update their wrapper DOM elements
            view.state.doc.descendants((node, pos) => {
              if (node.type.name === 'noteBlock') {
                const blockId = node.attrs.blockId;
                const dom = view.nodeDOM(pos);
                
                if (dom) {
                  // For React NodeViews, the wrapper is .react-renderer
                  const htmlDom = dom as HTMLElement;
                  const wrapper = htmlDom.classList?.contains('react-renderer') 
                    ? htmlDom 
                    : htmlDom.closest?.('.react-renderer');
                  
                  if (wrapper) {
                    if (blockId) {
                      wrapper.setAttribute('data-block-id', blockId);
                      wrapper.classList.add('block-node');
                      wrapper.setAttribute('draggable', 'false');
                    } else {
                      wrapper.removeAttribute('data-block-id');
                      wrapper.classList.remove('block-node');
                      wrapper.removeAttribute('draggable');
                    }
                  }
                }
              }
            });
          };
          
          // Update on initial mount
          setTimeout(updateNoteBlockWrappers, 0);
          
          return {
            update: () => {
              updateNoteBlockWrappers();
            },
          };
        },
      }),
    ];
  },
});

export default NoteBlock;

