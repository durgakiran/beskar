# Whiteboard v2 history, restore, and deletion

Base path: `/api/v2/editor/space/{spaceId}/whiteboard/{pageId}`. All endpoints require authentication and current page permission. Reads allow archived spaces; writes reject archived/deleted spaces. Version IDs must belong to the specified board and space. Responses use the existing success/error envelopes except DELETE (no body).

| Method | Path | Permission | Behavior |
| --- | --- | --- | --- |
| GET | `/versions?limit=20&before=12` | view | Published versions, newest first. `limit` is 1–100; `before` is an exclusive positive decimal version number. |
| GET | `/versions/{versionId}` | view | One immutable publication's metadata, snapshot download URL, and preview metadata/URL. |
| POST | `/versions/{versionId}/restore` | edit | Replace the draft with that publication's state and title. |
| DELETE | base path | delete | Delete a leaf board and its content. Returns 204, including an already absent board after authorization. |

## History

List `data` contains `versions` (an array of the existing published manifests) and optional `nextBefore`. Pass `nextBefore` as `before` to get the next page. Numbers representing sequences, generations and version numbers are decimal strings to preserve int64 precision. New publications do not shift an existing pagination boundary. An unpublished board returns an empty array. A missing board/version returns 404.

## Restore

Required header: `Idempotency-Key: <UUID>`.

```json
{"expectedHeadSequence":"12"}
```

Read the head from the draft manifest. Restore takes the board/draft locks, verifies that head, copies the immutable version snapshot to a new snapshot at head+1, increments the draft's `restoreGeneration`, and records a retry receipt in one transaction. State bytes are copied within PostgreSQL. The existing published pointer and historical versions remain unchanged; publish explicitly when ready.

Example response `data`:

```json
{
  "pageId":125,
  "versionId":"6da9e4f4-9ae9-4bbe-a56f-a73137485cec",
  "snapshotId":"75794d51-4d5a-44ce-b390-d0b8fa923ed5",
  "sequence":"13",
  "restoreGeneration":"1"
}
```

An identical actor/board/key/version/expected-head retry returns the original result without restoring again. A changed payload with the same key returns `409 IDEMPOTENCY_KEY_REUSED`. Concurrent edits/restores produce `409 DRAFT_HEAD_CHANGED`; fetch the current draft and make a new deliberate restore request. Missing versions and failed transactions leave the draft untouched.

### Active collaborators and offline recovery

The draft manifest now includes `restoreGeneration`, initially `"0"`. Checkpoints (including title-only changes) send this field. Omission means generation zero for compatibility with boards never restored. After restoration, all older-generation submissions—including old checkpoint retries—return `409 WHITEBOARD_RESTORED`.

The v2 UI detects the changed generation before applying server state, discards an in-memory pending publication, recreates the editor, and joins a generation-specific WebRTC room. IndexedDB and pending title storage are scoped to the generation. Previous local recovery is retained separately, never merged automatically into restored content. Existing clients may take up to the synchronization interval to detect a restore; server write fencing applies immediately. Older clients that do not support generations cannot save to a restored board.

New publications targeting sequences before the latest restore boundary are rejected. Retrying an already accepted publication returns its immutable receipt without moving the published pointer.

Selected behavior: replace the current draft with an explicit head precondition. Alternatives considered: merge old snapshot bytes into the existing Y.Doc (does not undo later CRDT changes), silently overwrite concurrent edits (loses work), or restore into a new board (different user-facing operation).

## Delete

Deletion rejects child pages with `409 WHITEBOARD_HAS_CHILDREN`; move/delete them first. The transaction removes the published pointer, previews, versions, replay leases, draft, title updates, snapshots, update log, restore receipts, board, and core page. It does not recursively delete a page tree. Read transactions already holding an MVCC snapshot may finish; later reads fail.

Creation receipts retain their original identity and page number as tombstones. Replaying an old create request returns 404 instead of recreating deleted content. Existing permission relationships are not removed from the external permission service in this transaction; content APIs require the board to exist, IDs are not reused, and permission revocation is not used as the deletion mechanism. Asset management remains deferred; this endpoint does not implement object-store garbage collection.

Selected behavior: atomic permanent deletion of a leaf board. Alternatives: soft-delete/trash and recursive tree deletion; both require broader product and retention contracts.

## Migration and verification

Apply `db/beskar/updates/whiteboard_history.xml` via the main changelog before deploying the server. It adds the restore generation and receipts, and removes the create-receipt FK so request tombstones can survive deletion. Structural changes use Liquibase XML; the grant uses SQL as in existing changesets. Rolling back after deletions removes orphan creation tombstones and therefore loses that retry protection.

Tests cover HTTP authentication, permissions, validation, large integer precision, history pagination, immutable metadata, cross-space isolation, failed restore rollback, idempotent restore, concurrent restore fencing, old-generation checkpoint rejection, publication after restore, archived writes, child-page protection, deletion cleanup and creation tombstones.

### Live browser verification — 2026-09-14

Using the explicitly approved test account against rebuilt local services, created isolated board 127 in the QA space. Published a one-shape version and a two-shape version, verified paginated history and historical metadata, and restored the first version with two independent authenticated editor contexts open. Both editors reloaded the one-shape draft and then collaborated on a new second shape. The current publication remained unchanged. A generation-zero checkpoint received 409; identical restore retries returned the original result and did not overwrite later edits.

Deleted that test board: initial DELETE and retry returned 204; draft, current publication, history, version metadata, and historical preview returned 404. The original creation retry returned 404, both active editors paused, and page listing excluded the board. The pre-existing QA board 125 was left unchanged. Screenshot: `output/playwright/v2-history-restored.png`.

The live test found and fixed a canvas identity mismatch: the identity embedded in Yjs stays stable across restores, while the WebRTC room, editor instance and recovery storage change. This avoids treating an otherwise valid historical snapshot as an incompatible board.

Validation: 75 UI tests, Go editor/core/API-documentation tests, the real PostgreSQL integration test with migrations, and four API-console tests passed. Server and UI production builds passed. Repository-wide TypeScript checking still reports existing invite/settings and legacy-editor errors; no new errors occurred in changed v2 code. The normal db-init image rebuild encountered upstream apt signature errors; the existing image successfully applied the current read-only-mounted XML changelog.

## UI integration

The published view and editor now expose **Version history**. The dialog supports pagination, selected-version PNG previews, restore confirmation, conflict review and stable retries. The shared view’s Delete action uses the v2 deletion API and displays errors without dismissing the confirmation. See [UI verification](whiteboard-ui-v2-testing.md) for automated and live browser results.
