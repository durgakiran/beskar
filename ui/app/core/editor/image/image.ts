import Image from "@tiptap/extension-image"
import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import ImageView from "./imageView";

export const reactImage = Node.create({
    name: "imageViewer",
    group: "block",
    content: "inline*",
    parseHTML() {
        return [
            {
                tag: "ImageView",
            }
        ]
    },
    addKeyboardShortcuts() {
        return {
            'Mod-Enter': () => {
                return this.editor.chain().insertContentAt(this.editor.state.selection.head, { type: this.type.name }).focus().run()
            },
        }
    },

    renderHTML({ HTMLAttributes }) {
        return ['ImageView', mergeAttributes(HTMLAttributes), 0]
    },

    addNodeView() {
        return ReactNodeViewRenderer(ImageView)
    },
})

export const customImage = Image.extend({
    content: "inline*",

    parseHTML() {
        return [
            {
                tag: "ImageView",
            }
        ]
    },

    renderHTML({ HTMLAttributes }) {
        return ['ImageView', mergeAttributes(HTMLAttributes), 0]
    },

    addNodeView() {
        return ReactNodeViewRenderer(ImageView)
    },
    addAttributes() {
        return {
            ...this.parent?.(),
            width: {
                default: 500
            },
            height: {
                default: null
            }
        }
    },
});
