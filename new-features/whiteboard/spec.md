# Glideline: Technical Specification — Index

**Package**: `packages/glideline` | **Status**: Phase 0 complete, Phase 1 ready to start.

> Each phase has its own detailed spec file with stories, acceptance criteria, and test cases.
> This file is the overview and decision log. Do not add story detail here.

---

## Phase Files

| Phase | File | Status | Stories |
| :--- | :--- | :--- | :--- |
| **0** — Architecture Spikes | This file §Phase 0 | ✅ All done | 5 spikes |
| **1** — Reactive Foundation | [spec-phase-1.md](./spec-phase-1.md) | 🔲 Ready | 1.1 Store · 1.2 Validators · 1.3 Migrations |
| **2** — Geometry & ShapeUtil | [spec-phase-2.md](./spec-phase-2.md) | 🔲 Blocked on P1 | 2.1 Camera · 2.2 Plugin System · 2.3 Built-in Shapes · 2.4 Spatial Index |
| **3** — Tools & Editor | [spec-phase-3.md](./spec-phase-3.md) | 🔲 Blocked on P2 | 3.1 FSM · 3.2 SelectTool · 3.3 BoxTool · 3.4 History |
| **4** — Bindings & Routing | [spec-phase-4.md](./spec-phase-4.md) | 🔲 Blocked on P3 | 4.1 BindingUtil · 4.2 Arc Router · 4.3 Elbow Router · 4.4 ArrowPlugin |
| **5** — Rendering & Perf | [spec-phase-5.md](./spec-phase-5.md) | 🔲 Blocked on P4 | 5.1 SVG Layer · 5.2 Canvas Indicators · 5.3 Export |
| **6** — Advanced Routing + MCP | [spec-phase-6.md](./spec-phase-6.md) | 🔲 Optional / Future | 6.1 A* Routing · ∞.1 AI Context · ∞.2 MCP Tools |

---

## Phase 0: Architecture Spikes ✅

### Spike 0.0: Competitive Analysis [DONE]
Analysis of tldraw, Excalidraw, Lucidchart architecture.
See: `new-features/whiteboard/arch-reference.md`

### Spike 0.1: Reactivity & Store [DONE]
- Jotai disqualified: no batch API.
- **Decision: `@preact/signals`** — isolation ✅, batch ✅, 12ms/10k, maintained, no ownership risk.
See: `spikes/spike-0.1-reactivity/RESULTS.md`

### Spike 0.2: Spatial Indexing [DONE]
- Brute-force: 9ms point query at 10k — fails 60fps.
- Quadtree: 51ms drag-tick at 10k clustered — 3× over budget.
- **Decision: RBush** — ≤0.14ms point, ≤3.4ms drag-tick at 10k on all distributions.
See: `spikes/spike-0.2-spatial/RESULTS.md`

### Spike 0.3: Arrow Routing [DONE]
- Bezier rejected: no user handle, overshoots at short distances.
- Manhattan rejected: float normal drift, U-bend bug found in spike.
- **Decision: Arc (`"curve"`) + Elbow (`"ortho"`)** — tldraw production-validated. Edge identity (named `"left"/"right"/"top"/"bottom"`) not float normals.
See: `spikes/spike-0.3-routing/RESULTS.md`

### Spike 0.4: Plugin API [DONE]
- **Decision: `ShapeUtil` abstract class** with `static type`, `static props`, `static migrations`.
- `GlidePlugin { shapes, bindings, tools }` as registration unit.
- 10/10 validation tests pass. Custom shape in 8 lines.
- `editor.batch(label, fn, { history: 'ignore' })` confirmed for AI/MCP.
See: `spikes/spike-0.4-api/types.ts`, `spikes/spike-0.4-api/migrations.test.ts`

---

## Key Architecture Decisions (locked)

| Decision | Choice | Spike |
| :--- | :--- | :--- |
| Reactivity | `@preact/signals` | 0.1 |
| Spatial index | `RBush` | 0.2 |
| Arrow routing | Arc + Elbow (Tier 2) | 0.3 |
| Plugin API | `ShapeUtil` abstract class | 0.4 |
| Prop validation (store) | `T` system (custom, O(1)) | 0.4 revised |
| Prop validation (MCP/API) | Zod | Design |
| Migrations | `defineMigrations()` co-located on ShapeUtil | 0.4 revised |
| Rendering | SVG (shapes) + Canvas (indicators) | Arch analysis |
| Collaboration | Yjs | Arch analysis |
| AI/MCP history | `{ history: 'ignore' }` on all mutations | Design |

---

## Design Documents

| Document | Location |
| :--- | :--- |
| High-Level Design | `new-features/whiteboard/hld.md` |
| Low-Level Design | `new-features/whiteboard/lld.md` |
| Architectural Reference | `new-features/whiteboard/arch-reference.md` |
| Roadmap | `new-features/whiteboard/roadmap.md` |
