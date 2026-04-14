import { Editor } from '@tiptap/core';
import { findParentNode } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { CommentAnchor } from '../types';

const CONTEXT_CHARS = 32;

/**
 * Extracts anchor metadata from the current selection.
 *
 * Two separate concerns:
 *   1. `blockId` — the nearest ancestor node that carries a stable `blockId`
 *      attribute (e.g. `bulletList`, `paragraph`). Used as the stable external key.
 *   2. `start`/`end` and prefix/suffix — computed relative to the **innermost
 *      textblock** containing the selection (e.g. the `paragraph` inside a
 *      `listItem`). This avoids wrong offsets when the blockId-bearing node is a
 *      multi-item list whose full text would shift every item's positions.
 */
export function extractAnchor(editor: Editor): CommentAnchor | null {
  const { state } = editor;
  const { from, to } = state.selection;

  if (from === to) return null;

  const quotedText = state.doc.textBetween(from, to, ' ');
  if (!quotedText.trim()) return null;

  // ── 1. Find the nearest ancestor that has a blockId ──────────────────────
  const blockWithId = findParentNode(
    (node) => node.isBlock && node.type.name !== 'doc' && !!node.attrs.blockId,
  )(state.selection);
  if (!blockWithId) return null;

  const blockId = blockWithId.node.attrs.blockId || '';
  if (!blockId) return null;

  // ── 2. Find the innermost textblock containing the selection ──────────────
  // This is the actual line of text the user selected (e.g. the `paragraph`
  // inside a `listItem`), even if it has no blockId of its own.
  const textblock = findParentNode(
    (node) => node.isTextblock,
  )(state.selection);

  // If there's no inner textblock (rare), fall back to the blockId node itself
  const scopeNode = textblock ?? blockWithId;
  const scopeStart = scopeNode.pos + 1;
  const scopeEnd = scopeNode.pos + scopeNode.node.nodeSize - 1;

  if (to > scopeEnd) return null;

  // All character offsets are relative to scopeStart so that `start`/`end`
  // point into just this line's text, not the entire container.
  const selectionText = state.doc.textBetween(from, to, ' ');
  const textBeforeSelection = state.doc.textBetween(scopeStart, from, ' ');
  const textAfterSelection = state.doc.textBetween(to, scopeEnd, ' ');

  const start = textBeforeSelection.length;
  const end = start + selectionText.length;
  const prefixText = textBeforeSelection.slice(Math.max(0, textBeforeSelection.length - CONTEXT_CHARS));
  const suffixText = textAfterSelection.slice(0, CONTEXT_CHARS);

  // Sanity: ensure the scope text actually contains the selection
  const scopeText = state.doc.textBetween(scopeStart, scopeEnd, ' ');
  if (end > scopeText.length) return null;

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

  // Shared helper: collect all textblocks that are part of the blockId node.
  // Handles two cases:
  //   a) The blockId node IS itself a textblock (e.g. plain `paragraph`) — return it directly.
  //   b) The blockId node is a container (e.g. `bulletList`) — return each textblock descendant.
  //
  // Returns an array of { tbStart, tbText } where:
  //   tbStart = absolute document position of the textblock's content start
  //   tbText  = plain text content of that textblock
  const collectTextblocks = (
    blockNode: PMNode,
    blockPos: number,
  ): Array<{ tbStart: number; tbText: string }> => {
    const result: Array<{ tbStart: number; tbText: string }> = [];

    if (blockNode.isTextblock) {
      // The blockId node is itself a textblock; its content starts right after its opening token.
      result.push({ tbStart: blockPos + 1, tbText: blockNode.textContent });
    } else {
      // Walk all descendant textblocks.
      // `node.descendants(fn)` passes (child, offset) where offset is the position of
      // child relative to the start of blockNode's content (i.e. relative to blockPos + 1).
      // So absolute position of child = blockPos + 1 + offset.
      // Content-start of child      = blockPos + 1 + offset + 1 = blockPos + offset + 2.
      blockNode.descendants((child, offset) => {
        if (!child.isTextblock) return; // keep descending into containers (listItem etc.)
        result.push({ tbStart: blockPos + offset + 2, tbText: child.textContent });
        return false; // don't descend into the textblock itself (its children are inline)
      });
    }

    return result;
  };

  // Steps 1 + 2: Find the best match within the blockId node.
  //
  // Critical insight: when the blockId node is a container (e.g. `bulletList`),
  // all list items may have the same `quotedText` at the same character offset.
  // For example, "item" appears at index 7 in EVERY "Bullet item X" line.
  // A position-only strategy (Step 1/2 from before) always matched the first item.
  //
  // We now score every occurrence across all textblocks in the node by:
  //   • Context score   (+4 per side that matches — prefix or suffix)
  //   • Exact position  (+2 if tbStart + anchor.start lands exactly on quotedText)
  //   • Proximity score (+1 if within 5 chars, +0.5 if within 20 chars)
  //
  // Context is weighted highest so "item" + suffixText=" three" wins over
  // "item" + suffixText=" one" even when both are at distance 0.
  if (anchor.blockId) {
    const ref: {
      range: { from: number; to: number } | null;
      bestScore: number;
    } = { range: null, bestScore: -Infinity };

    doc.descendants((node, pos) => {
      if (node.attrs.blockId !== anchor.blockId) return;

      for (const { tbStart, tbText } of collectTextblocks(node, pos)) {
        let searchFrom = 0;
        while (true) {
          const idx = tbText.indexOf(anchor.quotedText, searchFrom);
          if (idx === -1) break;

          const absoluteStart = tbStart + idx;
          const absoluteEnd = absoluteStart + anchor.quotedText.length;

          if (absoluteEnd > tbStart + tbText.length) {
            searchFrom = idx + 1;
            continue;
          }

          let score = 0;

          // Context: prefix match
          if (anchor.prefixText) {
            const actualPrefix = doc.textBetween(
              Math.max(0, absoluteStart - CONTEXT_CHARS),
              absoluteStart,
              ' ',
            );
            if (
              actualPrefix.endsWith(anchor.prefixText) ||
              anchor.prefixText.endsWith(actualPrefix)
            ) {
              score += 4;
            }
          }

          // Context: suffix match
          if (anchor.suffixText) {
            const actualSuffix = doc.textBetween(
              absoluteEnd,
              Math.min(doc.content.size, absoluteEnd + CONTEXT_CHARS),
              ' ',
            );
            if (
              actualSuffix.startsWith(anchor.suffixText) ||
              anchor.suffixText.startsWith(actualSuffix)
            ) {
              score += 4;
            }
          }

          // Exact position bonus: anchor.start lands exactly on this occurrence
          if (idx === anchor.start) {
            score += 2;
          }

          // Proximity bonus: occurrence is near anchor.start
          const dist = Math.abs(idx - anchor.start);
          if (dist <= 5) score += 1;
          else if (dist <= 20) score += 0.5;

          if (score > ref.bestScore) {
            ref.bestScore = score;
            ref.range = { from: absoluteStart, to: absoluteEnd };
          }

          searchFrom = idx + 1;
          if (searchFrom >= tbText.length) break;
        }
      }

      return false; // stop once we've found the blockId node
    });

    if (ref.range) return ref.range;
  }


  // 3. Search quotedText + context across the whole document (Handles block-level shifts)
  //    Requires at least one context side (prefix or suffix) to match — this prevents
  //    spurious matches when the same phrase appears multiple times in the document.
  //    A positional proximity bonus is added when the match is in the anchor's original
  //    block and close to anchor.start, for stable disambiguation.
  //
  //    NOTE: We use a wrapper object `bestRef.current` rather than a plain `let` variable
  //    because TypeScript's control-flow analysis narrows callback-captured `let` bindings
  //    to `never` after the closure — the wrapper sidesteps that limitation.
  const bestRef: { current: { from: number; to: number; score: number } | null } = { current: null };

  if (anchor.quotedText.length > 0) {
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return;

      const text = node.textContent;
      let startSearch = 0;
      let iterations = 0;
      const MAX_ITERATIONS = 1000;

      while (iterations < MAX_ITERATIONS) {
        iterations++;
        const index = text.indexOf(anchor.quotedText, startSearch);
        if (index === -1) break;

        const absoluteStart = pos + index + 1;
        const absoluteEnd = absoluteStart + anchor.quotedText.length;

        // Context score: how well prefix/suffix match
        let score = 0;
        if (anchor.prefixText) {
          const actualPrefix = doc.textBetween(Math.max(0, absoluteStart - 32), absoluteStart, ' ');
          if (actualPrefix.endsWith(anchor.prefixText) || anchor.prefixText.endsWith(actualPrefix)) score += 2;
        }
        if (anchor.suffixText) {
          const actualSuffix = doc.textBetween(absoluteEnd, Math.min(doc.content.size, absoluteEnd + 32), ' ');
          if (actualSuffix.startsWith(anchor.suffixText) || anchor.suffixText.startsWith(actualSuffix)) score += 2;
        }

        // Proximity bonus: same block AND close to original start offset
        if (anchor.blockId && node.attrs.blockId === anchor.blockId) {
          const dist = Math.abs(index - anchor.start);
          // Bonus decreases with distance; +1 within 5 chars, +0.5 within 20 chars
          if (dist <= 5) score += 1;
          else if (dist <= 20) score += 0.5;
        }

        if (!bestRef.current || score > bestRef.current.score) {
          bestRef.current = { from: absoluteStart, to: absoluteEnd, score };
        }

        startSearch = index + 1;
        if (startSearch >= text.length) break;
      }
    });
  }

  // Require at least one context side match (score >= 2) to avoid wild mismatches.
  // Without this guard, a comment whose text was partially deleted would snap to
  // an unrelated highlight elsewhere in the document.
  if (bestRef.current && bestRef.current.score >= 2) {
    const from = Math.max(0, bestRef.current.from);
    const to = Math.min(doc.content.size, bestRef.current.to);
    if (from < to) return { from, to };
  }

  // Step 4 (unrestricted "first match anywhere") has been intentionally removed.
  // Returning null here is correct — a partially-deleted anchor should simply not
  // render a decoration rather than incorrectly highlight unrelated text.
  return null;
}
