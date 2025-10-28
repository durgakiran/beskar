/**
 * Utility functions for ImageBlock operations
 */

import type { Editor } from '@tiptap/core';

export interface ImageBlockAttributes {
  src?: string;
  alt?: string;
  width?: number | null;
  height?: number | null;
  caption?: string;
  uploadStatus?: 'idle' | 'uploading' | 'error';
  align?: 'left' | 'center' | 'right';
}

/**
 * Insert an image block into the editor
 */
export function insertImage(editor: Editor, attrs: ImageBlockAttributes = {}): boolean {
  return editor.chain().focus().insertContent({
    type: 'imageBlock',
    attrs: {
      src: attrs.src || '',
      alt: attrs.alt || '',
      width: attrs.width || null,
      height: attrs.height || null,
      caption: attrs.caption || '',
      uploadStatus: attrs.uploadStatus || 'idle',
      align: attrs.align || 'center',
    },
  }).run();
}

/**
 * Copy the entire image block to clipboard
 */
export function copyImageBlock(editor: Editor): boolean {
  try {
    const { state } = editor;
    const { $from } = state.selection;
    
    console.log('[copyImageBlock] Called', {
      from: state.selection.from,
      to: state.selection.to,
      depth: $from.depth,
      parentNode: $from.parent?.type.name,
    });
    
    let imageBlockNode = null;
    let imageBlockPos = -1;
    
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d);
      console.log(`[copyImageBlock] Depth ${d}:`, {
        name: node.type.name,
      });
      
      if (node.type.name === 'imageBlock') {
        imageBlockNode = node;
        imageBlockPos = $from.start(d) - 1;
        console.log('[copyImageBlock] Found imageBlock at depth', d, 'pos', imageBlockPos);
        break;
      }
    }
    
    if (!imageBlockNode || imageBlockPos < 0) {
      console.warn('[copyImageBlock] Not inside an image block');
      return false;
    }
    
    console.log('[copyImageBlock] Selecting entire image block', {
      from: imageBlockPos,
      attrs: imageBlockNode.attrs,
    });
    
    editor.chain()
      .focus()
      .setNodeSelection(imageBlockPos)
      .run();
    
    setTimeout(() => {
      try {
        document.execCommand('copy');
        console.log('[copyImageBlock] Copy command executed');
        editor.commands.focus();
      } catch (err) {
        console.error('[copyImageBlock] Failed to execute copy command:', err);
      }
    }, 10);
    
    return true;
  } catch (error) {
    console.error('[copyImageBlock] Failed to copy image block:', error);
    return false;
  }
}

/**
 * Delete the current image block
 */
export function deleteImageBlock(editor: Editor): boolean {
  try {
    const { state } = editor;
    const { selection } = state;
    
    console.log('[deleteImageBlock] Called', {
      from: selection.from,
      to: selection.to,
      isNodeSelection: selection.from + 1 === selection.to,
    });
    
    // Check if we already have a node selection on an imageBlock
    if (selection.from + 1 === selection.to) {
      const node = state.doc.nodeAt(selection.from);
      if (node && node.type.name === 'imageBlock') {
        console.log('[deleteImageBlock] Already have imageBlock selected, deleting');
        return editor.chain().focus().deleteSelection().run();
      }
    }
    
    // Otherwise, find the image block node and its position
    const { $from } = selection;
    let imageBlockPos = -1;
    
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d);
      
      if (node.type.name === 'imageBlock') {
        imageBlockPos = $from.start(d) - 1;
        console.log('[deleteImageBlock] Found imageBlock at depth', d, 'pos', imageBlockPos);
        break;
      }
    }
    
    if (imageBlockPos < 0) {
      console.warn('[deleteImageBlock] Not inside an image block');
      return false;
    }
    
    // Select and delete the node
    return editor
      .chain()
      .focus()
      .setNodeSelection(imageBlockPos)
      .deleteSelection()
      .run();
  } catch (error) {
    console.error('[deleteImageBlock] Failed to delete image block:', error);
    return false;
  }
}

/**
 * Update image dimensions
 */
export function updateImageSize(editor: Editor, width: number, height: number): boolean {
  return editor.commands.updateAttributes('imageBlock', {
    width,
    height,
  });
}

/**
 * Update image caption
 */
export function updateImageCaption(editor: Editor, caption: string): boolean {
  return editor.commands.updateAttributes('imageBlock', {
    caption,
  });
}

