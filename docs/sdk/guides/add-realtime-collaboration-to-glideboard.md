# Guide: Add real-time collaboration to a glideboard whiteboard

**Use case:** multiple users editing the same board simultaneously, with live cursors/presence, and a durable save path that survives a network drop or a client closing mid-edit.

**Reference:** [glideboard: Collaboration](../glideboard/collaboration.md).

`glideboard` doesn't ship a transport — you supply a Yjs `Y.Doc` and provider (`y-websocket` is the common default; anything duck-typed to `GlideboardCollaborationProvider` works). This guide walks the pieces together; see the reference page for the full type contract.

## 1. Set up the Yjs doc and provider

```ts
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

function useCollaborationSession(boardId: string, wsUrl: string) {
  const [state, setState] = useState<{ doc: Y.Doc; provider: WebsocketProvider } | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(wsUrl, boardId, doc);
    setState({ doc, provider });
    return () => {
      provider.destroy();
      doc.destroy();
    };
  }, [boardId, wsUrl]);

  return state;
}
```

**One `Y.Doc`/provider pair per mounted board.** Awareness providers are session-owned in `glideboard`'s model — sharing one across two mounted `<Glideboard>` instances (e.g. a list preview and a full editor open at once) will cause presence state to bleed between them.

## 2. Wire it into `<Glideboard>`

```tsx
function WhiteboardPage({ boardId, currentUser }: { boardId: string; currentUser: { id: string; name: string; color: string } }) {
  const session = useCollaborationSession(boardId, 'wss://collab.example.com');
  if (!session) return <Loading />;

  return (
    <Glideboard
      sessionKey={boardId}
      collaboration={{
        doc: session.doc,
        provider: { awareness: session.provider.awareness, synced: session.provider.synced },
        user: currentUser,
        boardIdentity: boardId,
      }}
    />
  );
}
```

`provider.synced` gates whether `glideboard` will seed an empty shared document — pass the provider's real synced state, not a hardcoded `true`, or two clients connecting to a genuinely-empty board at the same moment can race to seed it. `boardIdentity` guards against a stale/wrong `Y.Doc` getting attached (e.g. a component re-render race handing a board a doc for a different `boardId`) — set it even though it's optional.

## 3. Presence UI

`CollaborationAvatars`/`CollaborationCursors` (rendered internally by `<Glideboard>` once `provider.awareness` is present) give you avatars and live cursors for free. If you need custom presence UI beyond that, read other peers' state defensively rather than trusting it — see the awareness parsers:

```ts
import { parseAwarenessUser, parseAwarenessCursor, safeAwarenessEntries } from '@durgakiran/glideboard';

for (const [clientId, state] of safeAwarenessEntries(session.provider.awareness)) {
  const user = parseAwarenessUser(state.user);     // null if malformed, not a throw
  const cursor = parseAwarenessCursor(state.cursor);
  // ...
}
```

## 4. The durable-save / publish flow

Real-time sync answers "what does everyone see right now" — it does **not** by itself tell you the server has durably persisted anything. For a "Publish" or "Save and close" action that must act on confirmed server state:

```tsx
async function handlePublish() {
  const board = boardRef.current!;
  const fence = await board.prepareForCapture('publish', { signal: sessionAbortSignal });
  try {
    await board.settleActiveEdit('commit');       // flush any in-progress text edit
    const target = await board.captureProjectionTarget();
    await fetch(`/api/boards/${boardId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ target, document: board.serialize() }),
    });
  } finally {
    fence.release();
  }
}
```

`prepareForCapture('publish')` immediately blocks new imports, waits for pending uploads/paste/library placements to insert their records, then acquires a mutation fence. Drawing remains available during the wait. Catch a preparation failure in the host so users can review failed imports; abort the optional signal when the editor session ends. Release the returned fence in `finally` so a failed publish doesn't leave the board fenced. Acquiring a fence before waiting would block pending insertions. `getPendingAssetCount()` provides a synchronous count for navigation/unload prompts.

`captureProjectionTarget()` gives you a `{ storeRevision, yjs: { transactionSequence, stateDigest } }` you can send alongside the document so your backend can verify what state it's actually acknowledging, rather than trusting "whatever arrived in this request."

For a lighter-weight "show a save indicator" without a full publish flow, subscribe to `boardRef.current!.checkpoints.status` (`'healthy' | 'catching-up' | 'quarantined' | 'incompatible' | 'failed'`) and render accordingly — `'catching-up'` is a normal transient state (just reconnected), `'quarantined'`/`'incompatible'`/`'failed'` mean something is actually wrong and a save/publish action should probably be disabled until it resolves.

## Known gap

As of writing, this codebase's own consumer app wires the real-time sync path (step 1–3) against a production backend, but nothing in this repo exercises the durable-save/publish flow (step 4) against a real reconnect-under-load or backend-outage scenario — see the [stability note on the collaboration reference page](../glideboard/collaboration.md#️-stability-note). Test that path deliberately (kill the websocket mid-publish, publish while `'catching-up'`) before relying on it for anything where "the server has what I think it has" matters.
