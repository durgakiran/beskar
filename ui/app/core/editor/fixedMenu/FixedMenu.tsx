"use client";
import { Button } from "flowbite-react";
import { HiHome } from "react-icons/hi";
import { LuUndo, LuRedo } from "react-icons/lu";
import { useContext } from "react";
import { EditorContext } from "@editor/context/editorContext";
import { ContentTypePicker } from "@editor/menus/contentTypePicker/ContentTypePicker";
import FormatTypePicker from "@editor/menus/formatTypePicker/formatTypePicker";
import ContentAlignPicker from "@editor/menus/contentAlignTypePicker/contentAlignPicker";

export default function FixedMenu({ handleClose }: { handleClose: () => void }) {
    const editor = useContext(EditorContext);

    if (!editor) {
        return <>Loading header ....</>;
    }

    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", maxWidth: "1024px" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", borderRight: "0.25px solid", paddingRight: "1em" }}>
                    <Button outline color="transparent" size="xs" aria-label="home" onClick={() => console.log("Home clicked")}>
                        <HiHome size="18" />
                    </Button>

                    <Button outline color="transparent" size="xs" onClick={() => editor.chain().undo().run()} aria-label="undo">
                        <LuUndo size="18" />
                    </Button>
                    <Button outline color="transparent" size="xs" onClick={() => editor.chain().redo().run()} aria-label="redo">
                        <LuRedo size="18" />
                    </Button>
                </div>

                <div style={{ display: "flex", borderRight: "0.25px solid", paddingLeft: "1rem", paddingRight: "1em" }}>
                    <ContentTypePicker editor={editor} />
                </div>
                <div style={{ display: "flex", borderRight: "0.25px solid", paddingLeft: "1rem", paddingRight: "1em" }}>
                    <FormatTypePicker editor={editor} />
                </div>
                <div style={{ display: "flex", borderRight: "0.25px solid", paddingLeft: "1rem", paddingRight: "1em" }}>
                    <ContentAlignPicker editor={editor} />
                </div>
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
                <div style={{ paddingRight: "0.5rem" }}>
                    <Button color="black">Update</Button> {/* 'color' used for specifying button color */}
                </div>
                <div style={{ paddingRight: "0.5rem" }}>
                    <Button color="gray" onClick={handleClose} style={{ backgroundColor: "transparent", border: "none" }}>
                        Close
                    </Button>
                </div>
            </div>
        </div>
    );
}
