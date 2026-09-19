# Glideboard Shapes — Feature Documentation

**Feature area**: `packages/glideline` + `packages/glideboard`
**Status**: Planning — implementation plan approved, not yet started.
**Owner**: engineering

---

## What this feature adds

1. **7 new P1 engineering diagram shapes** — covering Flowchart (ISO 5807), BPMN 2.0, UML, and C4/Architecture diagrams.
2. **`BasePathShapeUtil`** — a new abstract base class for SVG `<path d=...>` based shapes, parallel to the existing `BaseGeoShapeUtil` for polygon shapes.
3. **`createSvgPathShape()` factory** — a developer-facing API for registering custom shapes by providing only an SVG path formula.
4. **`customShapes` prop** on `<Glideboard>` — lets host applications inject their own shape plugins at mount time.

---

## Documents in this directory

| File | Purpose |
| :--- | :--- |
| [README.md](./README.md) | This file — feature index and decision log |
| [engineering-shapes-catalog.md](./engineering-shapes-catalog.md) | Research: what shapes are needed for which diagram types (P1/P2/P3 priority breakdown) |
| [implementation-plan.md](./implementation-plan.md) | Detailed agent-executable implementation plan (26 steps, verbatim code, verify gates) |

---

## Scope

### In scope (this feature)

- 7 P1 shapes: `rounded-rect`, `parallelogram`, `chevron`, `document`, `cylinder`, `note`, `callout`
- `BasePathShapeUtil` in `glideline/src/shapes/GeoShapeUtil.ts`
- `createSvgPathShape()` factory in `glideline/src/shapes/createSvgPathShape.ts`
- 7 new tool classes in `glideline/src/tools/GeoShapeTools.ts`
- `P1ShapesPlugin` export from `glideline`
- `customShapes?: GlidePlugin[]` prop on `<Glideboard>`
- `registerCustomShapes()` in `glideboard/src/editor.ts`
- Toolbar expansion to 13 shapes (3-column grid)
- Unit tests for all 7 shapes + factory

### Out of scope (future)

- P2 shapes: `actor`, `component`, `package`, `delay`, `manual-operation`, `predefined-process`, `off-page-connector`
- P3 shapes: `cloud`, `weak-entity`, `double-diamond`, `pentagon`, `octagon`, `cross`
- Crow's Foot ER tables (`TableUtil` — composite structured shape)
- Sequence diagram lifelines (needs fixed vertical layout mode)
- Swim lanes (needs `FrameUtil` extension)
- Network icons (router, firewall, switch) — should be an icon library, not geo shapes
- End-user UI for pasting SVG paths into the shape picker

---

## Key architecture decisions

| Decision | Choice | Rationale |
| :--- | :--- | :--- |
| Label system | HTML `<div>` overlay — same as existing shapes | Labels are never inside `toSvg()` output; `<text>` nodes stripped from any imported SVG |
| Geometry sourcing | Manually authored vertex/path formulas | No runtime dep on excalidraw/tldraw; MIT geometry formulas hand-translated |
| Path-based shapes base class | New `BasePathShapeUtil` parallel to `BaseGeoShapeUtil` | `<path d=...>` can't be expressed as simple vertex list; needs separate `getPathD()` contract |
| `RoundedRectUtil` inheritance | Extends `BaseGeoShapeUtil` but overrides `toSvg()` | Uses `<rect rx>` not `<polygon>`; AABB hit-test is correct for rounded rects |
| `CylinderUtil` `toSvg()` override | Adds a second `<ellipse>` element for the top rim | The rim must render on top of the fill; composite shape can't be expressed as a single path fill |
| Custom shape registration timing | Run `registerCustomShapes()` synchronously before first mount (ref-based guard) | `wbEditor` is a module singleton; must register utils before `initializeGlideboardSession` |
| Toolbar grid | 3 columns (was 2) | 13 shapes fit without scrolling; no pagination needed |

---

## Related documents

| Document | Location |
| :--- | :--- |
| Whiteboard engine roadmap | `new-features/whiteboard/roadmap.md` |
| Whiteboard LLD | `new-features/whiteboard/lld.md` |
| Phase specs (glideline phases 1–6) | `new-features/whiteboard/spec-phase-*.md` |
