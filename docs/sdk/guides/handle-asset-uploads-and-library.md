# Guide: Handle image/SVG uploads and a browsable asset catalog

**Use case:** users paste/drop images and SVGs onto a board (uploads), and/or you want a searchable stock-icon panel they can drag shapes from (a catalog) — two genuinely separate features that happen to share a UI panel.

**Reference:** [glideboard: Assets](../glideboard/assets.md).

## Uploads: implement `GlideboardAssetStorage`

```ts
import type { GlideboardAssetStorage, GlideboardAssetPersistence } from '@durgakiran/glideboard';

const assetStorage: GlideboardAssetStorage = {
  async prepare(asset, signal) {
    const res = await fetch('/api/assets/stage', {
      method: 'POST',
      body: JSON.stringify({ assetId: asset.id, mimeType: asset.props.mimeType }),
      signal,
    });
    const { token } = await res.json();

    const persistence: GlideboardAssetPersistence = {
      token,
      async stage(bytes, signal, reportProgress) {
        await uploadWithProgress(`/api/assets/${token}/bytes`, bytes, { signal, onProgress: reportProgress });
      },
      async commit(signal) {
        await fetch(`/api/assets/${token}/commit`, { method: 'POST', signal });
      },
      async rollback() {
        await fetch(`/api/assets/${token}/rollback`, { method: 'POST' }).catch(() => {});   // best-effort; must be safe to call twice
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

The ordering matters and is enforced by the contract, not just a style preference: `prepare()` gets you a `token` **before any bytes move**, so a client that goes offline mid-upload has something to retry against rather than an orphaned partial upload the server doesn't know about. `commit()` is only called after the corresponding shape-creation edit itself succeeds in the editor — so you never end up with a durably-committed asset for an edit that didn't actually land (e.g. the user hit Escape mid-drag). Make `rollback()` idempotent; it can be called more than once (an abort path and a cleanup path both calling it is expected, not a bug to guard against with a thrown "already rolled back" error).

`resolve()` must be synchronous and side-effect-free — it's called during render. If your real asset URL requires an async fetch (e.g. a signed URL with rotation), resolve it eagerly (on `prepare`/`commit`, or via `retainReferences`) and cache the result for `resolve()` to read synchronously.

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
