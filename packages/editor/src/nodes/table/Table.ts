import { Table as TiptapTable } from '@tiptap/extension-table';
import { Plugin } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';

/**
 * Custom Table extension
 * Extends Tiptap's table with custom rendering and interaction handling
 */
export const Table = TiptapTable.extend({
  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return ['div', { class: 'tableWrapper' }, ['table', HTMLAttributes, 0]];
  },

  addProseMirrorPlugins() {
    const { isEditable } = this.editor;

    if (!isEditable) {
      return [];
    }

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              const target = event.target as HTMLElement;

              // Check if the click is on the table element itself or its wrapper
              if (
                target.tagName === 'TABLE' ||
                target.closest('table') ||
                target.closest('.tableWrapper')
              ) {
                // Don't handle clicks inside table cells
                if (target.closest('td') || target.closest('th')) {
                  return false;
                }
                const tableElement =
                  target.tagName === 'TABLE' ? target : target.closest('table');
                if (tableElement) {
                  // Find the table node position
                  const pos = view.posAtDOM(tableElement, 0);
                  const $pos = view.state.doc.resolve(pos);
                  const tableNode = $pos.node();

                  if (tableNode.type.name === 'table') {
                    // Set cursor at the table start to trigger table menu
                    const tableStart = $pos.start();
                    const $tableStart = view.state.doc.resolve(tableStart);
                    const textSelection = TextSelection.near($tableStart);
                    const tr = view.state.tr.setSelection(textSelection);
                    view.dispatch(tr);
                    return true;
                  }
                }
              }

              return false;
            },
          },
        },
      }),
    ];
  },
}).configure({ resizable: true, lastColumnResizable: false });

export default Table;

