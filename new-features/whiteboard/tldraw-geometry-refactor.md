# Tldraw-Style Geometry & Resizing Refactor

## 1. Context & Goal
Currently, our whiteboard engine (Glideline) suffers from mathematical drift and scaling edge-cases during shape manipulation. The selection box sometimes mathematically outgrows or misaligns with the visual rendering bounds due to centralized math in `SelectTool.ts` and absolute-coordinate SVG rendering.

This document outlines an architectural refactor modelled directly on **tldraw**. The goal is to separate local geometry from world positioning, delegate resizing logic down to individual shapes, and guarantee perfectly smooth, artifact-free shape manipulation.

---

## 2. Current Architecture vs. Target Architecture

### Current Limitations (Glideline)
1. **Centralized Resizing:** `SelectTool.ts` attempts to calculate new dimensions for *any* shape. An explicit `if (shape.type === 'arrow')` branch at line 716 is already a sign the approach is breaking down.
2. **Absolute SVG Positioning:** `ShapeUtil.toSvg()` draws elements using absolute canvas coordinates (e.g., `<rect x={shape.x} y={shape.y}>`). Duplicates positioning logic and makes rotation calculations complex.
3. **Primitive Bounds:** `ShapeUtil.getGeometry()` returns a flat `Box2d` object with no collision or math logic.
4. **Broken Arrow Model:** Arrow terminal points are stored as **absolute world-space coordinates**, making `shape.x/y` permanently `0` and meaningless for arrows. This creates permanent special-case branches throughout `SelectTool.ts` and `DraggingRotation`.

### Target Architecture (tldraw approach)
1. **Local Coordinate Space:** Shapes always render relative to `(0, 0)`. Global positioning and rotation are applied entirely via a parent `<g transform="translate(shape.x, shape.y)">` in the DOM layer.
2. **Rich Geometry Primitives:** `getGeometry()` returns `Geometry2d` class instances that encapsulate hit testing and bounding box computation.
3. **Delegated Resizing (`onResize`):** The `SelectTool` computes the raw scale and passes it to `ShapeUtil.onResize(shape, info)`. Each shape handles its own internal changes.
4. **Arrows in local space:** Arrow terminal points are **local offsets from `shape.x/y`**, exactly like tldraw. `shape.x/y` is the world position of the start terminal. This eliminates all arrow special-case branches.

---

## 3. The New Arrow Positioning Model

> **This is the most impactful change in the refactor. Read this section before implementing any phase.**

### The Problem with the Current Model

Currently `props.start.point` and `props.end.point` hold **absolute world-space coordinates**. As a result, `shape.x` and `shape.y` are always `0` for arrows. This has poisoned every tool that manipulates shapes:

- `DraggingRotation._applyRotation()` has a special `if (s.type === 'arrow')` branch that rotates terminal points directly.
- `DraggingResize._applyResize()` has a special `if (shape.type === 'arrow')` branch.
- `ArrowBindingUtil.onAfterChangeToShape()` writes world-space coords into `props.start.point`.
- `DraggingHandle.onPointerMove()` adds world-space deltas to terminal points.

### The New Model (tldraw-style)

Arrow terminal points become **local offsets from `shape.x/y`**:

- `shape.x` / `shape.y` = world position of the **start terminal** (the arrow's anchor in the world).
- `props.start.point` = always `{ x: 0, y: 0 }` (the start is the local origin).
- `props.end.point` = `{ x: dx, y: dy }` — the end terminal's **offset** from the start in local space.

Example: an arrow from world `(100, 50)` to world `(300, 150)` is stored as:
```
shape.x = 100, shape.y = 50
props.start.point = { x: 0, y: 0 }
props.end.point   = { x: 200, y: 100 }
```

The `<g transform="translate(100, 50)">` wrapper in `Canvas.tsx` then handles the world positioning, and `toSvg()` simply draws from `start.point` `(0, 0)` to `end.point` `(200, 100)` — exactly like every other shape.

### Consequences: What Gets Simplified

| Location | Before | After |
|---|---|---|
| `Canvas.tsx` ShapeLayer | `translate(0,0)` no-op for arrows | `translate(shape.x, shape.y)` works correctly |
| `ArrowUtil.toSvg()` | Uses raw world coords | Draws from `(0,0)` to `end.point` local offset |
| `DraggingRotation` | Special `if arrow` branch — rotates both terminal points | Only needs to orbit `shape.x/y` around pivot; also rotate the `end.point` vector |
| `DraggingResize` | Special `if arrow` branch | Handled entirely by `ArrowUtil.onResize()` |
| `ArrowUtil.onResize()` | Hard requirement (world model breaks default) | Scales `shape.x/y` proportionally; scales `end.point` vector by `scaleX/scaleY` |
| `ArrowBindingUtil` | Writes world-space coords to terminal | Writes local offset to `end.point`; sets `shape.x/y` for the start terminal |
| `DraggingHandle` (start) | Adds delta to `props.start.point` world coord | Adds delta to `shape.x/y`; keeps `start.point = {0,0}` |
| `DraggingHandle` (end) | Adds delta to `props.end.point` world coord | Adds delta to `props.end.point` local offset |

### Store Migration Required

> [!WARNING]
> The original document stated "no store migration required." **That is no longer true.** Adopting tldraw's local-coordinate arrow model requires a data migration for all existing `ArrowShape` records in the store.

The migration (arrow schema version bump, e.g. `v3`) must:
1. Read the current world-space `props.start.point`.
2. Set `shape.x = props.start.point.x`, `shape.y = props.start.point.y`.
3. Compute `props.end.point = { x: end.point.x - start.point.x, y: end.point.y - start.point.y }`.
4. Set `props.start.point = { x: 0, y: 0 }`.

---

## 4. Implementation Blueprint

### Phase 1: Local Coordinate Rendering

**`Canvas.tsx` (`ShapeLayer`):** Wrap every shape's SVG output in a `<g>` element that handles world positioning and rotation. Since arrows now have a real `shape.x/y`, this works uniformly for all shape types:

```tsx
// Rotation pivots around the local center (cx - shape.x, cy - shape.y)
// because the translate has already moved the origin to (shape.x, shape.y).
<g transform={`translate(${shape.x}, ${shape.y}) rotate(${angleDeg}, ${cx - shape.x}, ${cy - shape.y})`}>
  <g ref={contentRef} />
</g>
```

The erasing tint overlay at `Canvas.tsx:124-135` currently uses `bounds.minX/minY` for world-space positioning. After Phase 1, since the parent `<g>` has already translated to `(shape.x, shape.y)`, this overlay must change to draw at local coords `x=0, y=0`.

**`ShapeUtil` implementations — `toSvg()` changes:**

| Util | Change |
|---|---|
| `BoxUtil` | `rect x=0, y=0`. Zero out `x/y` in `createTextForeignObject(0, 0, ...)`. |
| `EllipseUtil` | Draw ellipse centred at `(w/2, h/2)` — verify no world-coord leaks. |
| `FrameUtil` | `rect x=0, y=0`. |
| `StickyNoteUtil` | `rect/foreignObject` at `x=0, y=0`. |
| `TextUtil` | `foreignObject` at `x=0, y=0`. |
| `FreehandUtil` | Offset all path points by `-shape.x, -shape.y`. |
| `ArrowUtil` | Draw from `start.point` `(0, 0)` to `end.point` local offset. **No world-space coords.** |

**`ArrowUtil` — add `hideResizeHandles` and `hideRotateHandle`:**

Arrows are resized by dragging their terminal handles, not via the standard resize/rotate UI. Following tldraw:

```typescript
override hideResizeHandles(_shape: ArrowShape): boolean { return true; }
override hideRotateHandle(_shape: ArrowShape): boolean  { return true; }
```

These methods must be added to the `ShapeUtil` base class with a default of `false`, and `Canvas.tsx` / `SelectionLayer.tsx` must check them before rendering those handles.

---

### Phase 2: Rich Geometry Classes (Bounds vs. Outline)

Create a `geometry/` folder inside `packages/glideline/src/`.

#### `Geometry2d` abstract base class

```typescript
export abstract class Geometry2d {
  /** Axis-Aligned Bounding Box — used for selection box, marquee, culling. */
  abstract getBounds(): Box2d;
  /** Exact hit test against point — used for click-selection. */
  abstract hitTestPoint(point: Vec2): boolean;
  /** Precise outline vertices — used for snapping and edge-clicking. */
  abstract getOutline(): Vec2[];
}
```

**`getGeometry()` must remain `abstract` in `ShapeUtil`.** Do not provide a default implementation — a silent `Rectangle2d(0,0,0,0)` fallback would cause newly-added shapes to produce invisible, zero-size selection boxes with no error.

#### Concrete classes

- **`Rectangle2d`**: takes `(x, y, w, h)`. AABB is itself. Outline is 4 corners.
- **`Ellipse2d`**: takes `(cx, cy, rx, ry)`. AABB from radii. Hit test uses the ellipse equation.
- **`Polyline2d`**: takes `Vec2[]`. AABB is min/max of all points. Used for `ArrowUtil` (start + end) and `FreehandUtil`.

#### Call-site sweep — `getGeometry()` return type change

Changing `getGeometry()` from `Box2d` to `Geometry2d` is a **breaking change across 11+ call sites**. Every location that directly accesses `.minX/.minY/.w/.h` must call `.getBounds()` first. Full affected file list:

- `SelectTool.ts` — rotation handle setup (L54–70), resize handle setup (L85–101), `DraggingResize._applyResize()` (L712–754), `DraggingRotation._applyRotation()` (L867)
- `Canvas.tsx` — viewport culling (L72–78), erasing overlay (L124–135), center computation (L109–111)
- `SelectionLayer.tsx` — selection box drawing
- `ArrowUtil.ts` — geometry on bound shapes (L193, L234–236)
- `ArrowBindingUtil.onAfterChangeToShape()` — terminal recompute (L582)
- `editor.ts` — RBush spatial index insertion

Search for all `getGeometry(` usages and update each one before merging Phase 2.

---

### Phase 3: Delegated Resizing

#### `ResizeInfo` interface — replace, not add

`ResizeInfo` is already declared and exported in `SelectTool.ts` (L631–638). **Replace** it with the updated interface and **move it to `ShapeUtil.ts`** to avoid a circular import (shape utilities need to import it):

```typescript
// In ShapeUtil.ts
export interface ResizeInfo<S extends GlideShape = GlideShape> {
  handle: ResizeHandle;
  scaleX: number;
  scaleY: number;
  initialShape: S;
  initialBounds: Box2d;
  /** The fully-computed new selection bounds after handle drag + min-size enforcement.
   *  Passed down so each shape does not need to re-derive its own origin offset. */
  newBounds: Box2d;
}
```

#### `ShapeUtil.onResize()` — concrete default, not optional

```typescript
// Concrete default in ShapeUtil base class.
onResize(shape: S, info: ResizeInfo<S>): Partial<S> {
  const { initialShape, initialBounds: ib, newBounds: nb } = info;
  if (ib.w === 0 || ib.h === 0) return {};
  const relX = (initialShape.x - ib.minX) / ib.w;
  const relY = (initialShape.y - ib.minY) / ib.h;
  const relW = ((initialShape.props as any).w ?? ib.w) / ib.w;
  const relH = ((initialShape.props as any).h ?? ib.h) / ib.h;
  return {
    x: nb.minX + relX * nb.w,
    y: nb.minY + relY * nb.h,
    props: {
      ...(initialShape.props as any),
      w: Math.max(1, relW * nb.w),
      h: Math.max(1, relH * nb.h),
    },
  } as Partial<S>;
}
```

Do **not** make it optional (`onResize?`). An optional method allows shapes without an override to silently skip resizing.

#### `ArrowUtil.onResize()` — with the new local-coordinate model

With arrows now using local coords, `shape.x/y` is real and the default `onResize` correctly repositions the start terminal. The only additional work is scaling the end offset vector:

```typescript
override onResize(shape: ArrowShape, info: ResizeInfo<ArrowShape>): Partial<ArrowShape> {
  // 1. Let the default handle shape.x/y (start terminal world position)
  const base = super.onResize(shape, info) as any;
  // 2. Also scale the end offset vector
  const { scaleX, scaleY, initialShape: arr } = info;
  return {
    ...base,
    props: {
      ...arr.props,
      end: {
        ...arr.props.end,
        point: {
          x: arr.props.end.point.x * scaleX,
          y: arr.props.end.point.y * scaleY,
        },
      },
    },
  };
}
```

The `if (shape.type === 'arrow')` branch in `SelectTool._applyResize()` is **deleted** — it now lives entirely in `ArrowUtil.onResize()`.

#### `SelectTool._applyResize()` after delegation

After delegation, `_applyResize` only:
1. Computes `newBounds` from the drag delta and handle direction.
2. Enforces minimum size and aspect-ratio constraint.
3. Computes `scaleX = newBounds.w / initialBounds.w` and `scaleY = newBounds.h / initialBounds.h`.
4. Calls `util.onResize(shape, { handle, scaleX, scaleY, initialShape, initialBounds, newBounds })` for each shape.
5. Calls `this.editor.updateShape(id, result)`.

#### `DraggingRotation` — simplified arrow branch

With local coords, the rotation of an arrow still needs a small special case: in addition to orbiting `shape.x/y` around the pivot (same as all other shapes), the `end.point` local vector must also be rotated by the delta angle:

```typescript
// In DraggingRotation._applyRotation(), for arrows:
const arr = initS as ArrowShape;
const ep = arr.props.end.point;
const rotatedEnd = {
  x: ep.x * cos - ep.y * sin,
  y: ep.x * sin + ep.y * cos,
};
this.editor.updateShape<ArrowShape>(id, {
  x: newX, y: newY,           // orbited world position
  rotation: initRot + delta,
  props: { ...arr.props, end: { ...arr.props.end, point: rotatedEnd } },
});
```

This is simpler than the current model (which had to rotate two independent world-space points), and re-uses the same `newX/newY` orbit calculation used by all other shapes.

#### `DraggingHandle` — updated for local-coordinate terminals

| Handle | Before | After |
|---|---|---|
| `start` drag | `props.start.point += worldDelta` | `shape.x += worldDelta.x`, `shape.y += worldDelta.y`; `start.point` stays `{0,0}` |
| `end` drag | `props.end.point += worldDelta` | `props.end.point += worldDelta` (already local offset — delta is the same) |
| Bound `start` snap | Writes world-space snapped point to `start.point` | Sets `shape.x/y` to snapped world point; `start.point = {0,0}` |
| Bound `end` snap | Writes world-space snapped point to `end.point` | Writes `snappedWorldPoint - {shape.x, shape.y}` as local offset to `end.point` |

#### `ArrowBindingUtil.onAfterChangeToShape()` — updated for local model

Currently writes a world-space `point` into `props[terminal].point`. After the change:

- **`start` terminal binding:** The snapped world point becomes `shape.x/y`. `props.start.point` stays `{0,0}`. **Also** recompute `props.end.point` as `endWorldPoint - newStartWorldPoint` to keep the end terminal visually stable.
- **`end` terminal binding:** Compute `snappedWorldPoint - {arrow.x, arrow.y}` and write that as the local offset into `props.end.point`.

---

## 5. Migration Strategy

This refactor touches the core rendering and manipulation loops. Develop on a dedicated `refactor/tldraw-geometry` branch.

### Schema Migrations
Arrow records require a **v3 migration** in `ArrowUtil.migrations`. All other shape schemas are unchanged.

### Phase Gate
Phases can be merged independently in order. Phase 3 depends on Phase 2's `Geometry2d` type. Phase 1 can ship without Phase 2. The arrow data migration ships with Phase 1 (when `toSvg` begins using local coords, the data model must already be local).
