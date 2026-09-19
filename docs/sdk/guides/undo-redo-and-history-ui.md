# Guide: Wire up undo/redo and a history UI

**Use case:** keyboard shortcuts for undo/redo, toolbar buttons that disable when there's nothing to undo/redo, grouping several edits (e.g. a multi-shape align) into one undo step, and — if you need it — a history list UI.

**Reference:** [glideline: History & Interaction](../glideline/history-and-interaction.md), [glideline: Editor § History & batching](../glideline/editor.md#history--batching).

`glideboard` doesn't expose undo/redo buttons out of the box today — if you're using `<Glideboard>`, you drive this against `controller.editor` (or the ref handle doesn't currently proxy `undo`/`redo`/`getSelectionSignal`, so reach `editor` via `GlideboardController` — see [Controller & Theming](../glideboard/controller-and-theming.md#glideboardcontroller)).

## Basic undo/redo

```ts
editor.undo();   // → HistoryResult
editor.redo();
```

```ts
function handleUndo() {
  const result = editor.undo();
  if (result.status === 'conflict') {
    // A remote peer changed something this undo touched — see "Conflicts" below.
    toast('Could not undo — the canvas changed since then.');
  }
}
```

Always check `HistoryResult.status`, don't assume `undo()`/`redo()` always applies — see [Conflicts](#conflicts-in-a-collaborative-app) below.

## Reactive enabled/disabled state for buttons

`HistoryManager` doesn't expose a public "can undo" signal directly in the current API — the practical pattern is to track it yourself from `HistoryResult`, or (simpler, if slightly coarser) treat every document-version change as "there's now something to undo" and clear on a fresh session:

```ts
const [canUndo, setCanUndo] = useState(false);

function handleUndo() {
  const result = editor.undo();
  setCanUndo(result.status !== 'empty' /* heuristic; see note */);
}
```

This is a real gap worth flagging rather than working around silently: if you need exact undo/redo-availability signals for a toolbar, that's a small addition to `HistoryManager` (`ReadonlyHistoryManager` already exists as an interface — extending it with two boolean signals would be the natural place) rather than something to reverse-engineer from `HistoryResult` alone.

## Grouping edits into one undo step

Use `editor.batch(label, fn)` (or `editor.run(fn, opts)` for a variant with more options) around anything that should undo as a single unit:

```ts
editor.batch('Align left', () => {
  editor.alignShapes(selectedIds, 'left');
});
```

Every built-in multi-step operation (`alignShapes`, `distributeShapes`, `tidyShapes`, ...) already does this internally — you only need `editor.batch` explicitly when composing *your own* multi-write operation (e.g. "duplicate this shape and immediately nudge the copy") that should undo in one keystroke rather than two.

```ts
editor.batch('Duplicate and offset', () => {
  const [newId] = editor.duplicateShapes([shapeId]);
  editor.nudgeShapes([newId], { x: 40, y: 0 });
});
```

To exclude a write from history entirely (derived/bookkeeping state, not a user-meaningful edit):

```ts
editor.run(() => { /* ... */ }, { history: 'ignore' });
```

## A history list UI

There's no built-in history-list component, but `HistoryEntry.label` (what you passed to `batch()`) is exactly what such a UI would render. If you need one, the pattern is: maintain your own array of applied `HistoryEntry.label`/`commandId` as you observe commits (e.g. via `store.listen()`), rather than trying to read `HistoryManager`'s internal stack (which isn't exposed for iteration — only `undo()`/`redo()`/`clear()` are public). `commandIdFromLabel(label)` is useful if you want a stable, slug-form id to key list items or group related entries (e.g. collapsing "Align left" + "Align left" into one visual row) without hand-writing a slugifier.

## Conflicts in a collaborative app

If `glideboard`'s collaboration is attached (see [glideboard: Collaboration](../glideboard/collaboration.md)), a remote peer can change a field your local undo/redo is about to touch. `HistoryManager` detects this via each entry's recorded preconditions and returns `{ status: 'conflict', entry, error }` instead of silently overwriting the peer's change or throwing an uncaught error. Design your UI around this explicitly — a disabled-looking undo button that occasionally no-ops with a toast is a reasonable minimum; a "can't undo — someone else changed this" message that names the conflicting shape (via `error.conflicts[].id`) is better.
