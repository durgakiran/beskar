# Guide: Handle image/SVG uploads and a browsable asset catalog

**Use case:** users paste/drop images and SVGs onto a board (uploads), and/or you want a searchable stock-icon panel they can drag shapes from (a catalog) — two genuinely separate features that happen to share a UI panel.

**Reference:** [glideboard: Assets](../glideboard/assets.md).

## Uploads: implement `GlideboardAssetStorage`

```ts
import type { GlideboardAssetStorage, GlideboardAssetPersistence } from '@durgakiran/glideboard';

const assetStorage: GlideboardAssetStorage = {
  commitOrder: 'before-document',
  async prepare(asset, signal) {
    const res = await fetch('/api/assets/stage', {
      method: 'POST',
      body: JSON.stringify({ assetId: asset.id, mimeType: asset.props.mimeType }),
      signal,
    });
    if (!res.ok) throw new Error('Could not prepare image upload');
    const { token } = await res.json();

    const persistence: GlideboardAssetPersistence = {
      token,
      async stage(bytes, signal, reportProgress) {
        await uploadWithProgress(`/api/assets/${token}/bytes`, bytes, { signal, onProgress: reportProgress });
      },
      async commit(signal) {
        const res = await fetch(`/api/assets/${token}/commit`, { method: 'POST', signal });
        if (!res.ok) throw new Error('Could not finalize image upload');
        // This endpoint must confirm durable storage before returning success.
      },
      async rollback() {
        // The endpoint must leave committed files intact, even after a lost commit response.
        await fetch(`/api/assets/${token}/rollback`, { method: 'POST' }).catch(() => {});
      },
    };
    return persistence;
  },

  resolve(asset, context) {
    // A synchronous, trusted lookup — not a network call. Return a CDN/signed URL you already have,
    // or null if this asset can't currently be resolved (e.g. still uploading).
    return assetUrlCache.get(String(asset.id)) ?? null;
  },

  async download(asset, signal, context) {
    const res = await fetch(`/api/assets/${asset.id}/original`, { signal });
    return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: asset.props.mimeType as string };
  },
};
```

```tsx
<Glideboard sessionKey={boardId} assetStorage={assetStorage} />
```

With `commitOrder: 'before-document'`, Glideboard prepares the upload, sends the bytes, waits for `commit()` to confirm durable storage, and then inserts the asset reference and shape. Collaborators receive the image only after its file is ready. Other drawing, synchronization, and autosaving continue throughout the upload. Existing adapters that omit `commitOrder` retain the legacy order: document insertion followed by storage commit.

`prepare()` obtains a token **before any bytes move**, so interrupted uploads have a server-owned session for retry or cancellation. `commit()` must be idempotent and resolve only when the asset is known to be durable. If a response is lost, retry or query its status before reporting success. Make `rollback()` idempotent and restrict it to uncommitted staging: the server may have committed a file even when the client saw an error. A cancelled or obsolete insertion can leave an unused committed file retained according to your backend's policy.

The Assets panel displays upload progress and a finalizing phase, with cancellation and retry. A local on-canvas preview is optional additional UI; keep its loading state and object URL outside Yjs. Replacement retains the old image until the new asset is ready.

`resolve()` must be synchronous and side-effect-free — it's called during render. If your real asset URL requires an async fetch (e.g. a signed URL with rotation), resolve it eagerly (on `prepare`/`commit`, or via `retainReferences`) and cache the result for `resolve()` to read synchronously.

### Capture after pending imports finish

For publish or close, wait for pending asset work before capturing and saving:

```ts
// Pass the editor session's AbortSignal so leaving the session cancels the wait.
const fence = await board.prepareForCapture('publish', { signal });
try {
  await board.settleActiveEdit('commit');
  const target = await board.captureProjectionTarget();
  await durability.flush(target);
  const preview = await createPublishPreview(board, { target });
  await publishTarget(target, preview);
} finally {
  fence.release();
}
```

`prepareForCapture()` immediately blocks new asset imports, paste, library placements, and retries. It allows existing operations to insert their results, then applies a mutation fence. Drawing stays available while uploads finish. Use `'close'` when leaving after saving or `'export'` for a custom export flow; direct SVG export without a supplied target already performs this preparation. Selected clipboard capture through `createPortableFragment()` starts immediately without waiting for unrelated uploads, preserving copy/cut behavior.

Use `board.getPendingAssetCount()` in navigation/unload checks to detect uploads that have not yet changed the saved document. It reports a synchronous count of current operations; it does not wait or subscribe to changes.

Catch preparation errors in the host so users can retry failed imports before publishing. Aborting preparation releases the import block and rejects the wait; it does not cancel the underlying uploads. Always release a returned fence in `finally`. Acquiring a mutation fence before waiting would block the very insertions capture is waiting for. If retrying an already-prepared immutable publish request, replay that request instead of preparing a new capture.

## Library: implement the provider backend

```ts
import { createAssetLibraryProvider } from '@durgakiran/glideboard';

const provider = createAssetLibraryProvider({
  id: 'company-icon-library',
  async search(request) {
    const res = await fetch(`/api/icon-library/search?q=${encodeURIComponent(request.query)}`, { signal: request.signal });
    return res.json();   // { items: AssetLibraryItem[], nextCursor? }
  },
  async getGroups(signal) { /* ... */ return []; },
  async getFavorites(signal) { /* ... */ return []; },
  async setFavorite(itemId, favorite, signal) { /* ... */ },
  async getRecents(signal) { /* ... */ return []; },
  async recordRecent(itemId, signal) { /* ... */ },
  async getInstallations(signal) { /* ... */ return []; },
  async install(libraryId, signal) { /* ... */ throw new Error('not implemented'); },
  async resolveRetainedDependency(dependency, signal) { /* ... */ throw new Error('not implemented'); },
  async getRetainedDependencies(libraryId, signal) { /* backend-only method, not on the public AssetLibraryProvider */ return []; },
  async removeInstallation(libraryId, signal) { /* backend-only */ },
});
```

```tsx
<Glideboard sessionKey={boardId} assetLibraryProvider={provider} />
```

`createAssetLibraryProvider` wraps your backend and freezes the public-facing object — `getRetainedDependencies`/`removeInstallation` exist on the backend you pass in but aren't exposed on the `provider` you get back; they're only reachable through `uninstallAssetLibrary(provider, libraryId, signal)`, which is the one safe way to remove an installed library (see the reference page for exactly why it's structured this way — it verifies every still-placed asset from that library is accounted for before actually removing it).

## Do you need both?

Usually not both at once, and they solve different problems:

- Only `assetStorage` — a whiteboard where users bring their own images/screenshots. Most apps start here.
- Only `assetLibraryProvider` — a constrained diagramming tool where users compose from a fixed icon set and never upload arbitrary files.
- Both — a general whiteboard with a stock-icon panel *and* user uploads (e.g. a product-design tool). Note these are independent: an item dropped from the library doesn't necessarily flow through `assetStorage` at all unless your library backend's `materialize` step chooses to persist it that way.

## Enforcing size/type limits before you even call these

`glideline`'s content-ingress layer (`prepareRasterAsset`, `sanitizeSvg`) does the actual validation before an asset ever reaches your `assetStorage.prepare()` — see [Safely import pasted/uploaded SVG, images, and rich text](./sanitize-untrusted-content.md). `glideboard`'s `importRaster`/`importSvg` already run content through that layer for you; if you're calling `assetStorage.prepare()` from your own custom upload UI rather than through `GlideboardHandle.importRaster`, make sure you're still routing through that sanitization step yourself — `assetStorage` alone doesn't re-validate the bytes it's handed.
