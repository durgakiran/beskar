import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

/**
 * Exits an "island" node (table, columns, codeblock, etc.) by moving the
 * cursor to the next block after it, or inserting a new paragraph if no
 * suitable block follows.
 *
 * Designed to be reused across any node that isolates the cursor so the
 * escape UX is consistent throughout the editor.
 *
 * @param editor      - The Tiptap editor instance.
 * @param nodeEndPos  - The position immediately after the node
 *                      (i.e. nodeStartPos + node.nodeSize).
 * @returns true so the calling keyboard handler knows the event was consumed.
 */
export function exitNodeAfter(editor: Editor, nodeEndPos: number): boolean {
  const { state } = editor;
  const { doc } = state;

  // If there is already a text block right after the node, jump into it.
  if (nodeEndPos < doc.content.size) {
    const $after = doc.resolve(nodeEndPos);
    const nodeAfter = $after.nodeAfter;

    if (nodeAfter && nodeAfter.isTextblock) {
      const tr = state.tr.setSelection(
        TextSelection.create(doc, nodeEndPos + 1)
      );
      editor.view.dispatch(tr);
      return true;
    }
  }

  // Nothing after the node — insert a fresh paragraph and place the cursor in it.
  const tr = state.tr.insert(nodeEndPos, state.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, nodeEndPos + 1));
  tr.scrollIntoView();
  editor.view.dispatch(tr);
  return true;
}
