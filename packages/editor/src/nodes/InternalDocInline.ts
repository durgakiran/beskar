/**
 * InternalDocInline — inline chip for internal document links pasted into text.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
import { InternalDocInlineView } from '../components/internal-link/InternalDocInlineView';
import type { InternalResourceHandler } from '../types';

export interface InternalDocInlineAttributes {
  resourceId: string;
  resourceTitle: string;
  href: string;
}

export interface InternalDocInlineOptions {
  resourceHandler?: InternalResourceHandler;
}

const DEFAULT_ATTRS: InternalDocInlineAttributes = {
  resourceId: '',
  resourceTitle: '',
  href: '',
};

function parseInternalDocumentUrl(rawUrl: string, appBaseUrl: string): { resourceId: string; href: string } | null {
  try {
    const text = rawUrl.trim();
    const pasted = new URL(text);
    const base = new URL(appBaseUrl);
    if (pasted.origin !== base.origin) return null;

    const path = pasted.pathname;
    const routedMatch = path.match(/\/space\/[^/]+\/(view|edit|page|document|doc)\/([^/?#]+)/);
    if (routedMatch) {
      return { resourceId: decodeURIComponent(routedMatch[2]), href: text };
    }

    const shortMatch = path.match(/\/(doc|docs|document|documents|page|pages)\/([^/?#]+)/);
    if (shortMatch) {
      return { resourceId: decodeURIComponent(shortMatch[2]), href: text };
    }

    return null;
  } catch {
    return null;
  }
}

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
    const label = node.attrs.resourceTitle || `Document ${node.attrs.resourceId}`;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'internal-doc-inline',
        'data-resource-id': node.attrs.resourceId,
        'data-resource-title': node.attrs.resourceTitle,
        'data-href': node.attrs.href,
        class: 'internal-doc-inline-chip',
      }),
      label,
    ];
  },

  renderText({ node }) {
    return node.attrs.resourceTitle || `Document ${node.attrs.resourceId}`;
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
            if (!this.editor.isEditable || !handler?.appBaseUrl) return false;
            const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
            if (!text || /\s/.test(text)) return false;

            const parsed = parseInternalDocumentUrl(text, handler.appBaseUrl);
            if (!parsed) return false;

            const node = view.state.schema.nodes.internalDocInline.create({
              ...DEFAULT_ATTRS,
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
