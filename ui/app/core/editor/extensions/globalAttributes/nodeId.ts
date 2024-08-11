import { Extension } from "@tiptap/react";

export const NodeIdExtension = Extension.create({
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
                    contentId: {
                        default: null
                    },
                    orderId: {
                        default: null
                    },
                    docId: {
                        default: null
                    },
                },
            },
        ];
    },
});
