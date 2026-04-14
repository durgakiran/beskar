"use client";

import type { AttachmentRef } from "@durgakiran/editor";
import { Box, Flex, Text, IconButton } from "@radix-ui/themes";
import { FiArrowDown, FiPaperclip } from "react-icons/fi";
import { downloadAttachmentBlob } from "../http/uploadAttachmentData";

function formatSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const v = bytes / Math.pow(1024, i);
    return `${v % 1 === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

export interface AttachmentPanelProps {
    attachments: AttachmentRef[];
    /** Numeric page id (for labeling / future APIs). */
    pageId: number;
    title?: string;
    description?: string;
    variant?: "default" | "readonly";
}

/**
 * Lists attachments currently referenced in the document (driven by editor `onAttachmentsChange`).
 * Renders below the editor; not part of the editor package.
 */
export function AttachmentPanel({
    attachments,
    pageId,
    title,
    description,
    variant = "default",
}: AttachmentPanelProps) {
    if (!attachments.length) {
        return null;
    }

    const isReadOnly = variant === "readonly";

    if (isReadOnly) {
        return (
            <Box mt="4">
                <Flex direction="column" gap="3">
                    <Flex direction="column" gap={description ? "1" : "2"}>
                        <Text size="5" weight="bold" as="div" className="text-[#221f26]">
                            {title || `Files on this page${Number.isFinite(pageId) ? ` (#${pageId})` : ""}`}
                        </Text>
                        {description ? (
                            <Text size="2" className="leading-6 text-[#605c67]">
                                {description}
                            </Text>
                        ) : null}
                    </Flex>
                    <Flex wrap="wrap" gap="2">
                        {attachments.map((a) => (
                            <Flex
                                key={a.attachmentId}
                                align="center"
                                gap="2"
                                className="rounded-full border border-[#d4d1da] bg-[#f5f4f6] px-3 py-[9px]"
                            >
                                <FiPaperclip size={14} className="shrink-0 text-[#605c67]" aria-hidden />
                                <Text size="2" className="max-w-[220px] truncate text-[#221f26]" title={a.fileName}>
                                    {a.fileName}
                                </Text>
                                <Text size="1" className="rounded-full bg-[#f8f7f9] px-2 py-[3px] font-semibold uppercase tracking-[0.04em] text-[#898492]">
                                    {a.fileType || "file"}
                                </Text>
                                <IconButton
                                    type="button"
                                    variant="ghost"
                                    color="gray"
                                    size="1"
                                    radius="full"
                                    aria-label={`Download ${a.fileName}`}
                                    className="!h-6 !w-6 !bg-[#f8f7f9] !text-[#605c67]"
                                    onClick={() => downloadAttachmentBlob(a.fileUrl, a.fileName).catch((e) => console.error(e))}
                                >
                                    <FiArrowDown size={12} strokeWidth={1.75} aria-hidden />
                                </IconButton>
                            </Flex>
                        ))}
                    </Flex>
                </Flex>
            </Box>
        );
    }

    return (
        <Box mt="4" className="rounded-lg border border-neutral-200 bg-mauve-50/40 p-4">
            <Flex direction="column" gap={description ? "1" : "2"} mb="3">
                <Text size="2" weight="medium" as="div" className="text-neutral-900">
                    {title || `Files on this page${Number.isFinite(pageId) ? ` (#${pageId})` : ""}`}
                </Text>
                {description ? (
                    <Text size="2" className="leading-6 text-neutral-600">
                        {description}
                    </Text>
                ) : null}
            </Flex>
            <Flex direction="column" gap="2">
                {attachments.map((a) => (
                    <Flex
                        key={a.attachmentId}
                        align="center"
                        justify="between"
                        gap="3"
                        className="rounded-md border border-neutral-200 bg-white px-3 py-2"
                    >
                        <Flex direction="column" gap="0" className="min-w-0 flex-1">
                            <Text size="2" className="truncate text-neutral-900" title={a.fileName}>
                                {a.fileName}
                            </Text>
                            <Text size="1" color="gray">
                                {formatSize(a.fileSize)} · {a.fileType || "file"}
                            </Text>
                        </Flex>
                        <IconButton
                            type="button"
                            variant="soft"
                            color="plum"
                            size="2"
                            radius="full"
                            aria-label={`Download ${a.fileName}`}
                            onClick={() => downloadAttachmentBlob(a.fileUrl, a.fileName).catch((e) => console.error(e))}
                        >
                            <FiArrowDown size={18} strokeWidth={1.75} aria-hidden />
                        </IconButton>
                    </Flex>
                ))}
            </Flex>
        </Box>
    );
}
