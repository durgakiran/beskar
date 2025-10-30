import { Editor } from "@tiptap/react";
import { useTextMenuFormatTypes } from "./hooks/useTextMenuFormatTypes";
import ModifiedIcon from "@components/modifiedIcon";
import { useEffect, useState } from "react";
import { FormatTypePickerOption } from "./types";
import "./picker.css";
import { IconButton } from "@radix-ui/themes";

interface FormatTypePickerProps {
    editor: Editor;
}

export default function FormatTypePicker({ editor }: FormatTypePickerProps) {
    const options = useTextMenuFormatTypes(editor);
    const [activeFormatType, setActiveFormatType] = useState<Array<FormatTypePickerOption>>();

    useEffect(() => {
        if (editor) {
            editor.on("selectionUpdate", () => {
                const activeItemTmp = options.filter((option) => option.isActive());
                setActiveFormatType(activeItemTmp);
            });
            editor.on("transaction", () => {
                const activeItemTmp = options.filter((option) => option.isActive());
                setActiveFormatType(activeItemTmp);
            });
        }
    }, []);

    return (
        <>
            {options.map((item, i) => (
                <IconButton
                    variant={item.isActive() ? "soft" : "ghost"}
                    aria-label={item.label}
                    size="2"
                    key={i}
                    disabled={item.disabled()}
                    onClick={() => item.onClick()}
                >
                    <ModifiedIcon name={item.icon} size={16} />
                </IconButton>
            ))}
        </>
    );
}
