# Document collaboration

Documents use the same collaboration model as whiteboards: every tab loads a server snapshot, exchanges Yjs updates and awareness over WebRTC/BroadcastChannel, and persists independently. No elected client controls loading, saving, or editing.

`document-v2:<spaceId>:<pageId>` signaling rooms do not elect a save leader. Awareness carries user details only; the document header shows collaborators without a leader badge.

## Persistence protocol

`GET editor/space/<spaceId>/page/<pageId>/edit` returns the revision base as `docId`, `draftGeneration` (defaults to zero when omitted), and `draft`. Its `data.data` contains the full Yjs state for drafts and for publications made through the new protocol. Older publications fall back to node data; clients seed that content and title using stable CRDT identities derived from the published document ID.

`PUT editor/update` requires `expectedRevision: { docId, generation, draft }` alongside the existing title, page, space, base64 Yjs data and asset references. The server locks the page before checking the revision and writing, including first-draft creation. Stale revisions return 409. Successful responses include `data.revision: { docId, generation, draft: true }` from the committed transaction.

Each tab serializes saves, merges the latest server state after a conflict, and retries with a fresh snapshot and asset references. Pending requests retry after network failure without requiring a new edit. Page events and foreground/online transitions reconcile server state with live Yjs content. There is no periodic document-state poll; revision conflicts remain the correctness backstop when events are missed. Server metadata never replaces an unsaved collaborative title.

Each tab retains pending snapshots using the whiteboard IndexedDB recovery adapter, scoped to user, space, page and tab. Checkpoints clear only through an acknowledged snapshot, leaving newer edits available for recovery.

Publishing first flushes the draft. `PUT editor/publish` requires that acknowledged `expectedRevision`; a concurrent save or publication returns 409 and leaves the editor open for retry. Published Yjs state is preserved for subsequent loads, retaining content identities through publications and offline recovery. Closing through the editor also flushes before navigating.

## Rollout and validation

Apply `updates/document_collaboration.xml` before deploying the API. Deploy UI, API and signaling server together and refresh existing document tabs: legacy tabs use a different signaling room and omit required revision fields.

The migration marks preserved publication state with `core.content_draft.published_yjs`, initially false for historical rows. This avoids treating an old, potentially stale draft snapshot as authoritative published content.

Regression tests cover independent concurrent writers, in-flight edits, retry, local recovery, publication transitions, duplicate-free bootstrap, preservation of live title/body edits, revision validation and leaderless signaling rooms. PostgreSQL integration tests require their disposable database configuration; two-browser WebRTC and migration rollout should also be exercised against the deployed stack.
