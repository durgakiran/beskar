import { ActionList, ActionMenu } from "@primer/react";
import { useTextMenuContentTypes } from "./hooks/useTextMenuContentTypes";
import { Editor } from "@tiptap/react";
import { useEffect, useMemo, useState } from "react";
import { ContentTypePickerOption } from "./types";
import ModifiedIcon from "@components/modifiedIcon";

interface ContentTypePickerProps {
    editor: Editor;
}

export const ContentTypePicker = ({ editor }: ContentTypePickerProps) => {
    const [open, setOpen] = useState(false);
    const options = useTextMenuContentTypes(editor);
    const [activeItem, setActiveItem] = useState<ContentTypePickerOption>();

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
                { activeItem ? activeItem.label : "Normal Text" }
            </ActionMenu.Button>
            <ActionMenu.Overlay>
                <ActionList>
                    {
                        options.map((item, i) => (
                            <ActionList.Item key={i} onClick={() => {item.onClick(); setOpen(false) }} disabled={item.disabled()} active={item.isActive()} >
                                <ActionList.LeadingVisual>
                                    <ModifiedIcon name={item.icon} size={16} />
                                </ActionList.LeadingVisual>
                                {item.label} 
                                {/* <ActionList.TrailingVisual sx={{ color: "fg.subtle" }}>æ⌥1</ActionList.TrailingVisual> */}
                            </ActionList.Item>
                        ))
                    }
                </ActionList>
            </ActionMenu.Overlay>
        </ActionMenu>
    );
};
