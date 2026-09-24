import type { GlideboardAssetPersistence, GlideboardAssetStorage } from '@durgakiran/glideboard';
import { getApiOrigin } from 'app/core/http/apiBase';

type Asset = Parameters<GlideboardAssetStorage['prepare']>[0];
type Context = Parameters<GlideboardAssetStorage['resolve']>[1];
type Payload = Parameters<NonNullable<GlideboardAssetStorage['materializePortableAsset']>>[0];
type Metadata = { id: string; contentHash: string; contentType: string; byteLength: number; width: number; height: number };
type Receipt = { uploadId: string; state: string; asset?: unknown; cleanupPending?: boolean };
type Upload = { key: string; metadata: Metadata; body: string; uploadId?: string; state?: string; committed: boolean; prepare?: Promise<Receipt>; rollback?: Promise<void> };

const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 20 * 1024 * 1024;
const REQUEST_TIMEOUT = 15_000;
const STAGE_TIMEOUT = 60_000;
const CLEANUP_TIMEOUT = 15_000;
const MAX_ATTEMPTS = 3;

/** Error fields are consumed by Glideboard's per-image retry/error UI. */
export class WhiteboardAssetHttpErrorV2 extends Error {
    constructor(message: string, readonly category: string, readonly retryable: boolean, readonly status = 0, readonly code = '', readonly retryAfterMs?: number) {
        super(message);
        this.name = 'WhiteboardAssetHttpErrorV2';
    }
}
const invalid = (message: string) => new WhiteboardAssetHttpErrorV2(message, 'invalid-content', false);
const abortError = () => new DOMException('Image operation cancelled', 'AbortError');
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value) && value !== ZERO_UUID; }
function page(value: unknown): value is string { return typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)); }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function metadata(asset: Asset): Metadata {
    const props = asset?.props;
    if (asset?.type !== 'raster-image' || !props || typeof props.hash !== 'string' || !HASH.test(props.hash) || asset.id !== `asset:sha256:${props.hash}` || !TYPES.has(props.mimeType as string)) {
        throw invalid('Invalid whiteboard raster identity or MIME type');
    }
    for (const key of ['byteLength', 'width', 'height']) {
        if (typeof props[key] !== 'number' || !Number.isSafeInteger(props[key]) || (props[key] as number) <= 0) throw invalid('Invalid image dimensions or byte length');
    }
    if ((props.byteLength as number) > MAX_BYTES || (props.width as number) > 16_384 || (props.height as number) > 16_384 || (props.width as number) * (props.height as number) > 64_000_000) {
        throw new WhiteboardAssetHttpErrorV2('Image exceeds whiteboard asset limits', 'limit-exceeded', false);
    }
    return { id: asset.id, contentHash: props.hash, contentType: props.mimeType as string, byteLength: props.byteLength as number, width: props.width as number, height: props.height as number };
}
function throwIfAborted(signal: AbortSignal) { if (signal.aborted) throw abortError(); }
function linkedSignal(signals: (AbortSignal | undefined)[], timeout?: number) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    for (const signal of signals) {
        if (signal?.aborted) controller.abort();
        else signal?.addEventListener('abort', abort, { once: true });
    }
    const timer = timeout === undefined ? undefined : setTimeout(abort, timeout);
    return { signal: controller.signal, close: () => { if (timer !== undefined) clearTimeout(timer); for (const signal of signals) signal?.removeEventListener('abort', abort); } };
}
async function abortable<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    throwIfAborted(signal);
    let abort: () => void;
    const stopped = new Promise<never>((_, reject) => { abort = () => reject(abortError()); signal.addEventListener('abort', abort, { once: true }); });
    try { return await Promise.race([operation(), stopped]); }
    finally { signal.removeEventListener('abort', abort!); }
}
async function pause(ms: number, signal: AbortSignal) {
    let timer: ReturnType<typeof setTimeout>;
    try { await abortable(signal, () => new Promise<void>(resolve => { timer = setTimeout(resolve, ms); })); }
    finally { clearTimeout(timer!); }
}
async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw invalid('Asset response exceeds its byte limit');
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > limit) { await reader.cancel(); throw invalid('Asset response exceeds its byte limit'); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
}
// Repeated capture groups can overflow V8's regexp stack on a valid 20 MiB image.
function validBase64(value: string): boolean {
    if (value.length % 4 !== 0) return false;
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    const end = value.length - padding;
    for (let i = 0; i < end; i++) {
        const c = value.charCodeAt(i);
        if (!(c >= 65 && c <= 90 || c >= 97 && c <= 122 || c >= 48 && c <= 57 || c === 43 || c === 47)) return false;
    }
    return end > 0 || padding === 0;
}
async function validateBytes(bytes: Uint8Array, expected: Metadata) {
    if (bytes.byteLength !== expected.byteLength || bytes.byteLength > MAX_BYTES) throw invalid('Image byte length does not match its asset record');
    const prefix = String.fromCharCode(...bytes.subarray(0, 12));
    const media = bytes.length >= 8 && prefix.startsWith('\x89PNG\r\n\x1a\n') ? 'image/png'
        : bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
        : bytes.length >= 12 && prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP' ? 'image/webp' : '';
    if (media !== expected.contentType) throw invalid('Image MIME type does not match its encoded bytes');
    const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== expected.contentHash) throw invalid('Image hash does not match its asset record');
}

/** Session-owned transport; the server derives actor ownership from authentication. */
export class WhiteboardAssetHttpAdapterV2 implements GlideboardAssetStorage {
    readonly commitOrder = 'before-document' as const;
    private readonly lifetime = new AbortController();
    private readonly origin: string;
    private readonly apiPath: string;
    private readonly base: string;
    private readonly spaceId: string;
    private readonly pageId: string;
    private readonly uploads = new Set<Upload>();
    private readonly unresolved = new Map<string, Upload>();
    private readonly operations = new Set<Promise<unknown>>();
    private disposal?: Promise<void>;
    private readonly detachSignal: () => void;

    constructor(options: { spaceId: string; pageId: string; signal?: AbortSignal }) {
        const spaceId = options.spaceId.toLowerCase();
        if (!uuid(spaceId) || !page(options.pageId)) throw invalid('Invalid whiteboard asset destination');
        const configured = new URL(getApiOrigin() || window.location.origin, window.location.origin);
        if (!['https:', 'http:'].includes(configured.protocol) || configured.username || configured.password || configured.search || configured.hash) throw invalid('Invalid configured asset API origin');
        this.origin = configured.origin;
        this.apiPath = `${configured.pathname.replace(/\/+$/, '')}/api`;
        this.spaceId = spaceId;
        this.pageId = options.pageId;
        this.base = `${this.origin}${this.apiPath}/v2/editor/space/${spaceId}/whiteboard/${this.pageId}`;
        const dispose = () => { void this.dispose(); };
        options.signal?.addEventListener('abort', dispose, { once: true });
        this.detachSignal = () => options.signal?.removeEventListener('abort', dispose);
        if (options.signal?.aborted) dispose();
    }

    private track<T>(operation: () => Promise<T>): Promise<T> {
        const result = operation();
        this.operations.add(result);
        void result.then(() => this.operations.delete(result), () => this.operations.delete(result));
        return result;
    }
    private async active<T>(signal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
        const linked = linkedSignal([signal, this.lifetime.signal]);
        try { throwIfAborted(linked.signal); return await operation(linked.signal); }
        finally { linked.close(); }
    }
    private async request<T>(url: string, init: RequestInit, signal: AbortSignal, decode: (response: Response) => Promise<T>, timeout = REQUEST_TIMEOUT): Promise<T> {
        const bounded = linkedSignal([signal], timeout);
        try {
            return await abortable(bounded.signal, async () => {
                const response = await fetch(url, { ...init, credentials: 'include', redirect: 'error', cache: 'no-store', signal: bounded.signal });
                if (!response.ok) {
                    let detail: unknown;
                    try { detail = JSON.parse(new TextDecoder().decode(await readBounded(response, 16_384))); } catch { /* Status remains authoritative for proxy errors. */ }
                    const code = object(detail) && object(detail.error) && typeof detail.error.code === 'string' ? detail.error.code : '';
                    const message = object(detail) && object(detail.error) && typeof detail.error.message === 'string' ? detail.error.message.slice(0, 512) : `Image request failed (${response.status})`;
                    const status = response.status;
                    const category = code === 'ASSET_QUOTA_EXCEEDED' || status === 413 ? 'limit-exceeded' : status === 401 || status === 403 ? 'permission' : status === 404 ? 'not-found' : status === 415 ? 'unsupported-format' : status === 400 || status === 422 ? 'invalid-content' : status === 429 ? 'rate-limit' : status === 409 || status === 410 ? 'conflict' : 'network';
                    const retryable = status >= 500 || status === 408 || status === 429;
                    const retry = response.headers.get('retry-after');
                    const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Math.max(0, Date.parse(retry) - Date.now()) : undefined;
                    throw new WhiteboardAssetHttpErrorV2(message, category, retryable, status, code, Number.isFinite(delay) ? delay : undefined);
                }
                return decode(response);
            });
        } catch (error) {
            if (signal.aborted) throw abortError();
            if (error instanceof WhiteboardAssetHttpErrorV2) throw error;
            throw new WhiteboardAssetHttpErrorV2(bounded.signal.aborted ? 'Image request timed out; retry to resolve its status' : 'Image connection was interrupted; retry to resolve its status', 'network', true);
        } finally { bounded.close(); }
    }
    private async retry<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
        for (let attempt = 0; ; attempt++) {
            throwIfAborted(signal);
            try { return await operation(); }
            catch (error) {
                if (!(error instanceof WhiteboardAssetHttpErrorV2) || !error.retryable || attempt === MAX_ATTEMPTS - 1 || (error.retryAfterMs ?? 0) > 5_000) throw error;
                await pause(error.retryAfterMs ?? 250 * 2 ** attempt, signal);
            }
        }
    }
    private validateReceipt(raw: unknown, upload: Upload): Receipt {
        if (!object(raw) || !object(raw.data)) throw new WhiteboardAssetHttpErrorV2('Asset service returned an invalid upload receipt', 'network', true);
        const receipt = raw.data;
        if (!uuid(receipt.uploadId) || (upload.uploadId !== undefined && receipt.uploadId !== upload.uploadId) || typeof receipt.state !== 'string' || !['prepared', 'staging', 'staged', 'committed', 'cancelled', 'expired'].includes(receipt.state)) throw invalid('Asset service returned mismatched upload ownership');
        upload.uploadId = receipt.uploadId;
        if (receipt.state === 'committed') {
            const asset = receipt.asset;
            if (!object(asset) || asset.pageId !== Number(this.pageId) || Object.entries(upload.metadata).some(([key, value]) => asset[key] !== value)) throw invalid('Committed image metadata does not match its asset record');
            upload.committed = true;
            this.clearUnresolved(upload);
        }
        upload.state = receipt.state;
        return receipt as Receipt;
    }
    private async receipt(url: string, init: RequestInit, upload: Upload, signal: AbortSignal, timeout?: number): Promise<Receipt> {
        return this.request(url, init, signal, async response => {
            const bytes = await readBounded(response, 65_536);
            let raw: unknown;
            try { raw = JSON.parse(new TextDecoder().decode(bytes)); }
            catch { throw new WhiteboardAssetHttpErrorV2('Asset acknowledgement was incomplete; retry to inspect its status', 'network', true); }
            return this.validateReceipt(raw, upload);
        }, timeout);
    }
    private clearUnresolved(upload: Upload) {
        const key = this.fingerprint(upload.metadata);
        if (this.unresolved.get(key) === upload) this.unresolved.delete(key);
    }
    private fingerprint(value: Metadata) { return `${value.contentHash}:${value.contentType}:${value.byteLength}:${value.width}:${value.height}`; }
    private transactionUrl(upload: Upload) { if (!upload.uploadId) throw invalid('Upload session is not prepared'); return `${this.base}/assets/uploads/${upload.uploadId}`; }
    private async ensurePrepared(upload: Upload, signal: AbortSignal): Promise<Receipt> {
        if (upload.uploadId) return { uploadId: upload.uploadId, state: upload.state! };
        if (!upload.prepare) {
            upload.prepare = this.retry(() => this.receipt(`${this.base}/assets/uploads`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': upload.key }, body: upload.body }, upload, signal), signal);
            void upload.prepare.finally(() => { upload.prepare = undefined; }).catch(() => undefined);
        }
        return upload.prepare;
    }
    prepare(asset: Asset, signal: AbortSignal): Promise<GlideboardAssetPersistence> {
        return this.track(() => this.active(signal, async active => {
            const expected = metadata(asset);
            const fingerprint = this.fingerprint(expected);
            let upload = this.unresolved.get(fingerprint);
            this.unresolved.delete(fingerprint);
            if (!upload) {
                upload = { key: crypto.randomUUID(), metadata: expected, body: JSON.stringify({ contentHash: expected.contentHash, contentType: expected.contentType, byteLength: expected.byteLength }), committed: false };
                this.uploads.add(upload);
            }
            try {
                const result = await this.ensurePrepared(upload, active);
                this.assertUsable(result);
                throwIfAborted(active);
                this.clearUnresolved(upload);
            } catch (error) {
                if (active.aborted) await this.rollbackUpload(upload).catch(() => undefined);
                else if (error instanceof WhiteboardAssetHttpErrorV2 && error.retryable) this.unresolved.set(fingerprint, upload);
                throw error;
            }
            const current = upload;
            return {
                token: current.uploadId!,
                stage: (bytes, stageSignal, progress) => this.track(() => this.active(stageSignal, async stageActive => {
                    const immutable = Uint8Array.from(bytes);
                    await validateBytes(immutable, expected);
                    throwIfAborted(stageActive);
                    if (current.committed) { progress?.(1); return; }
                    progress?.(0);
                    const receipt = await this.retry(() => this.receipt(`${this.transactionUrl(current)}/content`, { method: 'PUT', headers: { 'Content-Type': expected.contentType }, body: immutable.buffer }, current, stageActive, STAGE_TIMEOUT), stageActive);
                    this.assertUsable(receipt);
                    if (receipt.state !== 'staged' && receipt.state !== 'committed') throw invalid('Image staging was not confirmed');
                    progress?.(1);
                })),
                commit: commitSignal => this.track(() => this.active(commitSignal, async commitActive => {
                    if (current.committed) return;
                    await this.retry(async () => {
                        try {
                            const result = await this.receipt(`${this.transactionUrl(current)}/commit`, { method: 'POST' }, current, commitActive);
                            this.assertUsable(result);
                            if (result.state !== 'committed') throw new WhiteboardAssetHttpErrorV2('Image commit is not yet confirmed', 'network', true);
                        } catch (error) {
                            if (commitActive.aborted) throw error;
                            if (error instanceof WhiteboardAssetHttpErrorV2 && error.retryable) {
                                try {
                                    const status = await this.receipt(this.transactionUrl(current), { method: 'GET' }, current, commitActive);
                                    this.assertUsable(status);
                                    if (status.state === 'committed') return;
                                } catch (statusError) {
                                    if (!(statusError instanceof WhiteboardAssetHttpErrorV2) || !statusError.retryable) throw statusError;
                                }
                            }
                            throw error;
                        }
                    }, commitActive);
                })),
                rollback: () => this.rollbackUpload(current),
            };
        }));
    }
    private assertUsable(receipt: Receipt) {
        if (receipt.state === 'cancelled' || receipt.state === 'expired') throw new WhiteboardAssetHttpErrorV2(receipt.state === 'expired' ? 'Image upload expired; retry the import' : 'Image upload was cancelled', 'conflict', false, receipt.state === 'expired' ? 410 : 409, receipt.state === 'expired' ? 'ASSET_UPLOAD_EXPIRED' : 'ASSET_UPLOAD_CONFLICT');
    }
    private rollbackUpload(upload: Upload): Promise<void> {
        if (upload.committed) return Promise.resolve();
        if (upload.rollback) return upload.rollback;
        const operation = async () => {
            const cleanup = linkedSignal([], CLEANUP_TIMEOUT);
            try {
                // Recover an acknowledged-lost prepare with its original key before cancelling.
                if (upload.prepare) await upload.prepare.catch(() => undefined);
                await this.ensurePrepared(upload, cleanup.signal);
                if (upload.committed) return;
                const receipt = await this.retry(() => this.receipt(this.transactionUrl(upload), { method: 'DELETE' }, upload, cleanup.signal, 5_000), cleanup.signal);
                if (!['committed', 'cancelled', 'expired'].includes(receipt.state)) throw new WhiteboardAssetHttpErrorV2('Image cancellation was not confirmed', 'storage', true);
                this.clearUnresolved(upload);
                this.uploads.delete(upload);
            } finally { cleanup.close(); }
        };
        upload.rollback = operation();
        void upload.rollback.finally(() => { upload.rollback = undefined; }).catch(() => undefined);
        return upload.rollback;
    }
    private contextVersion(context: Context, spaceId = this.spaceId, pageId = this.pageId): string | undefined {
        if (context?.documentId !== undefined && context.documentId !== `v2:${spaceId}:${pageId}`) throw invalid('Asset context belongs to another whiteboard');
        if (context?.versionId !== undefined && !uuid(context.versionId)) throw invalid('Invalid published asset version');
        if (context?.snapshotId !== undefined && (!uuid(context.snapshotId) || !context.versionId)) throw invalid('A published version is required for snapshot asset access');
        return context?.versionId;
    }
    private assetUrl(hash: string, context: Context): string {
        const version = this.contextVersion(context);
        return `${this.base}${version ? `/published/${version}` : ''}/assets/${hash}/content`;
    }
    resolve(asset: Asset, context?: Context): string | null {
        if (this.lifetime.signal.aborted) return null;
        try { return this.assetUrl(metadata(asset).contentHash, context); } catch { return null; }
    }
    private async readImage(url: string, expected: Metadata, signal: AbortSignal): Promise<Uint8Array> {
        return this.retry(() => this.request(url, { method: 'GET' }, signal, async response => {
            if (response.status !== 200 || response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== expected.contentType) throw invalid('Image download returned mismatched content metadata');
            const bytes = await readBounded(response, expected.byteLength);
            await validateBytes(bytes, expected);
            return bytes;
        }), signal);
    }
    download(asset: Asset, signal: AbortSignal, context?: Context) {
        return this.track(() => this.active(signal, async active => {
            const expected = metadata(asset);
            const bytes = await this.readImage(this.assetUrl(expected.contentHash, context), expected, active);
            return { bytes, mimeType: expected.contentType };
        }));
    }
    retainReferences(assetIds: readonly string[], context: Context, signal: AbortSignal): Promise<void> {
        return this.track(() => this.active(signal, async active => {
            this.contextVersion(context);
            if (assetIds.length > 10_000) throw invalid('Too many portable image references');
            for (const id of new Set(assetIds)) {
                const hash = id.slice('asset:sha256:'.length);
                if (id !== `asset:sha256:${hash}` || !HASH.test(hash)) throw invalid('Invalid portable image reference');
                await this.retry(() => this.request(this.assetUrl(hash, context), { method: 'HEAD' }, active, async response => {
                    const length = Number(response.headers.get('content-length'));
                    if (response.status !== 200 || !TYPES.has(response.headers.get('content-type') ?? '') || !Number.isSafeInteger(length) || length <= 0 || length > MAX_BYTES || response.headers.get('etag') !== `"${hash}"`) throw invalid('Asset ownership or published membership was not confirmed');
                }), active);
            }
        }));
    }
    private portableUrl(reference: string, expected: Metadata, context: Context): string {
        if (typeof reference !== 'string' || /[\s\\%]/.test(reference) || /\/(?:\.|\.\.)(?:\/|$)/.test(reference) || !(reference.startsWith('/') && !reference.startsWith('//') || /^https?:\/\//.test(reference))) throw invalid('Portable image reference is not a trusted API URL');
        const url = new URL(reference, this.origin);
        if (url.origin !== this.origin || url.username || url.password || url.search || url.hash) throw invalid('Portable image reference is not a trusted API URL');
        const prefix = `${this.apiPath}/v2/editor/space/`;
        const parts = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length).split('/') : [];
        if (parts.length === 6 || parts.length === 8) {
            const [spaceId, board, pageId] = parts;
            const version = parts.length === 8 ? parts[4] : undefined;
            const offset = version ? 5 : 3;
            if (!uuid(spaceId) || board !== 'whiteboard' || !page(pageId) || (version && (parts[3] !== 'published' || !uuid(version))) || parts[offset] !== 'assets' || parts[offset + 1] !== expected.contentHash || parts[offset + 2] !== 'content') throw invalid('Portable image reference has invalid source coordinates');
            const contextVersion = this.contextVersion(context, spaceId, pageId);
            if (contextVersion !== undefined && contextVersion !== version) throw invalid('Portable image reference does not match its published context');
            return url.href;
        }
        const legacyPrefix = `${this.apiPath}/v1/media/whiteboard-asset/`;
        const legacy = url.pathname.startsWith(legacyPrefix) ? url.pathname.slice(legacyPrefix.length).split('/') : [];
        if (legacy.length === 2 && page(legacy[0]) && legacy[1] === expected.contentHash && !context?.versionId && !context?.snapshotId && (!context?.documentId || context.documentId === legacy[0])) return url.href;
        throw invalid('Portable image reference is not a trusted asset route');
    }
    materializePortableAsset(payload: Payload, asset: Asset, context: Context, signal: AbortSignal) {
        return this.track(() => this.active(signal, async active => {
            const expected = metadata(asset);
            if (payload.assetId !== expected.id) throw invalid('Portable image payload identity does not match its record');
            let bytes: Uint8Array;
            if (payload.kind === 'embedded') {
                if (payload.byteLength !== expected.byteLength || typeof payload.base64 !== 'string' || payload.base64.length > Math.ceil(MAX_BYTES / 3) * 4 || !validBase64(payload.base64)) throw invalid('Invalid embedded image payload');
                const binary = atob(payload.base64);
                bytes = Uint8Array.from(binary, value => value.charCodeAt(0));
                await validateBytes(bytes, expected);
            } else if (payload.kind === 'durable-reference') {
                bytes = await this.readImage(this.portableUrl(payload.reference, expected, context), expected, active);
            } else throw invalid('Unsupported portable image payload');
            throwIfAborted(active);
            const transaction = await this.prepare(asset, active);
            try {
                await transaction.stage(bytes, active);
                await transaction.commit(active);
                return { rollback: transaction.rollback };
            } catch (error) {
                try { await transaction.rollback(); }
                catch { throw new WhiteboardAssetHttpErrorV2('Image import failed and cancellation could not be confirmed; the upload will expire automatically', 'storage', true); }
                throw error;
            }
        }));
    }
    /** Abort foreground work; cleanup uses fresh bounded signals and server expiry remains a fallback. */
    dispose(): Promise<void> {
        if (!this.disposal) {
            this.lifetime.abort();
            this.detachSignal();
            this.disposal = (async () => {
                await Promise.allSettled([...this.operations]);
                await Promise.allSettled([...this.uploads].map(upload => this.rollbackUpload(upload)));
                this.uploads.clear();
                this.unresolved.clear();
            })();
        }
        return this.disposal;
    }
}
