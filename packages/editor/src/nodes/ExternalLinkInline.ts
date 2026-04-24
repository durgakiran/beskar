import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ExternalLinkInlineView } from '../components/link/ExternalLinkInlineView';
import type { ExternalLinkHandler } from '../types';

export interface ExternalLinkInlineAttributes {
  href: string;
  title: string;
  siteName: string;
  error: string;
}

export interface ExternalLinkInlineOptions {
  linkHandler?: ExternalLinkHandler;
}

const DEFAULT_ATTRS: ExternalLinkInlineAttributes = {
  href: '',
  title: '',
  siteName: '',
  error: '',
};

export const ExternalLinkInline = Node.create<ExternalLinkInlineOptions>({
  name: 'externalLinkInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      linkHandler: undefined,
    };
  },

  addStorage() {
    return {
      linkHandler: this.options.linkHandler,
    };
  },

  onCreate() {
    this.storage.linkHandler = this.options.linkHandler;
  },

  addAttributes() {
    return {
      href: {
        default: DEFAULT_ATTRS.href,
        parseHTML: (element) => element.getAttribute('data-href') || '',
        renderHTML: (attributes) => ({ 'data-href': attributes.href }),
      },
      title: {
        default: DEFAULT_ATTRS.title,
        parseHTML: (element) => element.getAttribute('data-title') || '',
        renderHTML: (attributes) => (attributes.title ? { 'data-title': attributes.title } : {}),
      },
      siteName: {
        default: DEFAULT_ATTRS.siteName,
        parseHTML: (element) => element.getAttribute('data-site-name') || '',
        renderHTML: (attributes) => (attributes.siteName ? { 'data-site-name': attributes.siteName } : {}),
      },
      error: {
        default: DEFAULT_ATTRS.error,
        parseHTML: (element) => element.getAttribute('data-error') || '',
        renderHTML: (attributes) => (attributes.error ? { 'data-error': attributes.error } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="external-link-inline"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = node.attrs.title || node.attrs.siteName || node.attrs.href || 'Link';
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'external-link-inline',
        'data-href': node.attrs.href,
        'data-title': node.attrs.title,
        'data-site-name': node.attrs.siteName,
        class: 'external-link-inline-chip',
      }),
      label,
    ];
  },

  renderText({ node }) {
    return node.attrs.title || node.attrs.href || 'Link';
  },

  addNodeView() {
    return ReactNodeViewRenderer(ExternalLinkInlineView);
  },

  addCommands() {
    return {
      setExternalLinkInline:
        (attributes: Partial<ExternalLinkInlineAttributes>) =>
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
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    externalLinkInline: {
      setExternalLinkInline: (attributes: Partial<ExternalLinkInlineAttributes>) => ReturnType;
    };
  }
}

export default ExternalLinkInline;
