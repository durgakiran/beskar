# Whiteboard assets — v2 implementation plan

Status: backend, Glideboard, and v2 editor integration implemented, 2026-09-16.
See the [API guide](whiteboard-assets-v2.md) for the
implemented contract; this document also preserves the design rationale and
remaining rollout work.

### Editor integration — 2026-09-16

- The session-owned HTTP adapter handles prepare/upload/commit/status/cancel,
  authenticated original-byte downloads, portable exports, and destination-owned
  portable imports. It selects `before-document` ordering.
- Board identity and optional publication version scope asset resolution. Session
  teardown aborts pending work; late preview completion cannot publish another board.
- Published viewing/history remain PNG previews. Image-bearing v1 migration and
  shared asset libraries remain separate follow-ups.

### Backend implementation — 2026-09-15

- Eight Liquibase changesets add the board-owned catalog, upload receipts, snapshot
  associations/manifests, durable cleanup jobs, constraints, and grants.
- Independent prepare/stage/commit/status/cancel and authenticated content routes
  enforce image inspection, ownership, retries, quota, and archived-space rules.
- Publication and restore establish validated snapshot membership. Board deletion
  and the cleanup worker settle reservations and recover interrupted object writes.
- HTTP, storage, materializer, and real PostgreSQL integration tests cover these
  paths, including concurrent commits and delayed writes after cancellation/deletion.
- Changesets were tested on disposable PostgreSQL; the application database has
  not been migrated by this task.

### Package implementation — 2026-09-15

The Glideboard portion is implemented and used by the v2 editor's HTTP adapter.

- Hosts opt into `assetStorage.commitOrder: 'before-document'`. Existing adapters
  default to their existing order. Confirmed storage precedes shared image records;
  late cancellation retains committed files.
- File import, replace, portable paste, and library placement participate in
  pending-operation tracking. Upload status distinguishes finalization from completion.
- `prepareForCapture()` gates new imports, drains pending operations, then returns
  a releasable mutation fence. V2 publish/close use it; unload checks pending assets.
- Completion preserves the captured destination and newer interactions. Clipboard
  capture remains immediate so synchronous Cut retains its original payload.
- Package, engine, and app regression tests cover ordering, collaboration, cleanup,
  replacement, capture, and legacy behavior. A real-browser deferred-commit check
  confirmed continued drawing, zero image records before confirmation, successful
  capture after confirmation, and preservation of the Draw tool.

See the [SDK asset guide](../sdk/glideboard/assets.md) for the implemented contract.

## 1. Direction

Give v2 whiteboards their own asset catalog, upload sessions, snapshot associations,
and cleanup records in the PostgreSQL `whiteboard` schema. Expose a dedicated
asset API underneath the existing v2 whiteboard resource. Uploading an asset does
not checkpoint the canvas, advance its sequence, or publish a version.

Implemented defaults:

- Each asset belongs to one whiteboard. Reusing it on another board creates a
  destination-owned asset, deduplicated within that destination.
- Metadata and lifecycle state live in `whiteboard`; file bytes use the existing
  filesystem/S3 storage abstraction under a separate v2 key prefix.
- Start with PNG, JPEG, and WebP uploads, matching current raster imports.
  Sanitized, self-contained vector assets continue to live in canvas records.
- Retain committed uploads until the board is deleted. Removing an image from
  the canvas does not delete its stored file or release its storage usage.

Shared authentication, page permissions, blob storage, and billing remain shared
infrastructure. V2 asset ownership and references do not depend on
`core.whiteboard_asset`, `core.whiteboard_asset_staging`, `core.asset_reference`,
or legacy document IDs.

## 2. Starting point and integration requirements

This table records the behavior before the implementation above. Asset-bearing
v1 migration remains a follow-up.

| Existing behavior | Consequence for this work |
| --- | --- |
| V2 board identity, draft, updates, snapshots, and publications already live in `whiteboard`. | Asset ownership should reference `whiteboard.whiteboard(page_id)`. |
| V1 has prepare/upload/commit/cancel, inspection, quota reservations, and cleanup. Its catalog and references live in `core`. | Reuse infrastructure and validation concepts; introduce a v2 domain service and SQL. |
| V2 checkpoints validate Yjs wire structure and store incremental bytes. They do not reconstruct the document. | A checkpoint cannot establish a complete live asset set. |
| Publication reconstructs complete state but deliberately ignores asset semantics. | Extend the materializer and publication transaction with authoritative asset validation. |
| V2 draft reads require edit permission; published reads require view permission. | Apply the same separation to asset downloads. |
| Restore copies snapshot bytes; board deletion currently has no v2 asset cleanup. | Integrate reference copying, cleanup jobs, and quota settlement. |
| The v2 editor has no raster storage adapter; migration rejects asset-bearing boards. | Upload APIs alone are insufficient to enable imports or asset-bearing migration. |

The earlier [incremental entity proposal](../whiteboard-incremental-entity-model.md)
assumed reuse of the legacy catalog. This plan replaces that assumption for v2
assets and preserves its conservative retention rule.

## 3. Schema

Add a new Liquibase file, `whiteboard_assets_v2.xml`. Keep existing v1 migrations
and tables intact.

| Table | Identity and principal fields | Purpose |
| --- | --- | --- |
| `whiteboard.whiteboard_asset` | PK `(page_id, content_hash)`; unique `storage_key`; `file_size`, `mime_type`, `width`, `height`, `created_by`, `created_at`, bounded `provenance`, `inspector_version` | Catalog of validated, committed files. Presence means READY; staged content never appears here. |
| `whiteboard.whiteboard_asset_upload` | PK `id` UUID; unique `(page_id, actor_id, idempotency_key)`; `request_hash`, expected hash/type/size, staging key, verified metadata, state, timestamps/expiry, quota reservation correlation, worker lease/fence | Retryable upload session and terminal receipt. |
| `whiteboard.whiteboard_snapshot_asset` | PK `(snapshot_id, content_hash)`; `page_id`, composite snapshot and asset FKs | Exact external raster dependencies of an immutable snapshot. |
| `whiteboard.whiteboard_snapshot_asset_manifest` | PK `snapshot_id`; same-board FK; snapshot `state_digest`, extractor version, completion time | Distinguishes an inspected snapshot with zero raster dependencies from an uninspected snapshot. |
| `whiteboard.whiteboard_asset_cleanup` | PK `id` UUID; unique cleanup target; storage key, former board/space/account identities, byte count, reason, attempts, lease/fence, next attempt, last error, completion/exhaustion state | Durable deletion work, including work that must survive board deletion. |

Constraints and invariants:

- Catalog and live upload ownership reference `whiteboard.whiteboard(page_id)`.
  Actor UUIDs follow the v2 convention: external identities, without a local user FK.
- Hashes are 64 lowercase SHA-256 hex characters. The canvas ID remains
  `asset:sha256:<hash>`; the complete storage identity is `(page_id, hash)`.
- Snapshot associations use both `(page_id, snapshot_id)` and
  `(page_id, content_hash)` foreign keys. A hash match never grants access to
  another board's file.
- Enforce positive sizes/dimensions, supported MIME types, bounded metadata, and
  legal upload state transitions. Compute and inspect metadata from actual bytes.
- File identity and verified content metadata are immutable. A replacement uses
  a new hash. Geometry, crop, and alt text remain canvas properties.
- Cleanup jobs have no cascading FK to the board, space, or catalog. Copy every
  required object key and recovery identity into jobs before deleting owner rows.
- Snapshot manifests and associations are written atomically. A completed manifest
  is bound to the exact immutable snapshot digest and extractor version.
- Retain upload receipts while the board exists. Expiry ends upload eligibility;
  it does not permit reusing an old idempotency key for different content.

Use an isolated prefix such as `whiteboard-v2-assets/{pageId}/...`, with unique
upload/object generations. Stale cleanup must never target a later upload's
object. A deterministic hash-only final key needs equivalent locking and fencing;
unique physical keys are the simpler default. Cross-board physical deduplication
is deferred.

## 4. Independent asset API

Base: `/api/v2/editor/space/{spaceId}/whiteboard/{pageId}`.

Use existing authentication, success/error envelopes, UUID validation, and page
membership checks. Upload sessions belong to the authenticated actor and board;
the session ID alone is not authorization.

| Method | Relative path | Permission | Result |
| --- | --- | --- | --- |
| POST | `/assets/uploads` | edit | Prepare a session; requires `Idempotency-Key`. Returns 201 and stable upload ID, state, expiry, and upload/status URLs. |
| PUT | `/assets/uploads/{uploadId}/content` | edit + session owner | Upload raw image bytes. Validate and stage; return 200 only after staging is confirmed. |
| POST | `/assets/uploads/{uploadId}/commit` | edit + session owner | Commit staged content to the board catalog; return 200 with the stable asset descriptor. |
| GET | `/assets/uploads/{uploadId}` | edit + session owner | Inspect current session/terminal result after interruption or an ambiguous response. |
| DELETE | `/assets/uploads/{uploadId}` | edit + session owner | Cancel uncommitted work. Return terminal state, or 202 while cleanup is pending. A commit that already won is reported as committed and retained. |
| GET / HEAD | `/assets/{contentHash}/content` | edit | Resolve any committed asset owned by this board for editing/export. |
| GET / HEAD | `/published/{versionId}/assets/{contentHash}/content` | view | Resolve only assets associated with that version's snapshot, with a completed asset manifest. |

There is no independent delete-committed-asset endpoint in the first release.
An asset-library listing API can follow when there is a product flow that needs it.

Prepare request:

```json
{
  "contentHash": "<64 lowercase hex characters>",
  "contentType": "image/png",
  "byteLength": 183204
}
```

Committed asset descriptor inside the existing `data` envelope:

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
    "downloadUrl": "/api/v2/editor/space/<spaceId>/whiteboard/42/assets/<hash>/content"
  }
}
```

Persist the asset ID and verified intrinsic metadata in canvas records. Construct
download URLs through the host resolver; never persist temporary, signed, or blob
URLs as asset identity.

### Validation and reads

- Limits match existing raster limits: 20 MiB encoded, maximum 16,384
  pixels per dimension, and 64 million decoded pixels. Bound prepare JSON separately
  to 16 KiB and enforce binary limits in Go and compatible proxy configuration.
- Verify actual MIME, full decodability, hash, size, and dimensions before READY.
  The v2 inspector fully decodes PNG, JPEG, and static WebP, including lossy,
  lossless, and alpha fixtures. It bounds concurrent full decodes separately.
- Accept bytes, not arbitrary remote URLs. SVG file upload, video, audio, and
  attachments are separate future capabilities; existing sanitized vector ingress
  remains available.
- Downloads use verified MIME, `nosniff`, digest ETags, `Cache-Control: no-store`,
  and the existing single-range/HEAD conventions. Authenticate every read.
- Archived boards remain readable. Reject new prepare/stage/commit work for archived
  or deleted spaces; authorize matching committed replays without creating new work.
  Permit cancellation of uncommitted sessions in archived spaces. The worker can
  finish cleanup after permission loss or deletion.
- A catalog row with missing/unreadable storage is an observable storage failure,
  not an instruction to replace the image with an empty asset.

### Error categories

Use stable v2 error codes for invalid requests (400), authentication (401), access
denial (403), missing/mismatched board/session/asset (404), reused keys or invalid
session transitions (409), expired uploads (410), byte limits (413), unsupported
media (415), and quota exhaustion (409). The 100-active-session board limit and storage/lock transients
return 503 with retry guidance. Distinguish `ASSET_NOT_READY`,
`ASSET_CONTENT_UNAVAILABLE`, `ASSET_UPLOAD_EXPIRED`, and `ASSET_QUOTA_EXCEEDED`.
Existing `SPACE_ARCHIVED` and `IDEMPOTENCY_KEY_REUSED` remain applicable.

## 5. Upload transactions and recovery

Normal flow: prepare → upload/validate → staged → commit → committed.
Uncommitted sessions may transition to cancelling/cancelled or expired; failed
physical cleanup remains retryable and eventually observable as exhausted.

1. **Prepare:** authorize, validate the board, and atomically persist the session
   and quota reservation. Hash the normalized expected hash/type/size request.
   Matching scoped keys replay the same session; changed content returns 409.
2. **Stage:** claim/fence the session, write to its recorded private staging key,
   inspect bytes, then atomically record verified metadata and staged state. Exact
   PUT retries are safe. Different bytes cannot overwrite the session identity.
3. **Commit:** ensure the verified object exists, then atomically insert/reuse the
   board catalog row, settle quota, and mark the upload committed. Serialize
   concurrent commits for `(page_id, hash)`; charge only the winning catalog
   insertion. Release duplicate reservations and queue redundant objects for cleanup.
4. **Cancel:** serialize with commit. If cancel wins, commit can never resurrect the
   session. If commit wins, return `{state: "committed", retained: true}` and leave
   the catalog/file intact. Cancellation is never permission to delete an asset
   that another editor or a saved update may already reference.
5. **Recover:** persist object keys and quota correlation before storage writes.
   A worker reclaims expired/abandoned sessions and retries cleanup with bounded
   backoff, leases/fencing, attempt limits, and visible exhausted work. Active upload
   leases prevent cleanup racing an in-flight write; stale writers cannot finalize
   or leave untracked objects after cleanup.

Use the established lifecycle lock order: space → page/board → draft when needed →
upload/catalog → quota, with a consistent order across commit, cancel, and delete.
No database transaction should span the HTTP body transfer or slow blob write.
Recheck board lifecycle and the session fence in the short finalization transaction.
Storage and PostgreSQL are not one transaction; ambiguous outcomes must be resolved
through durable session state, never blind deletion of the hash's current object.

## 6. Canvas, checkpoints, publishing, and restore

### Client integration

`WhiteboardAssetHttpAdapterV2` is wired into `WhiteboardEditorV2.tsx`.
It implements prepare/stage/commit/status/cancel, editor resolution, original-byte
download, and portable materialization using the new routes.

Glideboard now provides an explicit `before-document` commit-order option in the
SDK contract. The v2 HTTP adapter uses this sequence:
validate/preflight → stage → confirm committed storage → recheck cancellation and
replacement target → create/replace the shared asset and shape atomically.
Legacy adapters retain their existing default order.

This order matters for WebRTC as well as autosave: pausing only the local checkpoint
queue would still let a peer save the premature asset reference. Do not disguise
storage commit as staging. Update SDK documentation and transaction tests.

If storage commits but the local edit fails or is cancelled, the file remains a
charged board-owned asset. Record compensation removes local mutations and cleans
uncommitted staging only. Status/retry must resolve an ambiguous commit before a
new asset reference is shared. Publish/export must await active imports and use
the existing verified projection boundary.

Cross-board paste downloads through an authorized, allowlisted source resolver,
verifies the immutable payload, and commits destination-owned files before applying
records. Keep credentials restricted to trusted same-origin routes. A shared hash
does not authorize reading the source. Portable retention validates ready ownership
or version membership; it does not create arbitrary client-asserted history links.

### Checkpoints and retention

Keep the incremental checkpoint contract and its size limits unchanged. Assets
upload separately and are referenced by ID. Do not materialize the entire board
on every checkpoint or trust a client-supplied asset list as authoritative.

Checkpoint acknowledgement continues to mean durable Yjs bytes, not validated
asset semantics. Unsupported API clients can still save malformed references;
render a recoverable missing-asset state and reject publication when appropriate.
Board-lifetime retention protects committed files used by the draft update tail,
replay leases, undo, restores, and offline recovery. Snapshot absence alone is
never grounds to delete a committed file.

### Publication and snapshot associations

Extend the pinned Yjs materializer to extract a bounded, deterministic set of
external raster dependencies from the reconstructed state at the requested
sequence. Match the client's active record map and tombstone semantics: after
adoption of the v2 record root, an obsolete legacy root is not an additional live
document. Validate supported asset records and references, including unreferenced
live raster records retained in the snapshot. Validate self-contained vector assets
separately; their hash IDs do not require raster catalog rows. Reject unsupported
external references or asset-bearing opaque records that cannot be classified.

In the publication transaction, verify every raster's same-board catalog membership
and immutable metadata, insert snapshot associations and the completed manifest,
then insert the version/preview and update the publication pointer. Cover both new
snapshots and reused snapshots. Missing, uncommitted, mismatched, or unsupported
assets fail the operation before publication changes become visible.

Keep manifests bounded: use the version-specific resolver route and, if the client
needs enumeration, a paginated asset manifest endpoint rather than an unbounded
addition to every version-list response. PNG publication previews remain separate.

Restore copies snapshot bytes, asset associations, and completed manifest metadata
to the new snapshot in the same restore transaction. Existing head preconditions
and restore-generation fencing still apply. Future compaction must create the same
complete associations before advancing the draft base.

## 7. Deletion and accounting

Extend board deletion to record cleanup jobs for every committed and staged object,
settle outstanding reservations, release logical catalog usage exactly once, and
delete associations/manifests/uploads/catalog rows in a valid FK order before
removing the board. Preserve enough metadata to recover a pre-existing storage
write after its owner is deleted. The existing 204 means the board is inaccessible
and cleanup work is durable; physical object deletion completes asynchronously.

Update account, space, and page storage reconciliation to include the v2 catalog.
Use a distinct v2 source identity for quota events. Do not count repeated placements
or same-board hash duplicates twice. Separate board ownership is separately charged.
After logical board deletion, the cleanup worker does not release usage again;
pending physical bytes are an operational metric rather than user catalog usage.

## 8. Delivery sequence and acceptance

| Phase | Deliverable | Required verification |
| --- | --- | --- |
| 1. Schema and service | New migrations, storage namespace, upload transactions, cleanup worker, quota/reconciliation and deletion integration | Apply real migrations; fail/cancel/retry at each storage/DB boundary; concurrent duplicate uploads; quota once; deletion races; restart recovery and bounded shutdown. |
| 2. Asset HTTP API | Upload/status/cancel and editor downloads; OpenAPI and API guide | Cookie/bearer authentication, cross-board/space denial, session ownership, malformed/oversized files, full decode/hash checks, range/HEAD, immutable retries, archived behavior. |
| 3. Snapshot lifecycle | Authoritative extraction, associations/manifests, version-scoped reads, publication/restore integration | Draft-only assets denied to viewers; exact historical boundary; active-root/tombstone/vector cases; reused snapshots; missing assets block publish; restore atomicity. |
| 4. Editor adoption | V2 adapter, explicit import commit ordering, retry/progress/cancel, replace, export and cross-board paste | Two-editor import race; reload before first publish; cancelled/lost commit; undo/redo; replacement retains old history; destination ownership; original-byte verification. |
| 5. Rollout | Feature gate, pre-existing snapshot audit/backfill, docs and monitoring | Existing asset-free boards remain usable; cleanup and quota metrics work; feature enabled only after phases 1–4 pass together. |
| 6. Asset-bearing v1 migration | Implemented: source/target manifest checks, verified independent copies, quota, durable copy cleanup, atomic associations, legacy retention pins, and deletion of both catalogs | Supported assets migrate without stripping; retained legacy history keeps independent originals; retries charge once and board deletion cleans up both copies. |

V2 already permits opaque asset records through its raw APIs. Do not assume all
existing snapshots are asset-free. Backfill completion manifests only after actual
inspection. Classify unresolvable existing publications for repair; preserve their
snapshot bytes and PNG previews, and fail new asset downloads closed until a valid
manifest exists. Do not silently rewrite history or label an uninspected snapshot
as an empty asset set. New publication/restore must establish a valid manifest
before relying on its associations; committed idempotent replays retain their
original outcome without creating new associations from unverified content.

## 9. Primary implementation locations

- Schema: `db/beskar/updates/whiteboard_assets_v2.xml`, the append-only
  `whiteboard_assets_v2_legacy_cleanup.xml`, and main changelog.
- HTTP/domain: new `server/editor/whiteboardAsset*V2.go` files and
  `server/editor/whiteboardControllerV2.go` route registration.
- Shared infrastructure: `server/storage/`, reusable raster inspection extracted
  from `server/media/services/whiteboardAssetService.go`, and `server/quota/`.
- Snapshot lifecycle: `server/whiteboard-runtime/materialize.mjs`,
  `server/editor/whiteboardMaterializerV2.go`, `whiteboardPublishServiceV2.go`,
  and `whiteboardHistoryServiceV2.go`.
- Client: `ui/app/core/whiteboard/v2/WhiteboardAssetHttpAdapterV2.ts`,
  `ui/app/components/WhiteboardEditorV2.tsx`, and Glideboard import/portability
  contracts. Extract shared trusted-source parsing from the legacy
  `WhiteboardEditor.tsx` adapter where useful.
- Contracts: `server/apidocs/openapi.json`, dedicated API documentation, and updates
  to v2 checkpoint/publish/history/UI decision docs when behavior is implemented.

This implementation uses board-owned metadata in PostgreSQL and bytes in the
existing storage abstraction. Shared libraries, committed-asset garbage collection,
resumable multipart uploads, and new media types remain later extensions.
