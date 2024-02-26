import ModifiedIcon from "@components/modifiedIcon";
import { ActionList, ActionMenu } from "@primer/react";
import { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { useContentAlignTypes } from "./hooks/useContentAlignTypes";
import { ContentAlignTypePickerOption } from "./types";

interface ContentAlignPickerOption {
    editor: Editor;
}

export default function ContentAlignPicker({ editor }: ContentAlignPickerOption) {
    const [open, setOpen] = useState(false);
    const options = useContentAlignTypes(editor);
    const [activeItem, setActiveItem] = useState<ContentAlignTypePickerOption>();

    useEffect(() => {
        if (editor) {
            editor.on('selectionUpdate', () => {
                const activeItemTmp = options.find(option => option.isActive());
                setActiveItem(activeItemTmp);
            });
            editor.on('transaction', () => {
                const activeItemTmp = options.find(option => option.isActive());
                setActiveItem(activeItemTmp);
            });
        }
    }, []);

    return (
        <ActionMenu open={open} onOpenChange={setOpen}>
            <ActionMenu.Button disabled={!activeItem} variant="invisible"> 
                <ModifiedIcon name={activeItem ? activeItem.icon : "Alignleft"} size={16} />
            </ActionMenu.Button>
            <ActionMenu.Overlay>
                <ActionList sx={{ display: "flex", alignItems: "center" }}>
                    {
                        options.map((item, i) => (
                            <ActionList.Item key={i} onClick={() => {item.onClick(); setOpen(false) }} disabled={item.disabled()}  >
                                <ActionList.LeadingVisual>
                                    <ModifiedIcon name={item.icon} size={16} />
                                </ActionList.LeadingVisual>
                                {/* <ActionList.TrailingVisual sx={{ color: "fg.subtle" }}>æ⌥1</ActionList.TrailingVisual> */}
                            </ActionList.Item>
                        ))
                    }
                </ActionList>
            </ActionMenu.Overlay>
        </ActionMenu>
    )
}
