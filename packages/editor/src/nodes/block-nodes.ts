/**
 * Extended block nodes with blockId support
 * These wrap StarterKit nodes to add block-level functionality
 */

import { Heading } from '@tiptap/extension-heading';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Blockquote } from '@tiptap/extension-blockquote';
import { CodeBlock } from '@tiptap/extension-code-block';
import { BulletList } from '@tiptap/extension-bullet-list';
import { OrderedList } from '@tiptap/extension-ordered-list';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { mergeAttributes } from '@tiptap/core';

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

export const BlockCodeBlock = CodeBlock.extend({
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

    return [
      'pre',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, blockAttrs),
      ['code', { class: node.attrs.language ? `language-${node.attrs.language}` : null }, 0],
    ];
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
