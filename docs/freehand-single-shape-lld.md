# Glideboard Freehand Single-Shape Lifecycle — LLD

## 1. Design decision

Replace the current freehand lifecycle:

```text
ephemeral __draw-preview__
        ↓ pointer-up
delete preview
        ↓
create durable freehand with a new ID
```

with:

```text
allocate unique ShapeId
        ↓ pointer-down
create interaction-owned freehand with that ID
        ↓ pointer-move
update the same record
        ↓ pointer-up
append final sample + set isComplete=true
        ↓
promote the same interaction record into the canonical store
```

The shape ID is stable. Only ownership changes: from the local interaction
overlay to the canonical document store.

## 2. Current implementation and failure point

`DrawTool` currently uses `PREVIEW_ID = sid('__draw-preview__')` for the
ephemeral stroke. On pointer-up it deletes that record and creates a new
freehand record with `createShapeId('freehand')`.

Glideboard's `ShapeLayer` is keyed by the record ID:

```tsx
<ShapeLayer key={id} id={id} ... />
```

The layer obtains the shape through `getShapeSignal(id)` and injects the
shape's SVG with an effect. A new committed ID therefore causes this sequence:

1. viewport projection removes the preview ID and adds the committed ID;
2. React mounts a new `ShapeLayer` for the committed ID;
3. the new `<svg>` is initially empty;
4. `useEffect` calls `toSvg()` and injects the path.

The empty SVG frame is the likely source of the observed flicker. Reordering
creation and cleanup can remove the blank logical state, but it still replaces
the keyed React layer and does not remove the underlying remount timing.

## 3. Components and responsibilities

### 3.1 `DrawTool`

Owns the gesture state and point collection.

Proposed fields on the `Drawing` state:

```ts
private _shapeId: ShapeId | null = null;
private _points: FreehandPoint[] = [];
private _lastPt: Vec2 = { x: 0, y: 0 };
private _pressureSensitive = false;
private _simulatePressure = false;
```

`_shapeId` is assigned in `onEnter` from
`editor.createShapeId('freehand')`. It must be reset in `onExit` after the
interaction has either committed or been cancelled.

### 3.2 `InteractionManager`

Continues to own the transient record overlay. The existing `commit()`
implementation already knows how to compare overlay baselines, apply the
result to the canonical store, and publish the interaction cleanup.

The missing piece is a controlled editor-facing way for a tool to request that
an active interaction be committed without reaching through private editor
state.

### 3.3 `GlideEditor`

Add a narrow internal lifecycle method, for example:

```ts
/** @internal — commit the active interaction as one document command. */
commitInteraction(label: string, commandId?: string): void;
```

The method must:

- validate mutation capability using the same policy as other editor commands;
- no-op or throw a clear error when no interaction is active;
- call `InteractionManager.commit({ label, commandId })`;
- use the existing canonical store transaction and commit participants;
- publish one durable document transaction;
- leave the interaction active if the transaction fails, so the caller can
  cancel or retry.

This method should be marked internal in the public TypeScript surface if the
package's API conventions support internal exports. It should not be exposed
through `GlideboardHandle`.

## 4. Detailed event lifecycle

### 4.1 Pointer down

1. Read active style values and pointer pressure settings.
2. Allocate `_shapeId`.
3. Store the first point in `_points` and `_lastPt`.
4. Create one freehand record through:

```ts
editor.batch('Draw Preview', () => {
  editor.createShape({
    id: _shapeId,
    type: 'freehand',
    ...,
    props: { points, isComplete: false, ...styles },
  });
}, { history: 'ignore', scope: 'ephemeral' });
```

The record is interaction-owned and therefore visible through composed editor
queries but absent from canonical store serialization.

### 4.2 Pointer move

1. Ignore movement below `MIN_DIST_SQ`.
2. Append the point to `_points`.
3. Update `_shapeId` in the interaction overlay with the latest points and
   current style fields.

No ID allocation, delete, or canonical store transaction occurs.

### 4.3 Pointer up

1. Append `e.point` if it is farther than `MIN_DIST_SQ` from `_lastPt`.
2. If fewer than two points exist, cancel the interaction and transition to
   idle.
3. Otherwise update the same `_shapeId` with final points and
   `isComplete: true` using an ephemeral interaction update.
4. Call `editor.commitInteraction('Draw Stroke')`.
5. Transition to idle only after commit succeeds.

The final `isComplete` update may be done in the same interaction callback as
the commit if the interaction API guarantees one publication. If not, two
overlay publications are acceptable because the shape ID and mounted layer
remain stable; the durable promotion must still be one store transaction.

### 4.4 Escape and cancellation

Call the existing interaction cancellation path. Do not call
`commitInteraction`. Clear `_shapeId` and `_points` when the state exits.

Cancellation must remove the overlay record, not create a tombstone in the
canonical store.

### 4.5 Failure handling

If canonical commit throws:

- do not transition to idle;
- leave the interaction-owned complete record available for retry/cancel;
- surface the error through the existing editor error convention;
- ensure a later cancel can clear it;
- do not emit a partial durable record.

## 5. Proposed API behavior

The internal editor method should be implemented near the existing history
preview compatibility methods or the batch/history section. Conceptually:

```ts
commitInteraction(label = 'Interaction', commandId = commandIdFromLabel(label)): void {
  this.assertMutationAllowed({
    origin: 'local-user',
    command: commandId,
    affectedIds: [...this.interactions.changedIds],
  });

  this.interactions.commit({ label, commandId });
}
```

The exact mutation-request metadata should follow the existing command and
collaboration conventions. The implementation must not duplicate the commit
algorithm already present in `InteractionManager.commit`.

If exposing a method on `GlideEditor` is undesirable, an internal
`InteractionCommitter` adapter can be injected into tools at editor creation.
The direct method is preferred because existing tools already call editor
methods for all other mutations.

## 6. Rendering behavior after the change

The viewport projection continues to include interaction-owned IDs through
`editor.interactions.changedIds`. Since the same ID remains in the ordered
shape list before and after promotion:

- `ShapeLayer` retains the same React key;
- the same SVG element remains mounted;
- `ShapeLayer`'s signal changes from overlay data to canonical data;
- its existing effect updates the SVG contents in place;
- there is no preview-ID removal followed by committed-ID mounting.

No Glideboard `Canvas.tsx` change should be required for Phase 1. If browser
testing finds the imperative SVG effect still produces a visible gap on a
same-ID shape update, the next improvement is to render a declarative path or
use a canvas overlay for active strokes. That is not part of the initial
promotion change.

## 7. History behavior

The preview is created and updated with `history: 'ignore'` and
`scope: 'ephemeral'`.

`InteractionManager.commit` must create one canonical transaction with
`history: 'record'`, label `Draw Stroke`, and the full record as the after
state. This gives:

```text
pointer-down / pointer-move: no history entries
pointer-up:                  one Draw Stroke entry
undo:                         removes the stroke
redo:                         restores the stroke
```

Do not create a separate `createShape` command after committing. Doing so
would reintroduce a second shape identity and defeat the design.

## 8. Persistence and collaboration behavior

While the stroke is in the interaction overlay:

- `store.listen` must not observe it as a canonical document delta;
- Yjs/document projection must not publish it;
- save scheduling must not run for it;
- export and serialization must omit it unless an explicit preview export is
  requested.

On promotion, the existing canonical store transaction and its commit
participants handle the normal Glideboard/Yjs projection. The committed
record must be indistinguishable from a record created by the current final
`createShape` path.

Remote users should see the stroke only after commit in Phase 1. Live remote
ink is explicitly out of scope.

## 9. State machine invariants

During `Drawing`:

- `_shapeId !== null`;
- exactly one interaction-owned freehand record exists for the gesture;
- the record's `isComplete` is false until pointer-up finalization;
- the record's points equal `_points` after each accepted sample.

After successful commit:

- `_shapeId` is the ID of one canonical freehand record;
- no interaction overlay owns that ID;
- `isComplete === true`;
- the tool is idle.

After cancellation:

- no interaction record exists;
- no canonical freehand record was created;
- the tool is idle or follows the existing cancellation transition.

## 10. Test design

### Unit tests

Extend `packages/glideline/src/tools/draw-tool.test.ts` with:

1. `keeps one shape id from pointerDown through commit`;
2. `does not add preview records to canonical store`;
3. `commits the same id as a complete freehand shape`;
4. `includes a pointerUp-only sample`;
5. `cancel removes the interaction without history`;
6. `commit creates one undo entry`;
7. `undo and redo operate on the complete stroke`;
8. `pen pressure survives promotion`;
9. `commit failure does not transition to idle or lose the interaction`.

Use both `editor.getShape(id)` and the canonical store query where needed so
the test distinguishes composed interaction state from durable state.

### Glideboard rendering test

Add a focused test around `ShapeLayer` or the canvas harness that verifies the
shape ID remains in the viewport entries across promotion. If feasible, spy on
the layer mount/unmount behavior and assert that promotion does not remount the
freehand layer.

### Browser smoke test

In `packages/glideline-demo`, draw several strokes with a mouse and, if the
test harness supports it, a pen-like pointer. Capture the final frame and
assert that the committed stroke remains visible. A visual assertion should
be supplementary to the deterministic unit tests, not their replacement.

## 11. Rollout plan

### Step 1 — interaction commit primitive

Implement and test the internal editor method around the existing
`InteractionManager.commit` implementation.

### Step 2 — freehand migration

Change only `DrawTool` to use a unique stable ID and same-record promotion.
Keep the existing cleanup workaround out of the new path.

### Step 3 — regression verification

Run:

```text
npm --prefix packages/glideline test -- --run src/tools/draw-tool.test.ts
npm --prefix packages/glideline run build
npm --prefix packages/glideboard run build
```

Restart `packages/glideline-demo` and verify freehand pointer-up behavior.

### Step 4 — future tool migration

Migrate box, ellipse, frame, geo-shape, arrow, and custom SVG tools through
the same primitive. Keep each migration isolated and add one stable-ID test
per tool.

### Step 5 — text evaluation

Design text creation around its edit session, draft, composition, and
collaboration contracts. Do not automatically apply the geometric-shape
promotion API to text.

## 12. Open questions

- Should `commitInteraction` remain `@internal`, or should the editor expose a
  more general public interaction lifecycle for custom tools?
- Should an incomplete interaction be allowed to participate in local
  accessibility/selection queries, or remain selectable only by its active
  tool?
- Should the current imperative `toSvg()` effect be replaced by declarative
  active-shape rendering if same-ID promotion still reveals a browser paint
  gap?
- Should future remote live drawing use a dedicated awareness/scribble channel
  instead of transient document records?

