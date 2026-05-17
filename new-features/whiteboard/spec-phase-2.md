# Phase 2: Geometry & Shape Utility System

**Goal**: Define how shapes are positioned, bounded, hit-tested, and rendered.
**Output**: `camera.ts`, `ShapeUtil` abstract class, RBush integration, `BoxPlugin`, `TextPlugin`, `FramePlugin`.
**Reference**: HLD §3.3–3.4, LLD §5–6.

---

## Story 2.1: Coordinate Engine & Camera

**Summary**: Implement camera state and `screenToPage`/`pageToScreen` transforms that power the infinite canvas.

**Description**: Shapes exist in infinite *page space*. Camera `{ x, y, z }` maps page to screen. At extreme zoom (< 0.01×) naïve coordinate subtraction loses precision — coordinate centering (subtract viewport center before zoom) prevents drift. Camera is a `@preact/signals` signal.

**Acceptance Criteria**:
- `pageToScreen(screenToPage(pt))` round-trips with < 0.001px error
- Zoom is clamped to [0.1, 8.0]
- Camera signal fires exactly once per `setCamera()` call
- `getViewportBounds()` returns correct `Box2d` for current camera + window size
- Coordinate centering prevents > 0.1px drift at zoom 0.001

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T2.1-01 | Round-trip precision | Camera `{x:100,y:50,z:2}`. Arbitrary page point → `pageToScreen` → `screenToPage`. Error < 0.001. |
| T2.1-02 | Zoom clamped low | `setCamera({z:0.001})`. Assert `getCamera().z === 0.1`. |
| T2.1-03 | Zoom clamped high | `setCamera({z:100})`. Assert `getCamera().z === 8.0`. |
| T2.1-04 | Camera signal once | Subscribe. `setCamera({z:2})`. Assert called exactly once. |
| T2.1-05 | Viewport bounds correct | Camera `{x:0,y:0,z:1}`, window 1000×600. `getViewportBounds()` → `{x:0,y:0,w:1000,h:600}`. |
| T2.1-06 | Precision at extreme zoom | z=0.001, shape at (1e6,1e6). Round-trip error < 0.1 page units. |

---

## Story 2.2: ShapeUtil Abstract Class & Plugin System

**Summary**: Implement the `ShapeUtil`/`BindingUtil` abstract classes, `GlidePlugin` registration, and `createEditor()` boot sequence.

**Description**: `ShapeUtil` is an abstract class with static `type`, `props` validators, and optional `migrations` — all co-located. `createEditor({ plugins })` installs all plugins, bakes validators into `GlideSchema`, and freezes the schema. No dynamic registration after init.

**Acceptance Criteria**:
- `createEditor({ plugins: [BoxPlugin, ArrowPlugin] })` completes without error
- `editor.getShapeUtil(shape)` resolves correct util by `shape.type`
- Unknown type throws with message identifying the type
- Duplicate `type` across two plugins throws conflict at registration
- `ShapeUtil.editor` is injected and accessible inside instance methods
- Schema is frozen after `createEditor()` — late `registerShapeUtil()` throws

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T2.2-01 | Two plugins, no conflict | `createEditor({plugins:[BoxPlugin,ArrowPlugin]})`. No throw. Both resolvable. |
| T2.2-02 | Duplicate type throws | Two plugins both `type="box"`. `createEditor()` → throws `/duplicate/`. |
| T2.2-03 | Unknown type error message | `editor.getShapeUtil({type:"triangle"})` → throws containing `"triangle"`. |
| T2.2-04 | Editor injected into util | `BoxUtil.component()` can access `this.editor.getSelectedShapeIds()`. |
| T2.2-05 | Custom shape ≤ 50 lines | Diamond ShapeUtil inline. Register. Resolve. Count source lines < 50. |
| T2.2-06 | Schema frozen after init | Post-`createEditor`, call `registerShapeUtil(New)` → throws. |

---

## Story 2.3: Built-in Shapes — Box, Text, Frame

**Summary**: Implement `BoxPlugin`, `TextPlugin`, and `FramePlugin` as the first production shape utilities.

**Description**: `BoxPlugin` is a rectangle with label and corner radius. `TextPlugin` auto-sizes to content. `FramePlugin` is a container (`canContain()` = true). Each implements `static props`, `static migrations` (v1), `getGeometry()`, `component()`, `indicator()`, and `toSvg()`.

**Acceptance Criteria**:
- `BoxUtil.getGeometry(shape)` returns correct `minX/maxX/minY/maxY`
- `BoxUtil.hitTestPoint` returns true for interior, false for exterior
- `FrameUtil.canContain()` returns true; `BoxUtil.canContain()` returns false
- All three implement `toSvg()` returning a valid `SVGElement`
- All three define `static migrations` with `currentVersion: 1`
- `store.put([{...box, props:{w:"bad"}}])` throws before write

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T2.3-01 | Geometry bounds correct | Box `{x:50,y:100,props:{w:200,h:150}}`. Assert `minX:50, maxX:250, minY:100, maxY:250`. |
| T2.3-02 | HitTestPoint AABB | Box at (0,0) 100×100. `hitTestPoint({x:50,y:50})` → true. `{x:200}` → false. |
| T2.3-03 | Frame canContain | `FrameUtil.canContain(frame)` → true. `BoxUtil.canContain(box)` → false. |
| T2.3-04 | toSvg returns SVGElement | `BoxUtil.toSvg(shape, ctx)` → instanceof SVGElement with correct dimensions. |
| T2.3-05 | Default props | `BoxUtil.getDefaultProps()`: `w===120`, `h===80`, `cornerRadius===0`. |
| T2.3-06 | Prop validation on put | `store.put([{...box, props:{w:"bad"}}])` → throws. Store unchanged. |

---

## Story 2.4: Spatial Index Integration (RBush)

**Summary**: Wire RBush into GlideStore for O(log N) point and bounds queries at all times.

**Description**: RBush is maintained inside `GlideStore`. On every `put()`, affected shapes are removed then re-inserted with updated bounding boxes. `getShapesAtPoint()` and `getShapesInBox()` query the tree. Drag-tick (remove+insert 1 shape at 10k) must stay < 4ms per Spike 0.2 baseline.

**Acceptance Criteria**:
- `getShapesAtPoint(pt)` returns all shapes geometrically containing the point
- `getShapesInBox(box)` returns all shapes whose AABB intersects the box
- After move, shape is findable at new position, not old
- After delete, shape absent from all queries
- At 10k shapes: `getShapesAtPoint` < 0.2ms; drag-tick < 4ms

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T2.4-01 | Point query finds shape | Shape at (100,100) 100×100. `getShapesAtPoint({x:150,y:150})` → returns shape. |
| T2.4-02 | Point outside returns empty | Same shape. `getShapesAtPoint({x:300,y:300})` → []. |
| T2.4-03 | Index updated after move | Move shape to (500,500). Old position query → []. New position → returns shape. |
| T2.4-04 | Index cleared after delete | Delete shape. `getShapesAtPoint` at old position → []. |
| T2.4-05 | Query perf at 10k | 10,000 shapes. `getShapesAtPoint` time < 0.2ms. |
| T2.4-06 | Drag-tick perf at 10k | 10,000 shapes. Move 1 (remove+insert). Time < 4ms. |
