import { useTextMenuContentTypes } from "./hooks/useTextMenuContentTypes";
import { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { ContentTypePickerOption } from "./types";
import ModifiedIcon from "@components/modifiedIcon";
import { Dropdown } from "flowbite-react";

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
        <Dropdown inline disabled={!activeItem} label={activeItem ? activeItem.label : "Normal Text"}>
            {options.map((item, i) => {
                return (
                    <Dropdown.Item
                        onClick={() => {
                            item.onClick();
                            setOpen(false);
                        }}
                        disabled={item.disabled()}
                        key={i}
                    >
                        {item.label}
                    </Dropdown.Item>
                );
            })}
        </Dropdown>
    );
};
