# Phase 3: Tools & Editor

**Goal**: Make the canvas interactive — selection, drawing, undo/redo, and the full Editor API.
**Output**: `StateNode` FSM, `SelectTool`, `BoxTool`, `HistoryManager`, `GlideEditor` implementation.
**Reference**: HLD §3.2, §3.5, LLD §7–8, §14.

---

## Story 3.1: StateNode FSM — Base Interaction Framework

**Summary**: Implement the hierarchical finite state machine that routes all pointer and keyboard events to the active tool.

**Description**: Every user interaction is modelled as a `StateNode` tree. The active leaf state receives events first; unhandled events bubble to the parent. `transition(id, info)` exits the current child state (calling `onExit`) and enters the new one (calling `onEnter`). This prevents conflicting interactions (e.g. drawing while selecting) at the structural level.

**Acceptance Criteria**:
- `transition("idle")` calls `onExit` on current state then `onEnter` on the new `Idle` state
- Unknown child ID in `transition()` throws with the ID in the message
- `StateNode.editor` is available inside all lifecycle methods
- A root tool with 3 children registers all 3 via `static children = () => [...]`
- Events handled by a child do not propagate to the parent (no double-fire)
- `getCurrentTool()` returns the root tool; `getCurrentTool().current` returns the active leaf

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T3.1-01 | Transition calls onExit then onEnter | Spy onExit on Idle, onEnter on Pointing. `transition("pointing")`. Assert order: exit then enter. |
| T3.1-02 | Unknown child throws | Tool with children [Idle, Pointing]. `transition("drawing")` → throws containing `"drawing"`. |
| T3.1-03 | Editor injected | Inside Idle.onEnter, call `this.editor.getSelectedShapeIds()`. No throw. |
| T3.1-04 | Starts in initial state | `setCurrentTool("box")`. `getCurrentTool().current.constructor.id === "idle"`. |
| T3.1-05 | Event not double-fired | Child handles `onPointerDown`. Parent spy NOT called. |
| T3.1-06 | Active leaf via `.current` | After `transition("pointing")`, `tool.current.constructor.id === "pointing"`. |

---

## Story 3.2: SelectTool — Full FSM

**Summary**: Implement the default selection tool with click-to-select, drag-to-move, and marquee selection.

**Description**: `SelectTool` is the root tool with states: `Idle → PointingShape → Dragging` (move), `Idle → PointingCanvas → MarqueeSelecting`. Clicking a shape selects it; shift-click adds to selection. Dragging a selected shape translates it in real time. Pressing Escape during drag cancels and restores original positions. Drag threshold is 4px to prevent accidental moves on click.

**Acceptance Criteria**:
- Clicking a shape selects it and deselects others
- Shift-clicking a shape adds/removes it from the current selection
- Clicking empty canvas deselects all
- Dragging shape(s) translates them in real time (positions update on every pointermove)
- Escape during drag restores all shapes to their pre-drag positions
- Marquee box drawn on canvas selects all shapes whose AABB intersects the marquee
- Double-click on a shape enters edit mode for that shape

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T3.2-01 | Click selects shape | `pointerDown` on shape → `pointerUp`. `getSelectedShapeIds()` → [shapeId]. |
| T3.2-02 | Click canvas deselects | Select shape. `pointerDown` on empty canvas → `pointerUp`. Selection → []. |
| T3.2-03 | Shift-click adds to selection | Select A. Shift+`pointerDown` on B → up. Selection → [A, B]. |
| T3.2-04 | Drag translates shape | `pointerDown` on shape → `pointerMove` +50px → `pointerUp`. Shape x increased by 50. |
| T3.2-05 | Escape cancels drag | pointerDown → pointerMove +50px → keyDown Escape. Shape x unchanged from original. |
| T3.2-06 | Marquee selects intersecting | Draw marquee covering shapes A and B, not C. Selection → [A, B]. |
| T3.2-07 | Drag threshold 4px | `pointerDown` → `pointerMove` 2px → `pointerUp`. State stays `PointingShape`, no drag initiated. |

---

## Story 3.3: BoxTool — Drawing Tool Pattern

**Summary**: Implement `BoxTool` as the reference drawing tool, demonstrating the `Idle→Pointing→Drawing` pattern.

**Description**: `BoxTool` lets users draw rectangles by clicking and dragging. On pointer-down, it enters `Pointing`. If the pointer moves more than 4px (drag threshold), it enters `Drawing` and creates a live preview shape in the store. The preview updates on every `pointerMove`. On `pointerUp`, the shape is committed to history. Escape during drawing deletes the preview and returns to `Idle`.

**Acceptance Criteria**:
- Pointer-down starts `Pointing` state; no shape created yet
- Moving > 4px from origin enters `Drawing` and creates a preview shape in the store
- Each `pointerMove` updates the preview shape's `w` and `h`
- `pointerUp` commits the shape and transitions to `Idle`
- Escape during `Drawing` deletes the preview shape; store count unchanged from before drag
- After commit, tool returns to `Idle` automatically
- Committed shape appears in the undo stack as a single entry

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T3.3-01 | No shape on pointerDown only | `pointerDown` → `pointerUp` (no move). `store.shapeCount` unchanged. |
| T3.3-02 | Preview created on drag | `pointerDown` → `pointerMove` +20px. `store.shapeCount` increases by 1. |
| T3.3-03 | Preview size updates on move | `pointerMove` to (origin+100, origin+60). Shape `props.w===100`, `props.h===60`. |
| T3.3-04 | Commit on pointerUp | `pointerUp` after drag. Shape remains in store. State → `Idle`. |
| T3.3-05 | Escape deletes preview | Drawing state. `keyDown Escape`. Shape removed. `store.shapeCount` back to original. |
| T3.3-06 | Single undo entry | Draw box. `editor.undo()`. Shape removed in one step. |

---

## Story 3.4: History Manager — Undo/Redo & Batch

**Summary**: Implement per-user undo/redo with `batch()` grouping and `{ history: 'ignore' }` for AI/remote mutations.

**Description**: The `HistoryManager` records before/after diffs for every store mutation. `batch(label, fn)` groups all mutations in `fn` into a single undo entry. `batch(label, fn, { history: 'ignore' })` applies mutations without recording — used for remote Yjs changes and AI/MCP actions. `undo()` applies the `before` diff; `redo()` re-applies the `after` diff. Remote changes must never appear in the local undo stack.

**Acceptance Criteria**:
- `undo()` after creating a shape removes it from the store
- `redo()` after undo re-creates the shape with identical props
- `batch("label", fn)` groups N mutations into 1 undo entry
- `batch("label", fn, { history: 'ignore' })` applies mutations but `undo()` has no effect
- Undo stack is limited to 100 entries (oldest dropped when exceeded)
- `undo()` on empty stack is a no-op (no throw)
- Remote Yjs changes applied via `{ history: 'ignore' }` do not appear in local undo stack

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T3.4-01 | Undo removes created shape | `createShape(box)`. `undo()`. `store.get(box.id)` → undefined. |
| T3.4-02 | Redo re-creates shape | After T3.4-01, `redo()`. `store.get(box.id)` → box. |
| T3.4-03 | Batch = 1 undo entry | `batch("move", () => updateShape A, updateShape B)`. `undo()` once. Both A and B restored. |
| T3.4-04 | history:ignore not undoable | `batch("ai", fn, {history:'ignore'})`. `undo()`. Mutation NOT reversed. |
| T3.4-05 | Empty undo stack no-op | Fresh editor. `undo()`. No throw. |
| T3.4-06 | Stack cap at 100 | Perform 101 individual mutations. `undoStack.length === 100`. Oldest dropped. |
