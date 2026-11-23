# @durgakiran/glideboard

A reusable React whiteboard UI — canvas, toolbar, layers panel, style panel, asset import/library panels, and real-time collaboration wiring — built on top of [`@durgakiran/glideline`](../glideline/README.md). `glideline` supplies the document model, editor, and tools; `glideboard` supplies a pre-wired, opinionated shape/tool set and the React component tree to render and drive it. If you need a different shape/tool combination or a non-React renderer, build directly on `glideline` instead — `glideboard` is one specific UI built on that engine, not the only way to consume it.

> **Status:** `0.0.x-alpha`. Used internally by the `ui` app's whiteboard pages against real collaboration/asset backends. API may still change between alpha versions.

## Install

```bash
npm install @durgakiran/glideboard
```

Peer dependencies: `react >= 18`, `react-dom >= 18`. Also import the stylesheet once, globally:

```css
/* e.g. in your app's global CSS entry */
@import "@durgakiran/glideboard/styles.css";
```

## Quick start

```tsx
import { Glideboard } from '@durgakiran/glideboard';

function WhiteboardPage() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Glideboard sessionKey="board-1" />
    </div>
  );
}
```

This alone gives you a fully working local (non-collaborative) whiteboard: select/box/frame/arrow/ellipse/text/sticky-note/freehand/eraser tools, layers panel, style panel, and SVG/raster asset placement — using the shape and tool set `glideboard` registers by default (see "Default shape & tool set" below).

`sessionKey` identifies a board session; changing it tears down and remounts a fresh session (fresh editor, fresh history). Use a stable key per document, and change it only when you intentionally want to swap to a different document/session.

## Persisting a document

`Glideboard` doesn't persist anything on its own — you own storage. Load a document via `initialDocument`, save on change via `onDocumentChange`, or reach into the imperative handle:

```tsx
import { useRef } from 'react';
import { Glideboard, type GlideboardHandle } from '@durgakiran/glideboard';

function WhiteboardPage({ savedDocument }: { savedDocument: GlideDocument | null }) {
  const boardRef = useRef<GlideboardHandle>(null);

  return (
    <Glideboard
      ref={boardRef}
      sessionKey="board-1"
      initialDocument={savedDocument}
      initialDocumentDisposition={
        savedDocument
          ? { kind: 'acknowledged-baseline', durableRevision: '1' }
          : { kind: 'new-unsaved-seed' }
      }
      onDocumentChange={(document) => saveToBackend(document)}
      documentChangeDebounceMs={500}
    />
  );
}
```

`initialDocumentDisposition` tells `glideboard` what kind of state `initialDocument` represents (a durable, server-acknowledged snapshot vs. a locally recovered draft vs. a brand-new empty seed) — this affects how it reconciles the initial save/collaboration state. It's required whenever `initialDocument` is provided.

The imperative `GlideboardHandle` (via `ref`) exposes `serialize()`, `replaceDocument()`, page management (`getPages`, `createPage`, `renamePage`, `movePage`, `deletePage`, ...), `exportSvg()`, cross-document copy-paste (`createPortableFragment`/`pastePortableFragment`), SVG/raster import, and collaboration checkpoints (`checkpoints`, `acquireMutationFence`).

## Pen mode

A pen tip press on an editable canvas enables pen mode when the browser reports touch capability. Pen mode ignores touch input on the canvas between pen strokes. Choose **Exit pen mode** in the status bar to resume finger input. Pen mode is local to the board session.

## Stroke diagnostics

Add `glideboardStrokeDiagnostics=1` to the board URL query string and reload. Open the browser's developer console, then draw the letters that lose their curves. Look for `[Glideboard stroke diagnostics]`. Remove the query parameter and reload to turn logging off.

Applications can also pass `onStrokeDiagnostics` to receive the batches directly. The callback takes precedence over the console logger.

```tsx
<Glideboard onStrokeDiagnostics={batch => console.table(batch)} />
```

Each `stroke-ended` entry reports the input type, how the stroke ended, and whether the ink reached the local document store. Use the sample counts to locate where detail was lost.

- `moveEventCount`, `coalescedSampleCount`, `maxInputSampleGapMs`, and `maxInputSampleDistancePx` describe the samples the browser delivered. Few samples or large gaps can leave a fast curve undersampled.
- Compare `distinctMoveSampleCount` to `acceptedPointCount` minus the starting point. A large difference can indicate that the draw tool's 0.75 CSS-pixel spacing filter skipped closely spaced samples. `committedPointCount` includes a final point from pointerup when its position changed.
- When the counts show that the samples reached the document, use `strokeStyle`, `strokeWidth`, `pressureSensitive`, and `zoomAtStart` to help investigate the SVG rendering. `zeroPressureMoveEventCount` counts pointermove events whose outer sample reported zero pressure.
- A `pen-press-blocked` entry indicates that another pointer already owned the interaction. `pointercancel` and `lostpointercapture` identify browser interruptions. Pointer events expose the interruption and its timing, while the underlying OS cause can remain unknown.

For long strokes, expand `frameTiming` in the `stroke-ended` entry. Timings are in milliseconds. Each maximum can come from a different update.

- `animationFrameCount` counts draw callbacks and `synchronousFlushCount` counts batches flushed ahead of a frame, such as on pen lift. `maxAnimationFrameGapMs` can include a pause in pen movement, so compare it with `maxInputQueueMs`, the longest time a move actually waited for its draw update.
- `maxDrawUpdateMs` measures the work to apply samples and publish a live preview. `maxUpdateToSvgStartMs` measures how long the same preview waited to reach SVG rendering.
- `maxSvgRenderMs` measures generating and writing the live SVG to the DOM. `slowestSvgPointCount` is the number of points in that render. `maxInputToSvgReadyMs` measures the full time from the first queued move to its live SVG DOM update. Browser paint and display latency occur after that endpoint.
- `svgRenderCount` includes the starting dot when it rendered during the stroke. A timing is `null` when its stage was never observed, for example when ink committed before the live SVG could render.

Glideboard delivers batches outside the pointer handlers. It buffers up to 100 entries per pending batch and drops the oldest entries on overflow. Payloads contain aggregate counts, timings, and settings and omit coordinates, pointer IDs, and document IDs. The URL flag logs locally to the browser console.

## Real-time collaboration

`glideboard` doesn't ship a transport — you bring a Yjs `Y.Doc` and an awareness-capable provider (e.g. `y-websocket`, `y-webrtc`, or your own), and `glideboard` projects the canvas document onto/from it:

```tsx
<Glideboard
  sessionKey="board-1"
  collaboration={{
    doc: yDoc,
    provider: { awareness: provider.awareness, synced: provider.synced },
    user: { id: currentUser.id, name: currentUser.name, color: currentUser.color },
  }}
/>
```

- `doc` is a `Y.Doc` (or duck-typed equivalent — see `GlideboardCollaborationDoc`).
- `provider.awareness` is required for presence (cursors, avatars via `CollaborationAvatars`/`CollaborationCursors`). Awareness providers are session-owned — don't share one instance across two mounted boards.
- `provider.synced` gates whether `glideboard` will seed an empty shared document (only once the provider is known to be caught up, to avoid a race where two just-connected clients both try to seed).
- `boardIdentity` / `bootstrapRevision` are optional guards against attaching the wrong `Y.Doc` or double-seeding from a stale revision — see `ui/app/components/WhiteboardEditor.tsx` for a full worked example against a real backend.

## Assets

Two independent, optional surfaces — implement whichever your app needs:

- **`assetStorage` (`GlideboardAssetStorage`)** — required for raster/SVG *upload*: `prepare()` opens a server-owned staging transaction, the returned `GlideboardAssetPersistence` handles `stage()`/`commit()`/`rollback()` of the actual bytes, and `resolve()` turns a stored asset reference into a renderable URL at render time. This is what backs `importRaster`/`importSvg`/paste-image.
- **`assetLibraryProvider` (`AssetLibraryProvider`)** — optional, powers the Assets panel's searchable catalog (stock icons/images) independent of user uploads: `search()`, `getGroups()`, favorites/recents, and library `install()`/uninstall. Create one with `createAssetLibraryProvider(...)`.

These are separate concerns: `assetStorage` is "where do a user's uploaded bytes live," `assetLibraryProvider` is "what pre-made catalog can they browse and drop in." A board can have either, both, or neither.

## Default shape & tool set

`Glideboard` boots a `glideline` editor with a fixed core: boxes, frames, groups, text, ellipses, sticky notes, freehand drawing, sanitized SVG, raster images, the full geo-shape family (triangle/diamond/hexagon/star/rounded-rect/parallelogram/chevron/document/cylinder/note/callout), arrows with routing/binding, and asset placement — plus the matching tools and `SelectTool`/`HandTool`/`EraserTool`.

To add your own shape or tool types on top of that default set, pass `customShapes` (a `glideline` `GlidePlugin[]`) — it's a startup-only option, so changing it requires a new `sessionKey`:

```tsx
<Glideboard sessionKey="board-1" customShapes={[myCustomPlugin]} />
```

You cannot currently *remove* shapes/tools from the default set through `Glideboard` — if you need a materially different shape/tool combination, call `createEditor()` from `@durgakiran/glideline` directly instead of using `Glideboard`.

## Other props

- `readOnly` — disables mutation while still rendering the current document.
- `toolbarLayout` — `'split'` (default: separate drawing/action toolbars) or `'vertical'`.
- `pendingSaveOnUnmount` — `'flush'` or `'cancel'` a dirty standalone (non-collaborative) snapshot when the component unmounts.
- `assetResolutionContext` — immutable coordinates used for historical rendering / portable export, distinct from live asset resolution.

## Lower-level: `GlideboardController`

`Glideboard` is a thin React wrapper around `GlideboardController`, which owns the `glideline` editor instance, collaboration attachment, asset import/export, and all the imperative operations above, independent of React. If you're building a non-`Glideboard` UI (a different component tree, or a non-React renderer) on the same collaboration/asset/history semantics, constructing a `GlideboardController` directly — rather than reimplementing that logic against raw `glideline` — is the supported path; see `GlideboardController.ts` and its tests for the full surface (`GlideboardControllerOptions`, `GlideboardDisposeOptions`).

## Re-exported from `glideline`

For convenience, `createSvgPathShape` is re-exported so simple custom shapes don't require a separate `glideline` import. Everything else — `GlidePlugin`, `ShapeUtil`, tool base classes, etc. — comes from `@durgakiran/glideline` directly when building `customShapes`.
