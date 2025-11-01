import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import MenuList from './MenuList';
import GROUPS from './groups';
import type { Command } from './groups';

const extensionName = 'slashCommand';

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
        startOfLine: true,
        pluginKey: new PluginKey(extensionName),
        command: ({ editor, range, props }: { editor: any; range: any; props: any }) => {
          const { view, state } = editor;
          const { $head, $from } = view.state.selection;

          const end = $from.pos;
          const from = $head?.nodeBefore
            ? end - ($head.nodeBefore.text?.substring($head.nodeBefore.text?.indexOf('/')).length ?? 0)
            : $from.start();

          const tr = state.tr.deleteRange(from, end);
          view.dispatch(tr);

          props.action(editor);
          view.focus();
        },
        allow: ({ state, range }: { state: any; range: any }) => {
          const $from = state.doc.resolve(range.from);
          const isParagraph = $from.parent.type.name === 'paragraph';
          const isStartOfNode = $from.parent.textContent?.charAt(0) === '/';

          const afterContent = $from.parent.textContent?.substring(
            $from.parent.textContent?.indexOf('/')
          );
          const isValidAfterContent = !afterContent?.endsWith('  ');

          // Check if we're at root depth OR inside detailsContent
          let isAllowedDepth = false;
          if ($from.depth === 1) {
            // Root level paragraph
            isAllowedDepth = true;
          } else {
            // Check if we're inside detailsContent (which is allowed)
            for (let depth = $from.depth; depth > 0; depth--) {
              const node = $from.node(depth);
              if (node.type.name === 'detailsContent') {
                isAllowedDepth = true;
                break;
              }
              // Stop checking if we reach root or a non-details node
              if (depth === 1 || node.type.name === 'details') {
                break;
              }
            }
          }

          return isAllowedDepth && isParagraph && isStartOfNode && isValidAfterContent;
        },
        items: ({ query, editor }: { query: string; editor: any }) => {
          const withFilteredCommands = GROUPS.map((group) => ({
            ...group,
            commands: group.commands
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

          const withoutEmptyGroups = withFilteredCommands.filter((group) => {
            return group.commands.length > 0;
          });

          return withoutEmptyGroups;
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

