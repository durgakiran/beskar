# Phase 4: Bindings & Arrow Routing

**Goal**: Implement persistent shape-to-shape connections with geometry-aware routing.
**Output**: `BindingUtil` abstract class, `ArrowPlugin`, Arc router, Elbow router, `ArrowTool`.
**Reference**: HLD §3.6, LLD §6–7, §10, `spikes/spike-0.3-routing/`.

---

## Story 4.1: BindingUtil & Binding Records

**Summary**: Implement `GlideBinding` records, the `BindingUtil` abstract class, and the store's binding lifecycle hooks.

**Description**: A `GlideBinding` is a store record that relates two shapes (`fromId` → `toId`). The `BindingUtil` abstract class defines lifecycle hooks: `onAfterChangeToShape` is called whenever the target shape moves or resizes, allowing the arrow to recompute its terminal point. `onBeforeDeleteToShape` is called before the target is deleted, allowing the arrow to detach gracefully. Secondary indices (`bindingsByFromShape`, `bindingsByToShape`) make these lookups O(1).

**Acceptance Criteria**:
- `createBinding({ type, fromId, toId, props })` stores the binding and updates secondary indices
- `getBindingsFromShape(id)` returns all bindings where `fromId === id` (O(1) via index)
- `getBindingsToShape(id)` returns all bindings where `toId === id` (O(1) via index)
- Moving the `toId` shape triggers `onAfterChangeToShape` on all bindings pointing to it
- Deleting the `toId` shape triggers `onBeforeDeleteToShape` before deletion
- Deleting the `fromId` shape auto-deletes all bindings from it
- `updateBinding(id, partialProps)` merges into existing props

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T4.1-01 | createBinding indexes correctly | `createBinding({fromId:A, toId:B, ...})`. `getBindingsFromShape(A)` → [binding]. `getBindingsToShape(B)` → [binding]. |
| T4.1-02 | onAfterChangeToShape fires on move | Bind arrow→box. Move box. Assert `onAfterChangeToShape` called with binding and editor. |
| T4.1-03 | onBeforeDeleteToShape fires before delete | Bind arrow→box. Delete box. Assert hook called before box removed from store. |
| T4.1-04 | Detach on target delete | Arrow bound to box. Delete box. Arrow `props.end.boundShapeId === null`. |
| T4.1-05 | fromId delete cascades bindings | Delete arrow shape. `getBindingsFromShape(arrow.id)` → []. Binding gone from store. |
| T4.1-06 | updateBinding merges props | `updateBinding(id, {fromEdge:"right"})`. Full props preserved except `fromEdge`. |

---

## Story 4.2: Arc Router — "curve" Style

**Summary**: Implement the circular arc routing algorithm for `routeStyle: "curve"` arrows.

**Description**: The arc router computes a quadratic Bézier path from start to end using a single `bend` scalar. `bend = 0` is a straight line; `bend = 0.5` is a symmetric arc; negative `bend` curves in the opposite direction. The midpoint handle is the control point the user drags to adjust the curve. At `bend = 0` the path degenerates cleanly to a straight line without any numerical edge case.

**Acceptance Criteria**:
- `computeArcPath(start, end, bend=0)` returns an SVG path string starting with `M` and ending at `end`
- `bend=0` produces the same path as a straight line `M sx sy L ex ey`
- `bend=0.5` produces a symmetric arc curving above the midpoint
- `bend=-0.5` produces the same arc curving below (mirror)
- The control point is perpendicular to the `start→end` line at the midpoint
- Path is valid SVG (parseable by `new Path2D(path)` without error)

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T4.2-01 | bend=0 is straight | `computeArcPath({x:0,y:0},{x:100,y:0}, 0)`. Assert path equals `"M 0 0 L 100 0"` or equivalent Q with coincident control. |
| T4.2-02 | bend=0.5 arcs upward | `computeArcPath({x:0,y:0},{x:100,y:0}, 0.5)`. Parse path. Assert control point y < 0 (above line). |
| T4.2-03 | bend=-0.5 arcs downward | Same endpoints, bend=-0.5. Control point y > 0 (below line). |
| T4.2-04 | Symmetric arcs mirror | bend=0.5 control point is exact mirror of bend=-0.5. |
| T4.2-05 | SVG validity | `new Path2D(computeArcPath(s, e, 0.3))` — no error thrown. |
| T4.2-06 | Diagonal path | `start={x:0,y:0}`, `end={x:100,y:100}`, bend=0.5. Control point perpendicular to diagonal. |

---

## Story 4.3: Elbow Router — "ortho" Style

**Summary**: Implement the edge-identity-aware orthogonal routing algorithm for `routeStyle: "ortho"` arrows.

**Description**: The elbow router computes a rectilinear path from `fromEdge` of `fromBounds` to `toEdge` of `toBounds`. It handles 16 edge-pair topologies (4 from × 4 to). `fromEdge` is computed from `normalizedAnchor` by `BindingUtil.onAfterChangeToShape` — never stored as a float normal. U-bends (`fromEdge === toEdge`) add extra segments to route around. Degenerate cases (overlapping bounds) fall back to a straight line.

**Acceptance Criteria**:
- `computeElbowPath(fromBounds, toBounds, "right", "left")` produces a 3-segment Z-path
- `computeElbowPath(..., "right", "right")` produces a 5-segment U-bend routing around
- `computeElbowPath(..., "right", "top")` produces an L-shaped 2-turn path
- `computeElbowPath(..., "bottom", "top")` produces a vertical Z-path
- When `fromBounds` and `toBounds` overlap, falls back to straight line without crashing
- All output paths are valid SVG (parseable by `new Path2D()`)
- All path segments are axis-aligned (no diagonal lines in ortho output)

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T4.3-01 | right→left produces Z-path | fromBounds at x=0, toBounds at x=300. `computeElbowPath(...,"right","left")`. Assert 3 segments, all axis-aligned. |
| T4.3-02 | right→right U-bend | toBounds to the left of fromBounds. `computeElbowPath(...,"right","right")`. Assert ≥ 5 segments. |
| T4.3-03 | right→top L-shape | `computeElbowPath(...,"right","top")`. Assert exactly 2 turns, axis-aligned. |
| T4.3-04 | Overlap fallback | fromBounds and toBounds identical. `computeElbowPath(...)` → returns straight line, no crash. |
| T4.3-05 | No diagonal segments | Parse output path. Assert all segments are horizontal or vertical only. |
| T4.3-06 | SVG validity | `new Path2D(computeElbowPath(...))` — no error. |

---

## Story 4.4: ArrowPlugin — Full Arrow Shape

**Summary**: Implement `ArrowShape`, `ArrowBindingUtil`, and `ArrowTool` as the built-in connector plugin.

**Description**: `ArrowShape` has typed terminals (`start`, `end`), each with `boundShapeId`, `normalizedAnchor`, and computed `point`. `ArrowBindingUtil.onAfterChangeToShape` recomputes the terminal point from `normalizedAnchor` against the current target bounds and updates `fromEdge` from the anchor position (not a stored float). `ArrowTool` lets users draw arrows by clicking a source shape then clicking a target, creating both the `ArrowShape` and `GlideBinding` records.

**Acceptance Criteria**:
- `ArrowBindingUtil.onAfterChangeToShape` updates `arrow.props.end.point` to center of moved box
- `fromEdge` is recomputed from `normalizedAnchor` — not from a stored normal vector
- Deleting the target box detaches the arrow (terminal `boundShapeId` becomes `null`)
- `ArrowTool` in Idle: hover over a shape highlights its connection points
- `ArrowTool` click-drag from shape A to shape B: creates ArrowShape + 2 bindings
- `ArrowShape.props.routeStyle` defaults to `"curve"`, switchable to `"ortho"`
- Arrow renders correctly for both `"curve"` and `"ortho"` route styles

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T4.4-01 | Terminal updates on box move | Bind arrow end → box at (100,100) 200×100. Move box to (200,200). `arrow.props.end.point` → `{x:300,y:250}` (center). |
| T4.4-02 | fromEdge computed from anchor | Anchor `{x:1.0, y:0.5}` (right edge). After `onAfterChangeToShape`, `binding.props.fromEdge === "right"`. |
| T4.4-03 | Detach on target delete | Arrow bound to box. Delete box. `arrow.props.end.boundShapeId === null`. |
| T4.4-04 | Binding deleted with target | Delete box. `getBindingsToShape(box.id)` → []. |
| T4.4-05 | ArrowTool creates shape+bindings | Click shape A → drag → release on shape B. `store` contains 1 ArrowShape + 2 bindings. |
| T4.4-06 | Route style switch | `updateShape(arrowId, {props:{routeStyle:"ortho"}})`. Rendered path switches to rectilinear. |
