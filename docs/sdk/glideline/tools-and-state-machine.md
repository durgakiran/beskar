# Tools & State Machine

**Package:** `@durgakiran/glideline` · **Stability:** 🔴 Unstable (all APIs on this page)

Tools (the select tool, box tool, arrow tool, ...) are `StateNode` subclasses. `StateNode` is a **hierarchical finite state machine**: "each tool is a root `StateNode` whose children represent discrete sub-states (Idle, Pointing, Dragging, etc.). Events route to the active leaf first; unhandled events bubble up to the parent." (source doc comment) `GlideEditor.dispatchEvent(event)` sends a `GlideEvent` into whichever tool is current.

## `StateNode`

```ts
abstract class StateNode {
  static readonly id: string;                          // must match the key used in transition()
  static children?: () => (typeof StateNode)[];         // first child = initial state

  editor: GlideEditor;                                   // injected during _init()
  parent: StateNode | undefined;                         // undefined for root tools
  current: StateNode;                                    // active child; equals `this` for leaf nodes

  transition(id: string, info?: unknown): void;          // exit current child, enter named child

  onEnter(info?: unknown): void;
  onExit(): void;
  onPointerDown?(e: PointerDownEvent): void;
  onPointerMove?(e: PointerMoveEvent): void;
  onPointerUp?(e: PointerUpEvent): void;
  onPointerCancel?(e: PointerCancelEvent): void;
  onKeyDown?(e: KeyDownEvent): void;
  onDoubleClick?(e: DoubleClickEvent): void;
}
```

- `handleEvent(event)` (internal, called by the editor) dispatches to the matching `on*` handler on `this.current` if one exists; if the leaf doesn't handle it, it's up to the tool's own hierarchy — an unhandled event does **not** automatically retry at the parent unless the node's own `on*` explicitly delegates (see `Idle.onPointerDown` calling `this.parent!.transition(...)` below).
- `transition(id, info)` throws if `id` isn't a registered child of the node it's called on. `info` is passed through to the new state's `onEnter(info)`.
- `_reset()` recursively resets every node back to its first child — used when a tool is deactivated, so re-selecting it always starts clean.

### `GlideEvent`

```ts
type GlideEvent =
  | { type: 'pointerDown'; point: Vec2; shiftKey: boolean; pressure?: number; pointerType?: string; target: 'shape' | 'canvas' | 'handle'; shapeId?: ShapeId; handleId?: string; screenPoint?: Vec2 }
  | { type: 'pointerMove'; point: Vec2; shiftKey?: boolean; altKey?: boolean; pressure?: number; pointerType?: string; screenPoint?: Vec2 }
  | { type: 'pointerUp';   point: Vec2; shiftKey?: boolean; altKey?: boolean; pressure?: number; pointerType?: string; screenPoint?: Vec2 }
  | { type: 'pointerCancel'; ... }   // browser/OS-initiated abort of an in-progress pointer sequence — no guaranteed point
  | { type: 'keyDown'; ... }
  | { type: 'doubleClick'; ... };
```

`point` is always in **page space** (already run through `screenToPage`) — a tool never has to know about the camera. `pointerCancel` matters on trackpads: the OS can disambiguate a fast short drag as a scroll gesture mid-interaction, firing a cancel instead of `pointerUp` — a well-behaved tool commits its in-progress state on cancel rather than losing it (see `BoxTool` below).

## Worked example: `BoxTool`

```
Idle → (pointerDown) → Pointing → (drag past 4px threshold) → Drawing → (pointerUp / pointerCancel) → commit → Idle
```

```ts
class Idle extends StateNode {
  static override readonly id = 'idle';
  override onPointerDown(e: PointerDownEvent): void {
    this.parent!.transition('pointing', e);
  }
}
```

The full `BoxTool` stages the in-progress box under its real, final shape id via `editor.beginHistoryPreview()` / `recordHistoryPreview()` — the same `InteractionManager` preview lifecycle `SelectTool` uses for drag/resize/rotate (see [History & Interaction](./history-and-interaction.md#preview-mode)) — so there's no delete-then-recreate step between the live drag preview and the committed shape. This pattern (preview under the final id, commit on pointer-up-or-cancel, discard on Escape) is the one to follow for a custom drawing tool.

## Built-in tools

`SelectTool`, `BoxTool`, `FrameTool`, `EllipseTool`, `TextTool`, `StickyNoteTool`, `DrawTool`, `EraserTool`, `HandTool`, `ArrowTool` (+ `ArrowIdle`), and the geo-shape family: `TriangleTool`, `DiamondTool`, `HexagonTool`, `StarTool`, `RoundedRectTool`, `ParallelogramTool`, `ChevronTool`, `DocumentTool`, `CylinderTool`, `NoteTool`, `CalloutTool`. Each is a real, if compact, worked example of the FSM pattern — read the one closest to what you're building before writing a custom tool from scratch. `AssetPlacementTool` (paired with `AssetPlacementPlugin`) drives asset drag-and-drop/paste placement.

## Registering a custom tool

Tools are registered at editor construction, alongside shapes/bindings:

```ts
const editor = createEditor({
  plugins: [MyShapesPlugin],
  tools: [SelectTool, BoxTool, MyCustomTool],
});

editor.setCurrentTool('my-custom-tool-id');   // id must match MyCustomTool.id
```

A tool can also be delivered via a `GlidePlugin`'s `tools` field instead of `CreateEditorOptions.tools` — both are merged at boot.

## Related types

`RotationInfo` (from `SelectTool` — resize/rotation handle info), `AssetMaterialization`, `AssetMaterializationRequest`, `AssetMaterializer`, `AssetPlacementCallbacks`, `AssetPlacementSelection`, `RetainedAssetProvenance` (from `AssetPlacementTool`), `SnapSettings`, `SnapGuide`, `SnapTranslationResult`, `SnapDimensionsResult` (from `SnapManager`, used by `SelectTool`/`BoxTool`-family drags for alignment snapping).
