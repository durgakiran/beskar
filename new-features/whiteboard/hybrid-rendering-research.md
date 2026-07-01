# Hybrid HTML+SVG Rendering — Research Findings

> Captured from architecture exploration session, June 2026.  
> Context: Planning migration from beskar's single-SVG canvas to a hybrid HTML+SVG model (like tldraw v2) to support rich content in shapes.

---

## 1. Why Migrate: The Single-SVG Limitation

Beskar currently renders every shape as a `<g>` element inside one global `<svg>`. This creates three hard constraints:

1. **Text labels require `<foreignObject>`** — cross-browser inconsistent, breaks SVG export if not handled separately.
2. **Editing requires a floating `<textarea>` overlay** — must manually compute screen-space position from world coordinates on every camera change.
3. **Rich HTML content (images, widgets, iframes, dropdowns) is impossible** — SVG has no native HTML embedding that works reliably across browsers and zoom levels.

Apps like Lucidchart and Balsamiq require native HTML inside shapes. Balsamiq's core feature (UI wireframe widgets) is impossible in pure SVG.

---

## 2. The Target Architecture: HTML Div Per Shape

Each shape becomes an absolutely-positioned HTML `<div>` in a dedicated layer. Positioning is via CSS `transform`, not SVG coordinate transforms.

```
<div id="wb-canvas">
  <svg id="wb-bg">                    ← Background grid only
  </svg>

  <div id="wb-shapes">               ← HTML shape layer
    <div class="wb-shape"
         style="position:absolute; left:0; top:0;
                transform: translate(Xpx, Ypx) rotate(Rdeg);
                transform-origin: Cx Cy;
                z-index: N;
                width: Wpx; height: Hpx">

      <!-- Geometry: tiny SVG, 1×1px, overflow:visible -->
      <svg style="overflow:visible; width:1px; height:1px; position:absolute">
        {shape geometry — rect, ellipse, path, polygon}
      </svg>

      <!-- Label: native HTML div for text -->
      <div class="wb-shape-label" contenteditable={isEditing}>
        {label text}
      </div>

    </div>
  </div>

  <svg id="wb-overlay">              ← Selection handles, marquee, binding preview
    <g style="transform: scale(z) translate(-x,-y)">
      ...handles, dashed boxes, anchor dots...
    </g>
  </svg>
</div>
```

### How shape position is computed

```
screenX = (shape.x - camera.x) * camera.z
screenY = (shape.y - camera.y) * camera.z
transform-origin = `${cx * camera.z}px ${cy * camera.z}px`
  where cx = localBounds.minX + localBounds.w / 2
```

---

## 3. The `overflow:visible; width:1px; height:1px` SVG Trick

This is how tldraw handles per-shape SVGs without needing to know the shape's exact pixel size in advance:

- The `<svg>` element is only `1×1px` in the DOM layout.
- All SVG geometry is drawn in **local coordinates** (origin at 0,0), exactly as the `toSvg()` method currently produces.
- `overflow: visible` makes the geometry render visually outside the 1px box.
- The parent `<div>`'s CSS `transform` handles world positioning.

**Key consequence:** `toSvg()` on every ShapeUtil needs **zero changes** to its output. The SVG content is identical. Only the container changes.

---

## 4. How Arrows Work in This Model

Arrows are treated exactly like every other shape — they get a per-shape `<div>` with a `1×1px overflow:visible` SVG inside.

The arrow's start point is `(shape.x, shape.y)`. The end point is stored as a local offset `props.end.point = { x: offsetX, y: offsetY }` relative to the start. So an arrow from `(100,200)` to `(300,350)` has:
- `shape.x=100, shape.y=200`
- `props.end.point = { x:200, y:150 }`

The SVG path `M 0,0 C 50,-30 150,130 200,150` drawn in a `1×1px` SVG at screen position `(100,200)` visually renders as a curve spanning the full world distance. **No special overlay layer needed for arrows.**

### Arrow binding (connections) — unchanged by migration

The binding lifecycle is entirely in `glideline`:
```
shape moves → editor.updateShape() → onAfterChangeToShape(binding)
  → ArrowUtil recomputes terminal from normalizedAnchor against shape bounds
  → arrow endpoint updated to new world position
```
Zero dependency on SVG vs HTML rendering.

### Smart routing (A*) — unchanged by migration

`SmartRouterCache.resolve()` in `smart-router.ts` runs A* on an obstacle visibility graph built from `getGeometry().getBounds()` + `shape.x/y`. It outputs a list of `Vec2` waypoints. These become the SVG path string. Entire pipeline is pure math — rendering-agnostic.

---

## 5. Polygons Don't Need Pure SVG

You don't need a global SVG for polygons (triangle, diamond, hexagon, star). Options:

| Approach | Stroke | Dash pattern | Arbitrary shape | Rich label |
|----------|--------|-------------|-----------------|------------|
| **Inline `<svg>` per shape** (chosen) | ✅ | ✅ | ✅ | ✅ sibling div |
| CSS `clip-path: polygon()` | ❌ outline only | ❌ | ⚠️ | ✅ |
| HTML `<canvas>` per shape | ✅ | ✅ | ✅ | ⚠️ |

Tldraw uses the inline `<svg>` per shape approach. Each shape's `toSvg()` output goes into a dedicated `<svg overflow:visible>` element. Polygons render identically to today — only the container changes.

---

## 6. Method Split: Canvas Rendering vs SVG Export

Since labels move from `<foreignObject>` in SVG to native HTML `<div>`, two separate render paths are needed:

| Method | Purpose | Has `foreignObject`? |
|--------|---------|---------------------|
| `toSvg()` | Interactive canvas rendering — geometry only | ❌ No |
| `toSvgExport()` | SVG/PNG export — full fidelity with text | ✅ Yes |

`toSvgExport()` defaults to calling `toSvg()`, so shapes without labels (arrows, freehand, frame) get the same output from both. Only the 5 label-bearing shapes (`box`, `ellipse`, `geo`, `sticky-note`, `text`) override `toSvgExport()`.

---

## 7. Pattern Fills — Per-Shape `<defs>` Inlining

SVG `url(#pattern-id)` references are **document-scoped**. Each per-shape `<svg>` is a separate SVG document in the browser's view, so patterns defined in `wb-bg` are invisible to shapes in `wb-shapes`.

**Solution:** Any `toSvg()` that uses a fill pattern inlines the `<pattern>` element in a `<defs>` block inside its own `<svg>`, using the shape's ID as a suffix to avoid collisions:

```tsx
// Example: box with "dot" pattern fill
const patternId = `dot-${shape.id}`

const defs = document.createElementNS('...', 'defs')
const pattern = document.createElementNS('...', 'pattern')
pattern.setAttribute('id', patternId)
pattern.setAttribute('width', '12')
pattern.setAttribute('height', '12')
// ... add dot circle child
defs.appendChild(pattern)
g.insertBefore(defs, g.firstChild)

rect.setAttribute('fill', `url(#${patternId})`)
```

Because the `<defs>` is part of the returned `<g>`, it lands inside the correct per-shape `<svg>` document automatically. No cross-document reference issues.

The global `WhiteboardPatterns` component (which defines patterns once in the global SVG) is deleted.

---

## 8. Inline Text Editing: contenteditable

Labels become real HTML `<div>` elements. Editing uses `contenteditable` instead of the current floating `<textarea>` overlay:

**Current flow:**
1. Shape double-clicked → `editingShapeId` set
2. `InlineEditor` component renders a `<textarea>` at screen-computed position
3. On blur → commit text to store

**New flow:**
1. Shape double-clicked → `editingShapeId` set
2. The shape's label `<div>` gets `contenteditable="true"` and auto-focus
3. On blur/Escape/Cmd+Enter → commit `element.textContent` to store

**Why this matters for the future:** A rich text editor (ProseMirror, TipTap, Slate) mounts into a `contenteditable` div. The label div IS the mounting target — no structural change needed when plugging in a rich editor later.

---

## 9. Z-ordering

In the HTML div model, z-ordering is natural CSS `z-index`. Each shape `<div>` gets `z-index` from its index in the `shapeIds` array. Arrows are normal shapes in the same list — no special layer needed.

Bring Forward / Send Backward = reordering the store's shape index (already tracked in the engine). The renderer just uses array position as z-index.

---

## 10. How tldraw Renders Overlays — Canvas 2D, Not SVG

**This is a key research finding that differs from our current plan.**

Tldraw renders ALL overlays (selection handles, marquee, binding hints, snap lines, collaborator cursors) to a **single full-screen HTML `<canvas>`** element using the 2D Canvas API — not SVG, not React DOM.

### Architecture

```
<canvas id="canvas-overlays"
        style="position:absolute; inset:0; pointer-events:none">
```

`CanvasOverlays.tsx` owns this canvas. An `EffectScheduler` re-runs whenever reactive state changes:

```ts
const ctx = canvas.getContext('2d')
ctx.clearRect(0, 0, canvas.width, canvas.height)

// Apply camera transform once
ctx.scale(zoom * dpr, zoom * dpr)
ctx.translate(-camera.x, -camera.y)

// Each overlay util draws into the shared ctx
for (const util of overlayUtils) {
  if (util.isActive()) {
    util.render(ctx, util.getOverlays())
  }
}
```

### `OverlayUtil` — the plugin interface

```ts
abstract class OverlayUtil<T extends TLOverlay> {
  isActive(): boolean               // predicate — when to show
  getOverlays(): T[]                // current overlay data
  getGeometry(o: T): Geometry2d    // for hit-testing (not DOM)
  getCursor(o: T): TLCursorType    // cursor on hover
  render(ctx: CanvasRenderingContext2D, overlays: T[]): void  // draw
}
```

### Selection handles (`SelectionForegroundOverlayUtil`)

Draws to `ctx`:
```ts
ctx.save()
ctx.translate(bounds.x, bounds.y)
ctx.rotate(rotation)
// dashed selection box
ctx.setLineDash([4, 2])
ctx.strokeRect(...)
// corner resize squares
ctx.fillRect(...)
// rotation arc circles
ctx.arc(...)
ctx.restore()
```

### Marquee brush (`BrushOverlayUtil`)

```ts
override render(ctx, overlays) {
  ctx.fillStyle = fillColor
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = strokeColor
  ctx.strokeRect(x, y, w, h)
}
```

### Arrow binding hints (`ArrowBindingHintOverlayUtil`)

Dashed stubs from bound endpoint to user's intended drag position:
```ts
ctx.setLineDash([...])
ctx.beginPath()
ctx.moveTo(...)
ctx.lineTo(...)
ctx.stroke()
// precision dot marker
ctx.arc(...)
ctx.fill()
```

### Hit-testing — geometry-based, not DOM events

Each `OverlayUtil.getGeometry(overlay)` returns a `Geometry2d`. On pointer move, the editor iterates overlay utils sorted by `zIndex` and calls `geom.hitTestPoint(pagePoint)` mathematically. No DOM event listeners on SVG elements.

---

## 11. Our Decision: Keep Overlay SVG for Now

tldraw's Canvas 2D overlay system is a performance optimization that matters at 500+ shapes. For our current scope, the **overlay SVG** approach (our current `SelectionLayer.tsx`) is simpler, already written, and correct.

The Canvas 2D overlay is an independent optimization that can be applied later without touching the shape rendering layer.

**Migration plan decision:**
- ✅ HTML div per shape (migrate now)
- ✅ Per-shape inline SVG for geometry (migrate now)
- ✅ HTML label div + contenteditable (migrate now)
- ✅ Overlay SVG for selection/marquee/binding (keep as-is for now)
- ⬜ Canvas 2D overlays (future optimization, independent concern)

---

## 12. File-Level Impact Summary

| File | Package | Change |
|------|---------|--------|
| `styles.ts` | glideline | Add `LabelProps`, rename foreignObject helper, add `inlinePatternDefs` helper |
| `ShapeUtil.ts` | glideline | Add `getLabelProps()`, `toSvgExport()` to abstract base |
| `BoxUtil.ts` | glideline | `toSvg()` geometry-only; `getLabelProps()`; `toSvgExport()` |
| `EllipseUtil.ts` | glideline | Same as BoxUtil |
| `GeoShapeUtil.ts` | glideline | Same as BoxUtil (Triangle, Diamond, Hexagon, Star) |
| `StickyNoteUtil.ts` | glideline | Same as BoxUtil + background color on label div |
| `TextUtil.ts` | glideline | Empty `toSvg()`; all content in `getLabelProps()` |
| `ArrowUtil.ts` | glideline | **No change** — pure SVG path, no labels |
| `FreehandUtil.ts` | glideline | **No change** — pure SVG path |
| `FrameUtil.ts` | glideline | **No change** — SVG `<text>` label |
| `Canvas.tsx` | glideboard | Major rewrite: new ShapeLayer, new DOM structure, delete InlineEditor & WhiteboardPatterns |
| `SelectionLayer.tsx` | glideboard | Add selection highlight; stays in overlay SVG |
| `WhiteboardApp.tsx` | glideboard | Remove InlineEditor reference |

---

## References

- tldraw `Shape.tsx` — per-shape div container with CSS transform positioning
- tldraw `SVGContainer.tsx` — the `1×1px overflow:visible` SVG wrapper
- tldraw `ArrowShapeUtil.tsx` — arrows as normal shapes with local-coordinate path
- tldraw `CanvasOverlays.tsx` — single HTML canvas for all overlay rendering
- tldraw `OverlayUtil.ts` — abstract base for canvas 2D overlay plugins
- tldraw `SelectionForegroundOverlayUtil.ts` — selection handles via Canvas 2D API
- tldraw `BrushOverlayUtil.ts` — marquee selection rect via Canvas 2D API
- tldraw `ArrowBindingHintOverlayUtil.ts` — binding hint stubs via Canvas 2D API
- beskar `smart-router.ts` — A* implementation, fully rendering-agnostic
- beskar `Canvas.tsx` — current single-SVG rendering, ShapeLayer, InlineEditor
- beskar `SelectionLayer.tsx` — current SVG-based selection handles
