import { useTextMenuContentTypes } from "./hooks/useTextMenuContentTypes";
import { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { ContentTypePickerOption } from "./types";
import ModifiedIcon from "@components/modifiedIcon";
import { DropdownMenu, Button } from "@radix-ui/themes";

interface ContentTypePickerProps {
    editor: Editor;
}

export const ContentTypePicker = ({ editor }: ContentTypePickerProps) => {
    const [open, setOpen] = useState(false);
    const options = useTextMenuContentTypes(editor);
    const [activeItem, setActiveItem] = useState<ContentTypePickerOption>();

    useEffect(() => {
        if (editor) {
            editor.on("selectionUpdate", () => {
                const activeItemTmp = options.find((option) => option.isActive());
                setActiveItem(activeItemTmp);
            });
            editor.on("transaction", () => {
                const activeItemTmp = options.find((option) => option.isActive());
                setActiveItem(activeItemTmp);
            });
        }
    }, []);

    return (
        <DropdownMenu.Root open={open} onOpenChange={setOpen}>
            <DropdownMenu.Trigger>
                <Button variant="ghost" disabled={!activeItem}>
                    {activeItem ? activeItem.label : "Normal Text"}
                </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
                {options.map((item, i) => {
                    return (
                        <DropdownMenu.Item
                            onClick={() => {
                                item.onClick();
                                setOpen(false);
                            }}
                            disabled={item.disabled()}
                            key={i}
                        >
                            {item.label}
                        </DropdownMenu.Item>
                    );
                })}
            </DropdownMenu.Content>
        </DropdownMenu.Root>
    );
};
