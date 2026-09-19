import { Extension, type KeyboardShortcutCommand } from '@tiptap/core';
import { indentCode } from '../components/codeblock/codeBlockUtils';

/** Code keys outrank table/column navigation without changing schema node order. */
export const CodeBlockKeyboard = Extension.create({
  name: 'codeBlockKeyboard',
  priority: 1100,
    addKeyboardShortcuts(): Record<string, KeyboardShortcutCommand> {
      const editor = this.editor;
      return {
        Tab: () => { if (!editor.isEditable) return false; const tr = indentCode(editor.state); if (!tr) return false; editor.view.dispatch(tr); return true; },
        'Shift-Tab': () => { if (!editor.isEditable) return false; const tr = indentCode(editor.state, true); if (!tr) return false; editor.view.dispatch(tr); return true; },
        'Mod-Enter': () => editor.isEditable && editor.isActive('codeBlock') && editor.commands.exitCode(),
        Escape: () => {
          const { $from } = editor.state.selection;
          if ($from.parent.type.name !== 'codeBlock') return false;
          const dom = editor.view.nodeDOM($from.before());
          if (!(dom instanceof HTMLElement)) return false;
          dom.querySelector<HTMLButtonElement>('.code-block-header button:not(:disabled)')?.focus();
          return true;
        },
      };
    },
});
