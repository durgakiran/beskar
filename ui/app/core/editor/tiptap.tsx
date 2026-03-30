"use client";
import React, { useCallback } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import { useDebounce } from "../hooks/debounce";
import { useEffect, useMemo, useRef, useState } from "react";
// import "./styles.css";
import "@durgakiran/editor/styles.css"; // Import editor styles
import { uploadImageData } from "../http/uploadImageData";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import {
    getExtensions,
    Editor as EditorBeskar,
    TableFloatingMenu,
    type ImageAPIHandler,
    type AttachmentAPIHandler,
    type AttachmentRef,
    TiptapEditor,
    TextFormattingMenu,
    CodeBlockFloatingMenu,
} from "@durgakiran/editor";
import { uploadAttachmentData, downloadAttachmentBlob } from "../http/uploadAttachmentData";
import { WebrtcProvider } from "y-webrtc";
import * as Y from "yjs";

interface TipTapProps {
    setEditorContext: (editorContext: Editor) => void;
    user: UserInfo;
    content: Object;
    pageId: string;
    /** Numeric page id for attachment upload API (`pageId` form field). */
    id: number;
    editable?: boolean;
    title: string;
    updateContent: (content: any, title: string) => void;
    provider?: WebrtcProvider;
    ydoc?: Y.Doc;
    /** Fired when the set of successfully uploaded inline attachments in the doc changes. */
    onDocAttachmentsChange?: (attachments: AttachmentRef[]) => void;
}

const MAX_DEFAULT_WIDTH = 760;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_ACCEPT =
    "application/pdf,application/zip,application/x-zip-compressed,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,.pdf,.zip,.doc,.docx,.xls,.xlsx,.csv,.txt";

interface UserInfo {
    email: string;
    id: string;
    name: string;
    username?: string;
    color?: string;
}

export function TipTap({
    setEditorContext,
    user,
    content,
    pageId,
    id,
    editable = true,
    title,
    updateContent,
    provider,
    ydoc,
    onDocAttachmentsChange,
}: TipTapProps) {
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
        setUpdated(true);
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

    const handleAttachmentRejected = useCallback((reason: "too_large", file: File) => {
        console.warn(`[TipTap] Attachment rejected (${reason}):`, file.name, file.size);
    }, []);

    const attachmentHandler: AttachmentAPIHandler = useMemo(
        () => ({
            uploadAttachment: async (file, opts) => {
                if (!Number.isFinite(id) || id < 1) {
                    throw new Error("Invalid page id for attachment upload");
                }
                const result = await uploadAttachmentData(file, id, { signal: opts?.signal });
                return {
                    attachmentId: result.attachmentId,
                    url: result.url,
                    fileName: result.fileName,
                    fileSize: result.fileSize,
                    mimeType: result.mimeType,
                };
            },
            downloadAttachment: async ({ url, fileName }) => {
                await downloadAttachmentBlob(url, fileName);
            },
        }),
        [id],
    );

    const collaborationExtensions = () => {
        return [
            Collaboration.configure({
                document: ydoc,
                field: "default",
            }),
            CollaborationCursor.configure({
                provider: provider,
                user: user,
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
                <EditorBeskar
                    imageHandler={imageHandler}
                    attachmentHandler={attachmentHandler}
                    maxAttachmentBytes={MAX_ATTACHMENT_BYTES}
                    onAttachmentRejected={handleAttachmentRejected}
                    allowedMimeAccept={ATTACHMENT_ACCEPT}
                    onAttachmentsChange={onDocAttachmentsChange}
                    extensions={collaborationExtensions()}
                    editable={editable}
                    placeholder="Start typing..."
                    onUpdate={editedDataFn}
                    onReady={handleReady}
                />
            ) : (
                <EditorBeskar
                    imageHandler={imageHandler}
                    attachmentHandler={attachmentHandler}
                    maxAttachmentBytes={MAX_ATTACHMENT_BYTES}
                    onAttachmentRejected={handleAttachmentRejected}
                    allowedMimeAccept={ATTACHMENT_ACCEPT}
                    onAttachmentsChange={onDocAttachmentsChange}
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

                    <CodeBlockFloatingMenu editor={editor} />
                </>
            )}
        </div>
    );
}
