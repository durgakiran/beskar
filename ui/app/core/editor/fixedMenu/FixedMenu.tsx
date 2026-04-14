"use client";
import { Button, IconButton, Flex } from "@radix-ui/themes";
import { LuUndo, LuRedo } from "react-icons/lu";
import { useContext } from "react";
import { EditorContext } from "@editor/context/editorContext";
import { ContentTypePicker } from "@editor/menus/contentTypePicker/ContentTypePicker";
import FormatTypePicker from "@editor/menus/formatTypePicker/formatTypePicker";
import ContentAlignPicker from "@editor/menus/contentAlignTypePicker/contentAlignPicker";

export default function FixedMenu({ isEditorReady, isSidePanelOpen, setIsSidePanelOpen, canComment }: { isEditorReady: boolean, isSidePanelOpen: boolean, setIsSidePanelOpen: (open: boolean) => void, canComment: boolean }) {
    const editor = useContext(EditorContext);

    if (!editor) {
        return <>Loading header ....</>;
    }

    return (
        <Flex
            align="center"
            justify="between"
            py="3"
            px="4"
            gap="4"
            style={{
                width: "100%",
                maxWidth: "100%",
                borderBottom: "1px solid var(--gray-6)",
                minHeight: "52px"
            }}
        >
            <Flex align="center" gap="4" style={{ flex: 1 }}>
                <Flex align="center" gap="2" pr="4" style={{ borderRight: "1px solid var(--gray-6)", height: "32px" }}>
                    <IconButton
                        variant="ghost"
                        size="2"
                        onClick={() => editor.chain().undo().run()}
                        aria-label="undo"
                        style={{ height: "32px", width: "32px" }}
                    >
                        <LuUndo size={18} />
                    </IconButton>
                    <IconButton
                        variant="ghost"
                        size="2"
                        onClick={() => editor.chain().redo().run()}
                        aria-label="redo"
                        style={{ height: "32px", width: "32px" }}
                    >
                        <LuRedo size={18} />
                    </IconButton>
                </Flex>

                <Flex align="center" gap="2" px="4" style={{ borderRight: "1px solid var(--gray-6)", height: "32px" }}>
                    <ContentTypePicker editor={editor} />
                </Flex>
                <Flex align="center" gap="2" px="4" style={{ borderRight: "1px solid var(--gray-6)", height: "32px" }}>
                    <FormatTypePicker editor={editor} />
                </Flex>
                <Flex align="center" gap="2" px="4" style={{ height: "32px" }}>
                    <ContentAlignPicker editor={editor} />
                </Flex>
            </Flex>
            {canComment ? (
                <Flex align="center" gap="3">
                    <Button size="2" variant="surface" onClick={() => setIsSidePanelOpen(!isSidePanelOpen)} disabled={!isEditorReady}>
                        {isSidePanelOpen ? "Hide" : "Show"} All Comments
                    </Button>
                </Flex>
            ) : null}
        </Flex>
    );
}
