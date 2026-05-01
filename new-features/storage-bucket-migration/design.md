# Design Doc: Object Storage Migration For Uploads And Attachments

## Summary

This document defines the design for migrating Beskar uploads from local disk to an S3-compatible object storage bucket. The scope of this phase is documentation only. No code, schema, infra, or migration scripts are introduced here.

Pre-launch implementation note:
- For the current `beskar-dev` and pre-launch production rollout, legacy local asset migration/backfill is intentionally skipped because no live customer data must be preserved yet.
- The steady-state runtime design in this document still assumes bucket-only storage and DB-backed image metadata.
- If legacy assets later need to be preserved, the migration and backfill sections remain the reference design for that future work.

The goal is to preserve the current authenticated API contract while replacing local filesystem blob storage with a shared object storage backend for:

- page and comment attachments
- editor-uploaded images

The design keeps Postgres as the metadata source of truth for attachments, keeps the Go server as the enforcement point for auth and permission checks, and uses a maintenance-window cutover for existing assets.

As part of this migration, images in documents also move from file-only tracking to a DB-backed asset model so the system can support durable storage accounting, quotas, migration validation, and future cleanup.

---

## Objective

- Replace local-disk blob storage with cloud bucket storage for all upload surfaces.
- Preserve current authenticated upload and download behavior for clients.
- Keep `core.attachment` as the durable metadata store for attachment records.
- Introduce a durable metadata table for document images so image storage can be tracked and accounted for at the DB layer.
- Avoid introducing signed URLs or CDN dependencies in this phase.
- Produce an implementation-ready design that covers storage architecture, migration, rollback, and operational validation.

---

## Current-State Findings

## Upload Surfaces

There are two active upload systems in the current codebase.

### 1. Attachments

Attachments are used by the editor, page attachment panels, and comment reply attachments.

- Upload API: `POST /api/v1/attachments/upload`
- Download API: `GET /api/v1/attachments/{attachmentId}`
- Router mount: `server/main.go`
- HTTP controller: `server/attachment/controller/attachmentController.go`
- Persistence service: `server/attachment/services/attachmentService.go`
- Limits and MIME policy: `server/attachment/services/config.go`
- Path helpers: `server/core/storage.go`
- Path tests: `server/core/storage_test.go`

#### Attachment request and response behavior

- Upload requires authenticated user context.
- Upload requires `pageId` in multipart form data.
- Upload enforces page edit permission through `core.ValidateUserPagePermission(..., "edit")`.
- Upload reads multipart field `file`.
- Upload reads the whole body into memory with a size cap based on `ATTACHMENT_MAX_BYTES`.
- Upload validates MIME type using server-side sniffing and the allowlist in `server/attachment/services/config.go`.
- Successful upload returns:
  - `attachmentId`
  - `url`
  - `fileName`
  - `fileSize`
  - `mimeType`
- Download requires authenticated user context.
- Download loads attachment metadata from Postgres by attachment UUID.
- Download enforces page view permission through `core.ValidateUserPagePermission(..., "view")`.
- Download sets `Content-Disposition`, `Content-Type`, and `Content-Length`.

#### Attachment persistence model

Attachment metadata is stored in `core.attachment`:

- `id`
- `page_id`
- `storage_path`
- `file_name`
- `file_size`
- `mime_type`
- `created_by`
- `created_at`
- `deleted_at`

Schema source:

- `db/beskar/updates/attachments.xml`

The `storage_path` column currently stores a disk-oriented relative path such as `attachments/<generated-name>`, with compatibility logic for older prefixes such as `public/attachments/...` and absolute paths rooted under the configured upload directory.

#### Attachment local storage behavior

Current path helpers in `server/core/storage.go` resolve attachments to:

- `UPLOAD_STORAGE_DIR/attachments/<generated-name>`

Legacy read compatibility is also present for:

- `public/attachments/<generated-name>`

Current write behavior:

- `SaveAttachment(...)` generates a UUID-based disk filename
- writes bytes to disk via `os.Create(...)`
- inserts metadata into `core.attachment`

Current read behavior:

- `ReadAttachmentBytes(storagePath string)` normalizes the stored path
- reads from the current `UPLOAD_STORAGE_DIR`
- falls back to legacy `public/attachments` when needed

### 2. Images

Images use a separate media upload flow that is distinct from attachments.

- Upload API: `POST /api/v1/media/upload`
- Fetch API: `GET /api/v1/media/image/{imageid}`
- Router mount: `server/main.go`
- HTTP controller: `server/media/controller/mediaController.go`
- Persistence service: `server/media/services/imageService.go`
- Path helpers: `server/core/storage.go`

#### Image request and response behavior

- Upload requires authenticated user context because `/api/v1/media` is mounted behind `mw.CheckAuthentication()`.
- Upload reads multipart field `file`.
- Upload currently does not send page context.
- Upload returns a single generated name payload:
  - `Name`
- Fetch takes the generated filename as the URL path parameter.
- Fetch reads bytes from storage and sets `Content-Type` using `http.DetectContentType(data)`.

#### Image persistence model

Images do not currently have a dedicated metadata table in Postgres.

Current image flow relies on:

- generated filename returned from upload
- stored filename embedded into editor content as a URL

There is no DB row to enumerate, attribute, quota, or normalize image assets later. Migration of existing image assets must therefore combine:

- file inventory on disk
- document-content extraction from stored editor content

The repo also shows that editor content is not guaranteed to live only in a clean JSON column. `core.content_draft` currently includes both:

- `data` JSON
- `data_binary` bytea

That means legacy image backfill cannot be designed as a simple SQL-only pattern match over one table. It must use an application-level extractor that can resolve current page content and enumerate referenced image URLs.

#### Image local storage behavior

Current path helpers resolve images to:

- `UPLOAD_STORAGE_DIR/images/<generated-name>`

Legacy read compatibility is also present for:

- `public/images/<generated-name>`

Current write behavior:

- image filenames preserve the original name with an appended random suffix
- the file is written directly to `core.ImageStorageDir()`

Current read behavior:

- `GetImage(id string)` reads from the current configured image directory
- falls back to `public/images` when needed

---

## Current Consumers

## UI and Editor Consumers

### Image consumers

- `ui/app/core/editor/tiptap.tsx`
  - calls `uploadImageData(file)`
  - has page context available as `id`, so page-bound image uploads are feasible without route changes
  - uses returned name to build `${NEXT_PUBLIC_IMAGE_SERVER_URL}/media/image/${name}`
- `ui/app/core/http/uploadImageData.ts`
  - posts to `/media/upload`
  - returns `[name, width, height]`

### Attachment consumers

- `ui/app/core/editor/tiptap.tsx`
  - calls `uploadAttachmentData(file, pageId, ...)`
  - uses returned `attachmentId`, `url`, `fileName`, `fileSize`, `mimeType`
- `ui/app/core/http/uploadAttachmentData.ts`
  - posts to `/api/v1/attachments/upload`
  - downloads via authenticated `fetch` from returned URL
- `ui/app/core/http/commentApiHandler.ts`
  - sends `attachmentIds` on thread creation and reply edits
- `ui/app/core/editor/AttachmentPanel.tsx`
  - downloads attachments via `downloadAttachmentBlob(...)`
- `packages/editor/src/extensions/attachment-upload.ts`
  - depends on app-provided attachment upload handler

## Server Consumers

- `server/editor/editorService.go`
  - emits per-page attachment metadata to the UI with `FileURL: "/api/v1/attachments/" + record.ID`
- `server/comment/queries.go`
  - emits comment attachment URLs as `'/api/v1/attachments/' || a.id::text AS url`

This means attachments are already normalized around a stable authenticated API route, while images are normalized around a generated filename plus a server fetch route.

It also means the current image upload contract will need a request-body evolution, not a route change: image uploads must carry `pageId` so the server can create a durable image asset row.

---

## Runtime and Deployment Findings

- Upload APIs are served through authenticated Go endpoints behind `/api/v1`.
- Nginx proxies `/api/v1` traffic to the Go server; it does not serve upload files statically.
- Existing env knob: `UPLOAD_STORAGE_DIR`
- Existing attachment limit env knob: `ATTACHMENT_MAX_BYTES`
- Existing ad hoc operational sync script: `backup/backup-uploads.sh`
- Existing backup configuration in `docker/env/deploy.env.example` already includes S3-compatible settings for Postgres backups, but upload storage is not integrated into the application runtime.

### Local asset inventory observed in this workspace

- `server/public/images` contains image files today.
- `/Users/kiran/projects/server/uploads` exists but is empty on this machine.
- No top-level `public/attachments` corpus was found in this repo workspace.

This local snapshot is not sufficient to infer production volume. The migration design must assume that production may contain active files in both:

- current `UPLOAD_STORAGE_DIR`
- legacy `public/...` locations

---

## Problems With Current Design

### Filesystem coupling

Blob availability depends on the local filesystem of the running server instance. This makes uploads vulnerable to:

- container replacement
- instance drift
- missing mounted volumes
- multi-instance deployments without shared disk

### Split storage implementations

Attachments and images implement storage separately:

- attachments have metadata + filesystem writes
- images have raw filesystem writes only and no durable asset record

This duplicates logic and prevents a single migration seam.

### Asymmetric durability

Attachments are durable in Postgres because metadata exists independently from the file.

Images are less durable operationally because:

- there is no metadata table
- the filename is the only persisted identifier
- migration must reconstruct state from disk plus document extraction

### No DB-backed usage accounting for images

Because images have no asset row today, the system cannot reliably answer:

- how many bytes of image storage a page consumes
- how many bytes of image storage a workspace consumes
- how many bytes of image storage a user uploaded
- which images are orphaned versus still referenced

Adding object storage alone does not solve this. A DB-backed image asset table is required.

### Backup and runtime are disconnected

`backup/backup-uploads.sh` mirrors files to a bucket as a separate operational action, but the application itself still treats disk as the primary store. This does not solve:

- read-path dependency on local files
- write-path dependency on local files
- consistency guarantees between DB rows and bucket objects

### Memory behavior is not future-proof

Current attachment uploads and downloads use whole-file reads into memory. This is workable for the current 10 MiB default but becomes an unnecessary constraint for a bucket-backed storage architecture.

The target design should require streaming at the storage layer even if the public API shape remains the same.

---

## Design Principles

- Preserve client-visible routes and response shapes.
- Keep the Go server as the policy enforcement point.
- Introduce one shared storage abstraction for all upload classes.
- Keep object keys stable and backend-agnostic.
- Keep bucket provider details in configuration rather than application logic.
- Keep the initial migration operationally conservative and reversible.
- Treat S3 compatibility as the interface boundary, not a specific vendor product.

---

## Target Architecture

## High-Level Model

The application introduces a shared internal storage layer for attachments and images, but the post-migration runtime supports only one backing store:

- `s3`

Both attachment and image flows call the same storage abstraction rather than writing to the filesystem directly.

Local filesystem access remains relevant only for:

- one-time migration inventory
- one-time migration copy
- rollback to the pre-migration release during the maintenance window

### Public behavior that remains unchanged

- `POST /api/v1/attachments/upload` remains the attachment upload endpoint.
- `GET /api/v1/attachments/{attachmentId}` remains the attachment download endpoint.
- `POST /api/v1/media/upload` remains the image upload endpoint.
- `GET /api/v1/media/image/{imageid}` remains the image fetch endpoint.
- The Go server remains responsible for:
  - authentication
  - permission checks
  - response headers
  - compatibility with existing UI/editor consumers

### Internal behavior that changes

- filesystem writes are replaced by a storage driver call
- filesystem reads are replaced by a storage driver read or stream call
- attachment `storage_path` is treated as an object key, not a disk-relative path
- image uploads create DB-backed asset rows
- image fetches resolve through DB metadata plus storage driver lookup
- image filenames map to a DB-backed public identifier and object key in the image prefix

## Image Asset Metadata Model

As part of this migration, document images gain a dedicated metadata table:

- `core.image_asset`

### Table purpose

`core.image_asset` becomes the durable catalog for images embedded in documents. It exists to support:

- object lookup
- page-scoped authorization
- page/workspace/user storage accounting
- migration validation
- orphan cleanup later

### Proposed schema

```sql
CREATE TABLE core.image_asset (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id BIGINT NOT NULL REFERENCES core.page(id) ON DELETE CASCADE,
  public_name TEXT NOT NULL UNIQUE,
  storage_key TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type VARCHAR(255) NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
```

### Field rules

- `public_name`
  - the generated filename returned to the editor today
  - remains the path segment used by `GET /api/v1/media/image/{imageid}`
- `storage_key`
  - canonical object key such as `images/<public_name>`
- `page_id`
  - owning page for authorization and storage accounting
- `created_by`
  - uploader identifier for new writes
  - nullable for legacy backfill when uploader cannot be proven from current data
- `deleted_at`
  - supports future cleanup without hard-deleting immediately on image removal

### Ownership and lifecycle decision

- Images are page-scoped assets.
- Deleting a page cascades the asset row.
- Removing an image from document content does not immediately delete the row or object.
- Future cleanup may soft-delete unreferenced image assets after content reconciliation.

This mirrors the conservative lifecycle used for attachments and avoids breaking undo flows.

## Shared Storage Interface

The implementation should introduce a shared internal interface conceptually equivalent to:

```go
type BlobStore interface {
    Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error
    Get(ctx context.Context, key string) (io.ReadCloser, BlobMetadata, error)
    Exists(ctx context.Context, key string) (bool, error)
    Delete(ctx context.Context, key string) error
}

type BlobMetadata struct {
    Size        int64
    ContentType string
}
```

The exact method names may differ during implementation, but the design requires:

- streaming writes
- streaming reads
- explicit object key ownership by the caller
- backend-neutral behavior

### Runtime Driver: S3

The S3 driver stores objects in a configured bucket under the same logical keys:

- `attachments/<name>`
- `images/<name>`

The driver is responsible for:

- bucket client initialization
- upload
- download/streaming
- existence checks

The driver is not responsible for:

- auth policy
- permission checks
- URL signing in this phase
- frontend URL generation

### Migration-only local file access

The migration tooling may read from local directories as a source of truth for legacy blobs, but that is not a supported application runtime mode after this change.

---

## Canonical Object Keys

## Attachments

Canonical attachment object keys:

- `attachments/<generated-name>`

`<generated-name>` should continue to be a server-generated opaque name derived from the current attachment filename generation logic.

The existing attachment filename generation already creates UUID-based names with validated extensions. That logical shape should be retained.

### Attachment metadata rule

`core.attachment.storage_path` becomes the canonical object key.

After migration, acceptable steady-state values are:

- `attachments/<generated-name>`

Values such as the following are legacy-only and should not be produced by new writes:

- `public/attachments/<generated-name>`
- absolute local filesystem prefixes

## Images

Canonical image object keys:

- `images/<generated-name>`

The generated image name returned by `POST /api/v1/media/upload` remains the logical public identifier used by the client and is stored as `core.image_asset.public_name`.

The image fetch route:

- `GET /api/v1/media/image/{imageid}`

first resolves `imageid` against `core.image_asset.public_name`, then maps the resolved row to:

- `storage_key`

### Image metadata rule

Every new image upload must create:

- one object at `images/<public_name>`
- one `core.image_asset` row with `storage_key = images/<public_name>`

Legacy-only image files without a matching `core.image_asset` row are not acceptable steady-state after migration.

---

## API Compatibility Rules

The following behaviors are required to remain stable:

### Attachment APIs

- same upload route
- same download route
- same auth requirements
- same permission semantics
- same response fields
- same use in page attachment panels
- same use in comment reply attachments

### Media APIs

- same upload route
- same image fetch route
- same response shape with returned `Name`
- same client-side URL construction pattern in `ui/app/core/editor/tiptap.tsx`
- image upload request gains `pageId` in multipart form data so the server can create `core.image_asset`

### Editor and comment behavior

- attachment chips keep working without consumer changes
- comment attachment URLs remain `/api/v1/attachments/{id}`
- page attachments remain downloadable through the current API
- editor image embeds continue to point at the current media route

---

## Configuration Design

The design introduces a new storage configuration surface.

## Required configuration

- `STORAGE_S3_BUCKET`
- `STORAGE_S3_ENDPOINT`
- `STORAGE_S3_REGION`
- `STORAGE_S3_ACCESS_KEY_ID`
- `STORAGE_S3_SECRET_ACCESS_KEY`
- `STORAGE_S3_PREFIX`

## Optional configuration

- `STORAGE_S3_BASE_URL`

`STORAGE_S3_BASE_URL` is reserved for future CDN or public asset URL use. It is not required for this design because the server continues to proxy file access.

`STORAGE_S3_PREFIX` is an optional logical directory prefix inside the bucket, for example `beskar-dev` or `prod/uploads`. Runtime object writes then land under:

- `<prefix>/attachments/<generated-name>`
- `<prefix>/images/<generated-name>`

The application should keep DB-stored logical keys as:

- `attachments/<generated-name>`
- `images/<generated-name>`

and apply the prefix only inside the storage driver so environment-specific bucket layout does not leak into application metadata.

## Existing configuration that remains relevant

- `UPLOAD_STORAGE_DIR`
  - used during migration to identify source files to copy from local disk
- `ATTACHMENT_MAX_BYTES`
  - continues to control attachment upload size validation

## Derived accounting enabled by the image table

`core.image_asset` plus `core.attachment` should be sufficient to support later aggregate queries for:

- total storage consumed by page
- total storage consumed by workspace
- total storage uploaded by user

For new image uploads, user-level totals can be exact because `created_by` is captured at write time.

For backfilled legacy images, `created_by` may remain null when historical uploader identity cannot be proven from existing data. In that case:

- page/workspace totals remain exact
- user totals are exact for new assets and partial for legacy images

## Runtime behavior

After migration:

- all new reads and writes use the configured bucket
- no client-visible URL change occurs
- the server fetches from S3 and streams back to the client
- the application no longer supports local-disk blob storage as a runtime mode

---

## Migration Strategy

## Chosen Strategy

This design uses a maintenance-window cutover.

It does not use:

- dual-write
- dual-read as the steady-state migration strategy
- signed URL rollout

This choice is based on the requested operational posture: simple cutover, no active implementation of a phased compatibility system, and minimized application complexity in the first migration.

## Migration Preconditions

Before the maintenance window:

- provision the target S3-compatible bucket
- verify credentials and bucket permissions
- define the final canonical prefixes:
  - `attachments/`
  - `images/`
- identify the actual production values for:
  - `UPLOAD_STORAGE_DIR`
  - any legacy `public/attachments`
  - any legacy `public/images`
- inventory attachment rows in `core.attachment`
- inventory local image files on disk
- design and validate the application-level image reference extractor for current page content

## Maintenance-Window Runbook

### Step 1. Announce and freeze writes

- announce the maintenance window
- stop or block new upload writes
- ensure no in-flight attachment or image uploads continue during the copy window

The exact mechanism is implementation-specific and out of scope for this design doc, but the operational requirement is that the local filesystem must stop changing before asset copy begins.

### Step 2. Inventory source assets

Inventory all possible local sources:

- `${UPLOAD_STORAGE_DIR}/attachments`
- `public/attachments`
- `${UPLOAD_STORAGE_DIR}/images`
- `public/images`

For each source, record:

- file count
- aggregate size
- sample filenames
- checksum spot checks for representative files

For attachments, also inventory Postgres:

- count of active `core.attachment` rows
- count of rows whose `storage_path` already equals `attachments/<name>`
- count of rows with legacy `public/attachments/...`
- count of rows with absolute or non-canonical path values

For images, inventory must include both storage and content references:

- count of local image files by source directory
- count of distinct image references extracted from current page content
- count of image filenames that exist on disk but are not referenced by any page
- count of image references that do not resolve to a local file

### Step 2a. Backfill image references from persisted page content

Before copying images, run an application-level extractor that resolves current page content and emits image references.

Authoritative source rules:

- prefer application-level document decoding over ad hoc SQL regex matching
- support both `core.content_draft.data` and `core.content_draft.data_binary`
- extract image URLs of the form `/media/image/{public_name}` or absolute equivalents
- map each extracted image to its owning `page_id`

Backfill output per referenced image:

- `public_name`
- `page_id`
- candidate local file path

If one `public_name` is referenced by multiple pages, treat it as a migration blocker unless the implementation explicitly chooses shared-image semantics. This design chooses page-scoped ownership, so ambiguous ownership must be resolved before cutover.

### Step 3. Copy assets into the bucket

Copy local assets into the bucket under canonical keys:

- attachment files -> `attachments/<generated-name>`
- image files -> `images/<generated-name>`

Rules:

- do not preserve local absolute path prefixes in the bucket key
- do not copy into multiple bucket prefixes
- do not expose provider-specific folder structure outside the canonical prefixes

For images:

- canonical copy target is `images/<public_name>`
- copied files must later match a `core.image_asset.storage_key`

### Step 4. Normalize attachment metadata

Normalize `core.attachment.storage_path` values to canonical object keys.

The normalization rules are:

- `attachments/<name>` -> keep as-is
- `public/attachments/<name>` -> rewrite to `attachments/<name>`
- `<UPLOAD_STORAGE_DIR>/attachments/<name>` -> rewrite to `attachments/<name>`
- any path that cannot be normalized to a safe attachment key -> block cutover and investigate

This is a data migration step, not a schema migration.

Images do not use a path-normalization step equivalent to attachments. Instead, the image migration creates canonical `core.image_asset` rows from extracted document references.

### Step 4a. Create `core.image_asset` rows for migrated images

After image reference extraction and bucket copy, create one `core.image_asset` row per active image reference.

Row creation rules:

- `public_name` = extracted image filename from the document URL
- `storage_key` = `images/<public_name>`
- `page_id` = owning page resolved by the extractor
- `original_file_name` = use `public_name` for legacy backfill when original client filename is unknown
- `file_size` = measured from the copied object or source file
- `mime_type` = determined from file inspection
- `width` and `height` = determined from image inspection
- `created_by` = null for legacy backfill unless uploader can be proven exactly

Files that exist on disk but are not referenced by any page should not be inserted as active `core.image_asset` rows. They must be reported separately for manual review before cutover.

### Step 5. Deploy bucket-backed server configuration

Deploy the application configured with:

- bucket endpoint and credentials

The deployed build should:

- write all new attachments to the bucket
- write all new images to the bucket
- read attachments from the bucket using `storage_path` as object key
- create `core.image_asset` on each new image upload
- require `pageId` on image upload so image assets can be page-scoped
- read images from the bucket by first resolving `core.image_asset.public_name`

### Step 6. Run smoke checks before reopening writes

Validate end-to-end behavior using representative assets:

- upload a new attachment to a page
- download an existing migrated attachment from a page
- download an attachment linked to a comment reply
- upload a new editor image
- load an existing migrated image inside the editor/view flow
- verify `core.image_asset` row creation for the new image upload
- verify page permission enforcement on migrated image fetches

Check:

- auth still works
- permission checks still work
- response headers are correct
- content bytes are correct
- newly written objects land in the bucket under canonical keys

### Step 7. Reopen writes

Once smoke checks pass:

- resume upload traffic
- monitor logs for attachment and media read/write failures

---

## Rollback Strategy

Rollback must be simple and fast.

## Rollback principles

- local source files remain intact during the initial migration
- bucket copy is additive during first cutover
- `core.image_asset` rows created during migration are harmless to the pre-migration release
- rollback is a release rollback to the pre-migration application, not a mode switch inside the new application
- attachment `storage_path` normalization remains the main rollback-sensitive data change

## Rollback procedure

If validation fails after deployment:

1. stop or block new writes again
2. redeploy the pre-migration release that still reads from local disk
3. restore pre-cutover attachment path values only if the pre-migration release requires them
4. re-run basic upload and download checks on the old release
5. reopen traffic

`core.image_asset` rows created during migration do not need to be removed for rollback because the pre-migration release does not depend on them.

## Attachment metadata reversibility

The simplest rollback path is for the pre-migration release to remain tolerant of canonical `attachments/<name>` keys. If that compatibility exists, `storage_path` normalization does not need to be reverted for rollback.

If the pre-migration release is not tolerant of canonical keys, then the cutover must record a reversible mapping for normalized attachment rows before updating them.

This document recommends the first approach so rollback remains a release rollback rather than a data restore.

---

## Operational Verification

## Pre-cutover checks

- confirm bucket credentials can write and read
- confirm source directories exist or are intentionally empty
- confirm object key naming rules are documented and agreed
- confirm `core.attachment` row counts and legacy-path counts are known

## Post-copy checks

- compare source and destination file counts by prefix
- compare aggregate byte totals by prefix
- perform checksum spot checks on representative attachment and image files
- verify a sample of attachment DB rows resolve to existing bucket objects
- verify a sample of backfilled `core.image_asset` rows resolve to existing bucket objects

## Post-deploy smoke checks

- upload new attachment
- download existing attachment
- create comment reply with attachment and download it
- upload new image
- load existing image in editor/view mode
- verify that the pre-migration release can still serve traffic if a release rollback is required during the maintenance window

## Early-life monitoring

Monitor for:

- attachment upload failures
- attachment download failures
- image upload failures
- image read failures
- bucket auth errors
- object-not-found errors
- abnormal response latency increases

---

## Risks And Mitigations

## Risk: Missing local files during migration

If production DB rows reference attachment files that no longer exist on local disk, normalization alone will not fix the missing object.

Mitigation:

- run pre-cutover inventory
- verify source file presence for a sample of active rows
- block cutover if missing-file rate is above acceptable threshold

## Risk: Legacy path inconsistencies

`core.attachment.storage_path` may contain more than the currently expected forms.

Mitigation:

- inventory actual row patterns before cutover
- define normalization rules explicitly
- treat unrecognized patterns as migration blockers, not best-effort guesses

## Risk: Images lack DB metadata

There is no canonical database source of truth for images today, and draft content may be stored in either JSON or binary editor form.

Mitigation:

- backfill `core.image_asset` as part of this migration
- use an application-level content extractor rather than relying on one raw SQL pattern
- preserve the existing filename-based fetch contract by using `public_name`

## Risk: Legacy user attribution for images may be incomplete

Historical image uploads may not have enough provenance to determine the exact uploader.

Mitigation:

- make `created_by` nullable for backfilled legacy rows
- require `created_by` for all new image uploads after migration
- document that page/workspace totals are exact after backfill, while per-user totals are exact going forward and partial for unattributed legacy images

## Risk: Large-object memory pressure

Current code reads some attachment content into memory.

Mitigation:

- require streaming in the new storage abstraction
- avoid whole-object buffering for bucket-backed reads and writes where possible

## Risk: Provider lock-in

Implementation could drift toward a vendor-specific storage model.

Mitigation:

- standardize on S3-compatible semantics
- keep provider-specific endpoint and credential details in config only
- keep application logic bucket-driver based rather than vendor-brand based

## Risk: Rollback complexity

If rollback requires both config change and DB restoration, recovery time grows.

Mitigation:

- ensure the pre-migration release can consume canonical `attachments/<name>` keys
- leave local files intact until steady-state confidence is established

---

## Out Of Scope

The following are explicitly not part of this phase:

- implementing the storage abstraction
- adding signed URL download flows
- CDN rollout
- virus scanning or malware inspection
- attachment orphan cleanup implementation
- image orphan cleanup implementation
- lifecycle deletion policies for bucket objects
- resumable uploads
- changing public API routes
- writing the actual migration scripts
- provisioning or applying infrastructure changes

---

## Acceptance Criteria For The Future Implementation

The future implementation based on this design is complete when:

- all current upload-related APIs continue to function without client contract changes
- attachments read and write through the shared storage abstraction
- images read and write through the shared storage abstraction
- `core.attachment.storage_path` stores canonical object keys for new writes
- `core.image_asset` exists and stores one row per active migrated or newly uploaded document image
- existing attachment rows are normalized during the migration window
- existing referenced local images are copied to the bucket, backfilled into `core.image_asset`, and remain readable through `/api/v1/media/image/{imageid}`
- the migrated runtime reads and writes blobs only through the bucket-backed storage path
- new image uploads are page-scoped and produce storage-accountable DB rows
- a maintenance-window cutover and rollback runbook exists and is verified operationally

---

## Implementation Notes For Later Work

These are decisions already made by this design and should not be reopened during implementation unless new constraints appear:

- Keep server-proxied downloads.
- Do not introduce signed URLs in v1.
- Use one shared storage abstraction for attachments and images.
- Use canonical bucket prefixes `attachments/` and `images/`.
- Keep the existing image route and response contract, but back it with `core.image_asset`.
- Use a maintenance-window migration instead of phased dual-write/dual-read.
- Do not keep local-disk blob storage as a supported mode in the migrated runtime.

---

## File and Code Path Reference Index

### Server

- `server/main.go`
- `server/attachment/controller/attachmentController.go`
- `server/attachment/services/attachmentService.go`
- `server/attachment/services/config.go`
- `server/attachment/services/cleanup.go`
- `server/media/controller/mediaController.go`
- `server/media/services/imageService.go`
- `server/core/storage.go`
- `server/core/storage_test.go`
- `server/editor/editorService.go`
- `server/comment/queries.go`

### Database

- `db/beskar/updates/attachments.xml`
- `db/beskar/updates/comments.xml`

### UI and editor consumers

- `ui/app/core/editor/tiptap.tsx`
- `ui/app/core/http/uploadImageData.ts`
- `ui/app/core/http/uploadAttachmentData.ts`
- `ui/app/core/http/commentApiHandler.ts`
- `ui/app/core/editor/AttachmentPanel.tsx`
- `packages/editor/src/extensions/attachment-upload.ts`

### Operations and env

- `.env.example`
- `docker/env/deploy.env.example`
- `docker/templates/compose.http.yml.tmpl`
- `docker/templates/compose.https.yml.tmpl`
- `backup/backup-uploads.sh`

---

## Final Notes

This design deliberately favors compatibility and operational safety over aggressive architecture changes. The current route structure and permission enforcement are already correct for a bucket-backed future because all access is mediated by the Go server. The primary architectural gap is not API shape but storage indirection.

That makes the migration straightforward in concept:

1. introduce one storage abstraction
2. point both upload systems at it
3. move existing blobs into canonical bucket keys
4. cut over during a maintenance window

The main operational complexity is asset inventory and attachment path normalization, not client compatibility. That is why this document emphasizes migration discipline, canonical object key rules, and rollback simplicity.
