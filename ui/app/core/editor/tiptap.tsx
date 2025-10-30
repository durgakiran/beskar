"use client";
import React, { useCallback } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import { useDebounce } from "../hooks/debounce";
import { useEffect, useMemo, useRef, useState } from "react";
// import "./styles.css";
import "@durgakiran/editor/styles.css"; // Import editor styles
import { uploadImageData } from "../http/uploadImageData";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { getExtensions, Editor as EditorBeskar, BubbleMenu, BubbleMenuButton, TableFloatingMenu, type ImageAPIHandler, TiptapEditor, TextFormattingMenu } from "@durgakiran/editor";

interface TipTapProps {
    setEditorContext: (editorContext: Editor) => void;
    user: UserInfo;
    content: Object;
    pageId: string;
    id: number;
    editable?: boolean;
    title: string;
    updateContent: (content: any, title: string) => void;
    provider?: HocuspocusProvider;
}

const MAX_DEFAULT_WIDTH = 760;

interface UserInfo {
    email: string;
    id: string;
    name: string;
    username: string;
}

export function TipTap({ setEditorContext, user, content, pageId, id, editable = true, title, updateContent, provider }: TipTapProps) {
    const [editedData, setEditedData] = useState(null);
    const menuContainerRef = useRef(null);
    const debouncedValue = useDebounce(editedData, 10000);
    const debouncedTitle = useDebounce(title, 10000);
    const [updated, setUpdated] = useState(false);
    const [editor, setEditor] = useState<TiptapEditor | null>(null);
    const countRenderRef = useRef(0);
    countRenderRef.current += 1;

    const editedDataFn = (data: JSONContent) => {
        setEditedData(data as any);
    };

    // Image upload handler for the editor
    const imageHandler: ImageAPIHandler = {
        uploadImage: async (file: File) => {
            try {
                const [name, width, height] = await uploadImageData(file);
                let adjustedWidth = width;
                let adjustedHeight = height;

                if (width > MAX_DEFAULT_WIDTH) {
                    const ratio = MAX_DEFAULT_WIDTH / width;
                    adjustedWidth = MAX_DEFAULT_WIDTH;
                    adjustedHeight = Math.round(ratio * height);
                }

                return {
                    url: `${process.env.NEXT_PUBLIC_IMAGE_SERVER_URL}/media/image/${name}`,
                    width: adjustedWidth,
                    height: adjustedHeight,
                };
            } catch (error) {
                console.error("Image upload failed:", error);
                throw error;
            }
        },
    };

    const collaborationExtensions = () => {
        return [
            Collaboration.configure({
                document: provider?.document,
                field: "default",
            }),
            CollaborationCursor.configure({
                provider: provider,
                user: {
                    id: user.id,
                    name: user.name,
                    color: `#${Math.floor(Math.random() * 16777215)
                        .toString(16)
                        .padStart(6, "0")}`,
                },
            }),
        ];
    };

    const manageContent = useMemo(() => {
        if (editable) {
            return {
                onCreate: ({ editor: currentEditor }: { editor: Editor }) => {
                    if (provider) {
                        // provider.connect();
                    }
                },
            };
        } else {
            return { content: content };
        }
    }, []);

    const handleReady = useCallback((editorInstance: TiptapEditor) => {
        console.log("Editor ready:", editorInstance);
        setEditor(editorInstance);
    }, []);

    // Get all extensions from the editor package plus collaboration extensions
    const allExtensions = useMemo(() => {
        const baseExtensions = getExtensions({
            placeholder: "Write something ....",
            imageHandler,
        });

        if (editable) {
            return [...baseExtensions, ...collaborationExtensions()];
        } else {
            return baseExtensions;
        }
    }, [editable]);

    // const editor = useEditor({
    //     immediatelyRender: true,
    //     shouldRerenderOnTransaction: false,
    //     extensions: allExtensions,
    //     ...manageContent,
    //     editable: editable,
    //     onUpdate: ({ editor }) => {
    //         setUpdated(true);
    //         editedDataFn(editor.getJSON());
    //     },
    //     onDestroy: () => {
    //         // TODO: Update data
    //     },
    //     // Image paste is now handled by ImagePasteDrop extension
    // });

    useEffect(() => {
        if (updated && editable) {
            updateContent(debouncedValue, debouncedTitle);
        }
    }, [debouncedValue, debouncedTitle]);

    useEffect(() => {
        setEditorContext(editor);
    }, [editor, setEditorContext]);

    return (
        <div ref={menuContainerRef} className="beskar-editor">
            <div>Rendered: {countRenderRef.current}</div>
            {editable ? (
                <EditorBeskar imageHandler={imageHandler} extensions={collaborationExtensions()} editable={editable} placeholder="Start typing..." onUpdate={editedDataFn} onReady={handleReady} />
            ) : (
                <EditorBeskar
                    imageHandler={imageHandler}
                    initialContent={content}
                    extensions={[]}
                    editable={editable}
                    placeholder="Start typing..."
                    onUpdate={editedDataFn}
                    onReady={handleReady}
                />
            )}
            {editor && editable && (
                <>
                    {/* <BubbleMenu editor={editor}>
                        <BubbleMenuButton onClick={() => (editor.chain().focus() as any).toggleBold().run()} isActive={editor.isActive("bold")} title="Bold (Cmd+B)">
                            <strong>B</strong>
                        </BubbleMenuButton>
                        <BubbleMenuButton onClick={() => (editor.chain().focus() as any).toggleItalic().run()} isActive={editor.isActive("italic")} title="Italic (Cmd+I)">
                            <em>I</em>
                        </BubbleMenuButton>
                        <BubbleMenuButton onClick={() => (editor.chain().focus() as any).toggleUnderline().run()} isActive={editor.isActive("underline")} title="Underline (Cmd+U)">
                            <u>U</u>
                        </BubbleMenuButton>
                        <BubbleMenuButton onClick={() => (editor.chain().focus() as any).toggleStrike().run()} isActive={editor.isActive("strike")} title="Strikethrough">
                            <s>S</s>
                        </BubbleMenuButton>
                        <BubbleMenuButton onClick={() => (editor.chain().focus() as any).toggleCode().run()} isActive={editor.isActive("code")} title="Code">
                            {"</>"}
                        </BubbleMenuButton>
                    </BubbleMenu> */}
                    <TextFormattingMenu editor={editor} />

                    {/* Table Floating Menu */}
                    <TableFloatingMenu editor={editor} />
                </>
            )}
        </div>
    );
}
