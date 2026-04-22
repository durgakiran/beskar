/**
 * ChildPagesList - block node that renders the current page's child pages.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
import { ChildPagesListView } from '../components/child-pages/ChildPagesListView';
import type { ChildPagesHandler } from '../types';

export interface ChildPagesListAttributes {
  title: string;
}

export interface ChildPagesListOptions {
  childPagesHandler?: ChildPagesHandler;
}

const DEFAULT_ATTRS: ChildPagesListAttributes = {
  title: 'Child pages',
};

export const ChildPagesList = Node.create<ChildPagesListOptions>({
  name: 'childPagesList',
  group: 'block',
  atom: true,
  draggable: true,
  isolating: true,

  addOptions() {
    return {
      childPagesHandler: undefined,
    };
  },

  addStorage() {
    return {
      childPagesHandler: this.options.childPagesHandler,
    };
  },

  onCreate() {
    this.storage.childPagesHandler = this.options.childPagesHandler;
  },

  addAttributes() {
    return {
      title: {
        default: DEFAULT_ATTRS.title,
        parseHTML: (element) => element.getAttribute('data-title') || DEFAULT_ATTRS.title,
        renderHTML: (attributes) => ({ 'data-title': attributes.title }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="child-pages-list"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { blockId, ...attributesWithoutBlockId } = HTMLAttributes as any;

    return [
      'div',
      mergeAttributes(attributesWithoutBlockId, {
        'data-type': 'child-pages-list',
        'data-title': node.attrs.title,
        class: 'child-pages-list-wrapper',
      }),
      node.attrs.title,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChildPagesListView);
  },

  addCommands() {
    return {
      setChildPagesList:
        (attributes?: Partial<ChildPagesListAttributes>) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              ...DEFAULT_ATTRS,
              ...attributes,
            },
          });
        },
    };
  },

  addProseMirrorPlugins() {
    if (!this.editor.isEditable) return [];

    return [
      new Plugin({
        view: (view) => {
          const updateChildPagesWrappers = () => {
            view.state.doc.descendants((node, pos) => {
              if (node.type.name !== 'childPagesList') return;
              const blockId = node.attrs.blockId;
              const dom = view.nodeDOM(pos);
              if (!dom) return;

              const htmlDom = dom as HTMLElement;
              const wrapper = htmlDom.classList?.contains('react-renderer')
                ? htmlDom
                : htmlDom.closest?.('.react-renderer');
              if (!wrapper) return;

              if (blockId) {
                wrapper.setAttribute('data-block-id', blockId);
                wrapper.classList.add('block-node');
                wrapper.setAttribute('draggable', 'false');
              } else {
                wrapper.removeAttribute('data-block-id');
                wrapper.classList.remove('block-node');
                wrapper.removeAttribute('draggable');
              }
            });
          };

          setTimeout(updateChildPagesWrappers, 0);

          return {
            update: updateChildPagesWrappers,
          };
        },
      }),
    ];
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    childPagesList: {
      setChildPagesList: (attributes?: Partial<ChildPagesListAttributes>) => ReturnType;
    };
  }
}

export default ChildPagesList;
