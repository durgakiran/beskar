/**
 * InternalLinkBlock — block preview card for Beskar documents and whiteboards.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
import { InternalLinkBlockView } from '../components/internal-link/InternalLinkBlockView';
import type { InternalResourceHandler, InternalResourceType } from '../types';

export interface InternalLinkBlockAttributes {
  resourceType: InternalResourceType;
  resourceId: string;
  resourceTitle: string;
  resourceIcon: string;
}

export interface InternalLinkBlockOptions {
  resourceHandler?: InternalResourceHandler;
}

const DEFAULT_ATTRS: InternalLinkBlockAttributes = {
  resourceType: 'document',
  resourceId: '',
  resourceTitle: '',
  resourceIcon: '',
};

export const InternalLinkBlock = Node.create<InternalLinkBlockOptions>({
  name: 'internalLinkBlock',
  group: 'block',
  atom: true,
  draggable: true,
  isolating: true,

  addOptions() {
    return {
      resourceHandler: undefined,
    };
  },

  addStorage() {
    return {
      resourceHandler: this.options.resourceHandler,
    };
  },

  onCreate() {
    this.storage.resourceHandler = this.options.resourceHandler;
  },

  addAttributes() {
    return {
      resourceType: {
        default: DEFAULT_ATTRS.resourceType,
        parseHTML: (element) => (element.getAttribute('data-resource-type') === 'whiteboard' ? 'whiteboard' : 'document'),
        renderHTML: (attributes) => ({ 'data-resource-type': attributes.resourceType }),
      },
      resourceId: {
        default: DEFAULT_ATTRS.resourceId,
        parseHTML: (element) => element.getAttribute('data-resource-id') || '',
        renderHTML: (attributes) => ({ 'data-resource-id': attributes.resourceId }),
      },
      resourceTitle: {
        default: DEFAULT_ATTRS.resourceTitle,
        parseHTML: (element) => element.getAttribute('data-resource-title') || '',
        renderHTML: (attributes) => ({ 'data-resource-title': attributes.resourceTitle }),
      },
      resourceIcon: {
        default: DEFAULT_ATTRS.resourceIcon,
        parseHTML: (element) => element.getAttribute('data-resource-icon') || '',
        renderHTML: (attributes) => ({ 'data-resource-icon': attributes.resourceIcon }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="internal-link-block"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { blockId, ...attributesWithoutBlockId } = HTMLAttributes as any;
    const label = node.attrs.resourceTitle || `${node.attrs.resourceType} ${node.attrs.resourceId}`;

    return [
      'div',
      mergeAttributes(attributesWithoutBlockId, {
        'data-type': 'internal-link-block',
        'data-resource-type': node.attrs.resourceType,
        'data-resource-id': node.attrs.resourceId,
        'data-resource-title': node.attrs.resourceTitle,
        'data-resource-icon': node.attrs.resourceIcon,
        class: 'internal-link-block-wrapper',
      }),
      label,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InternalLinkBlockView);
  },

  addCommands() {
    return {
      setInternalLinkBlock:
        (attributes?: Partial<InternalLinkBlockAttributes>) =>
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
    const plugins: Plugin[] = [];

    if (!this.editor.isEditable) return plugins;

    plugins.push(
      new Plugin({
        view: (view) => {
          const updateInternalLinkWrappers = () => {
            view.state.doc.descendants((node, pos) => {
              if (node.type.name !== 'internalLinkBlock') return;
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

          setTimeout(updateInternalLinkWrappers, 0);

          return {
            update: updateInternalLinkWrappers,
          };
        },
      }),
    );

    return plugins;
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    internalLinkBlock: {
      setInternalLinkBlock: (attributes?: Partial<InternalLinkBlockAttributes>) => ReturnType;
    };
  }
}

export default InternalLinkBlock;
