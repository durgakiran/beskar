/**
 * InternalDocInline — inline chip for internal document links pasted into text.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
import { InternalDocInlineView } from '../components/internal-link/InternalDocInlineView';
import type { InternalResourceHandler, InternalResourceType } from '../types';
import { getBrowserAppBaseUrl, parseInternalResourceUrl } from './internalDocumentUrl';

export { parseInternalResourceUrl };

export interface InternalDocInlineAttributes {
  resourceType: InternalResourceType;
  resourceId: string;
  resourceTitle: string;
  resourceIcon: string;
  href: string;
}

export interface InternalDocInlineOptions {
  resourceHandler?: InternalResourceHandler;
}

const DEFAULT_ATTRS: InternalDocInlineAttributes = {
  resourceType: 'document',
  resourceId: '',
  resourceTitle: '',
  resourceIcon: '',
  href: '',
};

export const InternalDocInline = Node.create<InternalDocInlineOptions>({
  name: 'internalDocInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

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
      href: {
        default: DEFAULT_ATTRS.href,
        parseHTML: (element) => element.getAttribute('data-href') || '',
        renderHTML: (attributes) => ({ 'data-href': attributes.href }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="internal-doc-inline"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const resourceLabel = node.attrs.resourceType === 'whiteboard' ? 'Whiteboard' : 'Document';
    const label = node.attrs.resourceTitle || `${resourceLabel} ${node.attrs.resourceId}`;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'internal-doc-inline',
        'data-resource-type': node.attrs.resourceType,
        'data-resource-id': node.attrs.resourceId,
        'data-resource-title': node.attrs.resourceTitle,
        'data-resource-icon': node.attrs.resourceIcon,
        'data-href': node.attrs.href,
        class: 'internal-doc-inline-chip',
      }),
      label,
    ];
  },

  renderText({ node }) {
    const resourceLabel = node.attrs.resourceType === 'whiteboard' ? 'Whiteboard' : 'Document';
    return node.attrs.resourceTitle || `${resourceLabel} ${node.attrs.resourceId}`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(InternalDocInlineView);
  },

  addCommands() {
    return {
      setInternalDocInline:
        (attributes: InternalDocInlineAttributes) =>
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
    const handler = this.options.resourceHandler;
    return [
      new Plugin({
        props: {
          handlePaste: (view, event) => {
            if (!this.editor.isEditable) return false;
            const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
            if (!text || /\s/.test(text)) return false;

            const appBaseUrl = handler?.appBaseUrl ?? getBrowserAppBaseUrl();
            if (!appBaseUrl) return false;

            const parsed = parseInternalResourceUrl(text, appBaseUrl);
            if (!parsed) return false;

            const node = view.state.schema.nodes.internalDocInline.create({
              ...DEFAULT_ATTRS,
              resourceType: parsed.resourceType,
              resourceId: parsed.resourceId,
              href: parsed.href,
            });
            view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    internalDocInline: {
      setInternalDocInline: (attributes: InternalDocInlineAttributes) => ReturnType;
    };
  }
}

export default InternalDocInline;
