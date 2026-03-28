import type { Editor } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * Resolve the document position before a `columns` node: NodeView getPos(), then blockId,
 * then walk selection ancestors (handles stale getPos after edits / toolbar focus).
 */
export function resolveColumnsLayoutPos(
  editor: Editor,
  getPos?: (() => number | undefined) | boolean | null,
  blockId?: string | null
): number {
  const doc = editor.state.doc;

  if (typeof getPos === 'function') {
    const p = getPos();
    if (p !== undefined && p >= 0) {
      const n = doc.nodeAt(p);
      if (n?.type.name === 'columns') {
        return p;
      }
    }
  }

  if (blockId) {
    let found = -1;
    doc.descendants((node: PMNode, pos: number) => {
      if (node.type.name === 'columns' && node.attrs.blockId === blockId) {
        found = pos;
        return false;
      }
    });
    if (found >= 0) {
      return found;
    }
  }

  const { $from } = editor.state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === 'columns') {
      return $from.before(d);
    }
  }

  return -1;
}

/** Delete the columns block at `pos` (must be the node offset for a `columns` node). */
export function deleteColumnsLayoutAt(editor: Editor, pos: number): boolean {
  if (pos < 0) {
    return false;
  }
  try {
    const { state, dispatch } = editor.view;
    const node = state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'columns') {
      return false;
    }
    const tr = state.tr.delete(pos, pos + node.nodeSize).scrollIntoView();
    dispatch(tr);
    editor.view.focus();
    return true;
  } catch (e) {
    console.error('[deleteColumnsLayoutAt] failed', e);
    return false;
  }
}

/** Clipboard fallback when `execCommand('copy')` is unavailable or returns false. */
function writeColumnsHtmlToSystemClipboard(editor: Editor, columnsBlockNode: PMNode): void {
  const serializer = DOMSerializer.fromSchema(editor.schema);
  const dom = serializer.serializeNode(columnsBlockNode);
  const wrap = document.createElement('div');
  wrap.appendChild(dom);
  const html = wrap.innerHTML;
  const plain = columnsBlockNode.textContent ?? '';

  if (typeof navigator !== 'undefined' && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    void navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      }),
    ]);
  }
}

/**
 * Copy the entire `columns` node (structure + attrs), same strategy as note block:
 * NodeSelection + `execCommand('copy')` so ProseMirror/TipTap clipboard serialization runs.
 */
export function copyColumnsBlock(
  editor: Editor,
  getPos?: (() => number | undefined) | boolean | null,
  blockId?: string | null
): boolean {
  try {
    const pos = resolveColumnsLayoutPos(editor, getPos, blockId);
    if (pos < 0) {
      return false;
    }
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'columns') {
      return false;
    }

    editor.commands.focus();

    window.setTimeout(() => {
      try {
        const p = resolveColumnsLayoutPos(editor, getPos, blockId);
        if (p < 0) {
          return;
        }
        const fresh = editor.state.doc.nodeAt(p);
        if (!fresh || fresh.type.name !== 'columns') {
          return;
        }

        editor.chain().focus().setNodeSelection(p).run();

        let didCopy = false;
        try {
          didCopy = document.execCommand('copy');
        } catch (err) {
          console.error('[copyColumnsBlock] execCommand copy failed:', err);
        }

        if (!didCopy) {
          writeColumnsHtmlToSystemClipboard(editor, fresh);
        }
      } catch (err) {
        console.error('[copyColumnsBlock] copy step failed:', err);
      } finally {
        editor.commands.focus();
      }
    }, 10);

    return true;
  } catch (error) {
    console.error('[copyColumnsBlock] Failed to copy columns block:', error);
    return false;
  }
}

/**
 * Delete a columns layout from the floating menu (or anywhere): resolves position reliably,
 * then uses a single `delete` step instead of setNodeSelection + deleteSelection (avoids
 * command chain failures when focus/selection are odd).
 */
export function deleteColumnsLayout(
  editor: Editor,
  getPos?: (() => number | undefined) | boolean | null,
  blockId?: string | null
): boolean {
  const pos = resolveColumnsLayoutPos(editor, getPos, blockId);
  return deleteColumnsLayoutAt(editor, pos);
}

/**
 * Delete the current columns block using only selection (no NodeView getPos).
 */
export function deleteColumnsBlock(editor: Editor): boolean {
  return deleteColumnsLayout(editor, null, null);
}
