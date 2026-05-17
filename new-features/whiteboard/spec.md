# Glideline: Technical Specification & Story Breakdown

## Phase 0: Architectural Spikes
**Goal**: Research and prototype the hardest parts of the engine before freezing the architecture.

### Spike 0.0: Competitive Architectural Analysis [DONE]
- **Context**: We need to understand the technical foundations, interfaces, and algorithms that power leading tools like tldraw, Excalidraw, and Lucid.
- **Results**: See `new-features/whiteboard/arch-reference.md`.

### Spike 0.1: Reactivity & Store Scalability [DONE]
- **Context**: The store will hold thousands of `GlideRecord` objects. We need to ensure that moving one shape doesn't trigger a re-render of the entire canvas.
- **Results**: See `spikes/spike-0.1-reactivity/RESULTS.md` for full numbers.
  - All 3 candidates (signals, jotai, custom) pass isolation.
  - **Jotai disqualified**: no batch API — fires 100x per subscriber for 100 drag-tick updates.
  - **`@preact/signals`**: passes all tests. 10k throughput: 12ms. Batch: ✅ 1x fire.
  - **Custom atom map**: fastest (10k: 2.3ms). Batch: ✅ 1x fire.
  - **Decision: `@preact/signals`** — both pass all tests; 12ms vs 2.3ms gap irrelevant at realistic shape counts (1–5k, both << 16ms frame budget). Signals is battle-tested, handles computed/effects/cleanup correctly, maintained by Preact team. Custom map ownership risk outweighs marginal speed gain.


### Spike 0.2: Spatial Indexing Performance [DONE]
- **Context**: For an infinite canvas, we need to quickly find which shapes are under the mouse or inside a selection box.
- **Results**: See `spikes/spike-0.2-spatial/RESULTS.md` for full numbers.
  - **Brute-force disqualified**: point query at 10k = 9ms — unacceptable for 60fps hover detection.
  - **Quadtree disqualified**: drag tick at 10k clustered = 51ms — 3× over 16ms frame budget. Remove/insert cost too high.
  - **RBush**: point query ≤0.14ms, bounds query ≤0.17ms, drag tick ≤3.4ms at all counts on both distributions.
  - **Decision: RBush** — only candidate that passes 60fps at 10k on both uniform and clustered data.

### Spike 0.3: Smart Arrow Routing [DONE]
- **Context**: Arrows should ideally avoid passing directly through other shapes.
- **Results**: See `spikes/spike-0.3-routing/RESULTS.md` + `preview.html` for visuals.
  - All 3 prototype routers: <10μs per route — performance is NOT the deciding factor.
  - **Initial decision revised** after studying tldraw's production implementation.
  - **Bezier rejected as default**: auto-computed control points give users no control over curve shape. No user-editable handle. Can overshoot at short distances.
  - **Arc adopted instead**: single `bend` scalar; user drags midpoint handle to adjust curvature. Simpler, more intuitive. Same UX as tldraw, Figma connectors.
  - **Manhattan (ours) rejected**: normal-vector routing is fragile — float precision can misclassify edge direction. U-bend detection required a bug fix during the spike.
  - **Elbow adopted instead**: routing driven by edge identity (`"left"` / `"right"` / `"top"` / `"bottom"`), not normal vectors. Edge identity is unambiguous. Shape-geometry-aware. Correct by construction for all topology cases. Used by tldraw in production.
  - **Final Decision: `"curve"` style = Arc (1 bend scalar) + `"ortho"` style = Elbow (edge-aware orthogonal)**.
  - Key insight: `"manhattan"` in EDA/PCB means full obstacle-avoiding routing (A\*). tldraw's `"elbow"` is shape-aware but NOT obstacle-avoiding — it finds the minimum rectilinear path between two named edges. No O(N) search.

### Spike 0.4: System Architecture & Plugin API [DONE]
- **Context**: We need a standard way for plugins to add new shapes and tools without modifying the core engine.
- **Results**: See `spikes/spike-0.4-api/RESULTS.md`. 10/10 validation tests pass.
  - `ShapeUtil<S>`: typed via generic, requires `type`, `defaultProps`, `getGeometry`, `component`, `indicator`. Optional: `hitTestPoint`, `canContain`, `onBeforeDelete`.
  - `BindingUtil<B>`: `onAfterChangeToShape` recomputes arrow terminal from `normalizedAnchor` (not float normals). `fromEdge` updated to named edge. `onBeforeDeleteToShape` detaches + cleans binding.
  - `StateNode` FSM: `Idle→Pointing→Drawing` transitions work. Escape during Drawing deletes preview shape correctly.
  - `GlidePlugin` registration: two plugins install without conflict. `getShapeUtil()` resolves by type string. Unknown type throws with clear message.
  - **Ergonomics validated**: 3rd-party diamond shape registered and resolved in 8 lines (target was < 50).
  - **`editor.batch(label, fn, opts)`**: `history: 'ignore'` option for AI/MCP actions confirmed in API.
  - **Decision**: API surface is final. Phase 1 implementation starts from `spikes/spike-0.4-api/types.ts`.

---

## Phase 1: The Reactive Foundation (Store & Schema)
**Goal**: Establish the "Source of Truth" with bulletproof validation and performance.

### Story 1.1: Reactive State Container
- **Description**: As a developer, I want a store that can hold thousands of shapes and notify UI components of changes instantly.
- **Tasks**:
    - [ ] Implement `GlideStore` using the library selected in Spike 0.1.
    - [ ] Support `get`, `set`, `update`, and `remove` for records.
    - [ ] Implement a `transaction` wrapper for atomic multi-record updates.
- **Testing**:
    - **Unit**: Verify signal triggers on record update.
    - **Integration**: Ensure transactions rollback correctly on error.

### Story 1.2: Strict Schema, Validation & Migrations
- **Description**: Every shape in the store follows a strictly defined format. Documents saved today must open correctly in 2 years even after shape props change, new shape types are added, or old plugins are absent.
- **Approach**: tldraw-inspired — migrations and runtime validators live **on the `ShapeUtil` class** (static properties), not in a separate registry. The serialised document carries a schema envelope so the loader knows exactly what version each record was saved at.
- **Tasks**:
    - [ ] **Runtime prop validators** on `ShapeUtil`: `static props: GlideProps<S['props']>` — a map of field names to `Validator` instances (e.g. `{ w: T.number, h: T.number, label: T.string }`). Store runs these on every `put()`. Replaces Zod for store records — Zod is too heavy for per-write validation; a custom `T` system does O(1) field checks.
    - [ ] **Co-located migrations** on `ShapeUtil`: `static migrations = defineMigrations({ currentVersion: N, migrators: { N: { up, down } } })`. No separate migration registry — the shape owns its own history.
    - [ ] **`defineMigrations()` helper**: validates that the version sequence is contiguous at startup, returns a typed `GlideMigrations` object.
    - [ ] **Document envelope**: serialised format wraps records with a schema header:
      ```json
      { "schema": { "storeVersion": 1, "shapes": { "box": 2, "arrow": 4 } }, "records": [ ... ] }
      ```
    - [ ] **Migration runner on load**: for each record, compare stored shape version vs `ShapeUtil.migrations.currentVersion`. Run `up()` for each missing step in order.
    - [ ] **Unknown-type preservation**: records whose `type` has no registered `ShapeUtil` are kept as opaque `{ id, type, props }`. Never crash, never drop data. Handles: plugin installed on create but absent on open.
    - [ ] **Forward compatibility**: unknown fields inside a known type's props are preserved as-is. New clients adding fields won't break old clients loading the same doc.
    - [ ] **Collaborative version negotiation** (Yjs): peers exchange schema versions on connect. Older peer runs `down()` migrators before broadcasting. Newer peer ignores unknown fields from older peer (forward compat).
- **Testing**:
    - Unit: `migrate({ type: 'box', version: 1, props: { w: 100 } })` with v1→v2 migrator adds `cornerRadius: 0`.
    - Unit: loading a record with unknown type does not throw, record preserved.
    - Integration: save doc at v1, register v2 migrator, load doc — all records arrive at v2.

---

## Phase 2: Geometry & Shape Utility System
**Goal**: Define how shapes are calculated, rendered, and scaled.

### Story 2.1: The Coordinate Engine
- **Description**: Support an "infinite" canvas where users can zoom and pan anywhere.
- **Tasks**:
    - [ ] Create a `Matrix` math library for 2D transformations.
    - [ ] Implement `screenToWorld` and `worldToScreen` conversion functions.
- **Testing**:
    - **Unit**: Test matrix multiplication and inversion.

### Story 2.2: Shape Utility API
- **Description**: A modular way to add new shapes (Rect, Circle, Arrow) to the engine.
- **Tasks**:
    - [ ] Implement `BoxShapeUtil` and `GeoShapeUtil`.
    - [ ] Implement `render()` method returning optimized SVG.
    - [ ] Implement `getBounds()` for selection logic.

---

## Phase 3: Interaction & Selection
**Goal**: Make the whiteboard "tangible" and easy to use.

### Story 3.1: Selection & Hit-Testing
- **Description**: Users should be able to click on a shape or drag a box to select multiple items.
- **Tasks**:
    - [ ] Implement the spatial indexing strategy selected in Spike 0.2.
    - [ ] Create a `SelectionBox` tool with marquee selection.
- **Testing**:
    - **E2E**: Verify "Click to Select" in Playwright.

### Story 3.2: Transform Engine (Move/Resize)
- **Description**: Drag handles to resize or move shapes with pixel-perfect precision.
- **Tasks**:
    - [ ] Implement `DragHandle` components (8-point resize).
    - [ ] Support aspect-ratio locking during resize.

---

## Phase 4: Relational Engine (Bindings)
**Goal**: Support intelligent links and connectors for diagrams.

### Story 4.1: Smart Arrow Connectors
- **Description**: Arrows that stay "glued" to shapes as they move.
- **Tasks**:
    - [ ] Implement `Binding` record type linking two shape IDs.
    - [ ] Implement `NormalizedAnchor` logic (e.g., center = 0.5, 0.5).
- **Testing**:
    - **Integration**: Move a box and verify its bound arrow updates instantly.

---

## Quality Assurance & Coverage Strategy

### Automated Testing
- **Vitest**: Used for all logic, math, and store operations.
- **Playwright**: Used for interaction tests (dragging, zooming) in a real browser.
- **Coverage**: Every PR must maintain >90% coverage on core geometry and store modules.

### Manual Verification Checklist
1.  **Stress Test**: Create 1,000 shapes and pan the canvas. It must maintain 60fps.
2.  **Undo/Redo**: Perform 20 random operations, then undo all of them.
3.  **Cross-Browser**: Verify rendering and touch input on Chrome, Safari, and Firefox.
4.  **MCP Audit**: Run `glideline_create_shape` via an AI tool and verify it appears instantly.
