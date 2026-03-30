/**
 * ImageInline — an inline image node that flows within text,
 * similar to Confluence's inline image feature.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ImageInlineView } from '../components/image/ImageInlineView';

export interface ImageInlineAttributes {
  src: string;
  alt: string;
  /** Explicit pixel width; null = natural / auto */
  width: number | null;
  /** Explicit pixel height; null = natural / auto */
  height: number | null;
  uploadStatus: 'idle' | 'uploading' | 'error';
}

export const ImageInline = Node.create({
  name: 'imageInline',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: false,

  addAttributes() {
    return {
      src: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-src') || el.querySelector('img')?.getAttribute('src') || '',
        renderHTML: (attrs) => ({ 'data-src': attrs.src }),
      },
      alt: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-alt') || el.querySelector('img')?.getAttribute('alt') || '',
        renderHTML: (attrs) => ({ 'data-alt': attrs.alt }),
      },
      width: {
        default: null,
        parseHTML: (el) => {
          const w = el.getAttribute('data-width');
          return w ? parseInt(w, 10) : null;
        },
        renderHTML: (attrs) => (attrs.width ? { 'data-width': String(attrs.width) } : {}),
      },
      height: {
        default: null,
        parseHTML: (el) => {
          const h = el.getAttribute('data-height');
          return h ? parseInt(h, 10) : null;
        },
        renderHTML: (attrs) => (attrs.height ? { 'data-height': String(attrs.height) } : {}),
      },
      uploadStatus: {
        default: 'idle',
        parseHTML: (el) => el.getAttribute('data-upload-status') as any || 'idle',
        renderHTML: (attrs) => ({ 'data-upload-status': attrs.uploadStatus }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="image-inline"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'image-inline',
        class: 'image-inline-root',
      }),
      [
        'img',
        {
          src: node.attrs.src,
          alt: node.attrs.alt || '',
          ...(node.attrs.width ? { width: node.attrs.width } : {}),
          ...(node.attrs.height ? { height: node.attrs.height } : {}),
          class: 'image-inline-img',
        },
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageInlineView);
  },
});

export default ImageInline;
