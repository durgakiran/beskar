/**
 * ImageBlock - A custom block node for displaying images with captions
 * Supports upload via paste/drag-drop, resizing, and floating menu
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
import { ImageBlockView } from '../components/image/ImageBlockView';

export interface ImageBlockAttributes {
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
  caption: string;
  uploadStatus: 'idle' | 'uploading' | 'error';
  align: 'left' | 'center' | 'right';
}

export const ImageBlock = Node.create({
  name: 'imageBlock',
  group: 'block',
  atom: true,
  draggable: true,
  
  addAttributes() {
    return {
      src: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-src') || element.querySelector('img')?.getAttribute('src') || '',
        renderHTML: (attributes) => {
          return { 'data-src': attributes.src };
        },
      },
      alt: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-alt') || element.querySelector('img')?.getAttribute('alt') || '',
        renderHTML: (attributes) => {
          return { 'data-alt': attributes.alt };
        },
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const w = element.getAttribute('data-width');
          return w ? parseInt(w, 10) : null;
        },
        renderHTML: (attributes) => {
          return attributes.width ? { 'data-width': attributes.width } : {};
        },
      },
      height: {
        default: null,
        parseHTML: (element) => {
          const h = element.getAttribute('data-height');
          return h ? parseInt(h, 10) : null;
        },
        renderHTML: (attributes) => {
          return attributes.height ? { 'data-height': attributes.height } : {};
        },
      },
      caption: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-caption') || element.querySelector('figcaption')?.textContent || '',
        renderHTML: (attributes) => {
          return { 'data-caption': attributes.caption };
        },
      },
      uploadStatus: {
        default: 'idle',
        parseHTML: (element) => element.getAttribute('data-upload-status') as any || 'idle',
        renderHTML: (attributes) => {
          return { 'data-upload-status': attributes.uploadStatus };
        },
      },
      align: {
        default: 'center',
        parseHTML: (element) => element.getAttribute('data-align') as any || 'center',
        renderHTML: (attributes) => {
          return { 'data-align': attributes.align };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-type="image-block"]',
      },
      {
        tag: 'img[src]',
        getAttrs: (element) => {
          const img = element as HTMLImageElement;
          return {
            src: img.getAttribute('src'),
            alt: img.getAttribute('alt') || '',
            width: img.width || null,
            height: img.height || null,
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    // Exclude blockId from serialization (it should be unique per block)
    const { blockId, ...attributesWithoutBlockId } = HTMLAttributes as any;
    
    return [
      'figure',
      mergeAttributes(
        attributesWithoutBlockId,
        {
          'data-type': 'image-block',
          'data-src': node.attrs.src,
          'data-alt': node.attrs.alt,
          'data-width': node.attrs.width,
          'data-height': node.attrs.height,
          'data-caption': node.attrs.caption,
          'data-align': node.attrs.align,
          class: `image-block-wrapper image-align-${node.attrs.align}`,
        }
      ),
      [
        'img',
        {
          src: node.attrs.src,
          alt: node.attrs.alt,
          width: node.attrs.width || undefined,
          height: node.attrs.height || undefined,
        },
      ],
      node.attrs.caption ? ['figcaption', {}, node.attrs.caption] : ['figcaption', {}, ''],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockView);
  },

  addKeyboardShortcuts() {
    return {
      // Optional: Add keyboard shortcut to insert image block
      // 'Mod-Alt-i': () => this.editor.commands.insertContent({ type: 'imageBlock' }),
    };
  },

  addProseMirrorPlugins() {
    const { isEditable } = this.editor;

    if (!isEditable) {
      return [];
    }

    return [
      new Plugin({
        view: (view) => {
          const updateImageBlockWrappers = () => {
            view.state.doc.descendants((node, pos) => {
              if (node.type.name === 'imageBlock') {
                const blockId = node.attrs.blockId;
                const dom = view.nodeDOM(pos);
                
                if (dom) {
                  const htmlDom = dom as HTMLElement;
                  const wrapper = htmlDom.classList?.contains('react-renderer') 
                    ? htmlDom 
                    : htmlDom.closest?.('.react-renderer');
                  
                  if (wrapper) {
                    if (blockId) {
                      wrapper.setAttribute('data-block-id', blockId);
                      wrapper.classList.add('block-node');
                      wrapper.setAttribute('draggable', 'false');
                    } else {
                      wrapper.removeAttribute('data-block-id');
                      wrapper.classList.remove('block-node');
                      wrapper.removeAttribute('draggable');
                    }
                  }
                }
              }
            });
          };
          
          setTimeout(updateImageBlockWrappers, 0);
          
          return {
            update: () => {
              updateImageBlockWrappers();
            },
          };
        },
      }),
    ];
  },
});

export default ImageBlock;

