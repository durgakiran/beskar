# Overview & Board Lifecycle

**Package:** `@durgakiran/glideboard` · **Stability:** 🔴 Unstable (all APIs on this page)

`glideboard` is a React whiteboard UI built on `@durgakiran/glideline` ([glideline docs](../glideline/overview.md)). It supplies a fixed default shape/tool bundle, the full component tree (canvas, toolbar, layers panel, style panel, asset panels), and the collaboration/asset/durability wiring around it. See the [package README](../../../packages/glideboard/README.md) for install steps and a runnable quick start; this page is the deeper reference for props, the imperative handle, and session lifecycle.

## `<Glideboard>` props (`GlideboardProps`)

| Prop | Type | Notes |
|---|---|---|
| `sessionKey` | `string?` | Changing this value tears down and remounts a fresh, isolated session — new editor instance, new history. Treat it as a session identity, not a display key. |
| `initialDocument` | `GlideDocument \| null?` | Seeds the board. Requires `initialDocumentDisposition`. |
| `initialDocumentDisposition` | `InitialDocumentDisposition?` | `{ kind: 'acknowledged-baseline', durableRevision }` \| `{ kind: 'local-recovery', recoveryCheckpoint }` \| `{ kind: 'new-unsaved-seed' }` — tells glideboard what trust level the initial state has, which affects save/collaboration reconciliation. Required whenever `initialDocument` is set. |
| `collaboration` | `GlideboardCollaborationConfig \| null?` | See [Collaboration](./collaboration.md). |
| `readOnly` | `boolean?` | Disables mutation; still renders the current document. |
| `toolbarLayout` | `'split' \| 'vertical'?` | Default `'split'`. |
| `assetLibraryProvider` | `AssetLibraryProvider?` | See [Assets](./assets.md). |
| `assetStorage` | `GlideboardAssetStorage?` | See [Assets](./assets.md). Required for raster import. |
| `assetResolutionContext` | `AssetResolutionContext?` | Immutable coordinates for historical rendering / portable export, distinct from live asset resolution. |
| `onDocumentChange` | `(document, context: { signal: AbortSignal }) => void \| Promise<void>` | Called (debounced) on document change; `context.signal` aborts if the board is disposed with the `'cancel'` unmount policy. |
| `documentChangeDebounceMs` | `number?` | Default `500`. |
| `pendingSaveOnUnmount` | `'cancel' \| 'flush'?` | What to do with a dirty **standalone** (non-collaborative) snapshot when the component unmounts. Default `'cancel'` — a debounced `onDocumentChange` that hasn't fired yet is dropped, not flushed. |
| `debugApiKey` | `string?` | Internal debug/testing hook. |
| `customShapes` | `readonly GlidePlugin[]?` | Startup-only extension of the default shape/tool bundle — see below. Changing it requires a new `sessionKey`. |

## `GlideboardHandle` (imperative ref API)

```ts
interface GlideboardHandle {
  readonly checkpoints: CollaborationCheckpointSource;
  serialize(): GlideDocument;
  replaceDocument(document: GlideDocument): LoadReport;
  getPages(): readonly GlidePage[];
  getActivePageId(): PageId;
  setActivePage(pageId): void;
  createPage(name?): PageId;
  renamePage(pageId, name): void;
  duplicatePage(pageId): PageId;
  movePage(pageId, direction: -1 | 1): boolean;
  deletePage(pageId): PageId;
  exportSvg(options?: GlideboardExportSvgOptions): Promise<string>;
  createPortableFragment(options): Promise<PortableBoardFragment | null>;
  pastePortableFragment(fragment, options?): Promise<ShapeId[]>;
  importSvg(source: string): Promise<ShapeId>;
  importRaster(bytes: Uint8Array, declaredMimeType?: string): Promise<ShapeId>;
  replaceAsset(shapeId, request): Promise<ShapeId>;
  downloadAsset(recordId, signal?, context?): Promise<GlideboardAssetDownload>;
  clearAssetImportHistory(): void;
  configureAssetPlacement(config): void;
  getRecoverableTextDraft(): RecoverableTextDraft | null;
  setCurrentTool(toolId: string): void;
  setReadOnly(readOnly: boolean): void;
  settleActiveEdit(policy: 'commit' | 'cancel'): Promise<void>;
  getPendingAssetCount(): number;
  prepareForCapture(reason: 'close' | 'publish' | 'export', options?: { signal?: AbortSignal }): Promise<MutationFence>;
  acquireMutationFence(reason: 'close' | 'publish' | 'export'): MutationFence;
  captureProjectionTarget(): Promise<ProjectionTarget>;
  flush(): void;
}
```

This is a thin pass-through to the underlying `GlideboardController` — see [Controller & Theming](./controller-and-theming.md) for the class that actually implements each of these.

`checkpoints`, `prepareForCapture`, `acquireMutationFence`, `captureProjectionTarget` are the durability/publish-flow primitives — see [Collaboration § Durability & publish flow](./collaboration.md#durability--publish-flow); they matter once you need to know "did the server actually persist what's on screen" rather than just rendering live collaborative state. `prepareForCapture()` waits for pending asset work before acquiring a mutation fence; `getPendingAssetCount()` provides a synchronous count for navigation/unload checks.

## Session lifecycle

A `Glideboard` mount goes through:

1. **Construct** — a `GlideboardController` is created for the given `sessionKey`, which boots a `glideline` editor (default shapes/tools + any `customShapes`).
2. **Seed** — `initialDocument` (if provided) is loaded via the controller, using `initialDocumentDisposition` to decide how to reconcile it against collaboration state.
3. **Attach collaboration** (if `collaboration` is provided) — see [Collaboration](./collaboration.md).
4. **Live** — user interaction flows through the `glideline` editor; `onDocumentChange` fires (debounced) on each commit.
5. **Unmount** — collaboration and presence are detached, in-flight asset imports are aborted, and any dirty standalone snapshot is cancelled or flushed per `pendingSaveOnUnmount`.

`sessionKey` is the unit of session identity: changing it is equivalent to unmounting and remounting a brand-new board, with no continuity in the editor's undo history or in-flight state.

## Default shape & tool set, and `customShapes`

`Glideboard` boots its `glideline` editor with a fixed core plugin set — boxes, frames, groups, text, ellipses, sticky notes, freehand, sanitized SVG, raster images, the full geo-shape family, arrows (with routing/binding), and asset placement — plus the matching tools (`SelectTool`, `HandTool`, `EraserTool`, and one tool per drawable shape type). This is assembled by an internal `createGlideboardEditorInstance()` in `glideboard/src/editor.ts`, which is not itself exported — `customShapes` is the only supported extension point:

```tsx
<Glideboard sessionKey="board-1" customShapes={[myCustomShapesPlugin]} />
```

`myCustomShapesPlugin` is an ordinary `glideline` `GlidePlugin` (see [glideline: Shapes & Bindings](../glideline/shapes-and-bindings.md)) — `Glideboard` doesn't wrap or restrict its shape here. There is currently **no way to remove** a default shape/tool through `Glideboard`'s public API; a materially different shape/tool combination means calling `createEditor()` from `glideline` directly and not using `Glideboard`/`GlideboardController` at all.

## What isn't exported

`GlideboardContext`/`useGlideboardController` and the `useSelectedShapes` hook exist in source (used internally by `Toolbar`, `LayersPanel`, etc.) but are **not** re-exported from `@durgakiran/glideboard`'s public entry point — they aren't part of the supported API today, even though they're referenced in this repo's own code. Likewise `wbTheme` (see [Controller & Theming § Theming](./controller-and-theming.md#theming)) is internal.

## Page index

- [Collaboration](./collaboration.md) — real-time Yjs wiring, presence, the durability/publish-flow (`checkpoints`, `prepareForCapture`, `acquireMutationFence`).
- [Assets](./assets.md) — `assetStorage` (uploads) vs. `assetLibraryProvider` (browsable catalog).
- [Controller & Theming](./controller-and-theming.md) — driving `GlideboardController` headlessly, and the current (unofficial) CSS-variable theming mechanism.
