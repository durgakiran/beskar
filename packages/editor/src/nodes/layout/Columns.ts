import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection, type Selection } from '@tiptap/pm/state';
import { exitNodeAfter } from '../../extensions/node-escape';
import { ColumnsView } from '../../components/layout/ColumnsView';

function columnIndexAtPos(columnsBefore: number, columnsNode: PMNode, pos: number): number {
  let offset = columnsBefore + 1;
  for (let i = 0; i < columnsNode.childCount; i++) {
    const col = columnsNode.child(i);
    const colEnd = offset + col.nodeSize;
    if (pos >= offset && pos < colEnd) {
      return i;
    }
    offset = colEnd;
  }
  return 0;
}

function columnStartPos(columnsBefore: number, columnsNode: PMNode, columnIndex: number): number {
  let p = columnsBefore + 1;
  for (let i = 0; i < columnIndex; i++) {
    p += columnsNode.child(i).nodeSize;
  }
  return p;
}

function firstSelectionInColumn(doc: PMNode, columnsBefore: number, columnsNode: PMNode, columnIndex: number): Selection | null {
  const colStart = columnStartPos(columnsBefore, columnsNode, columnIndex);
  const col = columnsNode.child(columnIndex);
  if (col.childCount === 0) return null;
  const first = col.child(0);
  const inner = colStart + 2;
  if (first.isTextblock) {
    try {
      return TextSelection.create(doc, Math.min(inner, doc.content.size));
    } catch {
      return TextSelection.near(doc.resolve(Math.min(inner, doc.content.size)));
    }
  }
  return TextSelection.near(doc.resolve(Math.min(inner, doc.content.size)));
}

function lastSelectionInColumn(doc: PMNode, columnsBefore: number, columnsNode: PMNode, columnIndex: number): Selection | null {
  const colStart = columnStartPos(columnsBefore, columnsNode, columnIndex);
  const col = columnsNode.child(columnIndex);
  if (col.childCount === 0) return null;
  let p = colStart + 1;
  for (let i = 0; i < col.childCount - 1; i++) {
    p += col.child(i).nodeSize;
  }
  const last = col.child(col.childCount - 1);
  const endPos = Math.min(p + last.nodeSize - 1, doc.content.size - 1);
  try {
    return TextSelection.create(doc, endPos);
  } catch {
    return TextSelection.near(doc.resolve(endPos), -1);
  }
}

export const Columns = Node.create({
  name: 'columns',

  group: 'block',

  content: 'column{2,3}',

  selectable: true,

  draggable: false,

  addAttributes() {
    return {
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => {
          if (!attributes.blockId) return {};
          // Must include class: 'block-node' so the drag-handle extension can
          // detect this element via closest('.react-renderer.block-node').
          return {
            'data-block-id': attributes.blockId,
            class: 'block-node',
            draggable: 'false',
          };
        },
      },
      columnCount: {
        default: 2,
        parseHTML: (element) => {
          const n = parseInt(element.getAttribute('data-column-count') ?? '2', 10);
          return n === 3 ? 3 : 2;
        },
        renderHTML: (attributes) => ({
          'data-column-count': String(attributes.columnCount ?? 2),
        }),
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

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;

        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d);
          if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') {
            return false;
          }
          if (n.type.name === 'columns') {
            const columnsNode = n;
            const columnsBefore = $from.before(d);
            const columnIndex = columnIndexAtPos(columnsBefore, columnsNode, $from.pos);
            const columnCount = columnsNode.childCount;

            if (columnIndex < columnCount - 1) {
              const sel = firstSelectionInColumn(state.doc, columnsBefore, columnsNode, columnIndex + 1);
              if (sel) {
                editor.view.dispatch(state.tr.setSelection(sel).scrollIntoView());
                return true;
              }
            } else {
              return exitNodeAfter(editor, columnsBefore + columnsNode.nodeSize);
            }
            return true;
          }
        }
        return false;
      },

      'Shift-Tab': ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;

        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d);
          if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') {
            return false;
          }
          if (n.type.name === 'columns') {
            const columnsNode = n;
            const columnsBefore = $from.before(d);
            const columnIndex = columnIndexAtPos(columnsBefore, columnsNode, $from.pos);
            if (columnIndex <= 0) {
              return true;
            }
            const sel = lastSelectionInColumn(state.doc, columnsBefore, columnsNode, columnIndex - 1);
            if (sel) {
              editor.view.dispatch(state.tr.setSelection(sel).scrollIntoView());
            }
            return true;
          }
        }
        return false;
      },
    };
  },
});

export default Columns;
