import type { GlideboardAssetStorage } from '@durgakiran/glideboard';
import { isCanonicalRasterAssetId, type GlideAsset, type PortableRasterPayload } from '@durgakiran/glideline';

const DEMO_ASSET_BYTES_KEY = 'glideline-whiteboard-demo-raster-bytes-v1';
export const DEMO_RASTER_QUOTA_BYTES = 3 * 1024 * 1024;
const BrowserURL = URL;

interface DemoAssetStorageOptions {
  isSlowUpload(): boolean;
  consumeUploadFailure(): boolean;
  consumeDownloadFailure?(): boolean;
  onUsageChange?(usageBytes: number): void;
  quotaBytes?: number;
  persistenceKey?: string;
}

export interface DemoAssetStorage extends GlideboardAssetStorage {
  activate(): void;
  dispose(): void;
  reset(): void;
  usageBytes(): number;
}

function demoQuotaError(): Error & { category: string; retryable: boolean } {
  return Object.assign(new Error('Demo raster quota is full. Reset demo data and try again.'), {
    category: 'limit-exceeded',
    retryable: false,
  });
}

function demoOrphanCleanupError(error: unknown, rollbackError: unknown): Error {
  return Object.assign(new Error('Demo portable asset persistence and rollback both failed.'), {
    name: 'AssetOrphanCleanupError',
    code: 'orphan-cleanup',
    category: 'storage',
    retryable: true,
    cause: error,
    errors: [error, rollbackError],
  });
}

function trustedDemoMediaReference(reference: string): string {
  let url: URL;
  try {
    url = new BrowserURL(reference, window.location.origin);
  } catch {
    throw new Error('Demo portable asset reference is invalid.');
  }
  const mediaPath = /^\/api\/v1\/media\/whiteboard-asset\/[1-9]\d*\/[a-f0-9]{64}$/;
  if (url.origin !== window.location.origin || !mediaPath.test(url.pathname) || url.search || url.hash) {
    throw new Error('Demo portable asset reference is not a trusted whiteboard media URL.');
  }
  return url.href;
}

function waitForDemoStep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Import cancelled', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Import cancelled', 'AbortError'));
    }, { once: true });
  });
}

export function createDemoAssetStorage(
  options: DemoAssetStorageOptions,
): DemoAssetStorage {
  const entries = new Map<string, { bytes: Uint8Array; mimeType: string; url: string | null }>();
  let lifecycleGeneration = 0;
  let disposed = false;
  const quotaBytes = options.quotaBytes ?? DEMO_RASTER_QUOTA_BYTES;
  const persistenceKey = options.persistenceKey ?? DEMO_ASSET_BYTES_KEY;
  const assetHash = (asset: GlideAsset) => String(asset.props['hash'] ?? asset.id);
  const encode = (bytes: Uint8Array) => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  const decode = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0));
  const persistEntries = () => {
    const stored = Array.from(entries, ([hash, entry]) => ({
      hash, mimeType: entry.mimeType, base64: encode(entry.bytes),
    }));
    window.localStorage.setItem(persistenceKey, JSON.stringify(stored));
  };
  const usageBytes = () => Array.from(entries.values()).reduce((total, entry) => total + entry.bytes.byteLength, 0);
  try {
    const stored = JSON.parse(window.localStorage.getItem(persistenceKey) ?? '[]') as unknown;
    if (Array.isArray(stored)) {
      for (const item of stored) {
        if (!item || typeof item !== 'object') continue;
        const { hash, mimeType, base64 } = item as Record<string, unknown>;
        if (typeof hash !== 'string' || typeof mimeType !== 'string' || typeof base64 !== 'string') continue;
        const bytes = decode(base64);
        entries.set(hash, {
          bytes,
          mimeType,
          url: null,
        });
      }
    }
  } catch {
    window.localStorage.removeItem(persistenceKey);
  }
  const storage: DemoAssetStorage = {
    activate() {
      if (disposed) throw new Error('Demo asset storage was already disposed.');
      lifecycleGeneration += 1;
    },
    async prepare(asset: GlideAsset, signal: AbortSignal) {
      if (signal.aborted) throw new DOMException('Import cancelled', 'AbortError');
      const mimeType = String(asset.props['mimeType']);
      const hash = assetHash(asset);
      const token = crypto.randomUUID();
      let entry: { bytes: Uint8Array; mimeType: string; url: string | null } | undefined;
      let committed = false;
      let rolledBack = false;
      return {
        token,
        stage: async (bytes, stageSignal, reportProgress) => {
          for (const progress of [0.15, 0.4, 0.7]) {
            reportProgress?.(progress);
            if (options.isSlowUpload()) await waitForDemoStep(600, stageSignal);
            else await Promise.resolve();
            if (stageSignal.aborted) throw new DOMException('Import cancelled', 'AbortError');
            if (progress === 0.4 && options.consumeUploadFailure()) {
              throw Object.assign(new Error('Demo storage failure.'), {
                category: 'storage',
                retryable: true,
              });
            }
          }
          const copy = new Uint8Array(bytes);
          if (!entries.has(hash) && usageBytes() + copy.byteLength > quotaBytes) {
            throw demoQuotaError();
          }
          entry = {
            bytes: copy,
            mimeType,
            url: URL.createObjectURL(new Blob([copy], { type: mimeType })),
          };
          reportProgress?.(1);
        },
        commit: async (commitSignal) => {
          if (commitSignal.aborted) throw new DOMException('Import cancelled', 'AbortError');
          if (rolledBack) throw new Error('Demo asset persistence was already rolled back.');
          if (!entry) throw new Error('Demo asset persistence has not been staged.');
          const existing = entries.get(hash);
          if (existing) {
            if (entry.url) URL.revokeObjectURL(entry.url);
          } else {
            if (usageBytes() + entry.bytes.byteLength > quotaBytes) throw demoQuotaError();
            entries.set(hash, entry);
            try {
              persistEntries();
            } catch (error) {
              entries.delete(hash);
              if (error instanceof DOMException && error.name === 'QuotaExceededError') throw demoQuotaError();
              throw error;
            }
            options.onUsageChange?.(usageBytes());
          }
          committed = true;
        },
        rollback: async () => {
          if (rolledBack) return;
          rolledBack = true;
          if (entry && committed && entries.get(hash) === entry) {
            entries.delete(hash);
            persistEntries();
            options.onUsageChange?.(usageBytes());
          }
          if (entry?.url) URL.revokeObjectURL(entry.url);
        },
      };
    },
    resolve(asset: GlideAsset) {
      const entry = entries.get(assetHash(asset));
      if (!entry) return null;
      if (!entry.url) {
        entry.url = URL.createObjectURL(new Blob([new Uint8Array(entry.bytes).buffer], { type: entry.mimeType }));
      }
      return entry.url;
    },
    async download(asset: GlideAsset, signal: AbortSignal) {
      if (signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
      if (options.consumeDownloadFailure?.()) {
        throw Object.assign(new Error('Demo download is temporarily unavailable.'), {
          category: 'storage',
          retryable: true,
        });
      }
      const entry = entries.get(assetHash(asset));
      if (!entry) throw new Error('Demo asset is no longer in memory.');
      return { bytes: new Uint8Array(entry.bytes), mimeType: entry.mimeType };
    },
    async retainReferences() {},
    async materializePortableAsset(payload: PortableRasterPayload, asset: GlideAsset, _context, signal) {
      if (signal.aborted) throw new DOMException('Portable paste cancelled', 'AbortError');
      if (!isCanonicalRasterAssetId(payload.assetId)
        || !isCanonicalRasterAssetId(asset.id)
        || payload.assetId !== asset.id) {
        throw new Error('Demo portable raster assetId must be a matching canonical SHA-256 asset ID.');
      }
      let bytes: Uint8Array;
      let mimeType = String(asset.props['mimeType'] ?? '');
      if (payload.kind === 'embedded') {
        bytes = decode(payload.base64);
      } else {
        const reference = trustedDemoMediaReference(payload.reference);
        const response = await fetch(reference, { credentials: 'include', signal });
        if (!response.ok) throw new Error(`Demo portable asset download failed (${response.status})`);
        bytes = new Uint8Array(await response.arrayBuffer());
        mimeType = response.headers.get('content-type')?.split(';', 1)[0] ?? mimeType;
      }
		const persistence = await this.prepare(asset, signal);
		try {
			await persistence.stage(bytes, signal);
			await persistence.commit(signal);
			return { rollback: persistence.rollback };
		} catch (error) {
			try {
				await persistence.rollback();
			} catch (rollbackError) {
					throw demoOrphanCleanupError(error, rollbackError);
			}
			throw error;
		}
    },
    usageBytes,
    reset() {
      for (const entry of entries.values()) if (entry.url) URL.revokeObjectURL(entry.url);
      entries.clear();
      window.localStorage.removeItem(persistenceKey);
      options.onUsageChange?.(0);
    },
    dispose() {
      const generation = ++lifecycleGeneration;
      queueMicrotask(() => {
        if (generation !== lifecycleGeneration || disposed) return;
        disposed = true;
        for (const entry of entries.values()) if (entry.url) URL.revokeObjectURL(entry.url);
        entries.clear();
      });
    },
  };
  return storage;
}
