# Controller & Theming

**Package:** `@durgakiran/glideboard` · **Stability:** 🔴 Unstable (all APIs on this page)

## `GlideboardController`

`Glideboard` is a thin React wrapper — `GlideboardController` owns the `glideline` editor instance, collaboration attachment, asset import/export, presence, and document-change tracking, independent of React. If you're building a different component tree (a non-`Glideboard` UI) on the same semantics, construct a controller directly rather than reimplementing this logic against raw `glideline`:

```ts
const controller = new GlideboardController({
  sessionKey: 'board-1',
  customShapes: [myPlugin],
  initialDocument: savedDoc,
  initialDocumentDisposition: { kind: 'acknowledged-baseline', durableRevision: '1' },
  readOnly: false,
  assetStorage: myAssetStorage,
  assetResolutionContext: myContext,
});

controller.editor;   // the underlying glideline GlideEditor — readonly, for direct read/query access
```

```ts
interface GlideboardControllerOptions {
  sessionKey: string;
  customShapes?: readonly GlidePlugin[];
  initialDocument?: GlideDocument | null;
  initialDocumentDisposition?: InitialDocumentDisposition;
  readOnly?: boolean;
  assetStorage?: GlideboardAssetStorage;
  assetResolutionContext?: AssetResolutionContext;
}
```

### Method groups

Everything on `GlideboardHandle` ([Overview § GlideboardHandle](./overview-and-lifecycle.md#glideboardhandle-imperative-ref-api)) is implemented directly on the controller (`serialize`, page management, `exportSvgAtTarget`, `createPortableFragment`/`pastePortableFragment`, `importSvg`/`importRaster`, `replaceAsset`/`downloadAsset`, `setCurrentTool`, `setReadOnly`, `settleActiveEdit`, `acquireMutationFence`, `captureProjectionTarget`), plus controller-only surface not exposed through the React handle:

```ts
// Asset placement (drag-and-drop / paste-to-place flow)
configureAssetPlacement(config) / retryAssetPlacement() / cancelAssetPlacement()

// Asset import job queue (tracked, cancelable, retryable uploads)
queueAssetImport(request) → GlideboardAssetImportTask
getAssetImportJob(jobId) / cancelAssetImport(jobId) / retryAssetImport(jobId) / dismissAssetImport(jobId)

// Plain document ops
importPlainText(text, point?) → ShapeId | null
clearDocument()

// Arrow defaults (applies to newly drawn arrows / current selection styling)
setArrowRouteStyle(routeStyle) / setArrowheadStart(style) / setArrowheadEnd(style) / setConnectorPreset(preset)

// Collaboration & presence (see Collaboration page)
attachCollaboration(config) → cleanup / detachCollaboration()
getCanvasTextCollaboration(shapeId, options?)   // per-shape Y.XmlFragment for rich-text co-editing
attachPresence(...) / detachPresence()

// Document-change tracking (what powers GlideboardProps.onDocumentChange)
configureDocumentChanges(handler, debounceMs)
startDocumentChangeTracking() → cleanup / stopDocumentChangeTracking()

// DOM wiring (used by Glideboard's own rendering; needed if you build a custom canvas host)
domId(name) / setCanvasElement(element) / getCanvasElement()

// Debug/testing hook
attachDebugApi(debugApiKey) → cleanup

// Teardown
dispose(options?: GlideboardDisposeOptions): Promise<void>   // { pendingSave?: 'cancel' | 'flush' }
```

`dispose()` is idempotent (repeated calls return the same in-flight promise) and, in order: aborts in-flight asset imports, aborts (or preserves, per `pendingSave`) any pending document save, detaches collaboration and presence, then clears asset history, cancels active interactions/placement, and runs any attached debug cleanups. If you construct a `GlideboardController` directly, you are responsible for calling `dispose()` yourself — `Glideboard` does this automatically on unmount.

## Theming

There is **no exported theming API today.** Component styling is driven by an internal `wbTheme` object (`theme.ts`, not exported from `@durgakiran/glideboard`) whose values are all `var(--token-name, <fallback>)` CSS custom properties — e.g. `accent: 'var(--accent-9, #2563eb)'`, `text: 'var(--gray-12, #221f26)'`. The token names follow a [Radix Colors](https://www.radix-ui.com/colors)-style numeric scale (`--gray-1` … `--gray-12`, `--accent-9`, `--accent-11`, `--red-9`, `--red-11`, plus alpha variants like `--accent-a3`).

This means the **de facto** (undocumented, unstable) customization mechanism is: define these CSS custom properties on an ancestor element in your host app, and `glideboard`'s inline styles will pick them up; omit them and the hardcoded fallback values render. There is no way to override via a JS theme prop, and the shipped `styles.css` (`@durgakiran/glideboard/styles.css`) is actually copied through from `@durgakiran/canvas-text-editor`'s build output, not authored by `glideboard` itself — don't assume it contains the token definitions; you supply those.

If your app needs first-class theming (a documented token list, dark-mode support, a JS-level override API), that's a gap to close explicitly, not something to reverse-engineer from `theme.ts` today.

## Re-exported from `glideline`

`createSvgPathShape` is re-exported for convenience so a simple custom shape doesn't require a separate `@durgakiran/glideline` import. Everything else needed to build `customShapes` (`GlidePlugin`, `ShapeUtil`, tool base classes, etc.) comes from `@durgakiran/glideline` directly — see [glideline: Shapes & Bindings](../glideline/shapes-and-bindings.md) and [glideline: Tools & State Machine](../glideline/tools-and-state-machine.md).
