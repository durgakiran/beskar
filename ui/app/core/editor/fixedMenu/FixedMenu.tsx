"use client";
import { ActionList, ActionMenu, Avatar, Box, Button, IconButton } from "@primer/react";
import { HomeIcon, UndoIcon, RedoIcon, ItalicIcon, BoldIcon, KebabHorizontalIcon } from "@primer/octicons-react";
import { ModifiedAlignCenterIcon, ModifiedAlignLeftIcon, ModifiedAlignRightIcon, ModifiedHighlighterIcon, ModifiedPaletteIconIcon, ModifiedUnderlineIcon } from "@editor/Button/modifiedIconButton";
import Collaborators from "@editor/collaborators/Collaborators";
import { useContext, useEffect } from "react";
import { CollaboratorsContext } from "@editor/context/collaborators";

export default function FixedMenu() {
    const collaborators = useContext(CollaboratorsContext);

    useEffect(() => {
        console.log(collaborators);
    }, [collaborators]);

    return (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", maxWidth: '1024px' }}>
            <Box sx={{ display: "flex", alignItems: "center" }}>
                <Box sx={{ display: "flex", borderRight: "0.5px solid", paddingRight: "1em" }}>
                    <IconButton variant="invisible" icon={HomeIcon} size="medium" aria-label="home" />
                    <IconButton variant="invisible" icon={UndoIcon} size="medium" aria-label="undo" />
                    <IconButton variant="invisible" icon={RedoIcon} size="medium" aria-label="redo" />
                </Box>
                <Box sx={{ display: "flex", borderRight: "0.5px solid", paddingLeft: "1rem", paddingRight: "1em" }}>
                    <ActionMenu>
                        <ActionMenu.Button variant="invisible"> Type </ActionMenu.Button>
                        <ActionMenu.Overlay>
                            <ActionList>
                                <ActionList.Item>
                                    Normal Text <ActionList.TrailingVisual sx={{ color: "fg.subtle" }}>æ⌥0</ActionList.TrailingVisual>
                                </ActionList.Item>
                                <ActionList.Item>
                                    Heading 1 <ActionList.TrailingVisual sx={{ color: "fg.subtle" }}>æ⌥1</ActionList.TrailingVisual>
                                </ActionList.Item>
                                <ActionList.Item>
                                    Heading 2 <ActionList.TrailingVisual sx={{ color: "fg.subtle" }}>æ⌥2</ActionList.TrailingVisual>
                                </ActionList.Item>
                                <ActionList.Item>
                                    Heading 3 <ActionList.TrailingVisual sx={{ color: "fg.subtle" }}>æ⌥3</ActionList.TrailingVisual>
                                </ActionList.Item>
                                <ActionList.Item>
                                    Heading 4 <ActionList.TrailingVisual sx={{ color: "fg.subtle" }}>æ⌥4</ActionList.TrailingVisual>
                                </ActionList.Item>
                                <ActionList.Item>
                                    Heading 5 <ActionList.TrailingVisual sx={{ color: "fg.subtle" }}>æ⌥5</ActionList.TrailingVisual>
                                </ActionList.Item>
                                <ActionList.Item>
                                    Heading 6 <ActionList.TrailingVisual sx={{ color: "fg.subtle" }}>æ⌥6</ActionList.TrailingVisual>
                                </ActionList.Item>
                            </ActionList>
                        </ActionMenu.Overlay>
                    </ActionMenu>
                </Box>
                <Box sx={{ display: "flex", borderRight: "0.5px solid", paddingLeft: "1rem", paddingRight: "1em" }}>
                    <IconButton aria-label="bold" icon={BoldIcon} size="small" variant="invisible" />
                    <IconButton aria-label="italic" icon={ItalicIcon} size="small" variant="invisible" />
                    <ActionMenu>
                        <ActionMenu.Button icon={KebabHorizontalIcon} size="small" variant="invisible">
                        </ActionMenu.Button>
                        <ActionMenu.Overlay>
                            <ActionList>
                                <ActionList.Item>
                                    Underline <ActionList.TrailingVisual sx={{ color: "fg.subtle" }}>æU</ActionList.TrailingVisual>
                                </ActionList.Item>
                                <ActionList.Item>
                                    Strikethrough <ActionList.TrailingVisual sx={{ color: "fg.subtle" }}>⌘⇧S</ActionList.TrailingVisual>
                                </ActionList.Item>
                                <ActionList.Item>
                                    Code <ActionList.TrailingVisual sx={{ color: "fg.subtle" }}>⌘⇧M</ActionList.TrailingVisual>
                                </ActionList.Item>
                                <ActionList.Item>
                                    Subscript <ActionList.TrailingVisual sx={{ color: "fg.subtle" }}>⌘⇧,</ActionList.TrailingVisual>
                                </ActionList.Item>
                                <ActionList.Item>
                                    Superscript <ActionList.TrailingVisual sx={{ color: "fg.subtle" }}>⌘⇧.</ActionList.TrailingVisual>
                                </ActionList.Item>
                            </ActionList>
                        </ActionMenu.Overlay>
                    </ActionMenu>
                </Box>
                <Box sx={{ display: "flex", borderRight: "0.5px solid", paddingLeft: "1rem", paddingRight: "1em" }}>
                    <ActionMenu>
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
                    </ActionMenu>
                </Box>
                <Box sx={{ display: "flex", borderRight: "0.5px solid", paddingLeft: "1rem", paddingRight: "1em" }}>
                    <ActionMenu>
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
                    </ActionMenu>
                </Box>
                {/* 
                <Box>List, indent by tab</Box>
                <Box>Additional macros such as Action Item, Link, Image, Mention, Emoji, Table, Layouts and other macros drops</Box>
                <Box>
                    Collaboration, AI, find and replace, show inline comments, content level restrictions, copy link, update button, close button, ellipsis for preview, resolved commnets and view changes{" "}
                </Box> */}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Box sx={{ paddingRight: '1rem' }}>
                    <Collaborators collaborators={collaborators} />
                </Box>
                <Box sx={{ paddingRight: '0.5rem' }}>
                    <Button variant="primary" >Update</Button>
                </Box>
                <Box sx={{ paddingRight: '0.5rem' }}>
                    <Button variant="invisible">Close</Button>
                </Box>
            </Box>
        </Box>
    );
}
