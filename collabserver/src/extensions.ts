import { Extension } from '@tiptap/core';
import { Document } from '@tiptap/extension-document';
import { Heading } from '@tiptap/extension-heading';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { Bold } from '@tiptap/extension-bold';
import { BulletList } from '@tiptap/extension-bullet-list';
import { Code } from '@tiptap/extension-code';
import { Dropcursor } from '@tiptap/extension-dropcursor';
import { Gapcursor } from '@tiptap/extension-gapcursor';
import { Italic } from '@tiptap/extension-italic';
import { ListItem } from '@tiptap/extension-list-item';
import { OrderedList } from '@tiptap/extension-ordered-list';
import { Strike } from '@tiptap/extension-strike';
import { Blockquote } from '@tiptap/extension-blockquote';
import { CodeBlock } from '@tiptap/extension-code-block';
import { TextStyle } from '@tiptap/extension-text-style';

// Custom Attributes extension
const CustomAttributes = Extension.create({
    name: 'customAttributes',
    addGlobalAttributes() {
        return [
            {
                types: [
                    'document',
                    'paragraph',
                    'heading',
                    'bulletList',
                    'orderedList',
                    'listItem',
                    'blockquote',
                    'codeBlock',
                ],
                attributes: {
                    orderId: {
                        default: null,
                        parseHTML: element => element.getAttribute('data-order-id'),
                        renderHTML: attributes => {
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
                        parseHTML: element => element.getAttribute('data-content-id'),
                        renderHTML: attributes => {
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
                        parseHTML: element => element.getAttribute('data-doc-id'),
                        renderHTML: attributes => {
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

export const extensions = [
    CustomAttributes,
    Document,
    Heading,
    Paragraph,
    Text,
    Bold,
    BulletList,
    Code,
    Dropcursor,
    Gapcursor,
    Italic,
    ListItem,
    OrderedList,
    Strike,
    Blockquote,
    CodeBlock,
    TextStyle,
]; 