import { Editor } from "@tiptap/react";
import { useMemo } from "react";
import { ContentTypePickerOption } from "../types";

export const useTextMenuContentTypes = (editor: Editor) => {
    const options = useMemo<ContentTypePickerOption[]>(() => {
        return [
            {
                id: "paragraph",
                label: "Normal Text",
                disabled: () => !(editor.can() as any).setParagraph(),
                isActive: () => editor.isActive("paragraph") && !editor.isActive("orderedList") && !editor.isActive("bulletList") && !editor.isActive("taskList"),
                icon: "Pilcrow",
                onClick: () => (editor.chain().focus().lift("taskItem").liftListItem("listItem") as any).setParagraph().run(),
            },
            {
                icon: "Heading1",
                onClick: () => (editor.chain().focus().lift("taskItem").liftListItem("listItem") as any).setHeading({ level: 1 }).run(),
                id: "heading1",
                disabled: () => !(editor.can() as any).setHeading({ level: 1 }),
                isActive: () => editor.isActive("heading", { level: 1 }),
                label: "Heading 1",
            },
            {
                icon: "Heading2",
                onClick: () => (editor.chain().focus().lift("taskItem").liftListItem("listItem") as any).setHeading({ level: 2 }).run(),
                id: "heading2",
                disabled: () => !(editor.can() as any).setHeading({ level: 2 }),
                isActive: () => editor.isActive("heading", { level: 2 }),
                label: "Heading 2",
            },
            {
                icon: "Heading3",
                onClick: () => (editor.chain().focus().lift("taskItem").liftListItem("listItem") as any).setHeading({ level: 3 }).run(),
                id: "heading3",
                disabled: () => !(editor.can() as any).setHeading({ level: 3 }),
                isActive: () => editor.isActive("heading", { level: 3 }),
                label: "Heading 3",
                type: "option",
            },
            {
                icon: "Heading4",
                onClick: () => (editor.chain().focus().lift("taskItem").liftListItem("listItem") as any).setHeading({ level: 4 }).run(),
                id: "heading4",
                disabled: () => !(editor.can() as any).setHeading({ level: 4 }),
                isActive: () => editor.isActive("heading", { level: 4 }),
                label: "Heading 4",
            },
            {
                icon: "Heading5",
                onClick: () => (editor.chain().focus().lift("taskItem").liftListItem("listItem") as any).setHeading({ level: 5 }).run(),
                id: "heading5",
                disabled: () => !(editor.can() as any).setHeading({ level: 5 }),
                isActive: () => editor.isActive("heading", { level: 5 }),
                label: "Heading 5",
            },
            {
                icon: "Heading6",
                onClick: () => (editor.chain().focus().lift("taskItem").liftListItem("listItem") as any).setHeading({ level: 6 }).run(),
                id: "heading6",
                disabled: () => !(editor.can() as any).setHeading({ level: 6 }),
                isActive: () => editor.isActive("heading", { level: 6 }),
                label: "Heading 6",
            },
        ];
    }, [editor]);

    return options;
};
