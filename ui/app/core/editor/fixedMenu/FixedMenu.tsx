"use client";
import { Button,Avatar } from "flowbite-react";
import { HiHome, } from "react-icons/hi";
import { FaUndoAlt,FaRedoAlt,FaItalic,FaBold } from "react-icons/fa";
import { GoKebabHorizontal } from "react-icons/go";
import { ModifiedAlignCenterIcon, ModifiedAlignLeftIcon, ModifiedAlignRightIcon, ModifiedHighlighterIcon, ModifiedPaletteIconIcon } from "@editor/Button/modifiedIconButton";
import Collaborators from "@editor/collaborators/Collaborators";
import { useContext, useEffect } from "react";
import { CollaboratorsContext } from "@editor/context/collaborators";
import { EditorContext } from "@editor/context/editorContext";
import { ContentTypePicker } from "@editor/menus/contentTypePicker/ContentTypePicker";
import FormatTypePicker from "@editor/menus/formatTypePicker/formatTypePicker";
import ContentAlignPicker from "@editor/menus/contentAlignTypePicker/contentAlignPicker";

export default function FixedMenu({ handleClose }: { handleClose: () => void }) {
    // const collaborators = useContext(CollaboratorsContext);
    const editor = useContext(EditorContext);


    // useEffect(() => {
    //     console.log(collaborators);
    // }, [collaborators]);

    if (!editor) {
        return <>Loading header ....</>;
    }

    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", maxWidth: "1024px" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", borderRight: "0.5px solid", paddingRight: "1em" }}>
                <Button
                    style={{ background: 'transparent', border: 'none', padding: 0 }}
                    aria-label="home"
                    onClick={() => console.log("Home clicked")}
                    >
                    <HiHome className="w-6 h-6" />
                </Button>

                <Button
                    style={{ background: 'transparent', border: 'none', padding: 0 }}
                    onClick={() => editor.chain().undo().run()}
                    aria-label="undo"
                    >
                    <FaUndoAlt className="w-6 h-6" />
                </Button>
                <Button
                    style={{ background: 'transparent', border: 'none', padding: 0 }}
                    onClick={() => editor.chain().redo().run()}
                    aria-label="redo"
                    >
                    <FaRedoAlt className="w-6 h-6" />
                </Button>
                    
                </div>
            
                <div style={{ display: "flex", borderRight: "0.5px solid", paddingLeft: "1rem", paddingRight: "1em" }}>
                    <ContentTypePicker editor={editor} />
                </div>
                <div style={{ display: "flex", borderRight: "0.5px solid", paddingLeft: "1rem", paddingRight: "1em" }}>
                    <FormatTypePicker  editor={editor} />
                </div>
                <div style={{ display: "flex", borderRight: "0.5px solid", paddingLeft: "1rem", paddingRight: "1em" }}>
                    {/* <ActionMenu>
                        <ActionMenu.Button size="small" variant="invisible">
                            <ModifiedAlignLeftIcon />
                        </ActionMenu.Button>
                        <ActionMenu.Overlay>
                            <ActionList sx={{ display: "flex", alignItems: "center" }}>
                                <ActionList.Item>
                                    <IconButton icon={ModifiedAlignLeftIcon} size="small" variant="invisible" aria-label="align left" />
                                </ActionList.Item>
                                <ActionList.Item>
                                    <IconButton icon={ModifiedAlignRightIcon} size="small" variant="invisible" aria-label="align right" />
                                </ActionList.Item>
                                <ActionList.Item>
                                    <IconButton icon={ModifiedAlignCenterIcon} size="small" variant="invisible" aria-label="align center" />
                                </ActionList.Item>
                            </ActionList>
                        </ActionMenu.Overlay>
                    </ActionMenu> */}
                    <ContentAlignPicker editor={editor} />
                </div>
                <div style={{ display: "flex", borderRight: "0.5px solid", paddingLeft: "1rem", paddingRight: "1em" }}>
                    {/* <ActionMenu>
                        <ActionMenu.Button size="small" variant="invisible">
                            <ModifiedHighlighterIcon />
                        </ActionMenu.Button>
                        <ActionMenu.Overlay>
                            <ActionList sx={{ display: "flex", alignItems: "center" }}>
                                <ActionList.Item>
                                    <IconButton icon={ModifiedAlignLeftIcon} size="small" variant="invisible" aria-label="align left" />
                                </ActionList.Item>
                                <ActionList.Item>
                                    <IconButton icon={ModifiedAlignRightIcon} size="small" variant="invisible" aria-label="align right" />
                                </ActionList.Item>
                                <ActionList.Item>
                                    <IconButton icon={ModifiedAlignCenterIcon} size="small" variant="invisible" aria-label="align center" />
                                </ActionList.Item>
                            </ActionList>
                        </ActionMenu.Overlay>
                    </ActionMenu>
                    <ActionMenu>
                        <ActionMenu.Button size="small" variant="invisible">
                            <ModifiedPaletteIconIcon />
                        </ActionMenu.Button>
                        <ActionMenu.Overlay>
                            <ActionList sx={{ display: "flex", alignItems: "center" }}>
                                <ActionList.Item>
                                    <IconButton icon={ModifiedAlignLeftIcon} size="small" variant="invisible" aria-label="align left" />
                                </ActionList.Item>
                                <ActionList.Item>
                                    <IconButton icon={ModifiedAlignRightIcon} size="small" variant="invisible" aria-label="align right" />
                                </ActionList.Item>
                                <ActionList.Item>
                                    <IconButton icon={ModifiedAlignCenterIcon} size="small" variant="invisible" aria-label="align center" />
                                </ActionList.Item>
                            </ActionList>
                        </ActionMenu.Overlay>
                    </ActionMenu> */}
                </div>
                {/* 
                <Box>List, indent by tab</Box>
                <Box>Additional macros such as Action Item, Link, Image, Mention, Emoji, Table, Layouts and other macros drops</Box>
                <Box>
                    Collaboration, AI, find and replace, show inline comments, content level restrictions, copy link, update button, close button, ellipsis for preview, resolved commnets and view changes{" "}
                </Box> */}
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
                {/* <Box sx={{ paddingRight: "1rem" }}>
                    <Collaborators collaborators={collaborators} />
                </Box> */}
                <div style={{ paddingRight: "0.5rem" }}>
                    <Button color="black">Update</Button> {/* 'color' used for specifying button color */}
                </div>
                <div style={{ paddingRight: "0.5rem" }}>
                    <Button color="gray" onClick={handleClose} style={{ backgroundColor: 'transparent', border: 'none' }}>
                        Close </Button>
                </div>
            </div>
        </div>
    );
}
