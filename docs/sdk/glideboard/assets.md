# Assets

**Package:** `@durgakiran/glideboard` · **Stability:** 🔴 Unstable (all APIs on this page)

Two independent, optional surfaces. Implement whichever your app needs — a board can have either, both, or neither.

| | `assetStorage` | `assetLibraryProvider` |
|---|---|---|
| Answers | "Where do a user's uploaded bytes live?" | "What pre-made catalog can they browse and drop in?" |
| Powers | `importRaster`/`importSvg`/paste-image, the Assets panel's upload flow | The Assets panel's searchable stock catalog |
| Real-world usage in this repo | Yes — `ui/app/components/WhiteboardEditor.tsx` implements this against a real backend | No — only the demo app's in-memory fake implements this today; see the note at the end |

## `GlideboardAssetStorage` (uploads)

```ts
interface GlideboardAssetStorage {
  readonly commitOrder?: 'before-document' | 'after-document';
  prepare(asset: GlideAsset, signal: AbortSignal): Promise<GlideboardAssetPersistence>;
  resolve(asset: GlideAsset, context?: AssetResolutionContext): string | null;
  download?(asset: GlideAsset, signal: AbortSignal, context?: AssetResolutionContext): Promise<GlideboardAssetDownload>;
  retainReferences?(assetIds: readonly string[], context: AssetResolutionContext | undefined, signal: AbortSignal): Promise<void>;
  materializePortableAsset?(payload: PortableRasterPayload, asset: GlideAsset, context: AssetResolutionContext | undefined, signal: AbortSignal): Promise<PortableAssetMaterialization>;
}

interface GlideboardAssetPersistence {
  readonly token: string;                                                    // opaque server-issued ownership token, available before bytes are sent
  stage(bytes: Uint8Array, signal: AbortSignal, reportProgress?: (p: number) => void): Promise<void>;
  commit(signal: AbortSignal): Promise<void>;                                // resolve only when the asset is durably available
  rollback(): Promise<void>;                                                 // idempotent cancellation; before-document hosts preserve committed bytes
}

interface GlideboardAssetDownload {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly fileName?: string;
}
```

`commitOrder` selects when the asset becomes part of the document. Use **`'before-document'` for collaborative uploads** so every newly shared image already has a durable file. Omitting the option preserves the existing `'after-document'` behavior for existing adapters.

For `'before-document'`, the upload sequence is:

1. **`prepare(asset, signal)`** — obtain a server-owned staging transaction (`token`) *before* any bytes move. Because the app already has a token before uploading starts, it can safely retry or cancel without ever having sent orphaned bytes the server doesn't know about.
2. **`stage(bytes, signal, reportProgress)`** — upload the immutable bytes into that transaction.
3. **`commit(signal)`** — validate/finalize storage and confirm that the asset is durable. Upload jobs show a finalizing phase while waiting. A successful HTTP request alone is insufficient if the server is still processing the file.
4. **Insert the document records** — Glideboard adds the asset reference and image shape only after storage confirmation. Yjs synchronization and normal checkpointing then include them. Replacement keeps the existing image until the replacement is ready.

For `'after-document'`, steps 3 and 4 are reversed. This legacy mode can share a reference before storage commit succeeds; choose the ordering that matches your adapter's contract.

### Failure, cancellation, and continued editing

The upload does not hold a document transaction or mutation fence open. Users can continue editing, collaborating, and autosaving while an image is uploading or finalizing. The Assets panel provides progress, cancellation, and retry. An on-canvas local preview is optional host/UI work; it must remain outside the shared document until the asset is ready.

In before-document mode, a failed or cancelled upload does not insert an image. Cancelling a replacement leaves the previous image in place. Cancellation or a deleted replacement target may occur after storage has committed; the now-unused file remains retained according to the host's retention policy.

`commit()` must resolve only when durability is known. If a response is lost, the adapter must retry the idempotent commit or inspect upload status before resolving. A rejected or cancelled commit may still have succeeded on the server. **In before-document mode, `rollback()` must cancel only uncommitted staging and preserve committed files**, including when their commit outcome is uncertain. It must be safe to call more than once. Glideboard does not roll back a confirmed storage commit just because document insertion fails.

- **`resolve(asset, context?)`** — a **trusted runtime lookup only**: turn a stored asset reference into a renderable URL. Its return value is never persisted back into the document — this is what stops a resolved (possibly signed, possibly expiring) URL from silently becoming part of the canonical document state.
- **`download(asset, signal, context?)`** — retrieval of the immutable original bytes for a trusted host use case (e.g. re-export); explicitly does **not** accept URLs as input, only asset references, to keep it from being used as an arbitrary-fetch primitive.
- **`retainReferences(assetIds, context, signal)`** — called before a portable payload (cross-document copy/paste, export) is released, so the storage backend can register every asset it's about to reference as "still live" and not eligible for garbage collection.
- **`materializePortableAsset(...)`** — the inverse: turn a portable fragment's embedded raster payload into a real, storage-backed asset when pasted into a *different* board/app instance.

Portable materialization and library placement must also return assets that are ready to use before their document records are inserted. Their in-flight work participates in capture preparation.

## Wait for assets before publishing, closing, or exporting

```ts
const fence = await board.prepareForCapture('publish', { signal });
try {
  await board.settleActiveEdit('commit');
  const target = await board.captureProjectionTarget();
  await durability.flush(target);
  const preview = await createPublishPreview(board, { target });
  // Publish this exact target and preview through the host's API.
} finally {
  fence.release();
}
```

`prepareForCapture(reason, options?)` accepts `'publish'`, `'close'`, or `'export'`. It immediately blocks new imports, paste, library placement, and retries, waits for already-running asset operations to insert their completed records, then acquires the ordinary mutation fence. Drawing remains available during the wait. Releasing the returned fence permits new imports and document mutations again.

`getPendingAssetCount()` returns the current number of in-flight asset operations, including portable paste and library placement. Hosts can use it for navigation/unload prompts even when the saved document is otherwise clean. This is a synchronous snapshot, not a subscription; use `prepareForCapture()` when capture correctness depends on waiting.

If an operation being awaited fails or is cancelled, capture preparation rejects and removes its ingress block; the host should display the error and allow retry. The optional `AbortSignal` cancels this wait and releases its block without cancelling the uploads themselves. Abort when the host leaves the current editor session. Always release a successfully returned fence in `finally`.

Do not call `acquireMutationFence()` before waiting for imports: that prevents their final insertion. Direct SVG export without a supplied projection target prepares capture automatically; SVG export of an explicitly supplied target uses that exact target. Selected clipboard capture through `createPortableFragment()` starts immediately and does not wait for unrelated uploads, preserving copy/cut behavior. An exact retry of a previously prepared publish request should replay its original payload without waiting for newer uploads or recapturing the board.

## `AssetLibraryProvider` (browsable catalog)

```ts
interface AssetLibraryProvider {
  readonly id: string;
  search(request: AssetLibrarySearchRequest): Promise<AssetLibrarySearchResult>;
  getGroups(signal: AbortSignal): Promise<readonly AssetLibraryGroup[]>;
  getFavorites(signal: AbortSignal): Promise<readonly AssetLibraryItem[]>;
  setFavorite(itemId: string, favorite: boolean, signal: AbortSignal): Promise<void>;
  getRecents(signal: AbortSignal): Promise<readonly AssetLibraryItem[]>;
  recordRecent(itemId: string, signal: AbortSignal): Promise<void>;
  getInstallations(signal: AbortSignal): Promise<readonly AssetLibraryInstallation[]>;
  install(libraryId: string, signal: AbortSignal): Promise<AssetLibraryInstallation>;
  resolveRetainedDependency(dependency: RetainedAssetDependency, signal: AbortSignal): Promise<RetainedAssetDependencyHandle>;
}
```

`AssetLibraryItem` (`id`, `providerId`, `sourceLibraryId`, `sourceVersion`, `name`, `mediaType: 'svg' | 'raster'`, `width`, `height`, `license`, `thumbnailUrl?`, `groupIds`, `availability: 'available' | 'unavailable' | 'missing'`) and `AssetLibraryGroup` (`kind: 'recent' | 'favorites' | 'personal' | 'team' | 'vendor'`, `installed`) model a catalog organized into installable groups (icon packs, team libraries) with per-item favorites/recents, independent of any single board.

You don't implement `AssetLibraryProvider` directly — you implement the backend contract and wrap it:

```ts
const provider = createAssetLibraryProvider(myBackend);   // freezes the public surface, tracks the backend for uninstall
```

```tsx
<Glideboard sessionKey="board-1" assetLibraryProvider={provider} />
```

### Uninstalling a library

```ts
uninstallAssetLibrary(provider: AssetLibraryProvider, libraryId: string, signal: AbortSignal): Promise<readonly RetainedAssetDependencyHandle[]>
```

> "Resolve every retained dependency before removing a library from the catalog." — source doc comment

This is the safety-critical operation in the whole surface: before actually removing a library, it looks up every asset from that library still *retained* somewhere (placed on some board, and thus not safe to garbage-collect), resolves a handle for each via `provider.resolveRetainedDependency`, and **verifies each returned handle matches the dependency it was asked to resolve** (same content hash, provider, source library/version, license) before proceeding — a mismatched handle throws rather than silently uninstalling. Only after every retained dependency is accounted for does it call the backend's internal `removeInstallation`. Requires a real `AbortSignal` (throws a `TypeError` otherwise) — dependency IDs are derived internally, not passed in, so there's no way to call this with a stale or attacker-controlled dependency list.

`getRetainedAssetProvenance(item: AssetLibraryItem): RetainedAssetProvenance` builds the immutable provenance record copied onto both the placed asset and shape when an item from the library is dropped onto a board — this is what `uninstallAssetLibrary` later matches against.

## Related types

`AssetLibraryMediaType`, `AssetLibraryAvailability`, `AssetLibraryGroupKind`, `AssetLibrarySearchRequest`, `AssetLibrarySearchResult`, `AssetLibraryInstallation`, `RetainedAssetDependency`, `RetainedAssetDependencyHandle`, `AssetMaterialization`, `AssetMaterializationRequest`, `AssetMaterializer`, `AssetPlacementCallbacks`, `AssetPlacementSelection`, `RetainedAssetProvenance` (all re-exported from `@durgakiran/glideboard`, sourced from `asset-library.ts`).

## ⚠️ Stability note

`AssetLibraryProvider` is exercised today only by `glideline-demo`'s in-memory fake backend (`GlideboardDemo.tsx`) — the real consumer app (`ui`) only implements `GlideboardAssetStorage`, not an asset library backend. `uninstallAssetLibrary`'s dependency-matching logic in particular has not been proven against a real network-backed provider (pagination edge cases, partial-failure mid-uninstall, concurrent installs). Treat this surface as the least field-tested part of the asset API.
