import type { Editor } from '@tiptap/core';

/**
 * Copy the entire columns block to clipboard
 */
export function copyColumnsBlock(editor: Editor): boolean {
  try {
    const { state } = editor;
    const { $from } = state.selection;
    
    let columnsBlockNode = null;
    let columnsBlockPos = -1;
    
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d);
      
      if (node.type.name === 'columns') {
        columnsBlockNode = node;
        columnsBlockPos = $from.start(d) - 1;
        break;
      }
    }
    
    if (!columnsBlockNode || columnsBlockPos < 0) {
      return false;
    }
    
    editor.chain()
      .focus()
      .setNodeSelection(columnsBlockPos)
      .run();
    
    setTimeout(() => {
      try {
        document.execCommand('copy');
        editor.commands.focus();
      } catch (err) {
        console.error('[copyColumnsBlock] Failed to execute copy command:', err);
      }
    }, 10);
    
    return true;
  } catch (error) {
    console.error('[copyColumnsBlock] Failed to copy columns block:', error);
    return false;
  }
}

/**
 * Delete the current columns block
 */
export function deleteColumnsBlock(editor: Editor): boolean {
  try {
    const { state } = editor;
    const { selection } = state;
    
    if (selection.from + 1 === selection.to) {
      const node = state.doc.nodeAt(selection.from);
      if (node && node.type.name === 'columns') {
        return editor.chain().focus().deleteSelection().run();
      }
    }
    
    const { $from } = selection;
    let columnsBlockPos = -1;
    
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d);
      
      if (node.type.name === 'columns') {
        columnsBlockPos = $from.start(d) - 1;
        break;
      }
    }
    
    if (columnsBlockPos < 0) {
      return false;
    }
    
    return editor
      .chain()
      .focus()
      .setNodeSelection(columnsBlockPos)
      .deleteSelection()
      .run();
  } catch (error) {
    console.error('[deleteColumnsBlock] Failed to delete columns block:', error);
    return false;
  }
}
