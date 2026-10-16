import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { exitSuggestion, type SuggestionProps } from '@tiptap/suggestion';
import tippy, { type Instance } from 'tippy.js';
import { MentionView } from '../components/mention/MentionView';
import type { MentionHandler, MentionUser } from '../types';

const mentionSuggestionKey = new PluginKey('mentionSuggestion');

export interface MentionOptions {
  mentionHandler?: MentionHandler;
}

/** Inline atom is always registered so persisted mentions work without a handler. */
export const Mention = Node.create<MentionOptions>({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addOptions() { return { mentionHandler: undefined }; },
  addAttributes() {
    return {
      id: { default: '', parseHTML: el => el.getAttribute('data-id'), renderHTML: attrs => ({ 'data-id': attrs.id }) },
      label: { default: '', parseHTML: el => el.getAttribute('data-label'), renderHTML: attrs => ({ 'data-label': attrs.label }) },
    };
  },
  parseHTML() { return [{ tag: 'span[data-type="mention"]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'mention', class: 'mention-chip' }), `@${node.attrs.label || node.attrs.id}`];
  },
  renderText({ node }) { return `@${node.attrs.label || node.attrs.id}`; },
  addNodeView() { return ReactNodeViewRenderer(MentionView); },
  addCommands() {
    return {
      insertMention: (user: MentionUser) => ({ editor, commands }) => {
        if (!editor.isEditable || !this.options.mentionHandler || !user.id || !user.label) return false;
        return commands.insertContent([{ type: this.name, attrs: { id: user.id, label: user.label } }, { type: 'text', text: ' ' }]);
      },
    };
  },
  addProseMirrorPlugins() {
    const handler = this.options.mentionHandler;
    if (!handler) return [];
    return [Suggestion<MentionUser>({
      editor: this.editor,
      pluginKey: mentionSuggestionKey,
      char: '@',
      allow: ({ editor, state, range }) => editor.isEditable
        && !state.doc.resolve(range.from).parent.type.spec.code
        && !state.doc.resolve(range.from).marks().some(mark => mark.type.name === 'code'),
      // Keep the suggestion lifecycle synchronous; the picker owns async search.
      items: () => [],
      command: ({ editor, range, props }) => {
        if (!editor.isEditable) return;
        editor.chain().focus().deleteRange(range).insertMention(props).run();
      },
      render: () => {
        const thisEditor = this.editor;
        let popup: Instance | undefined;
        let props: SuggestionProps<MentionUser>;
        let selected = 0;
        let generation = 0;
        const menu = document.createElement('div');
        menu.className = 'mention-menu';
        menu.setAttribute('role', 'listbox');
        menu.setAttribute('aria-label', 'Mention users');
        const draw = () => {
          menu.replaceChildren();
          props.items.forEach((user, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = user.label;
            button.setAttribute('role', 'option');
            button.setAttribute('aria-selected', String(index === selected));
            button.addEventListener('mousedown', event => { event.preventDefault(); props.command(user); });
            menu.append(button);
          });
          if (!props.items.length) menu.textContent = 'No users found';
        };
        const closeIfReadOnly = () => {
          if (!this.editor.isEditable && !this.editor.isDestroyed) {
            exitSuggestion(this.editor.view, mentionSuggestionKey);
          }
        };
        const search = (next: SuggestionProps<MentionUser>) => {
          props = { ...next, items: [] };
          selected = 0;
          const request = ++generation;
          menu.replaceChildren();
          menu.textContent = 'Searching…';
          void Promise.resolve().then(() => handler.searchUsers(next.query)).then(users => {
            if (request !== generation || !next.editor.isEditable || next.editor.isDestroyed) return;
            props.items = users.filter(user => user.id && user.label).slice(0, 10);
            draw();
          }).catch(() => {
            if (request !== generation) return;
            menu.textContent = 'Could not load users. Type to retry.';
          });
        };
        return {
          onStart(next) {
            if (!next.editor.isEditable || next.editor.isDestroyed) return;
            next.editor.on('update', closeIfReadOnly);
            search(next);
            popup = tippy(document.body, {
              getReferenceClientRect: () => props.clientRect?.() || new DOMRect(),
              appendTo: () => document.body, content: menu, interactive: true,
              trigger: 'manual', showOnCreate: true, placement: 'bottom-start',
            });
          },
          onUpdate(next) { search(next); popup?.setProps({ getReferenceClientRect: () => props.clientRect?.() || new DOMRect() }); },
          onKeyDown({ event }) {
            if (event.key === 'Escape') { exitSuggestion(thisEditor.view, mentionSuggestionKey); return true; }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + props.items.length) % (props.items.length || 1);
              draw(); return true;
            }
            if (event.key === 'Enter') { if (props.items[selected]) props.command(props.items[selected]); return true; }
            return false;
          },
          onExit() { thisEditor.off('update', closeIfReadOnly); generation++; popup?.destroy(); popup = undefined; },
        };
      },
    })];
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mention: { insertMention: (user: MentionUser) => ReturnType };
  }
}
