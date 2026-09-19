# Glideboard Freehand Single-Shape Lifecycle — Requirements

## 1. Summary

Glideboard currently renders freehand drawing through two different shape
records:

1. an ephemeral preview record while the pointer is down; and
2. a newly-created durable record after pointer-up.

The records have different IDs. Glideboard's `ShapeLayer` uses the record ID
as its React key and injects SVG geometry in an effect. When the preview is
replaced by the durable record, React mounts a new layer whose SVG is briefly
empty before the effect injects the path. Users observe this as a flicker,
and the final pointer sample can also be omitted when it is delivered only by
`pointerup`.

This change adopts a single-shape lifecycle for freehand strokes. The same
shape ID is created at pointer-down, updated during the gesture, and promoted
to a durable document record at pointer-up.

## 2. Goals

- Eliminate freehand flicker when the pointer is released.
- Preserve one stable shape identity and one stable React `ShapeLayer` during
  the entire gesture.
- Preserve the existing separation between transient interaction state and
  durable document state until the stroke is accepted.
- Produce exactly one undoable `Draw Stroke` command for an accepted stroke.
- Ensure the final pointer-up coordinate and pressure are included when they
  are not present in the last pointer-move event.
- Preserve Escape, pointer-cancel, lost-pointer-capture, window-blur, and
  unmount cancellation behavior.
- Keep incomplete strokes out of persistence, collaboration publication,
  export, and history until they are committed.

## 3. Non-goals

- Refactoring every shape tool in the first implementation.
- Changing freehand smoothing, pressure simulation, stroke widths, colors, or
  hit testing.
- Changing the public `<Glideboard>` component API.
- Replacing the SVG renderer with Canvas or changing the React rendering
  architecture.
- Changing text-editing behavior.
- Solving remote live-preview sharing; in-progress strokes remain local-only.

## 4. Scope

### Phase 1 — required

- `packages/glideline/src/tools/DrawTool.ts`
- `packages/glideline/src/interaction.ts` and/or the editor's internal
  interaction-commit surface
- DrawTool regression tests
- Glideboard/demo verification

### Phase 2 — follow-up

Apply the same lifecycle to box, ellipse, frame, geo-shape, arrow, custom SVG,
and other drag-created tools. This phase must reuse the Phase 1 interaction
commit primitive; each tool must not invent its own promotion behavior.

### Phase 3 — separate follow-up

Evaluate text creation and editing separately. Text has an edit-session and
collaboration lifecycle that must not be conflated with geometric previews.

## 5. Functional requirements

### FR-1 — Stable identity

The freehand gesture must allocate one unique `ShapeId` on pointer-down. The
same ID must be used for all preview updates and for the committed document
record.

### FR-2 — Immediate preview

The first point must become visible immediately after pointer-down, using the
existing ephemeral interaction overlay.

### FR-3 — In-place updates

Pointer-move events must update the existing interaction-owned record. They
must not delete and recreate the shape, and must not allocate a new shape ID.

### FR-4 — Final sample

On pointer-up, if the final point is at least the existing minimum distance
from the last recorded point, it must be appended to the stroke. Its pressure
must use the pointer-up pressure, defaulting to `0.5` when absent.

### FR-5 — Commit

For a meaningful stroke, pointer-up must:

1. update the interaction-owned record with the final points;
2. set `isComplete: true`; and
3. commit that same record to the canonical document store.

The commit must be one durable history entry labelled `Draw Stroke`.

### FR-6 — Short-stroke behavior

Strokes with fewer than two meaningful points must not create a durable
freehand record. Their interaction record must be cancelled and removed.

### FR-7 — Cancellation

Escape, pointer-cancel, lost pointer capture, window blur, tool replacement,
read-only transition, unmount, or editor/session disposal must remove the
interaction-owned record without creating a durable shape or history entry.

### FR-8 — Stable rendering layer

The Glideboard shape layer must remain keyed by the same ID throughout the
gesture. The browser must not need to mount a replacement `ShapeLayer` merely
because the stroke became durable.

### FR-9 — Persistence and collaboration isolation

While the gesture is in progress, the incomplete record must remain absent
from canonical serialization, persistence callbacks, collaboration updates,
and document export. After commit, the record must participate in all normal
document paths.

### FR-10 — Undo/redo

- Undo immediately after commit removes the whole stroke.
- Redo restores the whole stroke.
- Preview updates do not create intermediate undo entries.
- Cancelled strokes do not affect undo or redo history.

### FR-11 — Existing visual semantics

The committed stroke must retain the same points, pressure values, color,
stroke width, stroke style, opacity, pressure sensitivity, simulated pressure,
closure state, and geometry as the current implementation.

## 6. Non-functional requirements

- No additional per-pointer-move React component mounts.
- No increase in durable store writes for pointer-move events.
- No new network traffic for incomplete local strokes.
- The promotion path must be synchronous and deterministic.
- The change must remain compatible with React 18 and React 19 hosts.
- The existing package build and test commands must continue to pass.

## 7. Acceptance criteria

The change is accepted when all of the following are true:

1. Repeated mouse and stylus freehand strokes show no disappearance or
   reappearance at pointer-up in the Glideboard demo.
2. The shape ID observed during pointer-down, pointer-move, and pointer-up
   is identical.
3. A pointer-up coordinate that is not preceded by pointer-move appears in
   the persisted points array.
4. The document store has zero records for the active incomplete stroke and
   one record after commit.
5. A cancelled stroke leaves no record, no history entry, and no collaboration
   update.
6. Undo removes the committed stroke in one action; redo restores it.
7. Existing freehand pressure tests and rendering tests remain green.
8. The rebuilt GlideLine package, Glideboard package, and Glideboard demo all
   consume the changed implementation.

## 8. Test requirements

Add or update tests for:

- stable ID across preview and commit;
- pointer-up-only final sample;
- pressure preservation for pen input;
- simulated pressure for mouse input;
- no durable store record during preview;
- one durable record after commit;
- cancellation by Escape;
- cancellation by pointer cancellation/lost capture;
- one history entry and whole-stroke undo/redo;
- no duplicate shape after repeated strokes;
- commit failure leaves a recoverable interaction state and does not silently
  report success.

Add a browser/demo smoke test if the existing Playwright setup can observe
pointer gestures and capture a screenshot around pointer-up.

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Promoting an interaction record bypasses normal document hooks | Route promotion through the existing canonical store transaction and commit participant path. |
| Commit failure leaves a visible incomplete stroke | Preserve the active interaction on failure, expose the failure to the caller, and allow cancellation/retry. |
| A fixed preview ID collides with a previously committed record | Allocate a unique ID per gesture. |
| Incomplete records leak into persistence or collaboration | Keep them in `InteractionManager` overlay state until promotion. |
| Generalizing too early expands the regression surface | Ship freehand first; migrate other tools only after the shared primitive is proven. |

