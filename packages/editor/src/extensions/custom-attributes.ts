import { Extension } from '@tiptap/core';

export interface CustomAttributesOptions {
  types?: string[];
}

/**
 * Extension that adds custom attributes to nodes
 * Adds orderId, contentId, and docId attributes for tracking
 */
export const CustomAttributes = Extension.create<CustomAttributesOptions>({
  name: 'customAttributes',

  addOptions() {
    return {
      types: [
        'heading',
        'paragraph',
        'bulletList',
        'listItem',
        'orderedList',
        'blockquote',
        'doc',
        'taskList',
        'taskItem',
        'codeBlock',
        'table',
        'tableCell',
        'tableHeader',
        'tableRow',
      ],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types || [],
        attributes: {
          orderId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-order-id'),
            renderHTML: (attributes: Record<string, any>) => {
              if (!attributes.orderId) {
                return {};
              }
              return {
                'data-order-id': attributes.orderId,
              };
            },
          },
          contentId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-content-id'),
            renderHTML: (attributes: Record<string, any>) => {
              if (!attributes.contentId) {
                return {};
              }
              return {
                'data-content-id': attributes.contentId,
              };
            },
          },
          docId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-doc-id'),
            renderHTML: (attributes: Record<string, any>) => {
              if (!attributes.docId) {
                return {};
              }
              return {
                'data-doc-id': attributes.docId,
              };
            },
          },
        },
      },
    ];
  },
});

