# Whiteboarding Engine: Technical Roadmap & Architecture

## Overview
This roadmap details the construction of a custom, high-performance whiteboarding engine from scratch. The architecture is inspired by `tldraw v2` but optimized for **MCP-native** capabilities and highly specialized plugin solutions.

---

## 1. Core Architecture Pillars

### 1.1 Reactive State Engine (`Store`)
The engine requires a high-performance, reactive database to manage the "source of truth".
- **Signals-based Reactivity**: Use a library like `@preact/signals` or a custom atomic state manager to allow UI components to subscribe to specific record changes.
- **Flat Record Storage**: Store all data (Shapes, Bindings, Assets, Pages) in a flat object indexed by ID for $O(1)$ access.
- **Immutable Updates**: All mutations should produce a new state snapshot, facilitating easy Undo/Redo and real-time syncing.
- **Diffing & History**: Implement a transaction log that tracks exactly which properties changed, enabling efficient network propagation.

### 1.2 Schema & Data Evolution (`Schema`)
To ensure long-term stability and flexible data structures:
- **Strict Validation**: Use `Zod` or similar to define and validate every record type.
- **Versioning & Migrations**: Every record type (e.g., `geo` shape) must have a version. Implement a migration runner to transform old persisted data to the latest format.
- **Extensible Registry**: A central registry where plugins can register new shape types, assets, and custom records.

### 1.3 The Editor Controller (`Editor`)
The central API class that orchestrates all interactions.
- **Command API**: High-level methods like `createShapes()`, `updateShapes()`, `deleteShapes()`, `select()`, `zoom()`.
- **Coordinate Management**: Handle screen-to-world transformations, rotation matrices, and camera state.
- **Environment Context**: Track user presence, current tool, and selection state.

---

## 2. Component Implementation Phases

### Phase 1: Foundations (Store & Schema)
*Building the "Database" and "Validation" layer.*
> **Layman's Goal**: The engine now has a "brain" and a "memory." It can remember what you've done, save it securely, and undo mistakes. You won't see much on screen yet, but the foundation is rock solid.

- [ ] **TLStore Implementation**: Reactive store with `put()`, `get()`, `remove()`, and `onUpdate()` hooks.
- [ ] **Transaction Support**: Group multiple updates into a single undo/redo step.
- [ ] **Base Records**: Define core types: `Shape`, `Page`, `Asset` (external files), `Instance` (user-specific state), `Binding`.
- [ ] **Multi-Page Support**: Logic for switching between different canvas contexts and maintaining separate stores or sub-trees.
- [ ] **Migration Engine**: System for handling `v1 -> v2` property changes.

### Phase 2: Extensible Shape System (`ShapeUtil`)
*Defining how shapes look and behave.*
> **Layman's Goal**: The whiteboard comes to life. You can now draw freehand lines, place rectangles, and type text. Everything looks crisp and can be customized with colors and styles.

- [ ] **Abstract ShapeUtil Class**: Define the contract for all shapes:
    - `getBounds(shape)`: Calculate Axis-Aligned Bounding Box (AABB).
    - `getGeometry(shape)`: Detailed geometry for hit testing (lines, curves).
    - `render(shape)`: React component or SVG output.
    - `onResize() / onRotate() / onDrag()`: Specialized interaction logic.
- [ ] **Standard Shapes Library**:
    - `geo`: Rectangle, Ellipse, Triangle, Star.
    - `draw`: Freehand lines with simplification/smoothing algorithms.
    - `text`: Rich text with auto-scaling and alignment.
    - `image / video`: Asset-backed shapes with cropping, uploading, and lazy-loading support.
- [ ] **Asset Management**: A unified service to handle file uploads, URL resolution, and caching for media shapes.

### Phase 3: Interaction & Tooling (`StateNodes`)
*The state machine for user interaction.*
> **Layman's Goal**: You can finally "touch" your drawings. You can click to select, drag to move, and pull corners to resize. It feels like a real drawing app.

- [ ] **Hierarchical State Machine**: Manage complex pointer logic.
    - `Root` -> `Idle` -> `Pointing` -> `Dragging`.
    - `Root` -> `Selection` -> `Resizing`.
- [ ] **Hit Testing Engine**: Implement spatial indexing (R-Tree) for selecting shapes in an infinite canvas.
- [ ] **Transform Engine**: Logic for moving, resizing (centered vs. corner), and rotating single or multiple shapes.
- [ ] **Snapping Logic**: Grid snapping and "Smart Guides" for aligning edges/centers of shapes.

### Phase 4: Relational Engine (`Bindings`)
*Connecting shapes together (Arrows, Lucid-style links).*
> **Layman's Goal**: Shapes become "smart" and aware of each other. Draw an arrow between two boxes — the arrow stays glued to them as you move things around. Curve style looks smooth and natural; ortho style snaps to clean right angles like a flowchart.

- [ ] **Binding Records**: `fromId`, `toId`, `fromEdge`, `toEdge`, `routeStyle`, `bend` props.
- [ ] **Normalized Anchors**: `normalizedAnchor: {x, y}` scales with resize. `BindingUtil.onAfterChange` computes `fromEdge`/`toEdge` from anchor position (not normal vectors).
- [ ] **Arc Router** (`"curve"` style): Circular arc with single `bend` scalar. User drags midpoint handle to adjust curvature. Positive/negative bend = curves opposite directions. `bend=0` = straight line.
- [ ] **Elbow Router** (`"ortho"` style): Shape-geometry-aware rectilinear routing. Reads `fromBounds`, `toBounds`, `fromEdge`, `toEdge`. Computes minimum rectilinear path per edge-pair topology (16 cases). Falls back to straight on degenerate input. **Does NOT avoid obstacles** (Tier 2 — see arch-reference §2.5a).
- [ ] **Binding Lifecycle**: Clean up on shape delete. Detach gracefully (arrow becomes free-floating).

> **Routing scope note**: Phase 4 implements Tier 2 routing (shape-aware heuristic, O(1)). Routes may cross other shapes in dense diagrams. Tier 3 (A* obstacle-avoiding, Lucidchart-level) is Phase 6.

### Phase 5: Rendering & Performance
*Ensuring a "butter smooth" 60fps experience.*
> **Layman's Goal**: The app stays fast and "butter smooth" no matter how big your diagram gets. Zooming in and out feels instant, and there’s no lag even with thousands of shapes.

- [ ] **Hybrid Layered Rendering**:
    - **UI Layer**: (HTML/SVG) Selection handles, menus, cursors.
    - **Interaction Layer**: (SVG) Active drawing, moving shapes.
    - **Content Layer**: (Canvas/WebGL) Static shapes for high performance.
- [ ] **Culling**: Only render shapes within the current viewport. Uses RBush spatial index (Spike 0.2).
- [ ] **LOD (Level of Detail)**: Simplify rendering when zoomed out.

### Phase 6: Advanced Routing — Obstacle Avoidance _(Future / Optional)_
*Lucidchart-level "Smart Lines" — arrows that never cross other shapes.*
> **Layman's Goal**: No matter how crowded your diagram is, arrows will automatically find a clean path around other shapes. Parallel arrows stay visually separate. This is what makes Lucidchart feel "magic" for dense architecture diagrams.

> **Note**: Significant engineering investment. Only prioritise when Glideline targets professional diagramming (ERD, architecture, org-charts) as a primary use case. draw.io, tldraw, and Miro have shipped without this. Lucidchart uses it as a genuine competitive differentiator.

- [ ] **Orthogonal Visibility Graph**: Compute all free horizontal/vertical corridors on canvas. Update incrementally on shape move (avoid full rebuild).
- [ ] **A\* Pathfinder**: Route through visibility graph. Cost = `path_length + (bend_count × penalty)`. Minimises bends for clean routes.
- [ ] **Line Nudging**: Post-process step to separate parallel routes sharing the same corridor by a fixed offset. Prevents overlapping connectors.
- [ ] **Frame Budgeting**: Cap A\* iterations per frame. Defer re-route to next idle frame if over budget. Show stale route during drag, re-route on pointer-up.

---

## 3. MCP & AI Capabilities (The "Beskar" Advantage)


### 3.1 AI-Driven Canvas Manipulation
> **Layman's Goal**: Your whiteboard becomes an "AI assistant." You can tell it to "Create a flowchart for our login process," and it will draw the boxes and arrows for you. It can also "read" your sketches to help you organize your thoughts.
- **Context Serialization**: Export the current viewport as a structured JSON or Markdown tree that an LLM can understand.
- **MCP Toolset**:
    - `create_diagram`: High-level tool for AI to generate entire flowcharts.
    - `inspect_canvas`: Allows AI to "read" what the user has drawn.
    - `modify_shape`: AI can fix alignment, change colors, or update text.
- **Visual Reasoning**: Integration for AI to process screenshots of the canvas and provide feedback or corrections.

### 3.2 specialized Plugin Solutions
The engine should support building specialized apps on top:
- **Mind Map Plugin**: Automatic layout and branch management.
- **Architecture Diagramming**: Specialized "Cloud" shapes (AWS, GCP) and VPC containers.
- **ERD / Database Modeling**: Shapes with fields, types, and relationship lines.

---

## 4. Technical Stack
| Component | Choice | Rationale |
| :--- | :--- | :--- |
| **Language** | TypeScript | Strong typing for complex geometry and state. |
| **Reactivity** | `@preact/signals` | Fine-grained, passes isolation + batch tests. Spike 0.1. |
| **Spatial Index** | `RBush` | Only candidate passing 60fps at 10k shapes. Spike 0.2. |
| **Arrow routing** | Arc + Elbow (Tier 2) | Shape-aware, O(1), production-proven by tldraw. Spike 0.3. |
| **Validation** | Zod (external) + custom (store) | Zod for MCP/API inputs. Custom migration runner for store records. |
| **Rendering** | React + SVG + Canvas | SVG for shapes, Canvas for indicators (hover, selection, snapping). |
| **Sync** | Yjs | Battle-tested CRDT. Remote changes bypass local history. |
| **Math** | Custom | Lightweight geometry library for vectors and matrices. |

---

## 5. Success Metrics
- **Performance**: Support 2,000+ shapes with <16ms frame time.
- **Flexibility**: Register a new custom shape type in under 50 lines of code.
- **MCP Integration**: 100% of editor actions exposed as MCP tools.
- **Polish**: Pixel-perfect selection handles and smooth zooming.
