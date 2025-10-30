import { Editor } from "@tiptap/react";
import { useMemo } from "react";
import { ContentAlignTypePickerOption } from "../types";

export const useContentAlignTypes = (editor: Editor) => {
    const options = useMemo(() => {
        return [
            {
                label: "Left Align",
                icon: "AlignLeft",
                id: "alignleft",
                disabled: () => !(editor.can() as any).setTextAlign("left"),
                isActive: () => editor.isActive({ textAlign: "left" }),
                onClick: () => (editor.chain().focus() as any).setTextAlign("left").run(),
            },
            {
                label: "Center Align",
                icon: "AlignCenter",
                id: "aligncenter",
                disabled: () => !(editor.can() as any).setTextAlign("center"),
                isActive: () => editor.isActive({ textAlign: "center" }),
                onClick: () => (editor.chain().focus() as any).setTextAlign("center").run(),
            },
            {
                label: "Right Align",
                icon: "AlignRight",
                id: "alignright",
                disabled: () => !(editor.can() as any).setTextAlign("right"),
                isActive: () => editor.isActive({ textAlign: "right" }),
                onClick: () => (editor.chain().focus() as any).setTextAlign("right").run(),
            },
        ];
    }, [editor]);

    return options;
};
