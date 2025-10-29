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
                disabled: () => !(editor.can() as any).setBold(),
                isActive: () => editor.isActive('bold'),
                onClick: () => (editor.chain().focus() as any).toggleBold().run(),
            },
            {
                label: "Italic",
                icon: "Italic",
                id: "italic",
                disabled: () => !(editor.can() as any).setItalic(),
                isActive: () => editor.isActive('italic'),
                onClick: () => (editor.chain().focus() as any).toggleItalic().run(),
            },
            {
                label: "Underline",
                icon: "Underline",
                id: "underline",
                disabled: () => !(editor.can() as any).setUnderline(),
                isActive: () => editor.isActive('underline'),
                onClick: () => (editor.chain().focus() as any).toggleUnderline().run(),
            },
            {
                label: "Strike Through",
                icon: "Strikethrough",
                id: "strikethrough",
                disabled: () => !(editor.can() as any).setStrike(),
                isActive: () => editor.isActive('strike'),
                onClick: () => (editor.chain().focus() as any).toggleStrike().run(),
            },
            {
                label: "Code",
                icon: "Code",
                id: "code",
                disabled: () => !(editor.can() as any).setCode(),
                isActive: () => editor.isActive('code'),
                onClick: () => (editor.chain().focus() as any).toggleCode().run(),
            }
        ]
    }, [editor]);

    return options;
}
