import { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { useContentAlignTypes } from "./hooks/useContentAlignTypes";
import { ContentAlignTypePickerOption } from "./types";
import { HiMenuAlt2, HiMenuAlt3, HiOutlineMenu } from "react-icons/hi";
import { IconButton, Flex, Tooltip } from "@radix-ui/themes";
interface ContentAlignPickerOption {
    editor: Editor;
}

export default function ContentAlignPicker({ editor }: ContentAlignPickerOption) {
    const [open, setOpen] = useState(false);
    const options = useContentAlignTypes(editor);
    const [activeItem, setActiveItem] = useState<ContentAlignTypePickerOption>();

    const alignmentTypes = [
        { icon: HiMenuAlt2, alignment: "left", tooltip: "Align Left" },
        { icon: HiOutlineMenu, alignment: "center", tooltip: "Align Center" },
        { icon: HiMenuAlt3, alignment: "right", tooltip: "Align Right" },
    ];

    useEffect(() => {
        if (editor) {
            const updateActiveItem = () => {
                // Assuming there's a way to get the current alignment from the editor
                const currentAlignment = editor.getAttributes("paragraph").textAlign;
                setActiveItem(currentAlignment || "left");
            };

            editor.on("selectionUpdate", updateActiveItem);
            editor.on("transaction", updateActiveItem);

            return () => {
                editor.off("selectionUpdate", updateActiveItem);
                editor.off("transaction", updateActiveItem);
            };
        }
    }, [editor]);

    // Function to apply alignment to the content
    const handleIconClick = (alignment) => {
        if (editor) {
            editor.chain().focus().setNode("paragraph", { textAlign: alignment }).run();
            setActiveItem(alignment); // Update active item to reflect current alignment
        }
    };

    return (
        <Flex align="center" gap="1">
            {alignmentTypes.map((type) => {
                const Icon = type.icon;
                return (
                    <Tooltip key={type.alignment} content={type.tooltip}>
                        <IconButton 
                            variant="ghost" 
                            size="2"
                            onClick={() => handleIconClick(type.alignment)}
                        >
                            <Icon size={16} />
                        </IconButton>
                    </Tooltip>
                );
            })}
        </Flex>
    );
}
