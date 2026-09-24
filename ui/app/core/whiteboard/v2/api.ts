import { getApiOrigin } from 'app/core/http/apiBase';

export interface PageNavigation {
    type: string;
    contentApiVersion?: number;
    canEdit?: boolean;
    publishedVersionId?: string;
    whiteboard?: { draftUrl?: string; publishedUrl?: string; previewUrl?: string };
}
export class WhiteboardApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
    get retryable() { return this.status >= 500 || this.status === 408 || this.status === 429; }
}
export const boardUrl = (space: string, page: string) => `${getApiOrigin()}/api/v2/editor/space/${encodeURIComponent(space)}/whiteboard/${encodeURIComponent(page)}`;
export async function checkedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, { credentials: 'include', redirect: 'error', ...init });
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new WhiteboardApiError(response.status, body?.error?.code ?? '', body?.error?.message ?? `Request failed (${response.status})`);
    }
    return response;
}
export async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
    return (await (await checkedFetch(url, init)).json()).data as T;
}
export async function digest(bytes: Uint8Array): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
    return 'sha256:' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export function sequence(value: string): bigint {
    if (!/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > 9223372036854775807n) throw new Error('Invalid whiteboard sequence');
    return BigInt(value);
}
export interface Snapshot { id: string; throughSequence: string; title: string; updateEncoding: string; downloadUrl: string; byteLength: number; stateDigest: string }
export interface DraftManifest { restoreGeneration?: string; pageId: number; spaceId: string; title: string; headSequence: string; baseSnapshot: Snapshot; updatesUrl: string }
export interface PublishedBoard { versionId: string; snapshot: Snapshot; preview: { url: string } | null }
export function contentUrl(path: string): string {
    const base = new URL(getApiOrigin() || window.location.origin, window.location.origin);
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith('/api/v2/editor/')) throw new Error('Invalid whiteboard content URL');
    return url.href;
}
export async function post<T>(url: string, body: unknown, key: string, signal?: AbortSignal): Promise<T> {
    return jsonRequest<T>(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
}
