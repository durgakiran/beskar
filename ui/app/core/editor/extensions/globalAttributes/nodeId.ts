import { Extension } from "@tiptap/react";

export const CustomAttributes = Extension.create({
    name: 'customAttributes',
    addGlobalAttributes() {
        return [
            {
                types: [
                    "heading",
                    "paragraph",
                    "bold",
                    "bulletList",
                    "code",
                    "dropcursor",
                    "gapcursor",
                    "hardbreak",
                    "history",
                    "horizontalrule",
                    "italic",
                    "listItem",
                    "orderedList",
                    "strike",
                    "typography",
                    "blockQuote",
                    "textWithAttributes",
                    "document",
                    "textStyle",
                    "color",
                    "taskList",
                    "taskItem",
                    "codeBlock",
                    "underline",
                    "customImage",
                    "reactImage",
                    "customInput",
                    "table",
                    "tableCell",
                    "tableHeader",
                    "tableRow",
                ],
                attributes: {
                    orderId: {
                        default: null,
                        parseHTML: (element: HTMLElement) => element.getAttribute('data-order-id'),
                        renderHTML: (attributes: { orderId: string | null }) => {
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
                        renderHTML: (attributes: { contentId: string | null }) => {
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
                        renderHTML: (attributes: { docId: string | null }) => {
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
