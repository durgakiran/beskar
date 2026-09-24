# Whiteboard asset APIs — v2

Whiteboards own their raster assets in the PostgreSQL `whiteboard` schema. Uploads
run independently of checkpoints and publication: committing a file does not
change the canvas, its durable sequence, or its published version.

Apply `db/beskar/updates/whiteboard_assets_v2.xml` and the subsequent
`whiteboard_assets_v2_legacy_cleanup.xml` through the existing Liquibase root
before deploying the server. Metadata, upload receipts, snapshot associations,
and cleanup jobs use v2 tables. Bytes use the existing filesystem/S3 abstraction
under the `whiteboard-v2-assets/` prefix. Ordinary v2 uploads and downloads use
v2 ownership. Migration additionally reads the legacy catalog and retains its
original files until the board is deleted.

## Routes

Base: `/api/v2/editor/space/{spaceId}/whiteboard/{pageId}`.
All requests require authentication and a matching board in the supplied space.
IDs follow the existing v2 contract: nonzero UUIDs and positive, JavaScript-safe
integer page IDs. No asset route accepts query parameters.

| Method | Path relative to the base | Access | Success |
| --- | --- | --- | --- |
| POST | `/assets/uploads` | edit | 201, stable upload receipt |
| PUT | `/assets/uploads/{uploadId}/content` | edit + upload owner | 200, confirmed staging |
| POST | `/assets/uploads/{uploadId}/commit` | edit + upload owner | 200, committed descriptor |
| GET | `/assets/uploads/{uploadId}` | edit + upload owner | 200, current state/receipt |
| DELETE | `/assets/uploads/{uploadId}` | edit + upload owner | 200, or 202 while cleanup remains |
| GET / HEAD | `/assets/{contentHash}/content` | edit | committed board-owned image |
| GET / HEAD | `/published/{versionId}/assets/{contentHash}/content` | view | image in that version's completed snapshot manifest |

The upload ID is not a credential. Every session operation verifies the current
actor and board/space ownership. A matching hash on a different board does not
grant access. There is no endpoint to delete an individual committed asset;
committed files remain until board deletion, including after removing their
canvas records.

## Upload flow

### 1. Prepare

Send `Content-Type: application/json` and exactly one UUID `Idempotency-Key` header.
Keep the key and metadata for retries. Keys are scoped to this board and actor;
reusing one with different metadata returns `409 IDEMPOTENCY_KEY_REUSED`.

```json
{
  "contentHash": "<64 lowercase SHA-256 hex characters>",
  "contentType": "image/png",
  "byteLength": 183204
}
```

The JSON limit is 16 KiB. All three fields are required; additional, duplicate,
or incorrectly cased field names are rejected. `byteLength` is a positive integer
of at most 20 MiB. Supported MIME types are `image/png`, `image/jpeg`, and
`image/webp`. Hash the exact original bytes that will be uploaded.

The response uses the existing success envelope:

```json
{
  "status": "success",
  "data": {
    "uploadId": "<UUID>",
    "state": "prepared",
    "expiresAt": "<UTC timestamp>",
    "uploadUrl": "<base>/assets/uploads/<UUID>/content",
    "statusUrl": "<base>/assets/uploads/<UUID>",
    "commitUrl": "<base>/assets/uploads/<UUID>/commit"
  }
}
```

A matching replay returns the original session and its current state. Terminal
receipts remain while the board exists; expiry does not free an old key for
different content. New uploads expire after 30 minutes. Each board permits at
most 100 active upload sessions; additional prepares return `503 ASSET_UPLOAD_BUSY`
until sessions complete, are cancelled, or are recovered after expiry.

### 2. Stage the original bytes

PUT the raw file to `uploadUrl` using its image MIME type in `Content-Type`.
Send no multipart wrapper, media-type parameters, or `Content-Encoding`.

The server bounds the body to 20 MiB, checks hash/size/MIME against the prepare
request, and fully decodes the image. Dimensions must be positive, at most
16,384 pixels each, and at most 64 million pixels overall. Image dimensions and
type come from inspected bytes. SVG uploads, remote URL imports, audio, video,
and arbitrary attachments are not supported. WebP support covers static lossy,
lossless, and alpha images; animated WebP is not supported.

A successful response reports `state: "staged"` only after storage is confirmed.
Exact PUT retries use the same upload ID and bytes. A transient `staging` state
means an operation is in progress; retry according to `Retry-After` or inspect
the status URL.

### 3. Commit, then insert into Yjs

POST to `commitUrl` with no body. The server confirms staged content and
atomically records or reuses the board-owned catalog entry, settles storage
usage once, and marks the upload committed. Concurrent identical uploads on the
same board deduplicate the catalog entry and release redundant reservations.

The receipt includes:

```json
{
  "uploadId": "<UUID>",
  "state": "committed",
  "asset": {
    "id": "asset:sha256:<hash>",
    "pageId": 42,
    "contentHash": "<hash>",
    "contentType": "image/png",
    "byteLength": 183204,
    "width": 1200,
    "height": 800,
    "downloadUrl": "<base>/assets/<hash>/content"
  }
}
```

Other receipt fields remain present. Only after receiving a confirmed committed
descriptor should the host insert the asset and image records into shared Yjs
state. Persist the asset ID and intrinsic metadata; construct authenticated
download URLs in the host resolver. Keep geometry, crop, and alt text in canvas
records.

`WhiteboardEditorV2` wires `WhiteboardAssetHttpAdapterV2` into Glideboard with
`assetStorage.commitOrder: 'before-document'`. Uploads run in the background;
users can continue drawing while the image is being uploaded or finalized.
Publish and Close await pending asset operations before capturing the document.

The adapter belongs to one mounted board session. Its resolution context uses
`documentId: "v2:<spaceId>:<pageId>"`; a `versionId` selects the published asset
route. A snapshot ID alone cannot authorize a published download. Switching boards,
restoring a draft, or closing the editor cancels the old session's pending work.
Published viewing and version history continue to display the immutable PNG preview.

Portable exports verify authorized asset access and download original bytes.
Portable imports verify the source bytes, then commit destination-owned assets
before inserting records. Durable source URLs must match a trusted v2 asset route
or the existing v1 whiteboard media route on the configured API origin. URLs with
credentials, query parameters, fragments, or a different origin are rejected.
[V1 migration](whiteboard-migration-v1-to-v2.md) also supports these assets. Its
read-only preview downloads verified legacy bytes; the migration server creates
independent v2 copies and commits ownership, quota, snapshot associations, and
legacy retention references atomically with the new board. Existing v1 files
remain retained. See the [migration browser verification](whiteboard-migration-assets-browser-verification-2026-09-16.md)
for migration, history, restore, and recovery results.

See the [integration verification report](whiteboard-assets-integration-browser-verification-2026-09-16.md)
for browser results against the actual API and disposable PostgreSQL database.
Deployments must include the updated Glideboard and Glideline builds, using local
package distributions or newly published versions containing these changes.

## Retry and cancellation

If a response is lost, GET the status URL or repeat the same operation with the
same upload ID. A lost response does not prove storage or commit failed.

DELETE the status URL, with no body, to cancel uncommitted work. Cancellation
serializes with commit. If commit already won, the result stays `committed`,
includes `retained: true`, and leaves the stored file intact. If cancellation
wins, commit cannot resurrect the session. A cancelled/expired receipt may have
`cleanupPending: true`; DELETE returns 202 while durable cleanup remains queued.

The host must retain confirmed committed bytes even when the local canvas edit
is cancelled or fails. Cancellation/expiry releases the reservation in its
database transaction and queues physical object cleanup. Board deletion releases
the board's accounted usage and preserves cleanup jobs before removing owner
rows. Physical deletion does not release quota a second time. Cleanup failures
remain observable and retry with bounded backoff.

For migrated boards, deletion captures retained v1 catalog and staging objects
alongside v2 objects, and settles both catalogs' usage and outstanding reservations.
Legacy cleanup jobs may run only after the page is deleted. Soft-deleted spaces
retain committed files; soft deletion is not a physical board purge.

Archived spaces reject new prepare/stage/commit work. They permit reads,
committed replays, and cancellation of uncommitted sessions.

### Cleanup operation

The server starts the durable cleanup worker with these settings:

| Setting | Default | Behavior |
| --- | --- | --- |
| `WHITEBOARD_ASSET_V2_CLEANUP_ENABLED` | enabled | Set `false` to disable the worker |
| `WHITEBOARD_ASSET_V2_CLEANUP_INTERVAL` | `1m` | Go duration, minimum `1s`; invalid values use the default |

The worker runs once at startup, then at the configured interval. Each pass
considers up to 100 expired/abandoned uploads and 100 object cleanup jobs.
Interrupted staging returns to prepared after its lease expires; expired
sessions become terminal and release reservations. Object attempts use
three-minute fenced leases, a one-minute storage-operation deadline, and at most
eight attempts with exponential backoff. An interrupted final attempt also
becomes visibly exhausted. Jobs never delete an object referenced by the live
catalog or an active upload.

Logs report expired, recovered, deleted, failed, and exhausted counts. Failed jobs
retain a bounded `last_error`; exhausted jobs remain in the database for operator
investigation. A read-only operational check is:

```sql
SELECT count(*) FILTER (WHERE completed_at IS NULL AND exhausted_at IS NULL) AS pending,
       count(*) FILTER (WHERE exhausted_at IS NOT NULL) AS exhausted
FROM whiteboard.whiteboard_asset_cleanup;
```

## Downloads, publication, and restore

Editor downloads require edit permission and exact board ownership. Published
downloads require view permission, a matching immutable version, and membership
in that snapshot's completed manifest. Knowing a content hash never bypasses
these checks.

Responses use the verified image MIME, quoted SHA-256 ETag,
`Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`. GET supports one
byte range, including suffix/open ranges, `If-Range`, and `If-None-Match`. Multiple
or unsatisfiable ranges return 416. HEAD ignores Range and describes the complete
representation without a body. A missing or unreadable stored file returns
`503 ASSET_CONTENT_UNAVAILABLE`.

Publication reconstructs the exact Yjs state and validates raster IDs, immutable
metadata, and same-board committed ownership. It records all live raster asset
records, including records no longer referenced by a shape. The associations and
digest-bound completion manifest are written atomically with the snapshot/version.
Self-contained validated path vectors remain inline; they do not need raster
catalog entries. Invalid or uncommitted external references reject publication.
Extraction supports the current v2 editor's built-in record schemas and supported
legacy shapes/bindings. Custom shapes, opaque records, unknown schema versions,
and ambiguous legacy/v2 roots are rejected because their asset dependencies cannot
be established safely. Hosts adding custom schemas must extend the server extractor
before those documents can be published or restored.

Restore reinspects the immutable source state and its digest, checks its catalog
dependencies, and copies the validated associations into the restored snapshot.
Successful idempotent publication/restore retries return the original receipt.
Checkpoints still acknowledge durable Yjs bytes; they do not materialize the full
board or validate all asset references on every update.

## Errors

Errors use the existing v2 `status`/`error.code`/`error.message` envelope.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Invalid IDs, JSON, metadata, image bytes, or body/query contract |
| 401 / 403 | `UNAUTHENTICATED` / `WHITEBOARD_FORBIDDEN` | Missing authentication or required page permission |
| 404 | `WHITEBOARD_NOT_FOUND` / `ASSET_NOT_FOUND` | Missing/mismatched board, session owner, asset, or version membership |
| 409 | `ASSET_NOT_READY` / `ASSET_UPLOAD_CONFLICT` | Content not ready or illegal session transition |
| 409 | `IDEMPOTENCY_KEY_REUSED` / `SPACE_ARCHIVED` | Conflicting key payload or new work in an archived space |
| 409 | `ASSET_QUOTA_EXCEEDED` | Account storage quota exhausted |
| 409 | `ASSET_INVALID_REFERENCE` | Publication/restore contains invalid asset references |
| 410 | `ASSET_UPLOAD_EXPIRED` | Upload eligibility expired |
| 413 | `REQUEST_TOO_LARGE` / `ASSET_TOO_LARGE` | Body, encoded bytes, dimensions, or pixel limit exceeded |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Unsupported request/file MIME or content encoding |
| 503 | `ASSET_UPLOAD_BUSY` / `ASSET_CONTENT_UNAVAILABLE` | Transient lock or storage failure; `Retry-After: 1` |
| 500 | `ASSET_OPERATION_FAILED` | Operation outcome unconfirmed; inspect session status before retrying |

See the [OpenAPI console](README.md) for request and response schemas, and the
[design plan](whiteboard-assets-v2-plan.md) for lifecycle rationale.
