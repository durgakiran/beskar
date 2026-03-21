import { Node, mergeAttributes } from '@tiptap/core';

export const Column = Node.create({
  name: 'column',

  content: 'block+',

  addAttributes() {
    return {
      width: {
        default: null,
        parseHTML: element => element.getAttribute('data-width'),
        renderHTML: attributes => {
          if (!attributes.width) {
            return {};
          }
          return {
            'data-width': attributes.width,
            style: `flex-basis: ${attributes.width}%`,
          };
        },
      },
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
        tag: 'div[data-type="column"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const blockAttrs = node.attrs.blockId ? {
      'data-block-id': node.attrs.blockId,
      class: 'block-node editor-column',
    } : { class: 'editor-column' };

    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'column' }, blockAttrs),
      0,
    ];
  },
});

export default Column;
