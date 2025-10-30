"use client";
import { Button, IconButton, Flex, Separator } from "@radix-ui/themes";
import { HiHome } from "react-icons/hi";
import { LuUndo, LuRedo } from "react-icons/lu";
import { useContext } from "react";
import { EditorContext } from "@editor/context/editorContext";
import { ContentTypePicker } from "@editor/menus/contentTypePicker/ContentTypePicker";
import FormatTypePicker from "@editor/menus/formatTypePicker/formatTypePicker";
import ContentAlignPicker from "@editor/menus/contentAlignTypePicker/contentAlignPicker";

export default function FixedMenu({ handleClose, handleUpdate }: { handleClose: () => void, handleUpdate: () => void }) {
    const editor = useContext(EditorContext);

    if (!editor) {
        return <>Loading header ....</>;
    }

    return (
        <Flex align="center" justify="between" style={{ width: "100%", maxWidth: "1024px" }}>
            <Flex align="center" gap="2">
                <Flex align="center" gap="1" pr="3" style={{ borderRight: "1px solid var(--gray-6)" }}>
                    <IconButton variant="ghost" size="2" aria-label="home" onClick={() => console.log("Home clicked")}>
                        <HiHome size={18} />
                    </IconButton>
                    <IconButton variant="ghost" size="2" onClick={() => editor.chain().undo().run()} aria-label="undo">
                        <LuUndo size={18} />
                    </IconButton>
                    <IconButton variant="ghost" size="2" onClick={() => editor.chain().redo().run()} aria-label="redo">
                        <LuRedo size={18} />
                    </IconButton>
                </Flex>

                <Flex align="center" px="3" style={{ borderRight: "1px solid var(--gray-6)" }}>
                    <ContentTypePicker editor={editor} />
                </Flex>
                <Flex align="center" px="3" style={{ borderRight: "1px solid var(--gray-6)" }}>
                    <FormatTypePicker editor={editor} />
                </Flex>
                <Flex align="center" px="3" style={{ borderRight: "1px solid var(--gray-6)" }}>
                    <ContentAlignPicker editor={editor} />
                </Flex>
            </Flex>
            <Flex align="center" gap="2">
                <Button onClick={handleUpdate}>Update</Button>
                <Button variant="ghost" color="gray" onClick={handleClose}>
                    Close
                </Button>
            </Flex>
        </Flex>
    );
}
