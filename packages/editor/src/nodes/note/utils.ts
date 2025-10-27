/**
 * Utility functions for NoteBlock operations
 */

import { Editor } from '@tiptap/core';
import type { NoteBlockAttributes } from '../NoteBlock';

/**
 * Copy the entire note block (with styling and attributes) to clipboard
 */
export function copyNoteBlock(editor: Editor): boolean {
  try {
    const { state } = editor;
    const { $from } = state.selection;
    
    console.log('[copyNoteBlock] Called', {
      from: state.selection.from,
      to: state.selection.to,
      depth: $from.depth,
      parentNode: $from.parent?.type.name,
    });
    
    // Find the note block node and its position
    let noteBlockNode = null;
    let noteBlockPos = -1;
    let noteBlockDepth = -1;
    
    // Check if we're inside a noteBlock
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d);
      console.log(`[copyNoteBlock] Depth ${d}:`, {
        name: node.type.name,
        content: node.textContent.substring(0, 50),
      });
      
      if (node.type.name === 'noteBlock') {
        noteBlockNode = node;
        noteBlockDepth = d;
        noteBlockPos = $from.start(d) - 1;
        console.log('[copyNoteBlock] Found noteBlock at depth', d, 'pos', noteBlockPos);
        break;
      }
    }
    
    if (!noteBlockNode || noteBlockPos < 0) {
      console.warn('[copyNoteBlock] Not inside a note block');
      return false;
    }
    
    // Calculate the end position of the note block
    const noteBlockEndPos = noteBlockPos + noteBlockNode.nodeSize;
    
    console.log('[copyNoteBlock] Selecting entire note block', {
      from: noteBlockPos,
      to: noteBlockEndPos,
      nodeSize: noteBlockNode.nodeSize,
      attrs: noteBlockNode.attrs,
    });
    
    // Select the entire note block node
    editor.chain()
      .focus()
      .setNodeSelection(noteBlockPos)
      .run();
    
    // Give the selection a moment to update, then trigger copy
    setTimeout(() => {
      try {
        // Trigger the browser's copy command
        document.execCommand('copy');
        console.log('[copyNoteBlock] Copy command executed');
        
        // Optionally, restore the original cursor position inside the note block
        // (so the user can continue editing)
        editor.commands.focus();
      } catch (err) {
        console.error('[copyNoteBlock] Failed to execute copy command:', err);
      }
    }, 10);
    
    return true;
  } catch (error) {
    console.error('[copyNoteBlock] Failed to copy note block:', error);
    return false;
  }
}

/**
 * Delete the current note block
 */
export function deleteNoteBlock(editor: Editor): boolean {
  try {
    return editor.chain().focus().deleteNode('noteBlock').run();
  } catch (error) {
    console.error('Failed to delete note block:', error);
    return false;
  }
}

/**
 * Insert a new note block at the current position
 */
export function insertNoteBlock(
  editor: Editor,
  attrs?: Partial<NoteBlockAttributes>
): boolean {
  try {
    const defaultAttrs = {
      blockId: null,
      icon: 'note' as const,
      emoji: '📝',
      backgroundColor: '#f3f0ff',
      theme: 'note' as const,
      ...attrs,
    };

    return editor
      .chain()
      .focus()
      .insertContent({
        type: 'noteBlock',
        attrs: defaultAttrs,
      })
      .run();
  } catch (error) {
    console.error('Failed to insert note block:', error);
    return false;
  }
}

