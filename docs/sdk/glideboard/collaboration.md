# Collaboration

**Package:** `@durgakiran/glideboard` · **Stability:** 🔴 Unstable (all APIs on this page — this is the least externally-exercised surface in the SDK; see the note at the end)

`glideboard` doesn't ship a network transport. You bring a Yjs `Y.Doc` and an awareness-capable provider (`y-websocket`, `y-webrtc`, a custom transport — anything duck-typed to the interfaces below), and `glideboard` projects the canvas document onto and from it.

## `GlideboardCollaborationConfig`

```ts
interface GlideboardCollaborationConfig {
  doc: GlideboardCollaborationDoc;                 // a Y.Doc (or duck-typed equivalent)
  provider?: GlideboardCollaborationProvider | null;
  user?: GlideboardUser | null;                     // { id, name, color }
  boardIdentity?: string;                            // stable logical board id
  bootstrapRevision?: string;                         // server revision an empty doc was seeded from
}

interface GlideboardCollaborationProvider {
  awareness?: GlideboardAwareness;
  synced?: boolean;
  on?(event: 'sync' | 'synced', handler: (synced: boolean) => void): void;
  off?(event: 'sync' | 'synced', handler: (synced: boolean) => void): void;
}

interface GlideboardAwareness {
  setLocalStateField(field: string, value: unknown): void;
  getStates(): Map<number, any>;
  on(event: 'change', handler: () => void): void;
  off(event: 'change', handler: () => void): void;
  clientID: number;
}
```

- **`doc`** — the shared `Y.Doc`. `glideboard` maintains its own internal, schema-versioned representation of the canvas inside it (records, generation markers, a rich-text-fragment map) — this wire format is an implementation detail, not a public contract; don't read or write it directly from outside `glideboard`.
- **`provider.awareness`** — required for presence (`CollaborationAvatars`, `CollaborationCursors`). **Awareness providers are session-owned and must not be shared by two mounted boards.**
- **`provider.synced`** — gates whether `glideboard` will seed an empty shared document. A board only seeds when it's confident the provider has actually caught up with the server — otherwise two clients connecting at once could both "win" a race to seed and diverge.
- **`boardIdentity`** — a stable logical id for the board. Used as a guard: if the attached `Y.Doc` doesn't match the identity a board expects, `glideboard` treats it as a wrong-document attach rather than silently merging unrelated content.
- **`bootstrapRevision`** — the server revision an otherwise-empty shared document was seeded from, for reconciling with the app's own persistence layer.

## Attaching and detaching

`<Glideboard collaboration={config} />` attaches automatically on mount and re-attaches when `config` changes identity; detaches on unmount. If you're driving a `GlideboardController` directly (see [Controller & Theming](./controller-and-theming.md)), the equivalent calls are:

```ts
const detach = controller.attachCollaboration(config);   // returns a cleanup function
controller.detachCollaboration();                         // or call the returned cleanup directly
```

Only one collaboration config can be attached at a time; attaching a new one implicitly detaches the previous one first.

## Presence & awareness helpers

```ts
parseAwarenessUser(value: unknown): GlideboardUser | null
parseAwarenessCursor(value: unknown): Vec2 | null
parseAwarenessPageId(value: unknown): string | null
safeAwarenessEntries(awareness: GlideboardAwareness): Array<[number, unknown]>
```

These are defensive parsers for reading *other* peers' awareness state — every field is validated and defaulted to `null`/empty rather than trusted, since awareness payloads come from other clients (including, in principle, malicious or buggy ones) over the wire. Use them if you're building custom presence UI beyond `CollaborationAvatars`/`CollaborationCursors`.

## Durability & publish flow

Real-time sync (above) answers "what does everyone see right now." A separate, smaller surface answers "what has the server actually durably persisted" — this matters for save indicators, "you have unsaved changes" warnings, and any publish/export flow that must not act on a state the server hasn't confirmed.

```ts
interface CollaborationCheckpointSource {
  readonly status: ReadonlySignal<ProjectionStatus>;   // 'healthy' | 'catching-up' | 'quarantined' | 'incompatible' | 'failed'
  subscribe(listener: (state: ProjectedYjsState) => void): () => void;
  captureTarget(): Promise<ProjectionTarget>;
  waitForStoreRevision(storeRevision: number): Promise<ProjectionTarget>;
}

interface ProjectionTarget {
  readonly storeRevision: number;
  readonly yjs: { transactionSequence: number; stateDigest: string };
}

interface ProjectedYjsState {
  readonly target: ProjectionTarget;
  readonly encodedState: Uint8Array;   // detached bytes; SHA-256 digest is target.yjs.stateDigest
}

interface MutationFence {
  readonly reason: 'close' | 'publish';
  release(): void;
}
```

Reachable via `GlideboardHandle.checkpoints` (React) or `controller.getCollaborationCheckpoints()` (headless):

```ts
const checkpoints = boardRef.current!.checkpoints;
checkpoints.status.value;                                 // read current health
const unsubscribe = checkpoints.subscribe((state) => sendToBackend(state.encodedState, state.target));
```

**Publish/close pattern** — capture a consistent snapshot while briefly pausing new mutations:

```ts
const fence = boardRef.current!.acquireMutationFence('publish');
try {
  await boardRef.current!.settleActiveEdit('commit');   // flush any in-progress text edit first
  const target = await boardRef.current!.captureProjectionTarget();
  // ... persist boardRef.current!.serialize() / the Yjs state, tagged with `target` ...
} finally {
  fence.release();
}
```

`ProjectionStatus` values: `'healthy'` (projection is current), `'catching-up'` (behind but recovering), `'quarantined'`/`'incompatible'`/`'failed'` (the projection has detected a problem it can't resolve on its own — treat these as "do not trust this document's collaborative state for a publish/export" signals).

## ⚠️ Stability note

Of everything in this SDK, this is the surface with the thinnest real-world exercise: the app that consumes `glideboard` today (`ui/app/components/WhiteboardEditor.tsx`) wires real collaboration (a live `Y.Doc`/provider/user), but neither it nor the demo app has been observed driving `captureProjectionTarget`/`acquireMutationFence`/`waitForStoreRevision` through a real reconnect-under-load, two-tab, or backend-outage scenario in this codebase's tests. Treat the durability/checkpoint API in particular as **more likely to change shape** than the rest of this page as it gets exercised against real failure modes.
