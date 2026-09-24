# Whiteboard checkpoint v2

## Request

`POST /api/v2/editor/space/{spaceId}/whiteboard/{pageId}/checkpoint`

Authenticated session, page `edit` permission, `Content-Type: application/json`, and one nonzero UUID `Idempotency-Key` are required. The board must belong to the supplied space. Page IDs are positive JavaScript-safe integers.

```json
{
  "updateEncoding": "yjs-update-v1",
  "update": "<base64-encoded incremental Yjs update>"
}
```

The server permits at most 1 MiB decoded bytes and a 1.5 MiB JSON body. Unknown fields, extra JSON values, unsupported encodings, invalid Base64, and malformed Yjs v1 wire structures are rejected. Nested lib0 values are limited to 64 levels. Empty document encoding `00 00` is valid; zero bytes are not.

The client design targets 256 KiB or a flush after two seconds of pending edits. This endpoint does not implement that client queue. Retain the exact pending bytes and key until acknowledged; newer edits use another batch/key. Preserve individual Yjs updates before merging batches: arbitrary byte slicing does not produce valid updates. A single update above the server limit requires explicit handling rather than retries of the unchanged payload.

Images upload separately. Optional `title` changes are ordered with the checkpoint; see [title changes](whiteboard-title-v2.md). Snapshot compaction and collaboration broadcasting are separate.

## Acknowledgement

First submission and matching retry both return HTTP 200:

```json
{
  "status": "success",
  "data": {
    "pageId": 42,
    "updateId": "0195ad23-831a-7000-8000-000000000100",
    "sequence": "17"
  }
}
```

The sequence is the durable position of this batch, encoded as a string to preserve BIGINT precision. It is not necessarily the latest draft head when the response arrives. A retry returns the original update ID and sequence.

## Persistence and concurrency

Deploy the included `updates/whiteboard_updates.xml` Liquibase changesets before using the endpoint; the table column is `update_encoding`.

The service begins a Read Committed transaction and sets `SET LOCAL lock_timeout = '3s'`. It locks the space with FOR SHARE, then page/board with FOR SHARE to stabilize membership and deletion, then draft with FOR UPDATE. Future lifecycle/compaction operations should follow that lock order.

Under the draft lock, the service looks up `(page_id, actor_id, idempotency_key)`. The request hash is `sha256:` plus the lowercase SHA-256 hex digest of UTF-8 encoding name, one zero byte, then decoded update bytes. Matching retries return the stored acknowledgement without writes. Different content under the same key returns 409.

Authorized matching retries can acknowledge an earlier commit even after space archival or soft deletion. New batches are rejected for archived/deleted spaces. Missing drafts are internal integrity errors, not silently recreated.

For a new batch, insert `whiteboard_update` at `head_sequence + 1`, advance the existing draft's head, actor and timestamp, and commit together. The base snapshot is unchanged. Errors roll back; permission provisioning is not part of checkpointing. Sequence exhaustion is rejected rather than overflowing.

No advisory lock or expected-head precondition is needed. The draft row lock serializes same-board saves. Different actors' batches may overlap; idempotency scopes API submissions, while Yjs handles overlapping document changes. Keep retry metadata before pruning update rows during future compaction.

## Binary validation

The Go wire scanner validates the supported Yjs 13 update-v1 layout without materializing a CRDT document. It bounds reads/counts, limits nested lib0 values, checks tags and lengths, and rejects trailing bytes. It accepts references to earlier batches: it does not require updates to be independently applicable to an empty document.

This is structural validation, not drawing-schema validation, causal completeness verification, or proof that an update is consistent with the full existing document. Original bytes are stored unchanged.

Compatibility fixtures are generated using the repository's Yjs 13.6.27 installation:

```sh
node server/editor/testdata/generate-whiteboard-yjs.cjs
```

They cover empty/full documents, dependent incremental batches, rich text, nested values, binary values, XML, subdocuments, deletions, and overlapping/gapped merges. Changes to the supported wire format require validator and fixture updates.

## Errors

Errors use `{"status":"FAILED","error":{"code":"...","message":"..."}}`.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | INVALID_REQUEST | Invalid IDs, key, JSON, encoding, Base64 or Yjs wire structure |
| 401 | UNAUTHENTICATED | Missing/invalid identity |
| 403 | CHECKPOINT_FORBIDDEN | Page edit permission denied |
| 404 | WHITEBOARD_NOT_FOUND | Board/space missing or mismatched, or new write to deleted space |
| 409 | SPACE_ARCHIVED | New write to archived space |
| 409 | IDEMPOTENCY_KEY_REUSED | Same scoped key with different content |
| 413 | REQUEST_TOO_LARGE | JSON body or decoded payload exceeds its limit |
| 415 | UNSUPPORTED_MEDIA_TYPE | Content type is not application/json |
| 503 | WHITEBOARD_CHECKPOINT_BUSY | Lock timeout; Retry-After: 1 |
| 500 | WHITEBOARD_CHECKPOINT_FAILED | Save could not be confirmed or integrity error |

After a timeout, transport failure, 500 or 503, retry the same batch and key. A 413 requires addressing payload size; do not blindly retry. The lock timeout applies per acquisition, not to the total request duration. Existing nginx body limits exceed this endpoint's limit, which is enforced by Go.

## Implementation

- `server/editor/whiteboardControllerV2.go`: registers the endpoint on the authenticated v2 editor router.
- `whiteboardCheckpointControllerV2.go`: HTTP validation, authorization and error mapping.
- `whiteboardCheckpointServiceV2.go`: hashing, transactional append and replay.
- `whiteboardCheckpointQueriesV2.go`: SQL.
- `whiteboardCheckpointTypesV2.go`: contract types and limits.
- `whiteboardCheckpointValidationsV2.go`: JSON/Base64 validation.
- `whiteboardYjsValidation.go`: bounded v1 wire scanner.

For a title-only rename, send `update: "AAA="` with `title`. See [title changes](whiteboard-title-v2.md) for validation, replay and listing behavior.

## Restored drafts

Send the draft manifest’s `restoreGeneration` decimal string on every checkpoint. Omission means `"0"`. Stale generations return `409 WHITEBOARD_RESTORED`, including retries, and require loading the restored draft into a fresh CRDT/collaboration session. See [restore semantics](whiteboard-history-v2.md).
