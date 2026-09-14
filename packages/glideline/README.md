# @durgakiran/glideline

A headless, framework-agnostic canvas engine: a record store, a shape/binding schema system, a state-machine-driven tool layer, undo/redo history, arrow routing/bindings, and a plugin system for adding custom shapes and tools. It has no rendering layer of its own — [`@durgakiran/glideboard`](../glideboard/README.md) is a React UI built on top of it, but you can drive `glideline` directly to build a different UI (canvas/SVG renderer, non-React framework, headless automation) on top of the same document model.

> **Status:** `0.0.x-alpha`. The API is functional and exercised by an internal React consumer, but is not yet stability-guaranteed — expect breaking changes between alpha versions.

## Install

```bash
npm install @durgakiran/glideline
```

Peer requirements: none — this package is pure TypeScript with no DOM or framework dependency.

## Core concepts

| Concept | What it is |
|---|---|
| **Record** | The atomic unit of persisted state: a `GlideShape`, `GlideBinding`, `GlidePage`, or `GlideAsset`. All records share `id`, `type`, `meta`, and (for shapes/bindings) `props`. |
| **`GlideSchema`** | Registers which shape/binding types exist, their prop validators, and their migrations. Built once, then frozen — no further registration after an editor boots. |
| **`GlideStore`** | The reactive record store. Backed by [`@preact/signals`](https://preactjs.com/guide/v10/signals/), so any UI (or headless subscriber) can react to individual record changes without a virtual DOM. |
| **`GlideEditor`** | The public API surface — "all mutations flow through it." Wraps the store, history, tools, camera, bindings, and asset resolution behind one object. Created via `createEditor()`. |
| **`GlidePlugin`** | The unit of extension: a bundle of `ShapeUtil`/`BindingUtil` classes and `StateNode` tool classes, installed at editor-creation time. |
| **`ShapeUtil` / `BindingUtil`** | One per record type. Defines geometry, rendering hooks, resize/rotate behavior, and prop validation for a shape or binding type. |
| **`StateNode`** | A hierarchical finite-state-machine node. Tools (`SelectTool`, `BoxTool`, `ArrowTool`, ...) are `StateNode` subclasses; `GlideEditor` dispatches pointer/keyboard events into whichever tool is active. |

## Quick start: a headless editor

```ts
import {
  createEditor,
  BoxUtil,      // if you're composing your own shape set, see "Shapes" below
  SelectTool,
  BoxTool,
} from '@durgakiran/glideline';

const CoreShapesPlugin = {
  id: 'my-app-shapes',
  shapes: [BoxUtil],
};

const editor = createEditor({
  plugins: [CoreShapesPlugin],
  tools: [SelectTool, BoxTool],
  viewport: { width: 1024, height: 768 },
});

// Mutations go through the editor, not the store directly.
editor.createShape({ type: 'box', x: 100, y: 100, props: { w: 200, h: 120 } });

editor.setCurrentTool('select');
editor.selectAll();

// Undo/redo is built in.
editor.undo();
editor.redo();

// Serialize to a plain, JSON-safe document.
const doc = editor.serialize();
```

`createEditor()` runs a fixed boot sequence: build the schema from your plugins' shapes/bindings (throwing on duplicate types), freeze it, construct the store, camera, and editor, then call each plugin's `onInstall(editor)`. This means **all shape/binding types must be known up front** — there's no dynamic registration after boot. To change the plugin set, create a new editor.

Note: `glideline` ships a full library of shape utils and tools (boxes, frames, groups, text, sticky notes, freehand, geometric shapes, arrows, raster/SVG assets — see below), but `createEditor()` itself starts with nothing installed. You choose which subset to register via `plugins`. `@durgakiran/glideboard`'s `createGlideboardEditorInstance()` (re-exported indirectly through the `Glideboard` component) shows the "batteries-included" combination glideboard ships with, and is a good reference for building your own plugin set.

## Reactivity

`GlideStore` exposes a `@preact/signals` signal per record via `store.getSignal(id)`. Subscribe with `effect()` from `@preact/signals`, or read `.peek()` for a one-off value. This is how `glideboard`'s React layer re-renders individual shapes without diffing the whole document — any UI you build on `glideline` can use the same pattern, or ignore signals entirely and just call `editor.serialize()` after mutations.

## API by subsystem

### Records, schema, store
- `sid`, `bid`, `pid`, `aid` — branded-ID constructors for shapes/bindings/pages/assets.
- `GlideShape`, `GlideBinding`, `GlidePage`, `GlideAsset`, `BaseRecord`, `AnyRecord`, `GlideDocument` — record and document shapes.
- `GlideSchema`, `DocumentValidationError`, `CURRENT_STORE_VERSION`, `DEFAULT_DOCUMENT_LIMITS` — schema construction and validation.
- `GlideStore`, `AsyncTransactionError`, `TransactionAbortedError`, `TransactionReentryError`, `StoreFatalIntegrityError` — the reactive store and its transaction machinery (`StoreTransaction`, `TransactionOptions`, `ReadonlyGlideStore`, etc.).
- `T` (validators.ts) — the prop-validator builder used when defining a `ShapeUtil`'s `props`.
- `defineMigrations`, `migrateRecord`, `migrateRecordDown` — versioned migrations for shape/binding prop shapes.
- `generateOrderKeysBetween`, `sortShapesByCanonicalOrder`, `getShapeOrderParentId`, etc. — fractional-indexing helpers for parent-scoped sibling ordering (z-order, frame children).

### Editor
- `createEditor(opts)`, `GlideEditor` — the entry point and its instance API: shape/binding CRUD, selection, camera, history, asset resolution, serialize/import, clipboard (`ClipboardPayload`), portable-fragment export/import (cross-document copy-paste), SVG export.
- `GlidePlugin`, `CreateEditorOptions` — the plugin contract and boot options (mutation policy, asset resolver, initial camera/viewport).
- `AlignOperation`, `DistributeAxis`, `MatchSizeOperation`, `FlipAxis`, `TidyLayout` — layout-command types for `editor`'s alignment/distribution operations.

### Tools & interaction (state machine)
- `StateNode` — base FSM node; subclass to build custom tools.
- `SelectTool`, `BoxTool`, `FrameTool`, `EllipseTool`, `TextTool`, `StickyNoteTool`, `DrawTool`, `EraserTool`, `HandTool`, `ArrowTool`, and the geo-shape tools (`TriangleTool`, `DiamondTool`, `HexagonTool`, `StarTool`, `RoundedRectTool`, `ParallelogramTool`, `ChevronTool`, `DocumentTool`, `CylinderTool`, `NoteTool`, `CalloutTool`) — the built-in tool set.
- `AssetPlacementTool`, `AssetPlacementPlugin` — drag-and-drop / paste asset placement.
- `HistoryManager`, `HistoryConflictError` — undo/redo, batching (`BatchOptions`), and optimistic-update conflict detection (`HistoryConflict`, `FieldPrecondition`) for collaborative editing.
- `InteractionManager`, `InteractionConflictError` — in-progress pointer interactions (drag, resize) as a layer above history.
- `SnapManager` — alignment/distance snapping during drag and resize.

### Shapes & bindings
- `ShapeUtil`, `BindingUtil` (base classes) — implement one to define a new shape or binding type.
- Built-in shape utils: `BoxUtil`, `FrameUtil`, `GroupUtil`, `TextUtil`, `EllipseUtil`, `StickyNoteUtil`, `FreehandUtil`, `SanitizedSvgUtil`, `RasterImageUtil`, plus the geo-shape family (`TriangleUtil`, `DiamondUtil`, `HexagonUtil`, `StarUtil`, `RoundedRectUtil`, `ParallelogramUtil`, `ChevronUtil`, `DocumentUtil`, `CylinderUtil`, `NoteUtil`, `CalloutUtil`). Each is paired with a `*Plugin` bundle (e.g. `GeoShapePlugin`, `P1ShapesPlugin`) or is registered individually.
- `ArrowUtil`, `ArrowBindingUtil`, `ArrowPlugin` — arrows as first-class shapes bound to other shapes, plus routing (`computeArcPath`, `computeElbowPath`, `resolveArrowRoute`, `SmartRouterCache`) that keeps arrows attached and routed as bound shapes move.
- `createSvgPathShape` — helper for defining a shape whose geometry is an arbitrary SVG path.

### Content ingress & assets
- `sanitizeSvg`, `createSanitizedSvgAsset`, `prepareRasterAsset`, `validateAssetRecord`, `ContentIngressError` — turning untrusted pasted/uploaded SVG or raster bytes into safe, storable assets.
- `AssetResolver`, `AssetResolutionContext` — the hook an embedding app provides to turn a stored `GlideAsset` reference into a renderable URL (see `glideboard`'s `GlideboardAssetStorage` for a full implementation of this contract).

### Styling
- `TLDRAW_COLORS`, `resolveColor`, `STROKE_WIDTHS`, `FONT_SIZES`, `FONT_FAMILIES`, `STROKE_DASH_ARRAYS`, `FILL_OPACITIES` — the shared style token system used across shape utils.
- `TextEditSessionController` — manages an in-progress rich-text edit session for text-bearing shapes.

### AI / MCP integration
- `buildAIContext` — produces a serializable snapshot of the canvas (shapes, connections) suitable for feeding to an LLM.
- `createCanvasToolServer` and the `*InputSchema` zod schemas — an [MCP](https://modelcontextprotocol.io)-shaped tool server for letting an AI agent create/update/delete shapes and connections, query canvas state, and run layout commands against a live `GlideEditor`.

### Mutation policy
- `MutationPolicy`, `MutationCapability`, `createMutationCapability`, `allowAllMutations`, `MutationPermissionError` — a capability-based gate in front of every mutation, keyed by `MutationOrigin` (e.g. `'local'` vs `'remote'`). This is what lets an embedding app (like `glideboard`'s collaboration layer) restrict which mutations a remote peer is trusted to apply.

## Testing your own plugins

Every built-in shape/tool has a corresponding `*.test.ts` alongside it in `src/` — they're the most reliable worked examples of the `ShapeUtil`/`StateNode` contracts if you're implementing a custom one.
