import { Editor } from "@tiptap/react";
import { useTextMenuFormatTypes } from "./hooks/useTextMenuFormatTypes";
import ModifiedIcon from "@components/modifiedIcon";
import { Button, IconButton } from "@primer/react";
import { useEffect, useState } from "react";
import { FormatTypePickerOption } from "./types";
import "./picker.css";

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
                console.log(activeItemTmp);
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
                <Button
                    aria-label={item.label}
                    sx={{ color: "black" }}
                    className={item.isActive() ? "active" : ""}
                    as="button"
                    size="small"
                    variant="invisible"
                    key={i}
                    disabled={item.disabled()}
                    onClick={() => item.onClick()}
                >
                    <ModifiedIcon name={item.icon} size={16} />
                </Button>
            ))}
        </>
    );
}
