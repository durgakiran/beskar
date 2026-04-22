/**
 * EmbedBlock — iframe-based external rich embeds from a trusted provider registry.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
import { EmbedBlockView } from '../components/embed/EmbedBlockView';
import { getEmbedUrlAndProvider, isSinglePlainUrl } from './embed/embed-providers';

export interface EmbedBlockAttributes {
  src: string;
  embedUrl: string;
  provider: string;
  align: 'left' | 'center' | 'right';
  height: number;
  error: string;
}

const DEFAULT_EMBED_ATTRS: EmbedBlockAttributes = {
  src: '',
  embedUrl: '',
  provider: '',
  align: 'center',
  height: 480,
  error: '',
};

export const EmbedBlock = Node.create({
  name: 'embedBlock',
  group: 'block',
  atom: true,
  draggable: true,
  isolating: true,

  addAttributes() {
    return {
      src: {
        default: DEFAULT_EMBED_ATTRS.src,
        parseHTML: (element) => element.getAttribute('data-src') || '',
        renderHTML: (attributes) => ({ 'data-src': attributes.src }),
      },
      embedUrl: {
        default: DEFAULT_EMBED_ATTRS.embedUrl,
        parseHTML: (element) => element.getAttribute('data-embed-url') || '',
        renderHTML: (attributes) => ({ 'data-embed-url': attributes.embedUrl }),
      },
      provider: {
        default: DEFAULT_EMBED_ATTRS.provider,
        parseHTML: (element) => element.getAttribute('data-provider') || '',
        renderHTML: (attributes) => ({ 'data-provider': attributes.provider }),
      },
      align: {
        default: DEFAULT_EMBED_ATTRS.align,
        parseHTML: (element) => element.getAttribute('data-align') || DEFAULT_EMBED_ATTRS.align,
        renderHTML: (attributes) => ({ 'data-align': attributes.align }),
      },
      height: {
        default: DEFAULT_EMBED_ATTRS.height,
        parseHTML: (element) => {
          const value = Number.parseInt(element.getAttribute('data-height') || '', 10);
          return Number.isFinite(value) ? value : DEFAULT_EMBED_ATTRS.height;
        },
        renderHTML: (attributes) => ({ 'data-height': attributes.height }),
      },
      error: {
        default: DEFAULT_EMBED_ATTRS.error,
        parseHTML: (element) => element.getAttribute('data-error') || '',
        renderHTML: (attributes) => (attributes.error ? { 'data-error': attributes.error } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="embed-block"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { blockId, ...attributesWithoutBlockId } = HTMLAttributes as any;
    const linkUrl = node.attrs.src || node.attrs.embedUrl || '';

    return [
      'div',
      mergeAttributes(attributesWithoutBlockId, {
        'data-type': 'embed-block',
        'data-src': node.attrs.src,
        'data-embed-url': node.attrs.embedUrl,
        'data-provider': node.attrs.provider,
        'data-align': node.attrs.align,
        'data-height': node.attrs.height,
        class: `embed-block-wrapper align-${node.attrs.align}`,
      }),
      linkUrl ? ['a', { href: linkUrl, target: '_blank', rel: 'noopener noreferrer' }, linkUrl] : '',
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedBlockView);
  },

  addCommands() {
    return {
      setEmbedBlock:
        (attributes?: Partial<EmbedBlockAttributes>) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              ...DEFAULT_EMBED_ATTRS,
              ...attributes,
            },
          });
        },
      setEmbedFromUrl:
        (url: string) =>
        ({ commands }) => {
          const result = getEmbedUrlAndProvider(url);
          return commands.insertContent({
            type: this.name,
            attrs: result
              ? {
                  ...DEFAULT_EMBED_ATTRS,
                  src: url.trim(),
                  embedUrl: result.embedUrl,
                  provider: result.provider,
                }
              : {
                  ...DEFAULT_EMBED_ATTRS,
                  src: url.trim(),
                  error: 'Unsupported or invalid embed URL',
                },
          });
        },
    };
  },

  addProseMirrorPlugins() {
    const { isEditable } = this.editor;

    const plugins: Plugin[] = [
      new Plugin({
        props: {
          handlePaste: (view, event) => {
            if (!isEditable) return false;
            const text = event.clipboardData?.getData('text/plain') ?? '';
            if (!isSinglePlainUrl(text)) return false;

            const result = getEmbedUrlAndProvider(text);
            if (!result) return false;

            const { state, dispatch } = view;
            const node = state.schema.nodes.embedBlock.create({
              ...DEFAULT_EMBED_ATTRS,
              src: text.trim(),
              embedUrl: result.embedUrl,
              provider: result.provider,
            });

            dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
            return true;
          },
        },
      }),
    ];

    if (!isEditable) {
      return plugins;
    }

    plugins.push(
      new Plugin({
        view: (view) => {
          const updateEmbedBlockWrappers = () => {
            view.state.doc.descendants((node, pos) => {
              if (node.type.name !== 'embedBlock') return;
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

          setTimeout(updateEmbedBlockWrappers, 0);

          return {
            update: () => {
              updateEmbedBlockWrappers();
            },
          };
        },
      }),
    );

    return plugins;
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embedBlock: {
      setEmbedBlock: (attributes?: Partial<EmbedBlockAttributes>) => ReturnType;
      setEmbedFromUrl: (url: string) => ReturnType;
    };
  }
}

export default EmbedBlock;
