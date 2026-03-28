import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';

function parseWidth(value: string | null): number | null {
  if (value == null || value === '') return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * ProseMirror content expressions do not support subtracting a type from `block`
 * (e.g. `(block - columns)+` throws at schema parse time). Nested layouts are
 * prevented by unwrapping any `columns` node that ends up inside a `column`.
 */

export const Column = Node.create({
  name: 'column',

  content: 'block+',

  isolating: true,

  selectable: false,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const { doc, schema } = newState;
          const columnType = schema.nodes.column;
          const columnsType = schema.nodes.columns;
          if (!columnType || !columnsType) return null;

          const hits: { pos: number; node: PMNode }[] = [];
          doc.descendants((node, pos) => {
            if (node.type !== columnsType) return;
            const $pos = doc.resolve(pos);
            if ($pos.parent.type === columnType) {
              hits.push({ pos, node });
            }
          });

          if (hits.length === 0) return null;

          hits.sort((a, b) => b.pos - a.pos);

          const tr = newState.tr;
          for (const { pos, node } of hits) {
            const blocks: PMNode[] = [];
            node.forEach((col) => {
              col.forEach((block) => {
                blocks.push(block);
              });
            });
            if (blocks.length === 0) {
              blocks.push(schema.nodes.paragraph.create());
            }
            tr.replaceWith(pos, pos + node.nodeSize, Fragment.from(blocks));
          }
          return tr;
        },
      }),
    ];
  },

  addAttributes() {
    return {
      width: {
        default: null,
        parseHTML: element => parseWidth(element.getAttribute('data-width')),
        renderHTML: attributes => {
          if (attributes.width == null) {
            return {};
          }
          return {
            'data-width': String(attributes.width),
            style: `flex-grow: 1; flex-shrink: 1; flex-basis: ${attributes.width}%`,
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
