"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import { FiEdit3, FiFileText, FiMessageSquare, FiMoreHorizontal, FiMoreVertical, FiShare2, FiTrash2 } from "react-icons/fi";

export interface ReadOnlyBreadcrumb {
    id: number;
    title: string;
    href: string | null;
}

export interface ReadOnlyCapabilities {
    canEdit: boolean;
    canDelete: boolean;
    canComment: boolean;
    canShare: boolean;
}

export interface ReadOnlyMeta {
    createdByName?: string | null;
    updatedByName?: string | null;
    updatedAt?: string | null;
    publishedAt?: string | null;
}

interface ReadOnlyContentMainProps {
    spaceId: string;
    spaceName?: string | null;
    pageId: string;
    title: string;
    breadcrumbs: ReadOnlyBreadcrumb[];
    archived: boolean;
    capabilities: ReadOnlyCapabilities;
    meta: ReadOnlyMeta;
    isCommentsOpen: boolean;
    commentPresentation: "docked" | "bottom-sheet";
    onOpenComments: () => void;
    onEdit: () => void;
    onDelete: () => void;
    children: ReactNode;
    attachments?: ReactNode;
}

function formatUpdatedAt(timestamp?: string | null): string | null {
    if (!timestamp) return null;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function KebabMenu({
    canComment,
    canDelete,
    isCommentsOpen,
    onComments,
    onDelete,
}: {
    canComment: boolean;
    canDelete: boolean;
    isCommentsOpen: boolean;
    onComments: () => void;
    onDelete: () => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handlePointerDown = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handlePointerDown);
        return () => document.removeEventListener("mousedown", handlePointerDown);
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <IconButton
                variant="soft"
                radius="full"
                color="gray"
                size="2"
                onClick={() => setOpen((current) => !current)}
                aria-label="More actions"
                className="!h-[34px] !w-[34px] !bg-[#f5f4f6] !text-[#605c67]"
            >
                <FiMoreHorizontal size={16} />
            </IconButton>
            {open ? (
                <div className="absolute right-0 top-[42px] z-[210] w-[188px] rounded-[12px] border border-[#e3e1e7] bg-white p-1 shadow-[0_14px_28px_rgba(34,31,38,0.1)]">
                    {canComment ? (
                        <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[13px] font-medium text-[#605c67] transition-colors hover:bg-[#f5f4f6]"
                            onClick={() => {
                                setOpen(false);
                                onComments();
                            }}
                        >
                            <FiMessageSquare size={14} />
                            {isCommentsOpen ? "Hide comments" : "Comments"}
                        </button>
                    ) : null}
                    {canDelete ? (
                        <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[13px] font-medium text-[#d14b57] transition-colors hover:bg-[#fef2f3]"
                            onClick={() => {
                                setOpen(false);
                                onDelete();
                            }}
                        >
                            <FiTrash2 size={14} />
                            Delete page
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function MobileActionDock({
    capabilities,
    onEdit,
    onDelete,
    onOpenComments,
}: {
    capabilities: ReadOnlyCapabilities;
    onEdit: () => void;
    onDelete: () => void;
    onOpenComments: () => void;
}) {
    return (
        <div className="readonly-action-dock md:hidden">
                <button type="button" aria-label="Actions" className="readonly-dock-btn">
                    <FiMoreVertical size={15} />
                </button>
            {capabilities.canShare ? (
                <button type="button" aria-label="Share" className="readonly-dock-btn">
                    <FiShare2 size={15} />
                </button>
            ) : null}
            {capabilities.canEdit ? (
                <button type="button" aria-label="Edit" className="readonly-dock-btn" onClick={onEdit}>
                    <FiEdit3 size={15} />
                </button>
            ) : null}
            {capabilities.canComment ? (
                <button type="button" aria-label="Comments" className="readonly-dock-btn" onClick={onOpenComments}>
                    <FiMessageSquare size={15} />
                </button>
            ) : null}
            {capabilities.canDelete ? (
                <button type="button" aria-label="Delete" className="readonly-dock-btn" onClick={onDelete}>
                    <FiTrash2 size={15} />
                </button>
            ) : null}
        </div>
    );
}

export default function ReadOnlyContentMain({
    spaceId,
    pageId,
    title,
    breadcrumbs,
    archived,
    capabilities,
    meta,
    isCommentsOpen,
    commentPresentation,
    onOpenComments,
    onEdit,
    onDelete,
    children,
    attachments,
}: ReadOnlyContentMainProps) {
    const orderedBreadcrumbs = useMemo(() => {
        if (breadcrumbs.length > 0) return breadcrumbs;
        return [{ id: Number(pageId), title: title || `Page #${pageId}`, href: null }];
    }, [breadcrumbs, pageId, title]);

    const metaLine = useMemo(() => {
        const parts = [
            meta.createdByName ? `Created by ${meta.createdByName}` : null,
            meta.updatedByName ? `Updated by ${meta.updatedByName}` : null,
            formatUpdatedAt(meta.updatedAt ?? meta.publishedAt),
        ].filter(Boolean);
        return parts.join(" · ");
    }, [meta.createdByName, meta.publishedAt, meta.updatedAt, meta.updatedByName]);

    return (
        <Box className={`readonly-content-page relative min-h-full bg-[#fbfafc] ${commentPresentation === "bottom-sheet" ? "readonly-comments-mobile" : ""}`}>
            <Box className="mx-auto w-full max-w-[1180px] px-4 py-4 md:px-8 md:py-6">
                <Flex direction="column" gap="5" className="relative md:gap-7">
                    <Box className="relative z-[120]">
                        <Flex direction="column" gap="4" className="md:gap-6">
                            <Flex align="start" justify="between" gap="4" className="hidden md:flex">
                                <Flex align="center" gap="2" className="min-w-0">
                                    <FiFileText size={15} className="shrink-0 text-[#605c67]" />
                                    <Flex align="center" gap="2" wrap="wrap" className="min-w-0 text-[13px]">
                                        {orderedBreadcrumbs.map((crumb, index) => (
                                            <Flex key={`${crumb.id}-${index}`} align="center" gap="2" className="min-w-0">
                                                {crumb.href ? (
                                                    <Link
                                                        href={crumb.href}
                                                        className="truncate font-medium text-[#898492] hover:text-[#605c67]"
                                                    >
                                                        {crumb.title}
                                                    </Link>
                                                ) : (
                                                    <Text size="2" className="truncate font-semibold text-[#221f26]">
                                                        {crumb.title}
                                                    </Text>
                                                )}
                                                {index < orderedBreadcrumbs.length - 1 ? <span className="text-[#898492]">/</span> : null}
                                            </Flex>
                                        ))}
                                    </Flex>
                                </Flex>

                                <Flex align="center" gap="2" className="shrink-0">
                                    {capabilities.canShare ? (
                                        <button
                                            type="button"
                                            className="inline-flex items-center gap-2 rounded-[8px] bg-[#f5f4f6] px-[14px] py-[8px] text-[13px] font-medium text-[#605c67] transition-colors hover:bg-[#ece9ef]"
                                        >
                                            <FiShare2 size={14} />
                                            Share
                                        </button>
                                    ) : null}
                                    {capabilities.canEdit ? (
                                        <button
                                            type="button"
                                            disabled={archived}
                                            onClick={onEdit}
                                            className="inline-flex items-center gap-2 rounded-[8px] bg-[#f5f4f6] px-[14px] py-[8px] text-[13px] font-medium text-[#605c67] transition-colors hover:bg-[#ece9ef] disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <FiEdit3 size={14} />
                                            Edit
                                        </button>
                                    ) : null}
                                    {(capabilities.canDelete || capabilities.canComment) ? (
                                        <KebabMenu
                                            canComment={capabilities.canComment}
                                            canDelete={capabilities.canDelete}
                                            isCommentsOpen={isCommentsOpen}
                                            onComments={onOpenComments}
                                            onDelete={onDelete}
                                        />
                                    ) : null}
                                </Flex>
                            </Flex>

                            <Box className="md:hidden">
                                <div className="text-[13px] font-medium text-[#898492]">
                                    {orderedBreadcrumbs.map((crumb) => crumb.title).join(" / ")}
                                </div>
                            </Box>

                            <Box className="w-full pr-0 xl:pr-24">
                                <Flex direction="column" gap="2">
                                    <Flex align="center" gap="3" wrap="wrap">
                                        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.01em] text-[#221f26] md:text-[38px]">
                                            {title || "Untitled"}
                                        </h1>
                                        {archived ? (
                                            <span className="rounded-full bg-[#fff3d6] px-3 py-[6px] text-[13px] font-semibold text-[#8a5b00]">
                                                Archived
                                            </span>
                                        ) : null}
                                    </Flex>
                                    {metaLine ? (
                                        <Text size="2" className="text-[#898492]">
                                            {metaLine}
                                        </Text>
                                    ) : null}
                                </Flex>
                            </Box>
                        </Flex>
                    </Box>

                    <Box className="relative w-full pr-0 xl:pr-24">
                        {children}
                    </Box>

                    {attachments ? (
                        <Box className="relative w-full pr-0 xl:pr-24">
                            {attachments}
                        </Box>
                    ) : null}
                </Flex>
            </Box>

            <MobileActionDock
                capabilities={capabilities}
                onEdit={onEdit}
                onDelete={onDelete}
                onOpenComments={onOpenComments}
            />

            <style jsx global>{`
                .readonly-content-page .beskar-editor {
                    background: transparent;
                }

                .readonly-content-page .beskar-editor .editor-content,
                .readonly-content-page .beskar-editor .ProseMirror {
                    height: auto;
                    min-height: 0;
                }

                .readonly-content-page .beskar-editor .ProseMirror {
                    margin-top: 0;
                    font-family: Geist, Inter, system-ui, sans-serif;
                    color: #221f26;
                }

                .readonly-content-page .beskar-editor .ProseMirror h1 {
                    font-size: 2rem;
                    line-height: 1.2;
                    margin-top: 0;
                }

                .readonly-content-page .beskar-editor .ProseMirror h2 {
                    font-size: 1.25rem;
                    line-height: 1.25;
                    margin-top: 1.75rem;
                }

                .readonly-content-page .beskar-editor .ProseMirror p,
                .readonly-content-page .beskar-editor .ProseMirror li {
                    color: #221f26;
                    font-size: 16px;
                    line-height: 1.7;
                }

                .readonly-content-page .beskar-editor .ProseMirror pre {
                    border: 1px solid #d4d1da;
                    border-radius: 14px;
                    background: #f5f4f6;
                    padding: 16px;
                    box-shadow: none;
                }

                .readonly-action-dock {
                    position: fixed;
                    right: 14px;
                    bottom: 110px;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    padding: 4px;
                    border: 1px solid #d4d1da;
                    border-radius: 18px;
                    background: #f8f7f9;
                    box-shadow: 0 3px 10px rgba(16, 4, 47, 0.08);
                    z-index: 180;
                }

                .readonly-dock-btn {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 32px;
                    height: 32px;
                    border: none;
                    border-radius: 10px;
                    background: #f5f4f6;
                    color: #605c67;
                }

                @media (min-width: 768px) {
                    .readonly-content-page .comment-gutter {
                        right: 12px;
                    }
                }
            `}</style>
        </Box>
    );
}
