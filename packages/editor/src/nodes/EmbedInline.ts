import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { EmbedInlineView } from '../components/embed/EmbedInlineView';
import { getEmbedUrlAndProvider } from './embed/embed-providers';

export interface EmbedInlineAttributes {
  src: string;
  embedUrl: string;
  provider: string;
  title: string;
  error: string;
}

const DEFAULT_EMBED_INLINE_ATTRS: EmbedInlineAttributes = {
  src: '',
  embedUrl: '',
  provider: '',
  title: '',
  error: '',
};

export const EmbedInline = Node.create({
  name: 'embedInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: DEFAULT_EMBED_INLINE_ATTRS.src,
        parseHTML: (element) => element.getAttribute('data-src') || '',
        renderHTML: (attributes) => ({ 'data-src': attributes.src }),
      },
      embedUrl: {
        default: DEFAULT_EMBED_INLINE_ATTRS.embedUrl,
        parseHTML: (element) => element.getAttribute('data-embed-url') || '',
        renderHTML: (attributes) => ({ 'data-embed-url': attributes.embedUrl }),
      },
      provider: {
        default: DEFAULT_EMBED_INLINE_ATTRS.provider,
        parseHTML: (element) => element.getAttribute('data-provider') || '',
        renderHTML: (attributes) => ({ 'data-provider': attributes.provider }),
      },
      title: {
        default: DEFAULT_EMBED_INLINE_ATTRS.title,
        parseHTML: (element) => element.getAttribute('data-title') || '',
        renderHTML: (attributes) => (attributes.title ? { 'data-title': attributes.title } : {}),
      },
      error: {
        default: DEFAULT_EMBED_INLINE_ATTRS.error,
        parseHTML: (element) => element.getAttribute('data-error') || '',
        renderHTML: (attributes) => (attributes.error ? { 'data-error': attributes.error } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="embed-inline"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'embed-inline',
        'data-src': node.attrs.src,
        'data-embed-url': node.attrs.embedUrl,
        'data-provider': node.attrs.provider,
        class: 'embed-inline-chip',
      }),
      node.attrs.title || node.attrs.src || getEmbedUrlAndProvider(node.attrs.src)?.providerName || 'Embed',
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedInlineView);
  },

  addCommands() {
    return {
      setEmbedInline:
        (attributes?: Partial<EmbedInlineAttributes>) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              ...DEFAULT_EMBED_INLINE_ATTRS,
              ...attributes,
            },
          });
        },
      setEmbedInlineFromUrl:
        (url: string) =>
        ({ commands }) => {
          const result = getEmbedUrlAndProvider(url);
          return commands.insertContent({
            type: this.name,
            attrs: result
              ? {
                  ...DEFAULT_EMBED_INLINE_ATTRS,
                  src: url.trim(),
                  embedUrl: result.embedUrl,
                  provider: result.provider,
                }
              : {
                  ...DEFAULT_EMBED_INLINE_ATTRS,
                  src: url.trim(),
                  error: 'Unsupported or invalid embed URL',
                },
          });
        },
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embedInline: {
      setEmbedInline: (attributes?: Partial<EmbedInlineAttributes>) => ReturnType;
      setEmbedInlineFromUrl: (url: string) => ReturnType;
    };
  }
}

export default EmbedInline;
