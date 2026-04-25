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
    type ChildPageResult,
    type ChildPagesHandler,
    type ExternalLinkHandler,
    type ExternalLinkMetadata,
    type InternalResourceHandler,
    type InternalResourceMetadata,
    type InternalResourceResult,
    type InternalResourceType,
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
    OverlapDisambiguationPopover,
    type CommentThread,
} from "@durgakiran/editor";

interface TipTapProps {
    setEditorContext: (editorContext: Editor) => void;
    user: UserInfo;
    content: Object;
    pageId: string;
    spaceId: string;
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
    commentPresentation?: "docked" | "bottom-sheet";
}

const MAX_DEFAULT_WIDTH = 760;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_ACCEPT =
    "image/*,audio/*,video/*,text/*,application/pdf,application/json,application/xml,application/zip,application/x-zip-compressed,application/x-7z-compressed,application/vnd.rar,application/gzip,application/x-tar,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pdf,.json,.xml,.zip,.7z,.rar,.gz,.tar,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.mp4,.mov";
const EDITOR_PLACEHOLDER = "Start typing or enter / for commands";

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
    spaceId,
    id,
    editable = true,
    title,
    updateContent,
    provider,
    ydoc,
    onDocAttachmentsChange,
    isInlineMessageSidePanelOpen = false,
    setIsInlineMessageSidePanelOpen,
    commentPresentation = "docked",
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
    const [showCommentPopover, setShowCommentPopover] = useState(false);
    const [commentCardOpen, setCommentCardOpen] = useState(false);
    const [cardFallbackRect, setCardFallbackRect] = useState<DOMRect | null>(null);
    const [cardActiveIndex, setCardActiveIndex] = useState<number>(0);
    const [ambiguousThreads, setAmbiguousThreads] = useState<CommentThread[]>([]);
    const [ambiguityRect, setAmbiguityRect] = useState<DOMRect | null>(null);
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

    const internalResourceHandler: InternalResourceHandler | undefined = useMemo(() => {
        if (!spaceId) return undefined;

        const baseUrl = process.env.NEXT_PUBLIC_USER_SERVER_URL?.replace(/\/+$/, "") || "";
        const appBaseUrl =
            typeof window !== "undefined" ? window.location.origin : "";

        const fetchJson = async <T,>(path: string): Promise<T> => {
            const response = await fetch(`${baseUrl}/${path}`, {
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                },
            });

            if (!response.ok) {
                const error: Error & { status?: number } = new Error(`Request failed: ${response.status}`);
                error.status = response.status;
                throw error;
            }

            return response.json() as Promise<T>;
        };

        const listPages = async (): Promise<Array<{
            pageId: number;
            title: string;
            parentId: number;
            type: "document" | "whiteboard";
        }>> => {
            const response = await fetchJson<{ data?: Array<{
                pageId: number;
                title: string;
                parentId: number;
                type: "document" | "whiteboard";
            }> }>(`space/${spaceId}/page/list`);
            return Array.isArray(response.data) ? response.data : [];
        };

        return {
            appBaseUrl,
            async searchResources(query: string, resourceType: InternalResourceType): Promise<InternalResourceResult[]> {
                const pages = await listPages();
                const normalizedQuery = query.trim().toLowerCase();

                return pages
                    .filter((page) => page.type === resourceType)
                    .filter((page) => {
                        if (!normalizedQuery) return true;
                        return (page.title || "").toLowerCase().includes(normalizedQuery);
                    })
                    .slice(0, 20)
                    .map((page) => ({
                        resourceId: String(page.pageId),
                        resourceType: page.type,
                        title: page.title || "Untitled",
                        icon: page.type === "whiteboard" ? "▧" : "📄",
                    }));
            },
            async getResourceMetadata(resourceId: string, resourceType: InternalResourceType): Promise<InternalResourceMetadata | null> {
                if (resourceType === "document") {
                    const response = await fetchJson<{ data?: {
                        pageId: number;
                        type: string;
                        title: string;
                    } }>(`editor/space/${spaceId}/page/${resourceId}/inline-link`);
                    const metadata = response.data;
                    if (!metadata) return null;

                    return {
                        resourceId: String(metadata.pageId),
                        resourceType: "document",
                        title: metadata.title || "Untitled",
                        icon: "📄",
                    };
                }

                const pages = await listPages();
                const page = pages.find((candidate) => String(candidate.pageId) === String(resourceId) && candidate.type === resourceType);
                if (!page) return null;

                return {
                    resourceId: String(page.pageId),
                    resourceType: page.type,
                    title: page.title || "Untitled",
                    icon: page.type === "whiteboard" ? "▧" : "📄",
                };
            },
            navigateToResource(resourceId: string, _resourceType: InternalResourceType) {
                if (typeof window === "undefined") return;
                window.location.href = `/space/${spaceId}/view/${resourceId}`;
            },
        };
    }, [spaceId]);

    const externalLinkHandler: ExternalLinkHandler | undefined = useMemo(() => {
        if (!spaceId) return undefined;

        const baseUrl = process.env.NEXT_PUBLIC_USER_SERVER_URL?.replace(/\/+$/, "") || "";

        const fetchJson = async <T,>(path: string): Promise<T> => {
            const response = await fetch(`${baseUrl}/${path}`, {
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                },
            });

            if (!response.ok) {
                const error: Error & { status?: number } = new Error(`Request failed: ${response.status}`);
                error.status = response.status;
                throw error;
            }

            return response.json() as Promise<T>;
        };

        return {
            async getLinkMetadata(url: string): Promise<ExternalLinkMetadata | null> {
                const response = await fetchJson<{ data?: ExternalLinkMetadata }>(
                    `editor/external-link/metadata?url=${encodeURIComponent(url)}`,
                );
                return response.data || null;
            },
        };
    }, [spaceId]);

    const childPagesHandler: ChildPagesHandler | undefined = useMemo(() => {
        if (!spaceId || !Number.isFinite(id) || id < 1) return undefined;

        const baseUrl = process.env.NEXT_PUBLIC_USER_SERVER_URL?.replace(/\/+$/, "") || "";

        const fetchJson = async <T,>(path: string): Promise<T> => {
            const response = await fetch(`${baseUrl}/${path}`, {
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                },
            });

            if (!response.ok) {
                const error: Error & { status?: number } = new Error(`Request failed: ${response.status}`);
                error.status = response.status;
                throw error;
            }

            return response.json() as Promise<T>;
        };

        type PageDescendant = {
            pageId: number;
            title: string;
            type?: "document" | "whiteboard";
            children?: PageDescendant[];
        };

        const mapDescendants = (pages: PageDescendant[]): ChildPageResult[] => {
            return pages.map((page) => ({
                pageId: String(page.pageId),
                title: page.title || "Untitled",
                children: mapDescendants(page.children ?? []),
            }));
        };

        return {
            async getPageHierarchy() {
                const response = await fetchJson<{ data?: PageDescendant[] }>(
                    `space/${spaceId}/page/${id}/descendants`,
                );
                return mapDescendants(Array.isArray(response.data) ? response.data : []);
            },
            navigateToChildPage(pageId: string) {
                if (typeof window === "undefined") return;
                window.location.href = `/space/${spaceId}/view/${pageId}`;
            },
        };
    }, [spaceId, id]);

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

        reloadThreads();
    }, [reloadThreads]);

    // Editor bounds click for opening comments
    useEffect(() => {
        if (!editor) return;
        const editorDom = editor.view.dom as HTMLElement;
        const openThreadCard = async (threadId: string) => {
            const latestThreads = await reloadThreads();
            const threadIdx = latestThreads.findIndex((t) => t.id === threadId);
            setCardFallbackRect(null);
            setCardActiveIndex(threadIdx >= 0 ? threadIdx : 0);
            setCommentCardOpen(true);
        };

        const handleCommentClicked = (e: Event) => {
            const customEvent = e as CustomEvent<{ commentId?: string }>;
            const threadId = customEvent.detail?.commentId;
            if (!threadId) return;
            void openThreadCard(threadId);
        };

        const handleAmbiguityDetected = (e: Event) => {
            const customEvent = e as CustomEvent<{ commentIds?: string[]; rect?: DOMRect }>;
            const commentIds = customEvent.detail?.commentIds ?? [];
            if (commentIds.length === 0) return;
            const matchingThreads = threads.filter((thread) => commentIds.includes(thread.id));
            if (matchingThreads.length === 0) return;
            setAmbiguousThreads(matchingThreads);
            setAmbiguityRect(customEvent.detail?.rect ?? null);
        };

        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const span = target.closest('[data-comment-id]') as HTMLElement | null;
            if (!span) return;
            e.stopPropagation();
            const threadId = span.getAttribute('data-comment-id');
            if (!threadId) return;
            void openThreadCard(threadId);
        };

        editorDom.addEventListener('COMMENT_CLICKED', handleCommentClicked as EventListener);
        editorDom.addEventListener('COMMENT_AMBIGUITY_DETECTED', handleAmbiguityDetected as EventListener);
        editorDom.addEventListener('click', handleClick);
        return () => {
            editorDom.removeEventListener('COMMENT_CLICKED', handleCommentClicked as EventListener);
            editorDom.removeEventListener('COMMENT_AMBIGUITY_DETECTED', handleAmbiguityDetected as EventListener);
            editorDom.removeEventListener('click', handleClick);
        };
    }, [editor, reloadThreads, threads]);

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

        const span = editor.view.dom.querySelector(`[data-comment-id="${thread.id}"]`) as HTMLElement | null;
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
                    internalResourceHandler={internalResourceHandler}
                    externalLinkHandler={externalLinkHandler}
                    childPagesHandler={childPagesHandler}
                    commentHandler={commentApiHandler}
                    maxAttachmentBytes={MAX_ATTACHMENT_BYTES}
                    onAttachmentRejected={handleAttachmentRejected}
                    allowedMimeAccept={ATTACHMENT_ACCEPT}
                    onAttachmentsChange={onDocAttachmentsChange}
                    extensions={collaborationExtensions()}
                    editable={editable}
                    placeholder={EDITOR_PLACEHOLDER}
                    onUpdate={editedDataFn}
                    onReady={handleReady}
                />
            ) : (
                <EditorBeskar
                    initialContent={content}
                    imageHandler={imageHandler}
                    attachmentHandler={attachmentHandler}
                    internalResourceHandler={internalResourceHandler}
                    externalLinkHandler={externalLinkHandler}
                    childPagesHandler={childPagesHandler}
                    commentHandler={commentApiHandler}
                    maxAttachmentBytes={MAX_ATTACHMENT_BYTES}
                    onAttachmentRejected={handleAttachmentRejected}
                    allowedMimeAccept={ATTACHMENT_ACCEPT}
                    onAttachmentsChange={onDocAttachmentsChange}
                    extensions={[]}
                    editable={editable}
                    placeholder={EDITOR_PLACEHOLDER}
                    onUpdate={editedDataFn}
                    onReady={handleReady}
                />
            )}

            {editor && (
                <CommentSidePanel
                    editor={editor}
                    threads={threads}
                    commentHandler={commentApiHandler}
                    attachmentHandler={attachmentHandler}
                    documentId={pageId}
                    isOpen={isInlineMessageSidePanelOpen}
                    presentation={!editable ? commentPresentation : "docked"}
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
                            {(editable || commentPresentation === "docked") ? (
                                <CommentGutter
                                    editor={editor}
                                    threads={threads}
                                    onThreadClick={handleGutterThreadClick}
                                />
                            ) : null}

                            {showCommentPopover && (
                                <CommentInputPopover
                                    editor={editor}
                                    commentHandler={commentApiHandler}
                                    attachmentHandler={attachmentHandler}
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

                            {ambiguousThreads.length > 0 && ambiguityRect && (
                                <OverlapDisambiguationPopover
                                    editor={editor}
                                    threads={ambiguousThreads}
                                    anchorRect={ambiguityRect}
                                    onClose={() => {
                                        setAmbiguousThreads([]);
                                        setAmbiguityRect(null);
                                    }}
                                    onSelect={(thread: CommentThread) => {
                                        const idx = threads.findIndex((t) => t.id === thread.id);
                                        if (idx >= 0) {
                                            setCardFallbackRect(null);
                                            setCardActiveIndex(idx);
                                            setCommentCardOpen(true);
                                        }
                                        setAmbiguousThreads([]);
                                        setAmbiguityRect(null);
                                    }}
                                />
                            )}

                            {commentCardOpen && threads.length > 0 && cardActiveIndex < threads.length && (
                                <CommentThreadCard
                                    editor={editor}
                                    threads={threads}
                                    activeIndex={cardActiveIndex}
                                    fallbackAnchorRect={cardFallbackRect}
                                    commentHandler={commentApiHandler}
                                    attachmentHandler={attachmentHandler}
                                    presentation={!editable ? (commentPresentation === "bottom-sheet" ? "bottom-sheet" : "popover") : "popover"}
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
