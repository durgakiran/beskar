# Phase 5: Rendering & Performance

**Goal**: Deliver a production-grade rendering pipeline that maintains 60fps at 10,000 shapes.
**Output**: SVG content layer, Canvas indicator layer, viewport culling, export pipeline (`toSvg`, `toPng`).
**Reference**: HLD §3.8, LLD §12, §16–17.

---

## Story 5.1: SVG Content Layer & Viewport Culling

**Summary**: Build the React-driven SVG rendering tree with per-shape signal subscriptions and viewport culling via RBush.

**Description**: The content layer is an `<svg>` with a single `<g transform="camera-matrix">` applying the camera transform once. Inside it, one `<ShapeComponent>` per visible shape subscribes to that shape's individual signal — so only the changed shape re-renders. Shapes outside the viewport receive `display: none` on their `<g>` wrapper (NOT unmounted — unmounting is reserved for page switches). The visible set is recalculated on every pan/zoom via `getShapesInViewport()`.

**Acceptance Criteria**:
- Moving one shape triggers re-render of only that shape's component (others' render count unchanged)
- Shapes outside the current viewport have `display: none` on their container element
- Shapes that scroll into viewport become visible within one animation frame
- At 10,000 shapes with 100 visible, pan performance stays < 16ms/frame
- Camera transform is applied once on the root `<g>`, not per-shape
- Shape components are NOT unmounted on pan/zoom — only on page switch

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T5.1-01 | Signal isolation in render | Spy render on shape A and B. Update shape A props. Assert shape A rendered once, shape B render count unchanged. |
| T5.1-02 | Out-of-viewport hidden | Place 1000 shapes outside camera bounds. Query DOM. Assert `display:none` on all out-of-viewport `<g>` elements. |
| T5.1-03 | Pan reveals shapes | Shapes at (10000,0). Pan camera to x=9900. Assert shapes now `display:block`. |
| T5.1-04 | No unmount on pan | Spy component unmount. Pan canvas 500px. Assert zero unmounts. |
| T5.1-05 | Frame budget at 10k/100 visible | 10,000 shapes, 100 in viewport. Pan 1px. Measure frame time < 16ms. |
| T5.1-06 | Camera transform once | Parse DOM. Root `<g>` has `transform`. Shape `<g>` elements have translate only (no camera baked in). |

---

## Story 5.2: Canvas Indicator Layer

**Summary**: Implement the 2D Canvas overlay that renders selection handles, hover outlines, and snap guides.

**Description**: A `<canvas>` positioned absolutely above the SVG layer is redrawn via `requestAnimationFrame` during active interactions. It renders: selection bounding boxes with 8 resize handles, hover outlines on shape under cursor, and blue snap guide lines when shapes snap during drag. Between interactions the loop is paused (no idle GPU drain). The Canvas approach is ~25× faster than SVG DOM mutations for ephemeral indicator elements.

**Acceptance Criteria**:
- Selected shapes display a bounding box with 8 resize handles (4 corners + 4 edge midpoints)
- Hovering a shape shows its outline in the indicator canvas (not in SVG)
- Snap guide lines appear as blue lines when a dragged shape aligns with another
- The rAF loop only runs during pointer interactions (paused at idle)
- At 500 selected shapes, indicator redraw completes < 4ms
- Resize handle hit-testing uses screen-space coordinates

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T5.2-01 | Selection bounding box drawn | Select shape. Canvas `getImageData` at selection outline coords shows non-transparent pixels. |
| T5.2-02 | 8 handles rendered | Select shape. Assert 8 handle positions drawn on canvas (check image data at each handle center). |
| T5.2-03 | Hover outline on shape | Move pointer over shape. Canvas shows outline at shape bounds. Move off → outline gone. |
| T5.2-04 | Snap guide appears | Drag shape until it aligns with another. Assert blue horizontal or vertical line on canvas. |
| T5.2-05 | RAF paused at idle | No pointer events for 500ms. Assert rAF loop not firing (check frame counter). |
| T5.2-06 | 500 selections < 4ms | Select 500 shapes. Measure canvas redraw time. Assert < 4ms. |

---

## Story 5.3: Export Pipeline — SVG & PNG

**Summary**: Implement `editor.exportToSvg(shapeIds)` and `editor.exportToPng(shapeIds, { scale })` using per-shape `toSvg()`.

**Description**: `exportToSvg` calls `ShapeUtil.toSvg(shape, ctx)` for each requested shape, assembles the fragments into a standalone `<svg>` document with embedded fonts and inlined asset data URLs (so the export is self-contained). `exportToPng` renders the SVG to an offscreen `<canvas>` at the given pixel ratio and returns a `Blob`. The export respects the exact bounding box of the selected shapes, with optional padding.

**Acceptance Criteria**:
- `exportToSvg([id])` returns a string beginning with `<svg` and ending with `</svg>`
- The exported SVG is self-contained (no external font or image references)
- `exportToPng([id], { scale: 2 })` returns a `Blob` of type `image/png`
- The PNG pixel dimensions equal the shape bounding box dimensions × scale
- Assets (images) are inlined as data URLs in both SVG and PNG exports
- Shapes outside the `shapeIds` list do not appear in the export
- `toSvg()` returning `null` for a shape gracefully skips that shape

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T5.3-01 | SVG output valid | `exportToSvg([boxId])`. Parse result with `DOMParser`. Assert no parse errors. |
| T5.3-02 | SVG self-contained | Assert exported SVG string contains no `href` pointing to external URLs. |
| T5.3-03 | PNG is correct type | `exportToPng([boxId], {scale:1})` → Blob. `blob.type === "image/png"`. |
| T5.3-04 | PNG dimensions at scale:2 | Box 100×80. `exportToPng([boxId], {scale:2})` → PNG 200×160px. |
| T5.3-05 | Non-selected shapes absent | Place shapes A and B. `exportToSvg([A.id])`. Assert B's ID not in output string. |
| T5.3-06 | toSvg null handled | Register ShapeUtil with `toSvg = () => null`. `exportToSvg([id])` → no crash, shape skipped. |
