# Whiteboarding Engine: Architectural Reference (Spike 0.0)

This document is the deliverable for **Spike 0.0: Competitive Architectural Analysis**. It deconstructs the technical foundations, interfaces, and algorithms of industry-leading whiteboarding tools (tldraw, Excalidraw, Lucid) and defines the architectural path for **Glideline**.

---

## 1. The Core Reactive Loop (How It All Works)

A whiteboarding engine is fundamentally a **reactive database** driving a **high-performance graphics layer**. Every action—from moving a shape to typing a character—follows this unidirectional data flow:

```
PointerEvent
    │
    ▼
StateNode (Active Tool)
    │  Intercepts event, decides intent (Drag vs. Select vs. Draw)
    ▼
Editor API  (editor.updateShapes / editor.createShapes)
    │  Public command layer — all mutations go through here
    ▼
GlideStore (Reactive Database)
    │  Validates, stores the updated record (JSON)
    │  Fires a fine-grained "signal" ONLY for the changed shape ID
    ▼
React Component (ShapeUtil.render)
    │  Only the affected shape's component re-renders
    ▼
SVG / Canvas Layer (GPU Composite)
    │  Browser paints the updated pixels
    ▼
User sees the result
```

**Key Insight**: Reactivity is *granular*. Moving one shape must not re-render the other 999. This is achieved via "Signals" (atoms that hold individual shape values).

---

## 2. Critical Engine Components (Deep Dive)

### 2.1 The Store — The Reactive Database

The Store is the single source of truth. **It is not a simple object.** It is an in-memory, indexed, reactive database.

**How it works:**
- All data (shapes, pages, camera state, bindings, assets, user presence) is stored as flat JSON records indexed by their ID.
- A "Signal" wraps each record. When a record changes, only subscribers to that specific signal are notified — not the entire tree.
- Internal indices (e.g., `shapesByPageId`, `bindingsByFromShapeId`) are maintained automatically to avoid $O(N)$ scans.

**Key Interfaces:**

```typescript
interface GlideRecord {
  id: RecordId;       // Unique ID (e.g., "shape:abc123")
  type: string;       // The record type (e.g., "geo", "arrow", "page")
  typeName: string;   // Same as type for runtime discrimination
}

interface GlideStore {
  get<T extends GlideRecord>(id: RecordId<T>): T | undefined;
  put(records: GlideRecord[]): void;
  remove(ids: RecordId[]): void;
  has(id: RecordId): boolean;
  query: StoreQueries;    // Reactive queries (e.g., all shapes on current page)
  listen(listener: StoreListener): () => void;  // Subscribe to changes
}
```

**Transactions:**
Multiple mutations (e.g., grouping 100 shapes) are wrapped in a single `transaction`. This ensures:
1. A single Undo/Redo history entry is created.
2. A single network sync diff is emitted, not 100 individual ones.

**Gap Identified**: The spec mentions using `Zod` for validation. **tldraw uses its own `@tldraw/validate` (`T` module)** instead, because Zod's schema structure doesn't integrate with the migration pipeline. For Glideline, we will use **Zod for external API validation** (e.g., MCP inputs) but a **custom validator for store records** to enable schema migration compatibility.

---

### 2.2 The Editor — The Brain & Public API

The Editor is the entry point for all programmatic and UI-driven operations. It sits above the Store and orchestrates everything.

**Responsibilities:**
- **Camera Management**: Maintains `{ x, y, z }` (pan + zoom) state. Calculates the `ViewportBounds` (which world-space region is visible on screen).
- **Selection Management**: Tracks selected shape IDs, calculates the combined bounding box, computes selection handles.
- **Snap Engine**: On every pointer move during a drag, computes snapping points against the grid and other shapes' edges/centers.
- **History Manager**: Manages the Undo/Redo stack. Uses "marks" to batch operations.

**Key Interfaces:**

```typescript
interface GlideEditor {
  // Camera
  camera: Signal<Camera>;
  getViewportBounds(): Box2d;
  screenToWorld(point: Vec2): Vec2;
  worldToScreen(point: Vec2): Vec2;

  // Shapes
  createShapes(shapes: TLShapePartial[]): this;
  updateShapes(shapes: TLShapePartial[]): this;
  deleteShapes(ids: TLShapeId[]): this;
  getShape<T extends TLShape>(id: TLShapeId): T | undefined;
  getShapesAtPoint(point: Vec2): TLShape[];   // Uses R-Tree internally
  getShapesInBounds(box: Box2d): TLShape[];  // Uses R-Tree internally

  // Selection
  selectAll(): this;
  select(...ids: TLShapeId[]): this;
  deselect(...ids: TLShapeId[]): this;
  getSelectedShapes(): TLShape[];

  // Tool
  setCurrentTool(id: string, info?: {}): this;
  getCurrentTool(): StateNode;

  // History
  undo(): this;
  redo(): this;
  batch(fn: () => void): this;
  run(fn: () => void, opts?: { history?: 'ignore' | 'record' }): this;

  // Registration
  registerShapeUtils(utils: GlideShapeUtil<any>[]): void;
  registerTools(tools: typeof StateNode[]): void;
}
```

**`editor.run()` — Critical for MCP/AI**:
When an AI agent uses an MCP tool to modify the canvas, we do NOT want those changes appearing in the user's Undo stack. `editor.run(fn, { history: 'ignore' })` is the mechanism for this.

---

### 2.3 StateNodes — The Hierarchical Interaction Engine

Tools are a **hierarchical finite state machine**. This prevents "logic leaks" where two conflicting interactions (e.g., drawing and dragging) could fire simultaneously.

**How it works:**
- Every tool extends a `StateNode` base class.
- A tool can have **child states**. The active child handles events first.
- Transitions are explicit: `this.parent.transition('dragging')`.

**Full Selection Tool State Tree:**

```
SelectTool (Root)
├── Idle
│   ├── onPointerDown(onShape)  → transition to PointingShape
│   ├── onPointerDown(onCanvas) → transition to PointingCanvas
│   └── onKeyDown('a')         → selectAll
│
├── PointingShape
│   ├── onPointerMove(hasMoved) → transition to Dragging
│   └── onPointerUp            → select shape, transition to Idle
│
├── Dragging
│   ├── onPointerMove          → translate selected shapes
│   ├── onPointerUp            → commit move, transition to Idle
│   └── onKeyDown('Escape')    → cancel move, transition to Idle
│
├── PointingCanvas
│   ├── onPointerMove(hasMoved) → transition to MarqueeSelecting
│   └── onPointerUp            → deselect all, transition to Idle
│
└── MarqueeSelecting
    ├── onPointerMove          → update marquee box, update selection
    └── onPointerUp            → commit selection, transition to Idle
```

**Implementation Pattern (for Glideline):**

```typescript
class SelectTool extends StateNode {
  static id = 'select';
  static children = () => [Idle, PointingShape, Dragging, MarqueeSelecting];
  static initial = 'idle';
}

class Idle extends StateNode {
  static id = 'idle';

  onPointerDown(info: TLPointerEventInfo) {
    if (info.target === 'shape') {
      this.parent.transition('pointingShape', info);
    } else {
      this.parent.transition('pointingCanvas', info);
    }
  }
}
```

**Source**: [tldraw.dev — Custom Tools](https://tldraw.dev/docs/tools)

---

### 2.4 ShapeUtils — The Extensibility Layer

Each shape type (Box, Ellipse, Arrow, Text) is defined by a corresponding `ShapeUtil` class. This is the "plugin interface" for Glideline.

**Full Contract:**

```typescript
abstract class GlideShapeUtil<T extends GlideShape> {
  // Required — defines what type this util handles
  static type: string;

  // Required — the React/SVG component to render the shape
  abstract component(shape: T): React.ReactNode;

  // Required — calculate the axis-aligned bounding box
  abstract getBounds(shape: T): Box2d;

  // Optional (but important) — precise geometric outline for
  // arrow hit-testing and connector attachment
  getGeometry(shape: T): Geometry2d { ... }

  // Optional — SVG output for export pipeline
  toSvg(shape: T, ctx: SvgExportContext): React.ReactElement | null { ... }

  // Optional — handle resize events
  onResize(shape: T, info: ResizeInfo): Partial<T> { ... }

  // Optional — handle double-click (usually enters text editing)
  onDoubleClick(shape: T): void { ... }

  // Optional — can other shapes bind to this one (arrow connections)?
  canBind(args: { fromShapeType: string }): boolean { return true; }

  // Optional — default props when creating a new instance
  getDefaultProps(): T['props'] { ... }
}
```

**Source**: [tldraw.dev — ShapeUtils](https://tldraw.dev/docs/shapes)

---

### 2.5 Bindings — The Relational Layer (Smart Connectors)

Bindings define **persistent relationships** between two shapes. This is how arrows "stay attached" when you move a box.

**How it works:**
1. When you drag an arrow's endpoint to a shape, a `Binding` record is created in the Store.
2. The binding stores: `{ fromId: "shape:arrow1", toId: "shape:box1", props: { normalizedAnchor: { x: 0.5, y: 0.5 } } }`.
3. When `box1` moves or resizes, the store's binding index notifies `arrow1`.
4. A `BindingUtil` hook (`onAfterChangeToShape`) is called on the binding to recompute the arrow's terminal point.

**Key Concepts:**
- **`normalizedAnchor`**: `{ x: 0.5, y: 0.5 }` means "center of target." `{ x: 1.0, y: 0.5 }` means "right edge, middle." This scales perfectly with any resize.
- **`isPrecise`**: `false` = arrow snaps to closest edge point. `true` = arrow hits exact normalized coordinate.
- **Lifecycle Hooks** (`BindingUtil`):
  - `onBeforeCreate`: Validate before a binding is created.
  - `onAfterChangeToShape`: Target moved — update source (arrow) path.
  - `onBeforeDeleteToShape`: Target deleted — detach arrow gracefully.

```typescript
interface GlideBinding {
  id: BindingId;
  type: string;      // e.g., "arrow"
  fromId: ShapeId;   // The arrow
  toId: ShapeId;     // The target box
  props: {
    terminal: 'start' | 'end';
    normalizedAnchor: { x: number; y: number };
    isPrecise: boolean;
    isExact: boolean;
    routeStyle: 'curve' | 'ortho';  // Spike 0.3 decision
    bend: number;                    // curve style: +/- curvature, 0 = straight
  };
}
```

**Edge Identity (Spike 0.3 finding):**
When an arrow binds to a shape, `BindingUtil.onAfterChange` must compute which **named edge** the `normalizedAnchor` is closest to (`"left"` / `"right"` / `"top"` / `"bottom"`). This `fromEdge` / `toEdge` pair drives elbow routing — NOT a float normal vector. Float vectors drift; edge names are unambiguous.

---

### 2.5a Arrow Routing — Tiers & Trade-offs

Three distinct tiers of connector routing exist in the industry. Glideline targets **Tier 2** for Phase 4, with **Tier 3** as a documented future enhancement.

| Tier | Approach | Used by | Obstacle avoidance | Real-time? | Complexity |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1 — Heuristic** | Edge-pair rules. Route between two named edges using fixed topology rules. O(1). | tldraw, draw.io | ❌ No | ✅ Yes | Low |
| **2 — Shape-aware heuristic** | Same as Tier 1 but reads shape bounds + gap to compute midpoints. Cleaner paths. O(1). | tldraw (`elbow`), draw.io advanced | ❌ No | ✅ Yes | Low–Medium |
| **3 — Global pathfinding** | Build orthogonal visibility graph of free space. Run A* with bend-count cost. Post-process with nudging to separate parallel routes. O(N log N) per route. | Lucidchart ("Smart Lines"), yFiles | ✅ Yes | ⚠️ Needs budget | High |

**Glideline Phase 4 target: Tier 2.**
- `"curve"` style: circular arc, 1 `bend` scalar, user-draggable midpoint handle.
- `"ortho"` style: elbow routing — reads `fromBounds`, `toBounds`, `fromEdge`, `toEdge` — computes minimum rectilinear path per edge-pair topology. Falls back to straight if degenerate.
- Does NOT route around obstacles on canvas. Routes may cross other shapes in dense diagrams.

**Lucidchart's Tier 3 difference (for planning awareness):**
Lucidchart builds a visibility graph of all empty horizontal/vertical corridors on canvas, then runs A* minimising `(path_length + bend_count_penalty)`. A final nudging pass separates parallel lines. This is why Lucidchart connectors never pass through shapes and parallel lines stay visually distinct. It runs on every shape move — requires careful frame budgeting. This is a genuine competitive differentiator Lucidchart has. draw.io, tldraw, and Miro do NOT have this.

**When to implement Tier 3:** Only valuable when Glideline targets professional diagramming (ERD, architecture, org-chart) as a primary use case. Phase 6 placeholder added to roadmap.

---

### 2.6 History Manager — Undo/Redo

Undo/Redo in a collaborative whiteboard is non-trivial because remote changes must NOT appear in the local user's history.

**Architecture:**
- The `HistoryManager` records "diffs" (before/after state of changed records) for each user action.
- It uses a concept of **"marks"** and **"batches"**. All changes within a `batch()` call produce one single undo step.
- **Remote changes** from Yjs sync are applied using `editor.run(fn, { history: 'ignore' })`, bypassing the history stack entirely.
- **AI/MCP changes** should similarly use `{ history: 'ignore' }` so they don't pollute the user's undo stack.

**Pattern:**
```
User drags shape → 100 pointer move events → editor.batch() → 1 undo entry
Remote user moves shape → editor.run(..., { history: 'ignore' }) → 0 undo entries
AI agent creates diagram → editor.run(..., { history: 'ignore' }) → 0 undo entries
```

---

### 2.7 Asset Management

Images, videos, and other media are stored as `Asset` records in the Store. Shapes reference these records by `assetId`.

**How it works:**
1. User drops an image → `onDropFiles` handler creates an `Asset` record.
2. An `upload(asset, file)` function sends the file to the backend and returns a URL.
3. An image shape is created referencing `assetId: "asset:img1"`.
4. On render, a `resolve(asset)` function returns the appropriate URL (e.g., thumbnail vs. full-res for export).

**Key interfaces for Glideline:**
```typescript
interface GlideAssetStore {
  upload(asset: TLAsset, file: File): Promise<{ src: string }>;
  resolve(asset: TLAsset, ctx: { screenScale: number }): string | null;
}
```

**Source**: [tldraw.dev — Assets](https://tldraw.dev/docs/assets)

---

### 2.8 Export Pipeline

The export pipeline converts the vector SVG scene to a rasterized image or a standalone SVG file.

**How tldraw does it:**
1. `editor.toImage()` is called with a list of shape IDs.
2. Each shape's `toSvg()` method is called to produce its SVG fragment.
3. All fragments are assembled into one `<svg>` document with embedded fonts and inlined asset data URLs.
4. For PNG: the SVG is drawn onto an `<canvas>` and exported via `canvas.toBlob()`.

**Gap Identified**: The current arch-reference does not cover export. Glideline must implement `toSvg()` in every `ShapeUtil` to enable clean exports.

---

## 3. Advanced Algorithms & Math

### 3.1 World vs. Screen Coordinates

Every point exists in two spaces simultaneously:

- **World Space**: The infinite coordinate plane. A shape can be at `{ x: 15000, y: -3000 }`.
- **Screen Space**: Physical pixels on the user's monitor.

The camera maps between them:
```
ScreenX = (WorldX - Camera.x) * Camera.z
ScreenY = (WorldY - Camera.y) * Camera.z
```
```
WorldX = (ScreenX / Camera.z) + Camera.x
WorldY = (ScreenY / Camera.z) + Camera.y
```

**Floating-Point Precision Warning**: At extreme zoom levels (e.g., 0.001x), subtracting two large world coordinates can lose precision. Glideline must implement **coordinate centering** (subtracting the canvas center before applying zoom) to avoid this.

---

### 3.2 Spatial Indexing (R-Tree / RBush)

**Problem**: On every `onPointerMove`, we need to know "which shape is under the cursor?" Checking all N shapes is $O(N)$ and unacceptably slow at 1,000+ shapes.

**Solution**: An **R-Tree**, specifically the `RBush` library (the same library used by `tldraw v2`).

**How it works:**
- The R-Tree groups shapes into overlapping "bounding rectangles" in a hierarchical tree.
- To find shapes at a point, we traverse the tree, pruning branches whose bounds don't contain the point. This is $O(log N)$.
- The tree is updated incrementally — only the shapes that moved need to be re-inserted.

**Used for:**
- `getShapesAtPoint()` — hover detection
- `getShapesInBounds()` — marquee selection
- Viewport culling — which shapes are in the visible area?

```
npm install rbush
```

**Source**: [github.com/mourner/rbush](https://github.com/mourner/rbush), [tldraw performance blog](https://tldraw.dev/blog/performance)

---

### 3.3 Viewport Culling

Shapes outside the viewport are hidden via `display: none` on their container element. The R-Tree is queried on every pan/zoom event to update the visible set.

**Important**: Because SVG elements still exist in the DOM (just hidden), this is cheaper than unmounting React components on every pan. Component teardown is reserved for **page switches**.

---

### 3.4 Hybrid Rendering: SVG + Canvas

Glideline uses a **two-layer rendering strategy**:

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Content Layer** | SVG/HTML | Shapes, text, images (permanent, accessible, inspectable) |
| **Indicator Layer** | 2D Canvas | Hover outlines, selection boxes, snap guides (ephemeral) |

**Why 2D Canvas for indicators?**
During brush selection over 500 shapes, drawing 500 SVG `<rect>` outlines forces 500 DOM mutations. Drawing 500 rectangles to a single Canvas context is ~25x faster (measured by tldraw team).

**Source**: [tldraw.dev — Performance Blog](https://tldraw.dev/blog/performance)

---

### 3.5 Freehand Path Smoothing

Raw mouse/pointer input is noisy (many redundant points). Two algorithms are applied in sequence:

1. **Ramer-Douglas-Peucker (Simplification)**: Removes points that deviate from the straight line between neighbors by less than an `epsilon` threshold. Reduces a 500-point drag to ~30 key points.
2. **Catmull-Rom Spline (Smoothing)**: Converts the simplified key points into smooth curves by calculating control points automatically.

For the "pressure" effect on stylus/pen input, we also use stroke width modulation based on `PointerEvent.pressure`.

**Library option**: [`perfect-freehand`](https://github.com/steveruizok/perfect-freehand) (MIT License) by the creator of tldraw — we can use this directly.

---

### 3.6 Schema Migration

**Problem**: A canvas saved today may be loaded 2 years from now when the data schema has changed (e.g., a new required property added to a shape).

**How tldraw handles it:**
- Each shape type has a `migrations` array.
- Each migration has an `id`, an `up(props)` function (forward), and a `down(props)` function (backward, for multi-client compatibility).
- On load, the migration runner checks the stored schema version and applies migrations sequentially.

**Glideline's approach:**
```typescript
const boxShapeMigrations = createMigrationSequence({
  sequence: [
    {
      id: 'box_shape/add_corner_radius', // version 1
      up(props) { props.cornerRadius = 0; },
      down(props) { delete props.cornerRadius; }
    }
  ]
});
```

**Gap from Spec (Story 1.2)**: `Zod` will be used only for **external validation** (API inputs, MCP tool parameters). The internal store migration pipeline will use a custom, lightweight migration runner (not Zod) for compatibility with the incremental sync system.

---

## 4. Competitive Audit: Capabilities & Constraints

| Capability | tldraw v2 | Excalidraw | Lucid | Our Glideline Path |
| :--- | :--- | :--- | :--- | :--- |
| **Rendering** | SVG (shapes) + Canvas (indicators) | Pure `<canvas>` | Proprietary Canvas | **Hybrid: SVG + Canvas (same as tldraw v2)** |
| **Spatial Indexing** | R-Tree (RBush) | Brute-force loop | Unknown (likely tree) | **R-Tree (RBush)** |
| **High Density (10k+)** | Good (culling + R-Tree) | Excellent (canvas) | Excellent | **R-Tree + viewport culling** |
| **Custom Interactive Shapes** | Easy (React/HTML) | Hard (canvas-only) | Hard (proprietary) | **SVG/HTML = easy** |
| **Smart Connectors** | Advanced (BindingUtil) | Basic lines | Expert routing | **BindingUtil pattern + normalized anchors** |
| **State Sync** | Yjs (official) | Custom (JSON delta) | Proprietary | **Yjs + tldraw-style per-user undo** |
| **Schema Migrations** | Custom migration runner | None | Unknown | **Custom migration runner (up/down)** |
| **Undo in Multiplayer** | Per-user (local stack) | Global (fragile) | Per-user | **Per-user local stack, remote = history-ignore** |
| **Asset Upload** | `TLAssetStore` interface | Inline base64 | Unknown | **`GlideAssetStore` interface** |
| **Export** | SVG → Canvas → PNG | Canvas → PNG | Unknown | **`toSvg()` in every ShapeUtil** |
| **MCP / AI integration** | Not supported | Not supported | Not supported | **First-class: `editor.run(fn, {history:'ignore'})`** |
| **Extensibility** | Plugin-first | Core-only | API-only | **RegisterShape/Tool API with full lifecycle** |

---

## 5. Glideline Path Decisions (Post-Spike)

Based on this analysis, the following decisions are locked in for Glideline's architecture:

1. **Rendering**: SVG/HTML for shapes. 2D Canvas for indicators (hover, selection, snapping guides).
2. **Spatial Indexing**: `RBush` R-Tree. Updated on every shape create/update/delete.
3. **Reactivity**: Fine-grained signals per shape record. (Library to be finalized in Spike 0.1.)
4. **Tool System**: Hierarchical `StateNode` state machine. All tools extend `StateNode`.
5. **Shape Extensibility**: Abstract `GlideShapeUtil` class. Register via `editor.registerShapeUtils()`.
6. **Connectors**: `Binding` records with `normalizedAnchor`. `BindingUtil` for lifecycle.
7. **Undo/Redo**: Per-user local history stack. AI/MCP mutations use `{ history: 'ignore' }`.
8. **Schema Migrations**: Custom `up()`/`down()` migration runner (not Zod).
9. **Validation**: Zod for external/MCP inputs. Custom validators for store records.
10. **Freehand**: `perfect-freehand` library (MIT) for stroke smoothing and pressure.
11. **Collaboration**: Yjs as the CRDT layer. Remote changes bypass local history.

---

## 6. Gaps Resolution Status

| Gap | Spike | Status | Decision |
| :--- | :--- | :--- | :--- |
| Which signals library? | Spike 0.1 | ✅ **Resolved** | **`@preact/signals`** — passes isolation + batch; battle-tested; ownership risk of custom map outweighs 5× speed margin (both << 16ms at realistic counts). See `spikes/spike-0.1-reactivity/RESULTS.md`. |
| RBush vs custom R-Tree? | Spike 0.2 | ✅ **Resolved** | **`RBush`** — only candidate passing 60fps at 10k on both uniform and clustered data. Quadtree drag tick = 51ms at 10k (3× over budget). See `spikes/spike-0.2-spatial/RESULTS.md`. |
| Exact arrow routing algorithm? | Spike 0.3 | ✅ **Resolved** | **`arc` + `elbow`** (revised from initial bezier+manhattan). `"curve"` style = circular arc with 1 user-draggable `bend` scalar. `"ortho"` style = elbow routing driven by named edge identity (`"left"/"right"/"top"/"bottom"`), not normal vectors — unambiguous, shape-geometry-aware, correct by construction. Normal-vector routing (bezier/manhattan) rejected: float fragility + no user edit handle. See `spikes/spike-0.3-routing/RESULTS.md`. |
| Plugin registration API surface? | Spike 0.4 | ✅ **Resolved** | **`GlidePlugin { shapes, bindings, tools }`** — unit of registration. `ShapeUtil<S>` generic-typed. `BindingUtil<B>` with `onAfterChangeToShape` / `onBeforeDeleteToShape`. `StateNode` FSM with typed child transitions. 10/10 validation tests pass. Custom shape in 8 lines. API surface frozen in `spikes/spike-0.4-api/types.ts`. |

---

## 7. References & Technical Sources

| Topic | Source |
| :--- | :--- |
| TLStore, TLSchema, Bindings | [tldraw.dev Docs](https://tldraw.dev/docs) |
| R-Tree / Performance Blog | [tldraw.dev — Performance](https://tldraw.dev/blog/performance) |
| StateNode / Custom Tools | [tldraw.dev — Tools](https://tldraw.dev/docs/tools) |
| Asset Management | [tldraw.dev — Assets](https://tldraw.dev/docs/assets) |
| Export Pipeline | [tldraw.dev — Export](https://tldraw.dev/docs/export) |
| Schema Migrations | [tldraw.dev — Migrations](https://tldraw.dev/docs/migrations) |
| Yjs / Multiplayer Undo | [yjs.dev](https://docs.yjs.dev) |
| RBush R-Tree Library | [github.com/mourner/rbush](https://github.com/mourner/rbush) |
| Excalidraw Canvas Architecture | [blog.excalidraw.com](https://blog.excalidraw.com) |
| Infinite Canvas Patterns | [infinitecanvas.cc](https://infinitecanvas.cc) |
| Freehand Stroke Smoothing | [perfect-freehand (MIT)](https://github.com/steveruizok/perfect-freehand) |
| Rough.js (Sketchy Rendering) | [roughjs.com](https://roughjs.com) |
