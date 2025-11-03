/**
 * Extended block nodes with blockId support
 * These wrap StarterKit nodes to add block-level functionality
 */

import { Heading } from '@tiptap/extension-heading';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Blockquote } from '@tiptap/extension-blockquote';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { BulletList } from '@tiptap/extension-bullet-list';
import { OrderedList } from '@tiptap/extension-ordered-list';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { ListItem } from '@tiptap/extension-list-item';
import { mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { createLowlight, common } from 'lowlight';

export const BlockHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => {
          if (!attributes.blockId) return {};
          return { 'data-block-id': attributes.blockId };
        },
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const hasLevel = this.options.levels.includes(node.attrs.level);
    const level = hasLevel ? node.attrs.level : this.options.levels[0];
    
    const blockAttrs = node.attrs.blockId ? {
      'data-block-id': node.attrs.blockId,
      class: 'block-node',
    } : {};

    return [
      `h${level}`,
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, blockAttrs),
      0,
    ];
  },
});

export const BlockParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => {
          if (!attributes.blockId) return {};
          return { 'data-block-id': attributes.blockId };
        },
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const blockAttrs = node.attrs.blockId ? {
      'data-block-id': node.attrs.blockId,
      class: 'block-node',
    } : {};

    return ['p', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, blockAttrs), 0];
  },
});

export const BlockBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => {
          if (!attributes.blockId) return {};
          return { 'data-block-id': attributes.blockId };
        },
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const blockAttrs = node.attrs.blockId ? {
      'data-block-id': node.attrs.blockId,
      class: 'block-node',
    } : {};

    return ['blockquote', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, blockAttrs), 0];
  },
});



export const BlockBulletList = BulletList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => {
          if (!attributes.blockId) return {};
          return { 'data-block-id': attributes.blockId };
        },
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const blockAttrs = node.attrs.blockId ? {
      'data-block-id': node.attrs.blockId,
      class: 'block-node',
    } : {};

    return ['ul', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, blockAttrs), 0];
  },
});

export const BlockOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => {
          if (!attributes.blockId) return {};
          return { 'data-block-id': attributes.blockId };
        },
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const blockAttrs = node.attrs.blockId ? {
      'data-block-id': node.attrs.blockId,
      class: 'block-node',
    } : {};

    const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, blockAttrs);
    
    // Add start attribute if not 1
    if (node.attrs.start && node.attrs.start !== 1) {
      attrs.start = node.attrs.start;
    }

    return ['ol', attrs, 0];
  },
});

export const BlockHorizontalRule = HorizontalRule.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => {
          if (!attributes.blockId) return {};
          return { 'data-block-id': attributes.blockId };
        },
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const blockAttrs = node.attrs.blockId ? {
      'data-block-id': node.attrs.blockId,
      class: 'block-node',
    } : {};

    return ['hr', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, blockAttrs)];
  },
});

// Create lowlight instance with common languages
const lowlight = createLowlight(common);

export const BlockCodeBlockLowlight = CodeBlockLowlight
  .extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        blockId: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-block-id'),
          renderHTML: (attributes) => {
            if (!attributes.blockId) return {};
            return { 'data-block-id': attributes.blockId };
          },
        },
      };
    },

    renderHTML({ node, HTMLAttributes }) {
      console.log('node', node.attrs);
      console.log('HTMLAttributes', HTMLAttributes);
      const blockAttrs = node.attrs.blockId ? {
        'data-block-id': node.attrs.blockId,
        class: 'block-node',
      } : {};
      const { blockId: blockIdFromHTML, ...cleanHTMLAttributes } = HTMLAttributes as any;

      return [
        'pre',
        mergeAttributes(cleanHTMLAttributes, { class: 'code-block-wrapper' }),
        ['code', { class: node.attrs.language ? `language-${node.attrs.language}` : null }, 0],
      ];
    },
  })
  .configure({
    lowlight,
    HTMLAttributes: {
      class: 'code-block-lowlight',
    },
    defaultLanguage: 'plaintext',
  });

export const BlockDetails = Details.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => {
          if (!attributes.blockId) return {};
          return { 'data-block-id': attributes.blockId };
        },
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const blockAttrs = node.attrs.blockId ? {
      'data-block-id': node.attrs.blockId,
      class: 'block-node',
    } : {};

    return ['details', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, blockAttrs), 0];
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() || []),
      new Plugin({
        key: new PluginKey('detailsEnterHandler'),
        props: {
          handleKeyDown: (view, event) => {
            // Only handle Enter key
            if (event.key !== 'Enter') {
              return false;
            }

            const { state, dispatch } = view;
            const { selection, doc } = state;
            const { $from } = selection;

            // Check if we're inside a details node
            let detailsNode = null;
            let detailsPos = -1;
            
            for (let depth = $from.depth; depth > 0; depth--) {
              const node = $from.node(depth);
              if (node.type.name === 'details') {
                detailsNode = node;
                detailsPos = $from.before(depth);
                break;
              }
            }

            if (!detailsNode) {
              return false;
            }

            // Check if details is closed (not open)
            const detailsElement = view.nodeDOM(detailsPos) as HTMLElement;
            const isOpen = detailsElement?.classList.contains(this.options.openClassName) || 
                          detailsElement?.hasAttribute('open');

            // If details is open, allow default behavior
            if (isOpen) {
              return false;
            }

            // If details is closed and cursor is at the end of summary
            // Check if we're in the summary node
            let inSummary = false;
            for (let depth = $from.depth; depth > 0; depth--) {
              const node = $from.node(depth);
              if (node.type.name === 'detailsSummary') {
                inSummary = true;
                break;
              }
            }

            if (!inSummary) {
              return false;
            }

            // Check if we're at the end of the summary
            const summaryNode = $from.node();
            const isAtEnd = $from.parentOffset === summaryNode.content.size;

            if (isAtEnd) {
              // Exit details block and create a new paragraph after it
              event.preventDefault();
              
              const posAfterDetails = detailsPos + detailsNode.nodeSize;
              
              // Use editor commands to create paragraph after details
              const editor = this.editor;
              if (editor) {
                editor.chain()
                  .setTextSelection(posAfterDetails)
                  .insertContent({ type: 'paragraph', content: [] })
                  .focus()
                  .run();
              }

              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});

export const BlockDetailsSummary = DetailsSummary.extend({
  // Do NOT add blockId to summary - it's part of the details block, not a separate block
  renderHTML({ HTMLAttributes }) {
    return ['summary', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
});

export const BlockDetailsContent = DetailsContent.extend({
  // Do NOT add blockId to content - it's part of the details block, not a separate block
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: 'details-content' }), 0];
  },
});

export const BlockListItem = ListItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => {
          if (!attributes.blockId) return {};
          return { 'data-block-id': attributes.blockId };
        },
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const blockAttrs = node.attrs.blockId ? {
      'data-block-id': node.attrs.blockId,
      class: 'block-node',
    } : {};

    return ['li', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, blockAttrs), 0];
  },
});
