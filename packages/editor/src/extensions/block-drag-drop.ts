import { Extension, type Command } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';
import { yUndoPluginKey } from '@tiptap/y-tiptap';
import { BLOCK_TYPES, BLOCK_MOVED, canMoveBlock, documentBlocks, selectedBlock, siblingDestination, moveBlockTransaction } from './block-movement';
import { BlockDragController } from './block-drag-controller';

export interface BlockDragDropOptions { types: string[] }
export interface BlockDragDropState {
  isDragging: boolean;
  draggedNodeType: string | null;
  activeId: string | null;
  draggingId: string | null;
  movedId: string | null;
  moveRevision: number;
}
export const blockDragDropKey = new PluginKey<BlockDragDropState>('blockDragDrop');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockDragDrop: {
      moveBlockUp: (blockId?: string) => ReturnType;
      moveBlockDown: (blockId?: string) => ReturnType;
      openBlockMenu: () => ReturnType;
    };
  }
}

export const BlockDragDrop = Extension.create<BlockDragDropOptions>({
  name: 'blockDragDrop',
  addOptions: () => ({ types: BLOCK_TYPES }),
  addCommands() {
    const move = (direction: -1 | 1, id?: string): Command => ({ state, dispatch }) => {
      if (!this.editor.isEditable) return false;
      const sourceId = id ?? selectedBlock(state, this.options.types)?.id;
      const destination = sourceId && siblingDestination(state, sourceId, direction, this.options.types);
      if (!destination || !sourceId || !canMoveBlock(state, sourceId, destination, this.options.types)) return false;
      if (!dispatch) return true;
      const tr = moveBlockTransaction(state, sourceId, destination, this.options.types);
      if (!tr) return false;
      if (dispatch) dispatch(tr);
      return true;
    };
    return {
      moveBlockUp: id => move(-1, id),
      moveBlockDown: id => move(1, id),
      openBlockMenu: () => ({ state, dispatch }) => {
        if (!this.editor.isEditable || !selectedBlock(state, this.options.types)) return false;
        if (dispatch) this.editor.view.dom.dispatchEvent(new CustomEvent('beskar:block-menu'));
        return true;
      },
    };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-ArrowUp': () => this.editor.commands.moveBlockUp(),
      'Mod-Alt-ArrowDown': () => this.editor.commands.moveBlockDown(),
      'Alt-F10': () => this.editor.commands.openBlockMenu(),
    };
  },
  addProseMirrorPlugins() {
    const types = this.options.types;
    return [new Plugin<BlockDragDropState>({
      key: blockDragDropKey,
      state: {
        init: () => ({ isDragging: false, draggedNodeType: null, activeId: null, draggingId: null, movedId: null, moveRevision: 0 }),
        apply(tr, value) {
          const next = { ...value, ...tr.getMeta(blockDragDropKey) };
          if (tr.getMeta(BLOCK_MOVED)) { next.movedId = tr.getMeta(BLOCK_MOVED); next.moveRevision++; }
          return next;
        },
      },
      props: {
        decorations(state) {
          const feedback = blockDragDropKey.getState(state)!;
          const decorations = documentBlocks(state.doc, types).flatMap(b => {
            const classes = [b.id === feedback.draggingId ? 'block-is-dragging' : '', b.id === feedback.activeId ? 'block-is-active' : '', b.id === feedback.movedId ? 'block-was-moved' : ''].filter(Boolean);
            return classes.length ? [Decoration.node(b.pos, b.pos + b.node.nodeSize, { class: classes.join(' ') })] : [];
          });
          return DecorationSet.create(state.doc, decorations);
        },
      },
      filterTransaction(tr, state) {
        if (tr.getMeta(BLOCK_MOVED)) yUndoPluginKey.getState(state)?.undoManager.stopCapturing();
        return true;
      },
      appendTransaction: (transactions, _old, state) => {
        // Separate subsequent typing from this one undoable move.
        if (transactions.some(tr => tr.getMeta(BLOCK_MOVED))) {
          // Yjs records the change during view update, after appendTransaction.
          queueMicrotask(() => {
            if (!this.editor.isDestroyed) yUndoPluginKey.getState(this.editor.state)?.undoManager.stopCapturing();
          });
          return closeHistory(state.tr);
        }
        return null;
      },
      view: view => new BlockDragController(view, this.editor, types),
    })];
  },
});
export default BlockDragDrop;
