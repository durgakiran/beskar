"use client";
import React, { useCallback } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import { useDebounce } from "../hooks/debounce";
import { useEffect, useMemo, useRef, useState } from "react";
import "@durgakiran/editor/styles.css"; // Import editor styles
import "@durgakiran/editor/index.css"; // Import tailwind and radix UI styles
import { Flex, Button } from "@radix-ui/themes";
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
import { makeCommentApiHandler } from "../http/commentApiHandler";
import { useCommentEvents } from "../hooks/useCommentEvents";
import {
    CommentInputPopover,
    CommentGutter,
    CommentThreadCard,
    CommentSidePanel,
    type CommentThread,
} from "@durgakiran/editor";

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
    isInlineMessageSidePanelOpen?: boolean;
    setIsInlineMessageSidePanelOpen?: (open: boolean) => void;
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
    isInlineMessageSidePanelOpen = false,
    setIsInlineMessageSidePanelOpen
}: TipTapProps) {
    const [editedData, setEditedData] = useState(null);
    const menuContainerRef = useRef(null);
    const debouncedValue = useDebounce(editedData, 10000);
    const debouncedTitle = useDebounce(title, 10000);
    const [updated, setUpdated] = useState(false);
    const [editor, setEditor] = useState<TiptapEditor | null>(null);
    const countRenderRef = useRef(0);
    countRenderRef.current += 1;

    // ─── Inline Comments State ───
    const commentApiHandler = useMemo(() => makeCommentApiHandler(pageId), [pageId]);
    const [threads, setThreads] = useState<CommentThread[]>([]);
    const [activeCommentIds, setActiveCommentIds] = useState<Set<string>>(new Set());
    const [showCommentPopover, setShowCommentPopover] = useState(false);
    const [commentCardOpen, setCommentCardOpen] = useState(false);
    const [cardFallbackRect, setCardFallbackRect] = useState<DOMRect | null>(null);
    const [cardActiveIndex, setCardActiveIndex] = useState<number>(0);
    const [showComments, setShowComments] = useState(true);
    const [resolvedCount, setResolvedCount] = useState(0);

    const reloadThreads = useCallback(async () => {
        try {
            const data = await commentApiHandler.getThreads(pageId);
            setThreads(data);
            return data;
        } catch (err) {
            console.error('Failed to load threads', err);
            return [];
        }
    }, [commentApiHandler, pageId]);

    // Live Server-Sent Events from Backend
    const sseEvent = useCommentEvents(pageId);
    useEffect(() => {
        if (!sseEvent) return;
        reloadThreads(); // For simplicity, trigger a reload of threads on any event
    }, [sseEvent, reloadThreads]);

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

        // Load active comment IDs for orphan detection
        const ids = new Set<string>();
        editorInstance.state.doc.descendants((node) => {
            node.marks.forEach((mark) => {
                if (mark.type.name === 'comment' && mark.attrs.commentId) {
                    ids.add(mark.attrs.commentId);
                }
            });
        });
        setActiveCommentIds(ids);
        reloadThreads();
    }, [reloadThreads]);

    useEffect(() => {
        if (!editor) return;
        const updateIds = () => {
            const ids = new Set<string>();
            editor.state.doc.descendants((node) => {
                node.marks.forEach((mark) => {
                    if (mark.type.name === 'comment' && mark.attrs.commentId) {
                        ids.add(mark.attrs.commentId);
                    }
                });
            });
            setActiveCommentIds(ids);
        };
        editor.on('update', updateIds);
        return () => { editor.off('update', updateIds); };
    }, [editor]);

    // Derived threads state with orphans explicitly tracked
    const derivedThreads = useMemo(() => {
        return threads.map(t => ({
            ...t,
            orphaned: !activeCommentIds.has(t.commentId),
        }));
    }, [threads, activeCommentIds]);

    // Editor bounds click for opening comments
    useEffect(() => {
        if (!editor) return;
        const editorDom = editor.view.dom as HTMLElement;
        const handleClick = async (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const span = target.closest('[data-comment-id]') as HTMLElement | null;
            if (!span) return;
            e.stopPropagation();
            const commentId = span.getAttribute('data-comment-id');
            if (!commentId) return;

            const latestThreads = await reloadThreads();
            const threadIdx = latestThreads.findIndex((t) => t.commentId === commentId);
            setCardFallbackRect(null);
            setCardActiveIndex(threadIdx >= 0 ? threadIdx : 0);
            setCommentCardOpen(true);
        };
        editorDom.addEventListener('click', handleClick);
        return () => editorDom.removeEventListener('click', handleClick);
    }, [editor, reloadThreads]);

    // Thread helpers
    const handleThreadUpdated = useCallback((updated: CommentThread) => {
        setThreads((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    }, []);

    const handleThreadDeleted = useCallback((threadId: string) => {
        const thread = threads.find((t) => t.id === threadId);
        if (thread && editor) {
            const wasEditable = editor.isEditable;
            if (!wasEditable) editor.setEditable(true);
            editor.commands.removeComment(thread.commentId);
            if (!wasEditable) editor.setEditable(false);
        }
        setThreads((prev) => {
            const next = prev.filter((t) => t.id !== threadId);
            setCardActiveIndex((idx) => Math.min(idx, Math.max(0, next.length - 1)));
            if (next.length === 0) setCommentCardOpen(false);
            return next;
        });
    }, [threads, editor, editable, title, updateContent]);

    const handleGutterThreadClick = useCallback((threadId: string) => {
        if (!editor) return;
        const thread = threads.find((t) => t.id === threadId);
        if (!thread) return;

        const span = editor.view.dom.querySelector(`[data-comment-id="${thread.commentId}"]`) as HTMLElement | null;
        if (span) {
            setCardFallbackRect(null);
        } else {
            const editorRect = (editor.view.dom as HTMLElement).getBoundingClientRect();
            setCardFallbackRect(new DOMRect(editorRect.left, editorRect.top + 100, editorRect.width, 24));
        }
        const idx = threads.findIndex((t) => t.id === threadId);
        setCardActiveIndex(idx >= 0 ? idx : 0);
        setCommentCardOpen(true);
    }, [editor, threads]);

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
            {/* {editor && (
                <Flex justify="end" gap="3" align="center" style={{ marginBottom: "1rem" }}>
                    <Button onClick={() => setIsSidePanelOpen(true)} variant="soft" color="indigo" style={{ cursor: 'pointer' }}>
                        💬 All Comments
                    </Button>
                    <Button onClick={() => setShowComments(!showComments)} variant="soft" color="cyan" style={{ cursor: 'pointer' }}>
                        {showComments ? '💬 Hide Inline' : '💬 Show Inline'}
                    </Button>
                </Flex>
            )} */}
            {editable ? (
                <EditorBeskar
                    initialContent={content}
                    imageHandler={imageHandler}
                    attachmentHandler={attachmentHandler}
                    commentHandler={commentApiHandler}
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
                    initialContent={content}
                    imageHandler={imageHandler}
                    attachmentHandler={attachmentHandler}
                    commentHandler={commentApiHandler}
                    maxAttachmentBytes={MAX_ATTACHMENT_BYTES}
                    onAttachmentRejected={handleAttachmentRejected}
                    allowedMimeAccept={ATTACHMENT_ACCEPT}
                    onAttachmentsChange={onDocAttachmentsChange}
                    extensions={[]}
                    editable={editable}
                    placeholder="Start typing..."
                    onUpdate={editedDataFn}
                    onReady={handleReady}
                />
            )}

            {editor && (
                <CommentSidePanel
                    editor={editor}
                    threads={derivedThreads}
                    commentHandler={commentApiHandler}
                    documentId={pageId}
                    isOpen={isInlineMessageSidePanelOpen}
                    onClose={() => setIsInlineMessageSidePanelOpen(false)}
                    onThreadUpdated={handleThreadUpdated}
                    onThreadDeleted={handleThreadDeleted}
                />
            )}

            {editor && (
                <>
                    <TextFormattingMenu
                        editor={editor}
                        editable={editable}
                        commentHandler={commentApiHandler}
                        onCommentClick={() => setShowCommentPopover(true)}
                    />

                    {editable && (
                        <>
                            {/* Table Floating Menu */}
                            <TableFloatingMenu editor={editor} />
                            <CodeBlockFloatingMenu editor={editor} />
                        </>
                    )}

                    {showComments && (
                        <>
                            <CommentGutter
                                editor={editor}
                                threads={derivedThreads}
                                onThreadClick={handleGutterThreadClick}
                            />

                            {showCommentPopover && (
                                <CommentInputPopover
                                    editor={editor}
                                    commentHandler={commentApiHandler}
                                    documentId={pageId}
                                    onClose={() => setShowCommentPopover(false)}
                                    onThreadCreated={async (threadId: string) => {
                                        setShowCommentPopover(false);
                                        const latest = await reloadThreads();
                                        const idx = latest.findIndex((t) => t.id === threadId);
                                        setCardFallbackRect(null);
                                        setCardActiveIndex(idx >= 0 ? idx : 0);
                                        setCommentCardOpen(true);
                                    }}
                                />
                            )}

                            {commentCardOpen && derivedThreads.length > 0 && cardActiveIndex < derivedThreads.length && (
                                <CommentThreadCard
                                    editor={editor}
                                    threads={derivedThreads}
                                    activeIndex={cardActiveIndex}
                                    fallbackAnchorRect={cardFallbackRect}
                                    commentHandler={commentApiHandler}
                                    onClose={() => setCommentCardOpen(false)}
                                    onNavigate={setCardActiveIndex}
                                    onThreadUpdated={handleThreadUpdated}
                                    onThreadDeleted={handleThreadDeleted}
                                />
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    );
}
