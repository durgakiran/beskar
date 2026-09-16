import type { GlideboardAssetStorage } from '@durgakiran/glideboard';
import { prepareRasterAsset, validateAssetRecord } from '@durgakiran/glideline';
import { getApiOrigin } from 'app/core/http/apiBase';

type Asset = Parameters<GlideboardAssetStorage['prepare']>[0];
type Context = Parameters<GlideboardAssetStorage['resolve']>[1];
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const READ_TIMEOUT_MS = 30_000;

/** Detached migration previews may read only the captured legacy board's originals. */
export class WhiteboardMigrationAssetStorage implements GlideboardAssetStorage {
    private readonly lifetime = new AbortController();
    private readonly base: string;
    private readonly sourceDocId: string;
    private readonly cache = new Map<string, Uint8Array>();
    private cachedBytes = 0;
    private readonly detach: () => void;

    constructor(options: { pageId: string; sourceDocId: string; signal?: AbortSignal }) {
        if (!/^[1-9]\d*$/.test(options.pageId) || !/^[1-9]\d*$/.test(options.sourceDocId)) throw new Error('Invalid migration asset source.');
        const origin = new URL(getApiOrigin() || window.location.origin, window.location.origin);
        if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash) throw new Error('Invalid asset API origin.');
        this.base = `${origin.origin}${origin.pathname.replace(/\/+$/, '')}/api/v1/media/whiteboard-asset/${options.pageId}`;
        this.sourceDocId = options.sourceDocId;
        const abort = () => this.dispose();
        options.signal?.addEventListener('abort', abort, { once: true });
        this.detach = () => options.signal?.removeEventListener('abort', abort);
        if (options.signal?.aborted) this.dispose();
    }

    async prepare(): Promise<never> { throw new Error('Migration preview assets are read-only.'); }

    resolve(asset: Asset, context?: Context): string | null {
        if (this.lifetime.signal.aborted) return null;
        try { this.validate(asset, context); } catch { return null; }
        return `${this.base}/${asset.props.hash}`;
    }

    async download(asset: Asset, signal: AbortSignal, context?: Context) {
        this.validate(asset, context);
        signal.throwIfAborted(); this.lifetime.signal.throwIfAborted();
        const key = JSON.stringify([asset.props.hash, asset.props.mimeType, asset.props.byteLength, asset.props.width, asset.props.height]);
        const cached = this.cache.get(key);
        if (cached) return { bytes: new Uint8Array(cached), mimeType: String(asset.props.mimeType) };
        const abort = new AbortController();
        const cancel = () => abort.abort(new DOMException('Migration asset loading was cancelled.', 'AbortError'));
        signal.addEventListener('abort', cancel, { once: true });
        this.lifetime.signal.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(() => abort.abort(new Error('Loading a migration image timed out. Retry migration.')), READ_TIMEOUT_MS);
        try {
            const response = await abortable(fetch(`${this.base}/${asset.props.hash}`, {
                method: 'GET', credentials: 'include', redirect: 'error', cache: 'no-store', signal: abort.signal,
            }), abort.signal);
            if (response.status !== 200) throw new Error(response.status === 404
                ? 'An original whiteboard image is missing. Migration was stopped.'
                : 'An original whiteboard image could not be loaded. Retry migration.');
            const mimeType = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
            if (mimeType !== asset.props.mimeType) throw new Error('An original whiteboard image has mismatched metadata.');
            const expectedLength = Number(asset.props.byteLength), length = response.headers.get('Content-Length');
            if (length !== null && (!/^\d+$/.test(length) || Number(length) !== expectedLength)) throw new Error('An original whiteboard image has mismatched size.');
            if (!response.body) throw new Error('An original whiteboard image is empty.');
            const reader = response.body.getReader();
            const bytes = new Uint8Array(expectedLength);
            let received = 0;
            try {
                while (true) {
                    const chunk = await abortable(reader.read(), abort.signal);
                    if (chunk.done) break;
                    if (received + chunk.value.byteLength > expectedLength) throw new Error('An original whiteboard image exceeds its recorded size.');
                    bytes.set(chunk.value, received); received += chunk.value.byteLength;
                }
                if (received !== expectedLength) throw new Error('An original whiteboard image has mismatched size.');
            } finally { void reader.cancel().catch(() => undefined); }
            const verified = await abortable(prepareRasterAsset(bytes, mimeType), abort.signal);
            for (const property of ['hash', 'mimeType', 'byteLength', 'width', 'height']) {
                if (verified.asset.props[property] !== asset.props[property]) throw new Error('An original whiteboard image does not match its recorded content.');
            }
            abort.signal.throwIfAborted();
            while (this.cachedBytes + bytes.byteLength > MAX_CACHE_BYTES && this.cache.size) {
                const oldest = this.cache.keys().next().value as string;
                this.cachedBytes -= this.cache.get(oldest)!.byteLength; this.cache.delete(oldest);
            }
            const previous = this.cache.get(key);
            if (previous) this.cachedBytes -= previous.byteLength;
            this.cache.set(key, bytes); this.cachedBytes += bytes.byteLength;
            return { bytes: new Uint8Array(bytes), mimeType };
        } finally {
            clearTimeout(timer);
            abort.abort();
            signal.removeEventListener('abort', cancel);
            this.lifetime.signal.removeEventListener('abort', cancel);
        }
    }

    dispose(): void { this.detach(); this.lifetime.abort(); this.cache.clear(); this.cachedBytes = 0; }

    private validate(asset: Asset, context?: Context): void {
        if (context && ((context.documentId !== undefined && context.documentId !== this.sourceDocId) || context.versionId !== undefined || context.snapshotId !== undefined)) throw new Error('Migration image belongs to a different source.');
        if (asset.kind !== 'asset' || asset.type !== 'raster-image' || asset.schemaVersion !== 1 || asset.id !== `asset:sha256:${asset.props?.hash}` || Number(asset.props?.byteLength) <= 0) throw new Error('Invalid migration image metadata.');
        validateAssetRecord(asset as unknown as Record<string, unknown>);
    }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
        const cancel = () => reject(signal.reason);
        signal.addEventListener('abort', cancel, { once: true });
        promise.then(value => { signal.removeEventListener('abort', cancel); resolve(value); }, error => { signal.removeEventListener('abort', cancel); reject(error); });
    });
}
