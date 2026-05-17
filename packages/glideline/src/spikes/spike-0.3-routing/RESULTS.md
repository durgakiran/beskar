# Spike 0.3: Arrow Routing — Results

Generated: 2026-05-13 (revised after tldraw source analysis)

## Final Decision: `arc` (curve style) + `elbow` (ortho style)

_Initial prototype tested straight / bezier / manhattan. Decision revised after studying tldraw's production implementation._

---

## Throughput (10k route() calls — prototype implementations)

| Algorithm | Total | Per route | Routes/sec |
|---|---|---|---|
| straight | ~44ms | ~4μs | ~229k |
| bezier | ~80ms | ~8μs | ~125k |
| manhattan | ~65ms | ~7μs | ~153k |

**Performance is NOT the deciding factor.** All three are computationally trivial.
Route computation happens at most 60×/sec (per frame). Even at 10μs each, that is 0.6ms/frame — negligible.

---

## Edge Cases Tested (prototype)

| Scenario | Straight | Bezier | Manhattan (fixed) |
|---|---|---|---|
| Left→Right (opposite sides) | ✅ | ✅ smooth | ✅ 3-segment |
| Top→Bottom (vertical) | ✅ | ✅ smooth | ✅ 3-segment |
| Back-facing normals (U-bend) | ⚠️ cuts shapes | ⚠️ curves through | ✅ routes around |
| Overlapping shapes | ⚠️ degenerate | ⚠️ tiny curve | ✅ stubs prevent |
| Diagonal (mixed normals) | ✅ | ✅ smooth | ✅ L-shaped |
| Self-loop | ❌ invisible | ❌ invisible | ✅ rectangular loop |

Visual output: `preview.html`

---

## Why Not Bezier

- **No user control**: control points are auto-computed from normals. User cannot edit the curve shape.
- **No handle UX**: bezier curves need 2 control point handles — complex for users to manipulate.
- **Overshoot**: short-distance arrows can produce visually wrong bulging curves.
- **Normal fragility**: control points depend on float-precision normal vectors from binding anchors.

## Why Arc Instead

- **Single bend scalar**: user drags one midpoint handle to increase/decrease curvature. Intuitive.
- **Used by tldraw, Figma**: proven UX pattern for free-form connectors.
- **Simple data model**: `props.bend: number` — positive = curves one way, negative = other way, 0 = straight.
- **Renders as circular arc** (not bezier) — mathematically simpler, no control point algebra.

---

## Why Not Manhattan (ours)

- **Normal-vector routing is fragile**: `Math.abs(normal.dx) > Math.abs(normal.dy)` to classify axis can misfire at 45° attachment angles or due to float drift.
- **U-bend detection bug found during spike**: geometry-based crossable check was wrong — had to be replaced with normal dot-product check mid-spike. Indicates the approach is error-prone.
- **Not shape-geometry-aware**: only sees the anchor point, not which edge of the shape the arrow exits from.

## Why Elbow Instead

- **Edge identity input**: routing is driven by `fromEdge: "left" | "right" | "top" | "bottom"`, not a normal vector. This is unambiguous — `"right"` never drifts.
- **Shape-geometry-aware**: knows the bounding box of both source and target shapes. Can compute exact gap, midpoints, and routing topology per edge-pair combination.
- **Correct by construction**: each source-edge × target-edge combination (16 cases) has a purpose-built routing rule. No generic "which axis is dominant" heuristic.
- **Production-validated**: tldraw's `getElbowArrowInfo()` ships this approach in production.
- **Not obstacle-avoiding** (and that's fine): elbow finds the minimum rectilinear path between two named edges. Does NOT route around other shapes on canvas (that would require A* = expensive). This is the right tradeoff — full obstacle avoidance is not needed for most diagrams.

---

## Key Terminology Clarification

> "Manhattan routing" in EDA/PCB tooling = **full obstacle-avoiding** routing.
> Uses A* or Lee algorithm. O(N log N). Expensive.
>
> tldraw's "elbow" = **shape-aware, non-obstacle-avoiding** orthogonal routing.
> Reads source + target edge identity. Computes minimum rectilinear path. O(1).
>
> These are NOT the same algorithm. Glideline adopts the elbow approach.

---

## Impact on Spike 0.4 (API Design)

- `GlideBinding.props.routeStyle: "curve" | "ortho"` — per-connection style.
- `GlideBinding.props.bend: number` — used by `"curve"` style; 0 = straight line.
- Arrow `ShapeUtil` computes path from `(fromEdge, toEdge, fromBounds, toBounds, bend)`.
- `fromEdge` / `toEdge` are computed by `BindingUtil.onAfterChange` when anchor normalizedPosition hits a shape edge — not stored as raw normals.
- Router is a **pure function** — stateless, called on every render. No side effects.
