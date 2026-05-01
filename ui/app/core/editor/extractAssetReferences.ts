import type { JSONContent } from "@tiptap/core";

export interface AssetReferencesPayload {
    attachments: string[];
    images: string[];
}

function extractImagePublicName(src: string): string | null {
    const trimmed = src.trim();
    if (!trimmed || trimmed.startsWith("blob:")) {
        return null;
    }

    let path = trimmed;
    try {
        const origin = typeof window !== "undefined" ? window.location.origin : "https://local.invalid";
        path = new URL(trimmed, origin).pathname;
    } catch {
        path = trimmed;
    }

    const match = path.match(/\/media\/image\/([^/?#]+)$/);
    if (!match?.[1]) {
        return null;
    }

    return decodeURIComponent(match[1]);
}

function walkNode(node: JSONContent | null | undefined, attachments: Set<string>, images: Set<string>): void {
    if (!node) {
        return;
    }

    if (node.type === "attachmentInline") {
        const attachmentID = typeof node.attrs?.attachmentId === "string" ? node.attrs.attachmentId.trim() : "";
        if (attachmentID) {
            attachments.add(attachmentID);
        }
    }

    if (node.type === "imageInline" || node.type === "imageBlock") {
        const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
        const publicName = extractImagePublicName(src);
        if (publicName) {
            images.add(publicName);
        }
    }

    if (Array.isArray(node.content)) {
        for (const child of node.content) {
            walkNode(child, attachments, images);
        }
    }
}

export function extractAssetReferences(content: JSONContent | null | undefined): AssetReferencesPayload {
    const attachments = new Set<string>();
    const images = new Set<string>();

    walkNode(content, attachments, images);

    return {
        attachments: Array.from(attachments),
        images: Array.from(images),
    };
}
