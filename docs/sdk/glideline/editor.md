# Editor

**Package:** `@durgakiran/glideline` · **Stability:** 🔴 Unstable (all APIs on this page)

`GlideEditor` is, in the source's own words, "the public API brain — all mutations flow through it." It wraps `GlideStore` ([Store & Schema](./store-and-schema.md)), `HistoryManager` ([History & Interaction](./history-and-interaction.md)), the tool state machine ([Tools & State Machine](./tools-and-state-machine.md)), the camera, binding graph, and asset resolution behind one object with ~130 public methods. This page is a reference to that surface, grouped by concern; see the [package README](../../../packages/glideline/README.md#quick-start-a-headless-editor) for a runnable quick start.

## Construction

```ts
createEditor(opts: CreateEditorOptions = {}): GlideEditor
```

```ts
interface CreateEditorOptions {
  plugins?: GlidePlugin[];
  tools?: (typeof StateNode)[];
  viewport?: { width: number; height: number };
  camera?: { x?: number; y?: number; z?: number };
  idService?: RecordIdService;
  mutationPolicy?: MutationPolicy;
  trustedMutationCapabilities?: readonly MutationCapabilityGrant[];
  assetResolver?: AssetResolver;
  assetResolutionContext?: AssetResolutionContext;
}
```

### Boot sequence

1. Create a `GlideSchema`.
2. For each plugin, register each `ShapeUtil`/`BindingUtil` class (throws on a duplicate `type` across plugins).
3. Bake validators + migrations into the schema.
4. **Freeze** the schema — no further shape/binding registration after this point.
5. Create `GlideStore` with the frozen schema.
6. Create the camera.
7. Create `GlideEditor`.
8. For each plugin, instantiate its `ShapeUtil`/`BindingUtil` classes (injecting the editor) and register the instances.
9. Call each plugin's `onInstall(editor)`, if provided.
10. Return the editor.

Because registration happens once at boot, **the shape/binding type set is fixed for the lifetime of an editor instance.** To change it, construct a new editor (e.g. `glideboard` does this by keying a new session on `sessionKey`).

`GlidePlugin`:

```ts
interface GlidePlugin {
  id: string;
  shapes?: (abstract new () => ShapeUtil<any>)[];
  bindings?: (abstract new () => BindingUtil<any>)[];
  tools?: (typeof StateNode)[];
  onInstall?(editor: GlideEditor): void;
}
```

## Reading state (signals & queries)

| Method | Returns |
|---|---|
| `getShapeIdsSignal()` | `ReadonlySignal<readonly ShapeId[]>` — all shape ids |
| `getCurrentPageShapeIdsSignal()` | shape ids on the active page |
| `getPageIdsSignal()` / `getPageIds()` | page ids |
| `getOrderedShapeIdsSignal()` / `getOrderedShapeIds()` | canonically z-ordered shape ids |
| `getShapeSignal(id)` | signal for one shape record |
| `getDocumentVersionSignal()` | bumps on every commit |
| `getShapesInViewport()` | shapes intersecting the current camera viewport |
| `getShapesAtPoint(point)` / `getTopShapeAtPoint(...)` | hit testing |
| `getShapesInBox(box)` | spatial-index box query |
| `getChildren(parentId)` / `getAncestors(id)` / `getClippingFrameAncestors(id)` | hierarchy traversal |
| `isShapeEffectivelyLocked(id)` / `isShapeEffectivelyHidden(id)` | resolved (inherited) lock/hide state |
| `getSelectableShapeId(id)` | walks up to the nearest selectable ancestor (e.g. group) |
| `sortShapesByCanonicalOrder(shapes)` / `compareShapeOrder(a, b)` | ordering utilities |

These mirror the equivalent `GlideStore` queries but operate on `GlideShape`-typed, hierarchy-aware results.

## Pages

```ts
getDefaultPageId() / getActivePageId() / getPage(pageId) / getShapePageId(shapeId)
setActivePage(pageId)
createPage(name?) → PageId
renamePage(pageId, name)
duplicatePage(pageId) → PageId
movePage(pageId, direction: -1 | 1) → boolean
deletePage(pageId) → PageId   // returns the id of the page that became active
```

## Shapes: create, arrange, mutate

```ts
createShapeId(type?) / createBindingId(type?)
createShape(partial: AnyRecord) → ShapeId
updateShape<S>(id: ShapeId, partial: Partial<Omit<S, 'id' | 'type'>>) → void
```

`updateShape` is the general-purpose patch method — merges `partial` onto the existing record (props included) inside a transaction, and triggers `onAfterChangeToShape`/`onAfterChangeFromShape` on every binding attached to the shape (this is what keeps bound arrows routed after a move/resize — see [Shapes & Bindings § Arrows & binding](./shapes-and-bindings.md#arrows--binding)). Most of the higher-level methods below (`setLocked`, `alignShapes`, `flipShapes`, ...) are themselves built on `updateShape` + `editor.batch`.

`createShape` fills in defaults (`rotation: 0`, `parentId: activePageId`, `isLocked/isHidden: false`, a fresh order key) and merges the shape type's `getDefaultProps()` with the currently active style values before your `props` — see the [package README example](../../../packages/glideline/README.md). Arrow shapes must have `rotation: 0`; arrow geometry is encoded entirely in path points.

Arrangement and bulk operations:

```ts
reparentShapes(ids, parentId: PageId | ShapeId)
groupShapes(ids) → ShapeId / ungroupShapes(ids) → ShapeId[]
removeFramesKeepContent(ids) → ShapeId[]
setLocked(ids, locked) / setHidden(ids, hidden)
alignShapes(ids, operation: AlignOperation)
distributeShapes(ids, axis: DistributeAxis, mode?: DistributeMode)
matchShapeSizes(ids, operation: MatchSizeOperation)
flipShapes(ids, axis: FlipAxis)
tidyShapes(ids, layout: TidyLayout = 'row', gap = 24)
nudgeShapes(ids, delta: Vec2)
setShapePrecision(id, patch: ShapePrecisionPatch)
resetShapeRotations(ids)
reorderShapes(ids, ...)
duplicateShapes(ids, offset: Vec2 = { x: 10, y: 10 }) → ShapeId[]
deleteShapes(ids)
getShapes(sorted = false) → GlideShape[]
```

`deleteShapes` cascades: it calls each affected binding's `onBeforeDeleteToShape` and removes bindings that reference a deleted shape.

## Bindings

```ts
getBindingsFromShape(shapeId) / getBindingsToShape(shapeId) → GlideBinding[]
createBinding(partial: AnyRecord) → BindingId
updateBinding(id, partialProps)
deleteBinding(id)
```

Updating a shape calls `onAfterChangeToShape` for every binding attached to it — this is the hook `ArrowBindingUtil` uses to keep arrows routed to shapes that move. See [Shapes & Bindings](./shapes-and-bindings.md#arrows--binding).

## Selection & clipboard

```ts
getSelectedShapeIds() → ShapeId[]
getSelectionSignal() → Signal<ShapeId[]>
setSelectedShapeIds(ids)
selectAll()
enterGroup(id) / exitGroup() → boolean
copy(ids) / paste(point?) → ShapeId[]
```

For copy/paste **across documents or apps** — not just within one editor instance — see the portable-fragment API below, which is the sanitized, size-limited, asset-aware equivalent.

## Portable fragments (cross-document copy/paste)

```ts
createPortableBoardFragment(opts: CreatePortableBoardFragmentOptions): Promise<PortableBoardFragment>
pastePortableBoardFragment(fragment, opts?: PastePortableBoardFragmentOptions): Promise<ShapeId[]>
```

A `PortableBoardFragment` is a self-contained, schema-versioned, size-bounded (`PORTABLE_BOARD_FRAGMENT_LIMITS`) JSON payload — safe to put on the system clipboard or send over the network, and validated defensively on the way back in (`validatePortableBoardFragmentStructure`, `assertExactKeys`, `assertBoundedJson` internally). `PortableAssetExportHook` / `PortableAssetMaterializer` let the host app control how referenced assets are exported into and materialized back out of the fragment. A paste that partially fails asset materialization rolls back and throws `PortablePasteRollbackError` (carrying both the original error and any rollback errors) rather than leaving a half-pasted fragment.

`glideboard`'s `createPortableFragment`/`pastePortableFragment` handle methods are a thin pass-through to these.

## Text editing sessions

```ts
startEditing(...) / stopEditing(selectAgain?) / updateEditingDraft(...)
setEditingComposition(composing) / publishEditingDraft() / commitEditing(selectAgain?) / cancelEditing(selectAgain?, recover?)
```

Backed by `TextEditSessionController` (see [Shapes & Bindings § styling](./shapes-and-bindings.md)); `cancelEditing(_, recover: true)` is what powers draft recovery after an interrupted edit (`RecoverableTextDraft`, exposed through `glideboard`'s `getRecoverableTextDraft()`).

## History & batching

```ts
editor.batch(fn)
editor.batch(label, fn, opts?: BatchOptions)
editor.run(fn, opts?: BatchOptions)
editor.undo() / editor.redo() → HistoryResult
editor.beginHistoryPreview() / recordHistoryPreview(...) / cancelHistoryPreview()
```

Full detail in [History & Interaction](./history-and-interaction.md).

## Tools & input

```ts
setCurrentTool(id: string, options?: { preserveSelection?: boolean })
getCurrentTool() → StateNode
dispatchEvent(event: GlideEvent) → boolean
```

Full detail in [Tools & State Machine](./tools-and-state-machine.md).

## Camera & coordinate spaces

```ts
screenToPage(point) / pageToScreen(point) → Vec2
getViewportBounds() → Box2d
getShapeLocalBounds(id) / getShapeWorldBounds(id) / getShapeVisualWorldBounds(id) → Box2d
getShapeLocalOutline(id) → readonly Vec2[]
getLocalTransform(id) / getWorldTransform(id) / getWorldTransformInverse(id) → Matrix2d
localToPage(id, point) / pageToLocal(id, point) → Vec2
parentToPage(parentId, point) / pageToParent(parentId, point) → Vec2
pageDeltaToParent(parentId, delta) → Vec2
```

Three coordinate spaces matter: **screen** (pixels in the viewport), **page** (the document's own coordinate system), and **local/parent** (relative to a shape's parent, before its own transform). Most rendering code needs `pageToScreen` for display and `screenToPage` for pointer input; shape-authoring code (inside a `ShapeUtil`) works in local coordinates.

These editor methods delegate to `TransformService` internally, which is also exported directly (along with the matrix primitives it's built on: `IDENTITY_MATRIX`, `multiplyMatrices`, `translationMatrix`, `rotationMatrix`, `invertMatrix`, `applyMatrixToPoint`, `applyMatrixToVector`, `getMatrixRotation`, `matrixToSvg`, typed as `Matrix2d`) — reach for these directly only if you're computing transforms outside a live editor instance (e.g. server-side export tooling). `RecordIdService` (and its `IdTokenFactory` hook) is similarly the pluggable ID-generation strategy behind `editor.createShapeId`/`createBindingId`, injectable via `CreateEditorOptions.idService` if you need deterministic or externally-coordinated IDs (e.g. for reproducible tests, or ID schemes shared with a backend).

## Serialize, import, export

```ts
serialize() → GlideDocument
replaceDocument(doc) → LoadReport
importRecords(payload, options?) → ImportReport
getAIContext(opts?: { viewport?: boolean }) → AIContextSnapshot   // see AI / MCP
exportToSvg(shapeIds) → string
exportRegionToSvg(box) → string
exportToPortableSvg(...) → Promise<PortableSvgExport>   // sanitizes embedded assets for external use
exportToPng(shapeIds, opts?: { scale?: number }) → Promise<Blob>
exportRegionToPng(box, opts?: { scale?: number }) → Promise<Blob>
resolveAssetUrl(asset, context?) → string | null   // uses the CreateEditorOptions.assetResolver
```

`serialize`/`replaceDocument`/`importRecords` delegate directly to the equivalent `GlideStore` methods — see [Store & Schema](./store-and-schema.md#serialization--integrity) for their exact semantics (replace = atomic full-state swap, import = merge).

## Related types

`ClipboardSchemaHeader`, `ClipboardPayload`, `EditorCommand`, `ExecuteCommandOptions`, `AssetResolver`, `AssetResolutionContext`, `PortableRasterExport`, `PortableRasterPayload`, `PortableBoardFragmentSchemaHeader`, `PortableBoardFragment`, `PortableAssetExportHook`, `PortableAssetMaterialization`, `PortableAssetMaterializer`, `CreatePortableBoardFragmentOptions`, `PastePortableBoardFragmentOptions`, `PortableSvgExportOptions`, `PortableBoardFragmentLimits`, `AlignOperation`, `DistributeAxis`, `DistributeMode`, `MatchSizeOperation`, `FlipAxis`, `TidyLayout`, `ShapePrecisionPatch`.
