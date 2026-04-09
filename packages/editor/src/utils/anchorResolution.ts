import { Editor } from '@tiptap/core';
import { findParentNode } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { CommentAnchor } from '../types';

/**
 * Extracts anchor metadata from the current selection.
 */
export function extractAnchor(editor: Editor): CommentAnchor | null {
  const { state } = editor;
  const { from, to, $from } = state.selection;

  if (from === to) return null;

  const quotedText = state.doc.textBetween(from, to, ' ');
  
  // Context
  const prefixText = state.doc.textBetween(Math.max(0, from - 32), from, ' ');
  const suffixText = state.doc.textBetween(to, Math.min(state.doc.content.size, to + 32), ' ');

  // Find block parent
  const block = findParentNode((node) => node.isBlock && node.type.name !== 'doc')(state.selection);
  const blockId = block?.node.attrs.id || '';
  
  // Offsets within block
  const start = from - (block?.pos ?? 0) - 1; // -1 because pos is before the opening tag
  const end = to - (block?.pos ?? 0) - 1;

  return {
    quotedText,
    prefixText,
    suffixText,
    blockId,
    start,
    end,
    versionHint: editor.isEditable ? 'draft' : 'published',
  };
}

/**
 * Resolves an anchor back to a document range using the 4-step cascade.
 */
export function resolveAnchor(doc: PMNode, anchor: CommentAnchor): { from: number; to: number } | null {
  if (!anchor || !anchor.quotedText) return null;

  // 1. Try exact blockId + start/end offsets (Fastest)
  if (anchor.blockId) {
    let resolvedRange: { from: number; to: number } | null = null;
    doc.descendants((node, pos) => {
      if (node.attrs.id === anchor.blockId) {
        const absoluteStart = pos + anchor.start + 1;
        const absoluteEnd = pos + anchor.end + 1;
        
        if (absoluteEnd <= doc.content.size) {
          const text = doc.textBetween(absoluteStart, absoluteEnd, ' ');
          if (text === anchor.quotedText) {
            resolvedRange = { from: absoluteStart, to: absoluteEnd };
          }
        }
        return false; // found block, stop searching descendants
      }
    });
    if (resolvedRange) return resolvedRange;
  }

  // 2. Search exact quotedText in the same block (Reliable for small shifts)
  if (anchor.blockId) {
    let resolvedRange: { from: number; to: number } | null = null;
    doc.descendants((node, pos) => {
      if (node.attrs.id === anchor.blockId) {
        if (node.isTextblock) {
          const blockText = node.textContent;
          const index = blockText.indexOf(anchor.quotedText);
          if (index !== -1) {
            const absoluteStart = pos + index + 1;
            const absoluteEnd = absoluteStart + anchor.quotedText.length;
            resolvedRange = { from: absoluteStart, to: absoluteEnd };
          }
        }
        return false;
      }
    });
    if (resolvedRange) return resolvedRange;
  }

  // 3. Search quotedText + context across the whole document (Reliable for major shifts)
  let bestMatch: any = null;
  
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const text = node.textContent;
      let startSearch = 0;
      
      // Safety check to prevent infinite loop
      if (anchor.quotedText.length === 0) return false;

      let iterations = 0;
      const MAX_ITERATIONS = 1000;

      while (iterations < MAX_ITERATIONS) {
        iterations++;
        const index = text.indexOf(anchor.quotedText, startSearch);
        if (index === -1) break;

        const absoluteStart = pos + index + 1;
        const absoluteEnd = absoluteStart + anchor.quotedText.length;
        
        // Calculate context score
        let score = 0;
        const actualPrefix = doc.textBetween(Math.max(0, absoluteStart - 32), absoluteStart, ' ');
        const actualSuffix = doc.textBetween(absoluteEnd, Math.min(doc.content.size, absoluteEnd + 32), ' ');
        
        if (anchor.prefixText && (actualPrefix.endsWith(anchor.prefixText) || anchor.prefixText.endsWith(actualPrefix))) score += 1;
        if (anchor.suffixText && (actualSuffix.startsWith(anchor.suffixText) || anchor.suffixText.startsWith(actualSuffix))) score += 1;

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { from: absoluteStart, to: absoluteEnd, score };
        }
        
        startSearch = index + 1;
        if (startSearch >= text.length) break;
      }
    }
  });

  if (bestMatch && bestMatch.score >= 1) {
    const from = Math.max(0, bestMatch.from);
    const to = Math.min(doc.content.size, bestMatch.to);
    if (from < to) return { from, to };
  }

  // 4. Final fallback: just first match anywhere (Last resort)
  let finalFallback: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (finalFallback) return false;
    if (node.isTextblock) {
      const index = node.textContent.indexOf(anchor.quotedText);
      if (index !== -1) {
        const from = pos + 1 + index;
        const to = from + anchor.quotedText.length;
        if (from < to && to <= doc.content.size) {
          finalFallback = { from, to };
        }
      }
    }
  });

  return finalFallback;
}
