# History & Interaction

**Package:** `@durgakiran/glideline` · **Stability:** 🔴 Unstable (all APIs on this page)

Two related but distinct layers sit above `GlideStore`:

- **`HistoryManager`** — "selective, per-user undo/redo backed by atomic store change sets" (source doc comment). This is the permanent undo/redo stack.
- **`InteractionManager`** — "transient interaction overlay: previews never enter the canonical store" (source doc comment). This is what a drag/resize/draw gesture renders against *before* it commits — so 60 pointer-move events don't each become a history entry or a store commit.

Most apps use these indirectly, through `GlideEditor.batch()`/`.undo()`/`.redo()` and the built-in tools. Reach for these directly if you're implementing a custom tool ([Tools & State Machine](./tools-and-state-machine.md)) that needs live-preview-then-commit semantics, or building UI (a history panel, conflict resolution) around undo/redo itself.

## `HistoryManager`

```ts
class HistoryManager {
  batch(label: string, fn: () => void, opts?: BatchOptions): void;
  attachInteractionAdapter(adapter: InteractionPreviewAdapter): void;
  beginPreview(): void;
  recordPreview(label: string, before: ReadonlyMap<string, AnyRecord | null>): void;
  cancelPreview(): void;
  undo(): HistoryResult;
  redo(): HistoryResult;
  clear(): void;
}
```

`batch(label, fn, opts)` runs `fn` inside one store transaction and records it as a single history entry labeled `label`. `opts.history === 'ignore'` opts a batch out of the undo stack entirely (for derived/bookkeeping writes) — this is the same knob `GlideStore.batch()` and `GlideEditor.run()` expose.

```ts
undo(): HistoryResult   // { status: 'applied', entry } | { status: 'empty' } | { status: 'conflict', entry, error }
redo(): HistoryResult
```

`HistoryResult`'s `'conflict'` branch is the key thing to design around in a collaborative app: an undo/redo is a *reapplication* of a recorded delta, and each `HistoryEntry` carries `preconditions: FieldPrecondition[]` — the exact prior value/generation it expects at each touched path. If a remote peer changed that field since the entry was recorded, applying it now would silently clobber their edit — so the manager refuses and returns `'conflict'` (or throws `HistoryConflictError`, `code: 'history-conflict'`) instead of applying a stale delta.

- **`HistoryEntry`** — `{ id, label, commandId?, before, after, forward: HistoryDelta[], inverse: HistoryDelta[], preconditions }`. `forward`/`inverse` are the deltas applied on redo/undo respectively; each `HistoryDelta` is `{ id, before, after, changedPaths }`.
- **Stack limits** — capped at 100 entries and 16 MiB of serialized history (`MAX_STACK`, `MAX_HISTORY_BYTES` internally); oldest entries are evicted first.
- **`commandIdFromLabel(label, prefix?)`** — slugifies a human label into a stable `commandId` (`"Align Left"` → `"command.align.left"`), used for grouping/collapsing related history entries.

### Preview mode

`beginPreview()` / `recordPreview(label, before)` / `cancelPreview()` let a caller stage a change against the store for live rendering without yet creating a permanent history entry — this is the seam `InteractionManager` normally owns during a drag; you'd touch this directly only if you're building interaction handling outside the standard tool/`StateNode` pipeline.

## `InteractionManager`

Holds an **ephemeral overlay** on top of the store: while an interaction is active, reads through the manager see the in-progress preview; nothing is written to the canonical store or history until `commit()`.

```ts
class InteractionManager {
  begin(kind: 'document' | 'ephemeral' = 'document'): void;
  get(id): StoreRecord | undefined;
  getSignal(id): ReadonlySignal<StoreRecord | null>;
  getVersionSignal(): ReadonlySignal<number>;
  getShapeIdsSignal(): ReadonlySignal<readonly ShapeId[]>;
  getChangedIdsSignal(): ReadonlySignal<readonly string[]>;
  commit(options: InteractionCommitOptions): void;   // { label, commandId, actorId? }
  cancel(): void;
}
```

- **`'document'`** interactions (e.g. dragging a shape) preview against real store semantics and, on `commit()`, become one history entry.
- **`'ephemeral'`** interactions (e.g. a marquee-select rectangle, an in-progress draw stroke) never touch history even on commit — they're for state that's real during the gesture but isn't a document edit until something else (like `createShape`) makes it one.
- `commit()` can throw `InteractionConflictError` (`code: 'interaction-conflict'`) for the same reason `undo()`/`redo()` can — the underlying record changed out from under the preview (e.g. a remote peer edited or deleted the shape mid-drag).
- `cancel()` discards the overlay with no store/history effect at all.

`StateNode`-based tools (`BoxTool`, `ArrowTool`, `DrawTool`, ...) drive `InteractionManager` internally during pointer-down → pointer-move → pointer-up; see [Tools & State Machine](./tools-and-state-machine.md) for how a custom tool wires into this.

## Related types

`HistoryEntry`, `HistoryDelta`, `FieldPrecondition`, `HistoryConflict`, `HistoryResult`, `BatchOptions`, `InteractionPreviewAdapter`, `ReadonlyHistoryManager`, `InteractionConflict`, `InteractionCommitOptions`.
