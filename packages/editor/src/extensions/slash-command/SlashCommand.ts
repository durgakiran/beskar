import { Extension, type Editor } from '@tiptap/core';
import { EditorState, PluginKey } from '@tiptap/pm/state';
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import MenuList from './MenuList';
import GROUPS from './groups';
import type { Command } from './groups';

const extensionName = 'slashCommand';

/** Shared key so `items` can read the active suggestion range from editor state. */
export const slashCommandPluginKey = new PluginKey(extensionName);

/** True when the active `/…` query is not at the start of the paragraph (hide block-only commands). */
function hideBlockOnlyForSelection(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  if ($from.parent.type.name !== 'paragraph') return false;
  // textBetween expects positions relative to the node (0 = start of node content)
  const relCursor = $from.pos - $from.start();
  const beforeCursor = $from.parent.textBetween(0, relCursor, '');
  const slashIdx = beforeCursor.lastIndexOf('/');
  return slashIdx > 0;
}

export interface SlashCommandOptions {
  suggestion: Omit<SuggestionOptions, 'editor'>;
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: extensionName,

  addOptions() {
    return {
      suggestion: {
        char: '/',
        allowSpaces: true,
        pluginKey: slashCommandPluginKey,
        command: ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: { action: (e: Editor) => void } }) => {
          const { from, to } = range;
          const maxPos = editor.state.doc.content.size + 1;
          if (typeof from !== 'number' || typeof to !== 'number' || from >= to || from < 0 || to > maxPos) {
            return;
          }
          const { state, view } = editor;
          view.dispatch(state.tr.deleteRange(from, to));
          props.action(editor);
          view.focus();
        },
        allow: ({ state, range }: { state: EditorState; range: { from: number; to: number } }) => {
          const $from = state.doc.resolve(range.from);
          const isParagraph = $from.parent.type.name === 'paragraph';
          const parentStart = $from.start(); // absolute start of parent node content

          // textBetween expects positions relative to the node (0 = start of node content)
          const relSlash = range.from - parentStart;
          const textBeforeSlash = $from.parent.textBetween(0, relSlash, '');
          const isValidPosition = textBeforeSlash === '' || textBeforeSlash.endsWith(' ');

          const textFromSlash = $from.parent.textBetween(relSlash, $from.parent.content.size, '');
          const isValidAfterContent = !textFromSlash.endsWith('  ');

          // Allow paragraphs anywhere (columns, lists, blockquotes, nested doc), plus table cells.
          let isAllowedDepth = isParagraph;
          if (isParagraph) {
            for (let depth = $from.depth; depth > 0; depth--) {
              const name = $from.node(depth).type.name;
              if (name === 'codeBlock') {
                isAllowedDepth = false;
                break;
              }
            }
          }

          return isAllowedDepth && isValidPosition && isValidAfterContent;
        },
        items: ({ query, editor }: { query: string; editor: Editor }) => {
          try {
            const hideBlockOnly = hideBlockOnlyForSelection(editor);

            const withFilteredCommands = GROUPS.map((group) => ({
              ...group,
              commands: group.commands
                .filter((item: Command) => !(hideBlockOnly && item.blockOnly))
                .filter((item: Command) => {
                  const labelNormalized = item.label.toLowerCase().trim();
                  const queryNormalized = query.toLowerCase().trim();

                  if (item.aliases) {
                    const aliases = item.aliases.map((alias) => alias.toLowerCase().trim());
                    return (
                      labelNormalized.includes(queryNormalized) || aliases.includes(queryNormalized)
                    );
                  }

                  return labelNormalized.includes(queryNormalized);
                })
                .filter((command) =>
                  command.shouldBeHidden ? !command.shouldBeHidden(editor) : true
                ),
            }));

            return withFilteredCommands.filter((group) => group.commands.length > 0);
          } catch {
            return GROUPS;
          }
        },
        render: () => {
          let component: ReactRenderer<{ onKeyDown: (props: any) => boolean }> | null = null;
          let popup: TippyInstance[] | null = null;

          return {
            onStart: (props: any) => {
              component = new ReactRenderer(MenuList, {
                props,
                editor: props.editor,
              });

              if (!props.clientRect) {
                return;
              }

              popup = tippy('body', {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
                maxWidth: '20rem',
                offset: [0, 8],
                popperOptions: {
                  strategy: 'fixed',
                  modifiers: [
                    {
                      name: 'flip',
                      enabled: true,
                      options: {
                        fallbackPlacements: ['top-start', 'bottom-start'],
                        padding: 8,
                      },
                    },
                    {
                      name: 'preventOverflow',
                      enabled: true,
                      options: {
                        padding: 8,
                        altAxis: true,
                        tether: false,
                      },
                    },
                  ],
                },
              });
            },

            onUpdate(props: any) {
              component?.updateProps(props);

              if (!props.clientRect) {
                return;
              }

              popup?.[0]?.setProps({
                getReferenceClientRect: props.clientRect,
              });
            },

            onKeyDown(props: any) {
              if (props.event.key === 'Escape') {
                popup?.[0]?.hide();
                return true;
              }

              return component?.ref?.onKeyDown?.(props) || false;
            },

            onExit() {
              popup?.[0]?.destroy();
              component?.destroy();
            },
          };
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});

export default SlashCommand;

