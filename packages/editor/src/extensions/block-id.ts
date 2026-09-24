import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { BLOCK_TYPES } from './block-movement';

export interface BlockIdOptions { types: string[] }
const INITIALIZE_IDS = 'initializeBlockIds';
const newId = () => `block-${crypto.randomUUID()}`;

/** Split and paste can inherit attributes. Repair identity once, after the document transaction. */
export function normalizeBlockIds(state: EditorState, types = BLOCK_TYPES): Transaction | null {
  const seen = new Set<string>();
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (!types.includes(node.type.name)) return;
    const $pos = state.doc.resolve(pos);
    let restricted = false;
    if (!node.isTextblock) {
      for (let depth = $pos.depth; depth > 0; depth--) {
        const parent = $pos.node(depth).type.name;
        if ((parent === 'table' && node.type.name !== 'table') ||
          (['listItem', 'taskItem'].includes(parent) && !['bulletList', 'orderedList', 'taskList'].includes(node.type.name))) restricted = true;
      }
    }
    const id = node.attrs.blockId as string | null;
    if (restricted) {
      if (id) tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: null });
      return;
    }
    if (!id || seen.has(id)) {
      const blockId = newId();
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId });
      seen.add(blockId);
    } else seen.add(id);
  });
  return tr.docChanged ? tr : null;
}

export const BlockId = Extension.create<BlockIdOptions>({
  name: 'blockId',
  addOptions: () => ({ types: BLOCK_TYPES }),
  addGlobalAttributes() {
    return [{
      // Tables render their identity on both the table and its custom wrapper.
      types: this.options.types.filter(type => type !== 'table'),
      attributes: {
        blockId: {
          default: null,
          keepOnSplit: false,
          parseHTML: element => element.getAttribute('data-block-id'),
          renderHTML: attributes => attributes.blockId ? { 'data-block-id': attributes.blockId, class: 'block-node', draggable: 'false' } : {},
        },
      },
    }];
  },
  addProseMirrorPlugins() {
    const types = this.options.types;
    return [new Plugin({
      key: new PluginKey('blockId'),
      props: {
        transformPasted(slice) {
          const strip = (node: PMNode): PMNode => {
            const children: PMNode[] = [];
            node.content.forEach(child => children.push(strip(child)));
            if (node.isText) return node;
            const attrs = types.includes(node.type.name) ? { ...node.attrs, blockId: null } : node.attrs;
            return node.type.create(attrs, Fragment.from(children), node.marks);
          };
          const children: PMNode[] = [];
          slice.content.forEach(node => children.push(strip(node)));
          return new Slice(Fragment.from(children), slice.openStart, slice.openEnd);
        },
      },
      view(view) {
        let destroyed = false;
        // React mounts the view after plugin construction. Never dispatch recursively in view.update.
        queueMicrotask(() => {
          if (!destroyed) view.dispatch(view.state.tr.setMeta(INITIALIZE_IDS, true).setMeta('addToHistory', false));
        });
        return { destroy() { destroyed = true; } };
      },
      appendTransaction(transactions, _old, state) {
        if (!transactions.some(tr => tr.docChanged || tr.getMeta(INITIALIZE_IDS))) return null;
        const tr = normalizeBlockIds(state, types);
        // Yjs uses the final transaction's history flag for the whole update. Repairs
        // after typing/paste must join that edit; only initialization is excluded.
        if (tr && (transactions.some(t => t.getMeta(INITIALIZE_IDS)) || transactions.every(t => t.getMeta('addToHistory') === false))) tr.setMeta('addToHistory', false);
        return tr;
      },
    })];
  },
});
export default BlockId;
