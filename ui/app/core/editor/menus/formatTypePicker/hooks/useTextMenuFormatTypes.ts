import { Editor } from "@tiptap/react";
import { useMemo } from "react";
import { FormatTypePickerOption } from "../types";

export const useTextMenuFormatTypes = (editor: Editor) => {
    const options = useMemo<Array<FormatTypePickerOption>>(() => {
        return [
            {
                label: "Bold",
                icon: "Bold",
                id: "bold",
                disabled: () => !editor.can().setBold(),
                isActive: () => editor.isActive('bold'),
                onClick: () => editor.chain().focus().toggleBold().run(),
            },
            {
                label: "Italic",
                icon: "Italic",
                id: "italic",
                disabled: () => !editor.can().setItalic(),
                isActive: () => editor.isActive('italic'),
                onClick: () => editor.chain().focus().toggleItalic().run(),
            },
            {
                label: "Underline",
                icon: "Underline",
                id: "underline",
                disabled: () => !editor.can().setUnderline(),
                isActive: () => editor.isActive('underline'),
                onClick: () => editor.chain().focus().toggleUnderline().run(),
            },
            {
                label: "Strike Through",
                icon: "Strikethrough",
                id: "strikethrough",
                disabled: () => !editor.can().setStrike(),
                isActive: () => editor.isActive('strike'),
                onClick: () => editor.chain().focus().toggleStrike().run(),
            },
            {
                label: "Code",
                icon: "Code",
                id: "code",
                disabled: () => !editor.can().setCode(),
                isActive: () => editor.isActive('code'),
                onClick: () => editor.chain().focus().toggleCode().run(),
            }
        ]
    }, [editor]);

    return options;
}
