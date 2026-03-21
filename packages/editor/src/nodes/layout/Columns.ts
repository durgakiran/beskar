import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ColumnsView } from '../../components/layout/ColumnsView';

export const Columns = Node.create({
  name: 'columns',

  group: 'block',

  content: 'column{2}',

  addAttributes() {
    return {
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

  parseHTML() {
    return [
      {
        tag: 'div[data-type="columns"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const blockAttrs = node.attrs.blockId ? {
      'data-block-id': node.attrs.blockId,
      class: 'block-node editor-columns',
    } : { class: 'editor-columns' };

    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'columns' }, blockAttrs),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ColumnsView);
  },
});

export default Columns;
