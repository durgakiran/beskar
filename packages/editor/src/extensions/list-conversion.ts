import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { documentBlocks } from './block-movement';

export const LIST_TYPES = ['bulletList', 'orderedList', 'taskList'] as const;
export type ListType = typeof LIST_TYPES[number];

const itemTypeFor = (type: ListType) => type === 'taskList' ? 'taskItem' : 'listItem';

/** Convert one root list without changing its items, nested blocks, or block ID. */
export function convertListBlockTransaction(state: EditorState, id: string, target: ListType): Transaction | null {
  const source = documentBlocks(state.doc).find(block => block.id === id);
  if (!source || !LIST_TYPES.includes(source.node.type.name as ListType) || source.node.type.name === target) return null;

  const listType = state.schema.nodes[target];
  const itemType = state.schema.nodes[itemTypeFor(target)];
  if (!listType || !itemType) return null;

  const items: PMNode[] = [];
  try {
    source.node.forEach(item => {
      if (item.type.name !== 'listItem' && item.type.name !== 'taskItem') throw new Error('Invalid list item');
      items.push(itemType.createChecked(item.attrs, item.content, item.marks));
    });
    const converted = listType.createChecked(source.node.attrs, Fragment.from(items), source.node.marks);
    const tr = state.tr.replaceWith(source.pos, source.pos + source.node.nodeSize, converted);

    // Both item types have the same content structure, so text offsets remain valid.
    const selection = state.selection;
    if (selection.from >= source.pos && selection.to <= source.pos + source.node.nodeSize) {
      if (selection instanceof TextSelection) {
        tr.setSelection(TextSelection.create(tr.doc, selection.anchor, selection.head));
      } else if (selection instanceof NodeSelection && selection.from === source.pos) {
        tr.setSelection(NodeSelection.create(tr.doc, source.pos));
      }
    }
    return tr;
  } catch {
    return null;
  }
}
