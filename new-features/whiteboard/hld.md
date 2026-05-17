# Glideline — High-Level Design (HLD)

> **Status**: Post-Spike 0.4. All architectural decisions finalised. Ready for Phase 1 implementation.
> **Package**: `packages/glideline`

---

## 1. System Overview

Glideline is a **headless, plugin-first whiteboard engine** for the Beskar platform. It is not a UI component — it is a reactive data engine with a rendering contract. Consumers wire it to React to produce the visual canvas; plugins extend it with new shape types, tools, and interaction models.

### Goals

| Goal | Target |
| :--- | :--- |
| Performance | 60fps (< 16ms/frame) at 10,000 shapes |
| Extensibility | New shape type registerable in < 50 lines |
| Data durability | Documents saved today open correctly in 5+ years |
| AI-readiness | All canvas mutations exposable as MCP tools |
| Collaboration | Real-time multi-user via Yjs CRDT |

### Non-Goals (Phase 0)

- Full obstacle-avoiding arrow routing (Lucidchart-level A* — Phase 6)
- WebGL/GPU rendering (SVG + Canvas hybrid is sufficient for target density)
- Mobile/touch-first design (pointer events are unified, but mobile UX is Phase 5+)

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Consumer App                             │
│          (React component that mounts <GlideCanvas />)          │
└───────────────────────────┬─────────────────────────────────────┘
                            │ uses
┌───────────────────────────▼─────────────────────────────────────┐
│                       GlideEditor                               │
│   The public API. All mutations flow through here.              │
│   Owns: camera, selection, history, tool dispatch               │
└──────┬────────────┬────────────┬──────────────┬─────────────────┘
       │            │            │              │
┌──────▼──────┐ ┌───▼────┐ ┌────▼────┐ ┌──────▼──────────────────┐
│  GlideStore │ │History │ │ToolFSM  │ │    Plugin Registry       │
│ (Reactive   │ │Manager │ │StateNode│ │  ShapeUtils/BindingUtils  │
│  Database)  │ │        │ │  Tree   │ │  / Tools                 │
└──────┬──────┘ └────────┘ └─────────┘ └──────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────────┐
│                    Reactive Layer (@preact/signals)             │
│  Per-record signals. Only changed shape re-renders.             │
└──────┬──────────────────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────────┐
│              Spatial Index (RBush R-Tree)                       │
│  Updated on every shape create/update/delete.                   │
│  Powers: hit-test, marquee select, viewport culling             │
└──────┬──────────────────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────────┐
│                     Rendering Layer                             │
│   SVG   → Shape content (React-rendered ShapeUtil.component)   │
│  Canvas → Indicators (hover, selection handles, snap guides)   │
└──────┬──────────────────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────────┐
│                  Collaboration (Yjs)                            │
│  Store changes → Yjs Doc → WebSocket → Remote peers            │
│  Remote changes → editor.run(fn, { history: 'ignore' })        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Subsystems

### 3.1 GlideStore — Reactive Database

The store is the single source of truth. It is an in-memory, indexed, reactive database.

**Responsibilities:**
- Hold all canvas records (shapes, bindings, pages, assets, camera) as flat JSON indexed by ID
- Wrap each record in a `@preact/signals` signal — only the changed shape's signal fires on update
- Maintain internal indices (`shapesByPage`, `bindingsByFromShape`) to avoid O(N) scans
- Run prop validators (`ShapeUtil.props`) on every `put()`
- Emit transaction diffs for Yjs sync

**Key invariants:**
- Every `put()` is atomic — either all records are written or none (transaction rollback)
- No record leaves the store without passing its type's prop validators
- Unknown record types are preserved as opaque blobs (never dropped, never crash)

**Technology:** `@preact/signals` (Spike 0.1 decision — only candidate passing isolation + batch tests at 12ms/10k throughput)

### 3.2 GlideEditor — The API Brain

All programmatic and user-driven operations flow through the Editor.

**Responsibilities:**
- **Camera**: `{ x, y, z }` pan+zoom state; `screenToPage()` / `pageToScreen()` transforms
- **Selection**: selected shape IDs, combined bounding box, resize/rotation handles
- **History**: undo/redo stack; `batch(label, fn)` for grouping; `{ history: 'ignore' }` for AI/remote
- **Tool dispatch**: route pointer events to the active `StateNode` root
- **Plugin installation**: bake `ShapeUtil` classes and their validators/migrations into store schema at init

### 3.3 Plugin System

**Unit of extension:** `GlidePlugin { id, shapes, bindings, tools, onInstall }`

A plugin is declared once and installed at editor-init time. Schema is frozen after init — plugins cannot be hot-loaded dynamically (same model as tldraw).

**ShapeUtil** is an **abstract class** with:
- `static type` — unique type string
- `static props` — runtime validator map (`{ w: T.number, h: T.number }`)
- `static migrations` — versioned up/down migrators, co-located with the shape
- Abstract instance methods: `getDefaultProps()`, `getGeometry()`, `component()`, `indicator()`
- Concrete defaults: `hitTestPoint()` (AABB), `canContain()` (false), `onBeforeDelete()` (true)

**Technology decision (Spike 0.4):** 10/10 validation tests. Custom shape in 8 lines.

### 3.4 Spatial Index — RBush

O(log N) point and bounds queries. Updated incrementally (remove+insert) on every shape mutation.

**Used for:** hover detection, marquee selection, viewport culling.

**Technology (Spike 0.2):** RBush. Only candidate < 16ms at 10k shapes on both uniform + clustered data. Quadtree was 51ms — 3× over budget.

### 3.5 Tool System — StateNode FSM

All user interactions are a **hierarchical finite state machine**. Prevents conflicting interactions (e.g., draw + select firing simultaneously).

```
SelectTool (root)
├── Idle → Pointing → Dragging
│                  → MarqueeSelecting
├── PointingShape → Dragging | Idle
└── Dragging → commit → Idle | Escape → cancel → Idle
```

### 3.6 Bindings & Arrow Routing

Bindings define persistent relations between shapes. Arrow stays attached to box on move/resize.

**Routing (Spike 0.3, revised after tldraw source study):**

| Style | Algorithm | Status |
| :--- | :--- | :--- |
| `"curve"` | Circular arc, 1 `bend` scalar, draggable midpoint handle | ✅ Default |
| `"ortho"` | Elbow routing — edge-identity (`"left"/"right"/"top"/"bottom"`) aware | ✅ User-selectable |
| Bezier | Normal-vector control points | ❌ Rejected: no user handle, overshoot |
| Manhattan | Normal-vector routing | ❌ Rejected: float drift, U-bend bug |

**Tier 2 routing:** Shape-aware heuristic, O(1). Does NOT avoid obstacles. Tier 3 (A*, Lucidchart-level) is Phase 6.

**Key:** `fromEdge` computed from `normalizedAnchor` by `BindingUtil.onAfterChange` — NOT stored as a float normal vector.

### 3.7 Schema, Validation & Migrations

**tldraw-inspired, co-located design:**
- `static migrations = defineMigrations({ currentVersion: N, migrators: { N: { up, down } } })` — on the ShapeUtil class
- `static props = { w: T.number }` — runtime validators on every `put()`
- Document envelope: `{ schema: { storeVersion, shapes: { box: 2 } }, records: [...] }`
- Unknown types preserved as opaque blobs on load
- Future records (savedVersion > currentVersion) preserved without crash
- `down()` migrators for backward Yjs peer sync

### 3.8 Rendering Pipeline

**Hybrid two-layer:**

| Layer | Technology | Content |
| :--- | :--- | :--- |
| Content | SVG + React | Shape content — accessible, exported via `toSvg()` |
| Indicator | 2D Canvas | Hover, selection handles, snap guides — ~25× faster than SVG DOM for ephemeral elements |

Viewport culling: `display: none` on out-of-viewport shapes. NOT unmount — too expensive. Components unmount only on page switch.

### 3.9 Collaboration (Yjs)

```
Local action   → editor.batch(label, fn)               → history recorded → Yjs broadcast
Remote action  → editor.run(fn, { history: 'ignore' }) → no history entry
AI/MCP action  → editor.run(fn, { history: 'ignore' }) → no history entry
```

Peer schema negotiation: older peer receives `down()`-migrated records; newer peer ignores unknown fields.

---

## 4. Technology Stack (Locked)

| Component | Choice | Basis |
| :--- | :--- | :--- |
| Reactivity | `@preact/signals` | Spike 0.1 |
| Spatial index | `RBush` | Spike 0.2 |
| Arrow routing | Arc + Elbow (Tier 2) | Spike 0.3 |
| Plugin API | `ShapeUtil` abstract class | Spike 0.4 |
| Migrations | `defineMigrations()` + `T` validators | Spike 0.4 (revised) |
| Rendering | SVG (shapes) + Canvas (indicators) | Arch analysis |
| Collaboration | Yjs | Arch analysis |
| Freehand | `perfect-freehand` (MIT) | Arch analysis |
| External validation | Zod | MCP/API inputs only |
| Language | TypeScript | Branded IDs, generics |

---

## 5. Phase Mapping

| Phase | Subsystem | Key Deliverable |
| :--- | :--- | :--- |
| **0** ✅ | Architecture spikes | All 4 gaps resolved; API types frozen |
| **1** | Store + Schema | `GlideStore`; `defineMigrations`; document envelope; `T` validators |
| **2** | Geometry + ShapeUtil | Coordinate system; camera; first built-in shapes (box, text, image) |
| **3** | Tools + Editor | `SelectTool`, `BoxTool`; history; `batch()` |
| **4** | Bindings | Arc + Elbow routers; `BindingUtil` lifecycle; `ArrowPlugin` |
| **5** | Rendering + Perf | Culling; indicator Canvas; LOD; 60fps validated at 10k |
| **6** | Advanced Routing *(optional)* | A* visibility graph; obstacle avoidance; line nudging |
| **∞** | MCP + AI | Context serialisation; MCP toolset |

---

## 6. Competitive Positioning

| Capability | tldraw | Excalidraw | Lucidchart | **Glideline** |
| :--- | :--- | :--- | :--- | :--- |
| Smart connectors | ✅ | ⚠️ Basic | ✅ Expert | ✅ Phase 4 |
| Custom shapes | ✅ Easy | ❌ Hard | ❌ Hard | ✅ 8 lines |
| Obstacle-avoiding routing | ❌ | ❌ | ✅ | ⏳ Phase 6 |
| Multiplayer undo | ✅ Per-user | ⚠️ Global | ✅ Per-user | ✅ Per-user |
| Schema migrations | ✅ | ❌ | ❓ | ✅ `defineMigrations` |
| AI / MCP | ❌ | ❌ | ❌ | ✅ First-class |
| Plugin system | ✅ | ❌ | ❌ API-only | ✅ `GlidePlugin` |
