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
  spaceId?: string;
  href?: string;
  resourceId: string;
  resourceTitle: string;
  resourceIcon: string;
}

export interface InternalLinkBlockOptions {
  resourceHandler?: InternalResourceHandler;
}

const DEFAULT_ATTRS: InternalLinkBlockAttributes = {
  resourceType: 'document',
  spaceId: '',
  href: '',
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
      spaceId: { default: '', parseHTML: (element) => element.getAttribute('data-space-id') || '', renderHTML: (attributes) => ({ 'data-space-id': attributes.spaceId }) },
      href: { default: '', parseHTML: (element) => element.getAttribute('data-href') || '', renderHTML: (attributes) => ({ 'data-href': attributes.href }) },
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
    return ReactNodeViewRenderer(InternalLinkBlockView, {
      // Keep the generic hyperlink plugin from also opening internal node links.
      stopEvent: ({ event }) => event.type === 'click' || (event.target instanceof Element && (
        Boolean(event.target.closest('button, input, select')) ||
        (event.type === 'mousedown' && Boolean(event.target.closest('a')))
      )),
    });
  },

  addCommands() {
    return {
      setInternalLinkBlock:
        (attributes?: Partial<InternalLinkBlockAttributes>) =>
        ({ commands, editor }) => {
          if (!editor.isEditable) return false;
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
