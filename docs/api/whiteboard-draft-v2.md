# Get whiteboard draft — v2

The editor reconstructs a draft from a small manifest, a separate binary snapshot download, and bounded pages of incremental Yjs updates. Apply `db/beskar/updates/whiteboard_draft_replay.xml` through the main Liquibase changelog before enabling these routes.

All requests require the application's authenticated cookie/bearer session and current page `edit` permission. Draft content is unpublished; page view permission is insufficient. The board must belong to the supplied space. Archived spaces remain readable; deleted spaces do not. Space IDs are nonzero UUIDs, and page IDs are positive JavaScript-safe integers. Responses use `Cache-Control: no-store`.

## Manifest

`GET /api/v2/editor/space/{spaceId}/whiteboard/{pageId}/draft`

No body, query parameters, or idempotency key. HTTP 200:

```json
{
  "status": "success",
  "data": {
    "pageId": 42,
    "spaceId": "c7022348-1bb3-4e52-8403-17786e15e035",
    "headSequence": "17000",
    "baseSnapshot": {
      "id": "0195ad23-831a-7000-8000-000000000001",
      "throughSequence": "16000",
      "title": "Architecture discussion",
      "updateEncoding": "yjs-update-v1",
      "downloadUrl": "/api/v2/editor/space/c7022348-1bb3-4e52-8403-17786e15e035/whiteboard/42/snapshots/0195ad23-831a-7000-8000-000000000001/content?replay=<replay UUID>",
      "byteLength": 25165824,
      "stateDigest": "sha256:<64 lowercase hexadecimal characters>"
    },
    "updatesUrl": "/api/v2/editor/space/c7022348-1bb3-4e52-8403-17786e15e035/whiteboard/42/draft/updates?cursor=<opaque cursor>",
    "expiresAt": "2026-09-13T11:00:00Z",
    "updatedBy": "0195ad23-831a-7000-8000-000000000002",
    "updatedAt": "2026-09-13T09:55:00Z"
  }
}
```

All sequence fields are decimal strings, matching checkpoint acknowledgements and preserving BIGINT precision. `headSequence` is fixed for this replay. Later saves do not enter its update pages. `baseSnapshot.title` belongs to the base snapshot boundary; top-level `title` belongs to the captured head. Update pages include optional `title` metadata for rename checkpoints. `byteLength` is the raw snapshot byte count, not Base64 length. URLs are same-origin application paths; clients should follow the returned paths rather than construct cursors.

The manifest creates an actor-scoped, one-hour replay lease. It changes no document content, draft head, or publication state. Repeating the manifest request creates another lease and may capture a newer head. Retry an individual page/download using its original URL while its lease remains valid.

For a newly created board, base and head are both `"0"`, the snapshot download contains the two bytes `00 00`, and the update endpoint returns an empty, complete page.

## Snapshot download

`GET /api/v2/editor/space/{spaceId}/whiteboard/{pageId}/snapshots/{snapshotId}/content?replay={replayId}`

`HEAD` is also supported. The replay must belong to this actor and board, be unexpired, and identify this exact snapshot. Authorization is checked before serving bytes or answering conditional requests.

A successful full download returns raw Yjs update-v1 bytes with HTTP 200:

```http
Content-Type: application/octet-stream
Content-Length: 25165824
Accept-Ranges: bytes
ETag: "sha256:<snapshot digest>"
Cache-Control: no-store
X-Accel-Buffering: no
```

One HTTP byte range per request is supported, including `bytes=0-65535`, `bytes=65536-`, and `bytes=-65536`. A satisfiable range returns 206 and `Content-Range`. Use `If-Range` with the ETag to resume the same snapshot. An unsatisfiable or malformed range returns 416; multiple ranges are rejected. `If-None-Match` can return 304; failed `If-Match` can return 412. These responses contain no snapshot bytes. HEAD returns headers without reading snapshot bytes.

The PostgreSQL reader fetches at most 256 KiB of `state_bytes` per query using bytea `substring`, reusing a bounded buffer for adjacent reads. The Go server never loads the complete snapshot. PostgreSQL may internally detoast/decompress a larger value; this is not a guarantee of bounded database CPU or memory for compressed bytea. The reader holds a read-only Repeatable Read transaction for the duration of the download, releasing it on completion, failure, or cancellation. Long/slow downloads therefore occupy a database connection and retain an MVCC snapshot; account for this in pool/proxy capacity. A future object-storage reader can replace this reader without changing the manifest contract.

The client must assemble the complete snapshot and verify byte length/digest before applying it to Yjs. Byte ranges are transport chunks, not independently applicable Yjs updates. A storage failure after response headers aborts the transport; the server never appends a JSON error to a partial binary response. Retry/resume while the lease is valid, or restart from a fresh manifest after expiry.

## Update pages

`GET /api/v2/editor/space/{spaceId}/whiteboard/{pageId}/draft/updates?cursor={cursor}`

The first cursor comes from `updatesUrl`. HTTP 200:

```json
{
  "status": "success",
  "data": {
    "headSequence": "17000",
    "updates": [
      {
        "sequence": "16001",
        "updateEncoding": "yjs-update-v1",
        "update": "<base64-encoded incremental update>"
      }
    ],
    "nextCursor": "<opaque cursor>",
    "complete": false
  }
}
```

Each page contains at most 64 whole updates and at most 4 MiB of decoded update bytes. JSON/Base64 adds approximately one third to the byte payload. Individual stored updates must satisfy the existing 1 MiB checkpoint limit. No update is sliced into invalid Yjs fragments. Updates are ordered by sequence, starting immediately after the cursor's position and ending no later than the captured head.

Pass `nextCursor` to the same endpoint until `complete` is true. The final page has `nextCursor: null`; `updates` is always an array. Repeating a cursor returns the same bytes and continuation while its lease remains valid. Do not interpret one page's final sequence as the captured head unless `complete` is true. Missing rows, unsupported encodings, oversized stored batches, and sequence gaps fail closed; an incomplete replay never reports completion. A missing tail may only become detectable on the next page.

Cursors bind replay identity and the last returned sequence using HMAC-SHA256 with a per-replay secret stored in PostgreSQL. Clients must treat them as opaque. Replay lookup additionally enforces actor and board scope. No signing key configuration or process-local state is needed, so multiple server instances can serve the same replay.

## Consistency, retention, and lifecycle

Manifest creation uses a short Read Committed transaction, locking space, page/board, then draft with shared locks. It captures the base/head and inserts the lease before releasing those locks. Checkpointing may briefly wait for manifest creation; downloads/pages never hold the draft lock. Missing drafts/base snapshots and invalid boundaries are integrity failures, not reasons to silently recreate a draft.

Each page or binary download uses its own read-only Repeatable Read transaction. A request that starts with a valid lease can finish consistently even if expiry/cleanup/compaction happens while it is running. Subsequent requests recheck expiry and current permissions. New saves cannot extend the captured head.

The lease's composite snapshot foreign key retains the base snapshot until the lease is deleted. A database DELETE trigger protects update rows within active leases' `(base_sequence, head_sequence]` intervals. Accepted snapshot/update contents remain immutable by service convention, as in the existing schema.

Future compaction must use Read Committed, acquire locks in the same space → page/board → draft order (exclusive draft lock), preserve checkpoint retry receipts, atomically advance the base, and prune only rows not required by active leases. This lock order prevents a lease from being created between capture and pruning. Expired leases for a board are cleaned up opportunistically when a new manifest is requested. Compaction must also clean expired leases before deleting old snapshots; there is no background cleanup worker in this change.

Explicit document deletion should remove replay leases before related updates/snapshots, along with the other records required by the deletion contract. Deletion and permission revocation override access to later requests; a lease is not an access grant.

## Errors

JSON errors use `{"status":"FAILED","error":{"code":"...","message":"..."}}`.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Invalid IDs, missing/duplicate/unknown query parameters, malformed or tampered cursor |
| 401 | `UNAUTHENTICATED` | Missing or invalid application identity |
| 403 | `DRAFT_FORBIDDEN` | Current page edit permission denied |
| 404 | `WHITEBOARD_NOT_FOUND` | Missing/deleted/mismatched board or snapshot does not belong to this replay |
| 410 | `DRAFT_REPLAY_EXPIRED` | Lease expired, removed, unknown, or belongs to another actor/board; request a fresh manifest |
| 416 | `INVALID_RANGE` | Multiple byte ranges; standard single-range HTTP errors use a plain-text 416 response |
| 500 | `WHITEBOARD_DRAFT_READ_FAILED` | Database operation or stored-data integrity failure before binary transfer |
| 503 | `WHITEBOARD_DRAFT_BUSY` | Manifest lock timeout; retry with `Retry-After: 1` |

Authentication middleware may return its existing errors or login redirects before the handler. Standard download conditional/range handling can return 304, 412, or 416 outside the JSON envelope. Binary transfer failures after headers require detecting an interrupted response rather than parsing a JSON error.

## Verification

Controller tests cover authorization on all routes, request validation, sequence serialization, full/HEAD/range downloads, conditional resume, and broken-stream abortion. The PostgreSQL integration test executes the actual replay migration and rollback against a disposable database and checks page byte/count limits, pinned heads across checkpointing, cursor tampering/scope/expiry, retention, chunk-boundary seeking, MVCC download survival during compaction, archived/deleted spaces, and sequence gaps.

From the repository root with Go 1.26.4:

```sh
go test ./server/editor ./server/apidocs ./server/auth ./server/core ./server
node --test server/apidocs/console.test.cjs
WHITEBOARD_DRAFT_TEST_DSN='postgres://postgres@127.0.0.1:5432/whiteboard_draft_test?sslmode=disable' go test ./server/editor -run TestDraftV2Postgres -count=1
```

The integration test requires Liquibase on PATH and a **disposable** database named `whiteboard_draft_test` and replaces its `core` and `whiteboard` schemas and public Liquibase tracking tables. Without that environment variable, it is skipped.
