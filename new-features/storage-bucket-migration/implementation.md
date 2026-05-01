# Implementation Plan: Object Storage Migration For Uploads And Attachments

> This document translates [design.md](./design.md) into an execution-ready implementation plan.
>
> Scope: code, schema, migration tooling, config, rollout, and verification required to move Beskar uploads from local disk to S3-compatible object storage, while adding DB-backed image metadata.

Pre-launch implementation note:
- The current rollout for `beskar-dev` and pre-launch production intentionally skips legacy local asset migration and image backfill.
- Runtime work still targets bucket-only operation for all new uploads.
- Migration tooling and backfill sections in this document are retained as optional future work if legacy assets ever need to be preserved.

---

## Summary

This implementation has six workstreams that must land in order:

1. Add new database structures for image assets.
2. Introduce a bucket-backed storage layer in the Go server.
3. Migrate attachment APIs from filesystem access to the storage layer.
4. Migrate image APIs from filesystem access to storage + DB-backed metadata.
5. Build migration/backfill tooling for existing local files and legacy document image references.
6. Roll out in a maintenance window with explicit verification and rollback.

Target end state:

- all attachment blobs live in the bucket
- all document image blobs live in the bucket
- attachments continue to use `core.attachment`
- images gain `core.image_asset`
- runtime server reads and writes only via bucket-backed storage
- local disk is not a supported runtime mode after cutover

---

## Implementation Principles

- Preserve public HTTP routes.
- Preserve current frontend response shapes wherever possible.
- Keep authorization server-side.
- Make storage object keys canonical and deterministic.
- Prefer streaming at storage boundaries.
- Keep migration logic separate from request handlers.
- Treat legacy local disk as migration input only.
- Make rollback a release rollback, not a runtime mode switch.

---

## Phase Overview

| Phase | Goal | Output |
| --- | --- | --- |
| Phase 0 | Prepare schema and storage primitives | DB changelog + storage package + config |
| Phase 1 | Migrate attachment runtime | bucket-backed attachment upload/download |
| Phase 2 | Migrate image runtime | bucket-backed image upload/fetch + `core.image_asset` |
| Phase 3 | Build migration/backfill tooling | attachment path normalization + image extractor + copy tooling |
| Phase 4 | Test and verify | unit/integration/manual verification |
| Phase 5 | Maintenance-window rollout | copy, normalize, deploy, validate, reopen |

---

## Phase 0: Schema And Storage Foundation

## Story 0.1 — Add `core.image_asset`

**Goal**

Create the DB table that becomes the durable metadata catalog for document images.

**Files**

- new Liquibase changelog under `db/beskar/updates/`
- any master changelog/include file if required by current Liquibase wiring

**Implementation**

- Add a new Liquibase file for `core.image_asset`.
- Table shape:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `page_id BIGINT NOT NULL`
  - `public_name TEXT NOT NULL UNIQUE`
  - `storage_key TEXT NOT NULL`
  - `original_file_name TEXT NOT NULL`
  - `file_size BIGINT NOT NULL`
  - `mime_type VARCHAR(255) NOT NULL`
  - `width INTEGER NOT NULL`
  - `height INTEGER NOT NULL`
  - `created_by TEXT`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - `deleted_at TIMESTAMPTZ`
- Add foreign key:
  - `page_id -> core.page(id) ON DELETE CASCADE`
- Add indexes:
  - unique index on `public_name`
  - index on `page_id`
  - optional partial index on active rows if query shape needs it later
- Grant runtime app user permissions:
  - `SELECT`
  - `INSERT`
  - `UPDATE`
  - `DELETE`

**Rules**

- `public_name` is the current route-level image identifier.
- `storage_key` must contain canonical bucket key `images/<public_name>`.
- `created_by` is nullable for backfilled legacy rows only.

**Verification**

- Liquibase applies cleanly on a fresh DB.
- Liquibase applies cleanly on an existing DB.
- Table and indexes exist with expected constraints.

---

## Story 0.2 — Introduce shared storage package

**Goal**

Add one internal storage abstraction for bucket-backed blob reads and writes.

**Files**

- new package under `server/`
  - recommended path: `server/storage/`
- `server/go.mod`
- `server/go.sum`

**Implementation**

- Add a storage package with:
  - config loading
  - storage interface
  - S3 client implementation
  - helper types for object metadata
- Recommended package layout:
  - `server/storage/config.go`
  - `server/storage/store.go`
  - `server/storage/s3.go`
  - `server/storage/errors.go`
- Define interface:
  - `Put(ctx, key, reader, size, contentType) error`
  - `Get(ctx, key) (io.ReadCloser, BlobMetadata, error)`
  - `Exists(ctx, key) (bool, error)`
  - `Delete(ctx, key) error`
- Add lazy singleton or explicit initializer used by request paths and migration tooling.
- Add bucket config validation on server startup.

**Dependency decision**

Use AWS SDK for Go v2:

- `github.com/aws/aws-sdk-go-v2/config`
- `github.com/aws/aws-sdk-go-v2/credentials`
- `github.com/aws/aws-sdk-go-v2/service/s3`
- `github.com/aws/aws-sdk-go-v2/feature/s3/manager`

**S3 compatibility requirements**

- custom endpoint support
- region support
- static credentials support
- path-style compatibility if required by provider

**Verification**

- config fails fast if required S3 env vars are missing
- storage package can upload/read small fixture objects in test
- interface supports streaming reads and writes

---

## Story 0.3 — Replace runtime storage config surface

**Goal**

Move runtime storage config to bucket-only settings.

**Files**

- `.env.example`
- `docker/env/deploy.env.example`
- `docker/templates/compose.http.yml.tmpl`
- `docker/templates/compose.https.yml.tmpl`
- `docker/app/app.yml`
- `docker/scripts/common.sh`
- `docker/README.md`

**Implementation**

- Add runtime env vars:
  - `STORAGE_S3_BUCKET`
  - `STORAGE_S3_ENDPOINT`
  - `STORAGE_S3_REGION`
  - `STORAGE_S3_ACCESS_KEY_ID`
  - `STORAGE_S3_SECRET_ACCESS_KEY`
  - `STORAGE_S3_PREFIX`
  - optional `STORAGE_S3_BASE_URL`
- Keep `ATTACHMENT_MAX_BYTES`.
- Remove `UPLOAD_STORAGE_DIR` from runtime server docs and runtime compose wiring.
- Keep `UPLOAD_STORAGE_DIR` documented only as a migration-time input if still needed by migration tooling.
- `STORAGE_S3_PREFIX` must be applied only by the storage driver, not persisted into `core.attachment.storage_path` or `core.image_asset.storage_key`.

**Decision**

The migrated server must not branch on storage mode. It should always initialize bucket-backed storage.

**Verification**

- deploy env examples reflect bucket-only runtime
- no post-migration runtime docs instruct operators to mount or persist upload directories

---

## Phase 1: Attachment Runtime Migration

## Story 1.1 — Move attachment persistence to storage layer

**Goal**

Replace direct disk writes in attachment upload flow with bucket writes.

**Files**

- `server/attachment/services/attachmentService.go`
- `server/attachment/services/config.go`
- `server/core/storage.go`

**Implementation**

- Update `SaveAttachment(...)` to:
  - preserve current validation behavior
  - generate canonical object key `attachments/<generated-name>`
  - upload bytes through storage package
  - store object key into `core.attachment.storage_path`
- Remove direct `os.Create(...)` and `os.Remove(...)` write logic from attachment service.
- Keep display-name sanitization logic unchanged.

**Decision**

`core.attachment.storage_path` becomes bucket key only. New writes must never persist:

- `public/attachments/...`
- absolute disk paths

**Verification**

- upload succeeds and row stores canonical key
- failure to insert DB row after successful blob upload is handled explicitly
- response payload remains unchanged

---

## Story 1.2 — Move attachment reads to storage layer

**Goal**

Replace direct disk reads in attachment download flow with bucket reads.

**Files**

- `server/attachment/services/attachmentService.go`
- `server/attachment/controller/attachmentController.go`

**Implementation**

- Replace `ReadAttachmentBytes(...)` with storage-backed read API.
- Recommended shape:
  - `OpenAttachment(...)` or `ReadAttachment(...)` that returns stream + metadata
- Controller should:
  - load metadata row
  - authorize access
  - stream object body to `http.ResponseWriter`
  - preserve `Content-Disposition`
  - preserve `Content-Type`
  - preserve `Content-Length` when known

**Decision**

Do not keep compatibility code that reads from local disk in the migrated runtime.

**Verification**

- download returns correct bytes
- comment attachment downloads still work
- page attachment panel downloads still work
- large attachments do not require full buffering in controller

---

## Story 1.3 — Add attachment tests for canonical storage keys

**Goal**

Make canonical bucket-key behavior explicit in tests.

**Files**

- `server/core/storage_test.go`
- new attachment service tests as needed

**Implementation**

- Update or replace path normalization tests to validate canonical key expectations.
- Keep legacy-path normalization logic only where required by migration tooling, not runtime reads.
- Add tests for:
  - valid canonical attachment key
  - legacy `public/attachments/...` rewrite logic in migration helper
  - invalid traversal or malformed key rejection

**Verification**

- test suite clearly separates runtime key validation from migration-only normalization

---

## Phase 2: Image Runtime Migration

## Story 2.1 — Add image asset repository/service layer

**Goal**

Introduce DB operations for `core.image_asset`.

**Files**

- new package under `server/media/` or `server/imageasset/`
- recommended:
  - `server/media/services/imageAssetService.go`
  - or `server/media/repository/imageAssetRepository.go`

**Implementation**

- Add CRUD methods required by runtime:
  - `CreateImageAsset(...)`
  - `GetImageAssetByPublicName(...)`
  - `ListImageAssetsForPage(...)` if needed later
  - optional `SoftDeleteImageAsset(...)` placeholder
- Row creation inputs:
  - `page_id`
  - `public_name`
  - `storage_key`
  - `original_file_name`
  - `file_size`
  - `mime_type`
  - `width`
  - `height`
  - `created_by`

**Decision**

Runtime fetch path resolves by `public_name`, not by DB primary key, to preserve the current URL contract.

**Verification**

- row insert/select works
- unique violation on duplicate `public_name` is surfaced cleanly

---

## Story 2.2 — Change image upload flow to require page context

**Goal**

Make new image uploads page-scoped and storage-accountable.

**Files**

- `ui/app/core/http/uploadImageData.ts`
- `ui/app/core/editor/tiptap.tsx`
- `server/media/controller/mediaController.go`
- `server/media/services/imageService.go`

**Implementation**

### UI

- Change `uploadImageData(...)` signature from:
  - `uploadImageData(file)`
- To:
  - `uploadImageData(file, pageId)`
- Include `pageId` in multipart form data.
- Update TipTap image handler to pass current page `id`.
- Preserve returned tuple:
  - `[name, width, height]`

### Server

- Update `/api/v1/media/upload` handler to:
  - require authenticated user
  - require `pageId`
  - enforce page edit permission, same as attachments
  - read file
  - determine dimensions
  - determine mime type
  - generate `public_name`
  - upload object at `images/<public_name>`
  - create `core.image_asset`
  - return current payload shape with `Name`

**Decision**

Do not change the media upload route or response shape in this migration.

**Verification**

- editor still inserts image successfully
- image upload now fails if `pageId` missing or unauthorized
- returned `Name` continues to drive current URL generation

---

## Story 2.3 — Change image fetch flow to use DB metadata + bucket

**Goal**

Resolve image fetches through `core.image_asset` and storage layer.

**Files**

- `server/media/controller/mediaController.go`
- `server/media/services/imageService.go`

**Implementation**

- Replace direct local-file read by `imageid` with:
  - lookup `core.image_asset` by `public_name = imageid`
  - authorize page view access using `page_id`
  - open `storage_key` from bucket
  - stream bytes to response
- Set `Content-Type` from DB metadata when possible.
- Keep `Content-Disposition` and route shape compatible.

**Decision**

Image fetches become page-authorized asset reads, not blind filename fetches.

**Verification**

- existing authenticated image loads succeed for migrated rows
- unauthorized page viewers cannot fetch image bytes
- image route still works for editor content without content changes

---

## Story 2.4 — Add image metadata and controller tests

**Goal**

Cover new page-scoped image behavior.

**Files**

- new tests under `server/media/`

**Implementation**

- Add tests for:
  - upload requires auth
  - upload requires `pageId`
  - upload enforces page edit permission
  - upload creates DB row and bucket object
  - fetch resolves `public_name`
  - fetch enforces page view permission

**Verification**

- image API contract remains stable while access path is now DB-backed

---

## Phase 3: Migration And Backfill Tooling

## Story 3.1 — Build attachment path normalization tool

**Goal**

Normalize existing `core.attachment.storage_path` rows to canonical bucket keys.

**Files**

- new migration tool under `server/cmd/` or `server/tools/`
- recommended:
  - `server/cmd/upload_migration/main.go`
  - split internal packages if needed

**Implementation**

- Tool loads attachment rows.
- For each row:
  - accept `attachments/<name>` as canonical
  - rewrite `public/attachments/<name>` to `attachments/<name>`
  - rewrite `<UPLOAD_STORAGE_DIR>/attachments/<name>` to `attachments/<name>`
  - reject any row that cannot normalize safely
- Produce dry-run mode and apply mode.
- Produce structured output:
  - total rows
  - rewritten rows
  - blocked rows

**Decision**

Normalization tool is idempotent.

**Verification**

- dry-run output is deterministic
- repeated apply mode does not mutate already-canonical rows

---

## Story 3.2 — Build image reference extractor

**Goal**

Extract legacy document image references from persisted page content.

**Files**

- new migration tool package under `server/cmd/upload_migration/`
- likely helpers for editor-content decoding
- `server/editor/queries.go` may be referenced for read paths

**Implementation**

- Add extractor that can iterate current pages and resolve current content.
- Support content sources:
  - `core.content_draft.data`
  - `core.content_draft.data_binary`
- Extraction output:
  - `page_id`
  - `public_name`
  - normalized image URL source
- Accept both:
  - relative `/media/image/<name>`
  - absolute URLs ending in `/media/image/<name>`

**Decision**

Do not implement the extractor as ad hoc SQL regex over raw tables. Use application-level decoding or a parser aware of current content shapes.

**Failure policy**

- if one `public_name` maps to multiple `page_id` values, treat as blocker
- if one reference cannot resolve to a local file, report blocker

**Verification**

- extractor can emit a JSONL or CSV report for operator review
- extractor is repeatable and deterministic

---

## Story 3.3 — Build local-to-bucket copy tool

**Goal**

Copy legacy local blobs into canonical bucket keys.

**Files**

- same migration command package as above

**Implementation**

- Inputs:
  - bucket config
  - local attachment source roots
  - local image source roots
  - normalized attachment report
  - extracted image-reference report
- Copy behavior:
  - attachment source file -> `attachments/<generated-name>`
  - image source file -> `images/<public_name>`
- Add dry-run mode and apply mode.
- Add optional checksum verification mode.

**Decision**

Copy tool must not delete local files.

**Verification**

- copied object count matches expected references
- rerun is safe

---

## Story 3.4 — Build image asset backfill tool

**Goal**

Create `core.image_asset` rows for active legacy image references.

**Files**

- same migration command package

**Implementation**

- Read extractor output.
- For each active referenced image:
  - compute `storage_key = images/<public_name>`
  - inspect source or bucket object to derive:
    - `file_size`
    - `mime_type`
    - `width`
    - `height`
  - insert `core.image_asset`
  - set `original_file_name = public_name` for legacy rows
  - set `created_by = null` unless exact uploader attribution is available
- Do not insert rows for unreferenced files.

**Decision**

`core.image_asset` backfill runs after copy verification so metadata rows point at objects that already exist.

**Verification**

- backfilled rows match extracted references
- repeated run does not create duplicates

---

## Phase 4: Cleanup Of Runtime File Dependencies

## Story 4.1 — Remove migrated runtime dependence on filesystem helpers

**Goal**

Make the server runtime bucket-only.

**Files**

- `server/core/storage.go`
- `server/core/storage_test.go`
- `server/media/services/imageService.go`
- `server/attachment/services/attachmentService.go`

**Implementation**

- Remove or isolate runtime helpers that assume local filesystem blob access.
- Keep only:
  - canonical key helpers if still useful
  - migration-only normalization helpers if needed by tooling
- Ensure media and attachment runtime code do not call:
  - `os.ReadFile`
  - `os.Create`
  - `ResolveUploadPath(...)`
  - legacy public fallback logic

**Decision**

If migration tooling still needs path normalization helpers, move them into a migration-specific package rather than leaving them as runtime storage primitives.

**Verification**

- code search confirms runtime request paths no longer read or write local blob files

---

## Story 4.2 — Remove or quarantine upload backup script assumptions

**Goal**

Avoid keeping operational scripts that imply local disk remains the source of truth.

**Files**

- `backup/backup-uploads.sh`
- `backup/README.md` if relevant

**Implementation**

- Either remove the script, or mark it deprecated and replace it with documentation that runtime blob storage is already bucket-native.
- If retained for historical reference, add a warning header that it is not part of the post-migration runtime architecture.

**Verification**

- operator docs do not imply uploads require local disk sync after migration

---

## Phase 5: Test Matrix

## Unit tests

### Storage

- S3 config validation
- object put/get/delete
- metadata propagation
- error mapping

### Attachments

- canonical key generation
- DB write on upload
- stream read on download
- invalid path normalization in migration helper

### Images

- image asset insert/select
- upload requires `pageId`
- fetch resolves by `public_name`
- fetch enforces page permission

### Migration tooling

- attachment path rewrite
- image URL extraction from JSON content
- image URL extraction from binary-decoded content
- duplicate page ownership detection
- missing local file detection
- dry-run idempotence

## Integration tests

- upload attachment -> bucket object + DB row
- download attachment -> stream bytes
- upload image -> bucket object + `core.image_asset`
- fetch image -> page-authorized stream
- comment reply attachment path still works
- page attachment panel path still works

## Manual verification

- editor image insert on a document page
- editor attachment insert on a document page
- page reload after image insert
- comment reply attachment download
- unauthorized image fetch from another page context

---

## Maintenance-Window Rollout Procedure

## Pre-window

- deploy code to staging and verify bucket-backed runtime
- run migration tooling in dry-run against production snapshot or staging clone
- review blocked rows and ambiguous image ownership before production window
- produce final operator checklist with exact commands

## Window execution order

1. Freeze writes.
2. Run attachment inventory and normalization dry-run one final time.
3. Run image extractor one final time.
4. Copy attachment blobs to bucket.
5. Copy image blobs to bucket.
6. Normalize `core.attachment.storage_path`.
7. Backfill `core.image_asset`.
8. Deploy migrated runtime.
9. Run smoke checks.
10. Reopen writes.

## Required smoke checks

- existing attachment download
- new attachment upload and download
- existing image render in document
- new image upload and render
- comment attachment download
- permission failure check on image fetch for unauthorized user

---

## Rollback Procedure

Rollback target is the pre-migration release.

## Conditions that trigger rollback

- migrated runtime cannot read bucket objects reliably
- authorization regressions on image or attachment fetch
- large-scale missing object reports
- schema-related runtime failures not quickly fixable in-window

## Rollback steps

1. Freeze writes again.
2. Redeploy pre-migration release.
3. Restore `core.attachment.storage_path` values only if required by the old release.
4. Validate old release attachment and image reads from local disk.
5. Reopen traffic.

## Rollback notes

- keep local files intact until steady-state confidence is established
- `core.image_asset` rows may remain; old release ignores them
- bucket-copied blobs may remain; they are harmless

---

## Concrete File Touch Map

## Database

- new changelog for `core.image_asset`
- update Liquibase include chain if required

## Server runtime

- `server/go.mod`
- `server/go.sum`
- `server/main.go` if storage initialization must happen on startup
- `server/attachment/controller/attachmentController.go`
- `server/attachment/services/attachmentService.go`
- `server/attachment/services/config.go`
- `server/media/controller/mediaController.go`
- `server/media/services/imageService.go`
- `server/core/storage.go`
- `server/core/storage_test.go`
- new `server/storage/*`
- new image-asset repository/service files

## Server migration tooling

- new `server/cmd/upload_migration/*`

## UI

- `ui/app/core/http/uploadImageData.ts`
- `ui/app/core/editor/tiptap.tsx`

## Config and docs

- `.env.example`
- `docker/env/deploy.env.example`
- `docker/templates/compose.http.yml.tmpl`
- `docker/templates/compose.https.yml.tmpl`
- `docker/app/app.yml`
- `docker/scripts/common.sh`
- `docker/README.md`
- `backup/backup-uploads.sh`
- `backup/README.md` if needed

---

## Delivery Order

Recommended merge order:

1. DB schema PR
2. storage package PR
3. attachment runtime PR
4. image runtime + UI pageId PR
5. migration tooling PR
6. env/docs cleanup PR
7. rollout execution

If repo preference is fewer PRs, combine as:

- PR 1: schema + storage package + attachment runtime
- PR 2: image runtime + UI integration
- PR 3: migration tooling + docs + rollout checklist

---

## Definition Of Done

Implementation is complete when all of the following are true:

- server runtime no longer reads or writes blob files from local disk
- attachments use bucket-backed storage and canonical object keys
- images use bucket-backed storage and `core.image_asset`
- image upload requires page context and creates DB-backed metadata
- legacy attachments are normalized and readable
- legacy referenced images are copied, backfilled, and readable
- migration tooling is idempotent and operator-friendly
- staging verifies the full upload/download path
- maintenance-window runbook is executable without design ambiguity
