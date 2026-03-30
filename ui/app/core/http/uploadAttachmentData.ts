import { post } from "./call";

/** Base URL including `/api/v1` (e.g. `http://localhost:8082/api/v1`). */
export function getApiV1Base(): string {
    const explicit = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "");
    if (explicit) {
        return explicit.endsWith("/api/v1") ? explicit : `${explicit}/api/v1`;
    }
    const img = (process.env.NEXT_PUBLIC_IMAGE_SERVER_URL || "").replace(/\/$/, "");
    if (!img) {
        return "";
    }
    if (img.endsWith("/api/v1")) {
        return img;
    }
    return `${img}/api/v1`;
}

/** Origin only (no `/api/v1`), for joining server-relative paths like `/api/v1/attachments/...`. */
export function getApiOrigin(): string {
    const base = getApiV1Base();
    return base.replace(/\/api\/v1\/?$/, "");
}

export interface AttachmentUploadResponse {
    attachmentId: string;
    url: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
}

function toAbsoluteAttachmentUrl(serverRelativePath: string): string {
    const origin = getApiOrigin();
    if (!origin) {
        return serverRelativePath;
    }
    if (serverRelativePath.startsWith("http")) {
        return serverRelativePath;
    }
    const path = serverRelativePath.startsWith("/") ? serverRelativePath : `/${serverRelativePath}`;
    return `${origin}${path}`;
}

/**
 * Upload a file for the given page. Requires auth (Bearer via `post`).
 * Server: POST /api/v1/attachments/upload — multipart field `file`, form field `pageId`.
 */
export async function uploadAttachmentData(
    file: File,
    pageId: number,
    options?: { signal?: AbortSignal },
): Promise<AttachmentUploadResponse> {
    const apiV1 = getApiV1Base();
    if (!apiV1) {
        throw new Error("NEXT_PUBLIC_IMAGE_SERVER_URL or NEXT_PUBLIC_API_BASE_URL is not set");
    }
    const url = `${apiV1}/attachments/upload`;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("pageId", String(pageId));
    const res = await post(url, formData, { Accept: "application/json" }, { signal: options?.signal });
    const inner = res.data?.data as AttachmentUploadResponse | undefined;
    if (!inner?.attachmentId) {
        throw new Error("Invalid attachment upload response");
    }
    return {
        ...inner,
        url: toAbsoluteAttachmentUrl(inner.url),
    };
}

/** Authenticated download to a local file save (same pattern as editor chip). */
export async function downloadAttachmentBlob(targetUrl: string, fileName: string): Promise<void> {
    const headers = new Headers();
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (token) {
        headers.set("Authorization", `Bearer ${token}`);
    }
    const res = await fetch(targetUrl, { headers });
    if (!res.ok) {
        throw new Error(`Download failed (${res.status})`);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName || "download";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
}
