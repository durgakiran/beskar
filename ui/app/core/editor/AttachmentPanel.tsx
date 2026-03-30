"use client";

import type { AttachmentRef } from "@durgakiran/editor";
import { Box, Flex, Text, IconButton } from "@radix-ui/themes";
import { FiArrowDownCircle } from "react-icons/fi";
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
}

/**
 * Lists attachments currently referenced in the document (driven by editor `onAttachmentsChange`).
 * Renders below the editor; not part of the editor package.
 */
export function AttachmentPanel({ attachments, pageId }: AttachmentPanelProps) {
    if (!attachments.length) {
        return null;
    }

    return (
        <Box mt="4" className="border border-neutral-200 rounded-lg p-4 bg-mauve-50/40">
            <Text size="2" weight="medium" mb="2" as="div" className="text-neutral-800">
                Files on this page {Number.isFinite(pageId) ? `(#${pageId})` : ""}
            </Text>
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
                            <FiArrowDownCircle size={18} strokeWidth={1.75} aria-hidden />
                        </IconButton>
                    </Flex>
                ))}
            </Flex>
        </Box>
    );
}
