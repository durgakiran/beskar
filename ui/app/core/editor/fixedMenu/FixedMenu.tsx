"use client";
import { ActionList, ActionMenu, Avatar, Box, Button, IconButton } from "@primer/react";
import { HomeIcon, UndoIcon, RedoIcon, ItalicIcon, BoldIcon, KebabHorizontalIcon } from "@primer/octicons-react";
import { ModifiedAlignCenterIcon, ModifiedAlignLeftIcon, ModifiedAlignRightIcon, ModifiedHighlighterIcon, ModifiedPaletteIconIcon } from "@editor/Button/modifiedIconButton";
import Collaborators from "@editor/collaborators/Collaborators";
import { useContext, useEffect } from "react";
import { CollaboratorsContext } from "@editor/context/collaborators";
import { EditorContext } from "@editor/context/editorContext";
import { ContentTypePicker } from "@editor/menus/contentTypePicker/ContentTypePicker";
import FormatTypePicker from "@editor/menus/formatTypePicker/formatTypePicker";
import ContentAlignPicker from "@editor/menus/contentAlignTypePicker/contentAlignPicker";

export default function FixedMenu() {
    const collaborators = useContext(CollaboratorsContext);
    const editor = useContext(EditorContext);

    useEffect(() => {
        console.log(collaborators);
    }, [collaborators]);

    if (!editor) {
        return <>Loading header ....</>;
    }

    return (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", maxWidth: "1024px" }}>
            <Box sx={{ display: "flex", alignItems: "center" }}>
                <Box sx={{ display: "flex", borderRight: "0.5px solid", paddingRight: "1em" }}>
                    <IconButton variant="invisible" icon={HomeIcon} size="medium" aria-label="home" />
                    <IconButton variant="invisible" onClick={() => editor.chain().undo().run()} icon={UndoIcon} size="medium" aria-label="undo" />
                    <IconButton variant="invisible" onClick={() => editor.chain().redo().run()} icon={RedoIcon} size="medium" aria-label="redo" />
                </Box>
                <Box sx={{ display: "flex", borderRight: "0.5px solid", paddingLeft: "1rem", paddingRight: "1em" }}>
                    <ContentTypePicker editor={editor} />
                </Box>
                <Box sx={{ display: "flex", borderRight: "0.5px solid", paddingLeft: "1rem", paddingRight: "1em" }}>
                    <FormatTypePicker  editor={editor} />
                </Box>
                <Box sx={{ display: "flex", borderRight: "0.5px solid", paddingLeft: "1rem", paddingRight: "1em" }}>
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
                </Box>
                <Box sx={{ display: "flex", borderRight: "0.5px solid", paddingLeft: "1rem", paddingRight: "1em" }}>
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
                </Box>
                {/* 
                <Box>List, indent by tab</Box>
                <Box>Additional macros such as Action Item, Link, Image, Mention, Emoji, Table, Layouts and other macros drops</Box>
                <Box>
                    Collaboration, AI, find and replace, show inline comments, content level restrictions, copy link, update button, close button, ellipsis for preview, resolved commnets and view changes{" "}
                </Box> */}
            </Box>
            <Box sx={{ display: "flex", alignItems: "center" }}>
                <Box sx={{ paddingRight: "1rem" }}>
                    <Collaborators collaborators={collaborators} />
                </Box>
                <Box sx={{ paddingRight: "0.5rem" }}>
                    <Button variant="primary">Update</Button>
                </Box>
                <Box sx={{ paddingRight: "0.5rem" }}>
                    <Button variant="invisible">Close</Button>
                </Box>
            </Box>
        </Box>
    );
}
