# Design Doc: Orphaned File And Image Cleanup

## Summary

This document defines a cleanup design for uploaded attachments and editor images that are no longer referenced by product data.

Beskar already stores durable metadata for both asset classes:

- attachments in `core.attachment`
- document images in `core.image_asset`

Both classes also contribute to `billing.space_usage.storage_bytes_used`, so orphaned rows and blobs create two problems:

- unnecessary object-storage cost
- inflated quota usage

The goal of this design is to introduce a safe, repeatable cleanup pipeline that detects orphaned assets, soft-deletes their metadata, removes their bytes from quota usage, and permanently deletes blobs after a retention window.

This is a design-only document. No code, schema, or cron jobs are introduced here.

---

## Objective

- Detect orphaned attachments and images using persisted product state, not storage bucket scans.
- Avoid deleting assets immediately after an editor action so undo/save races do not break content.
- Use DB metadata as the source of truth for cleanup decisions.
- Keep quota usage aligned with active assets only.
- Make cleanup idempotent, resumable, and safe to run on a schedule.

---

## Non-Goals

- Building an end-user trash or restore UI.
- Cleaning unrelated bucket objects with no DB metadata at all.
- Redesigning the editor document schema.
- Introducing signed URLs or direct-to-bucket uploads.
- Solving historical local-disk migration concerns that are already covered by the storage migration work.

---

## Current-State Findings

## Asset Models Already Exist

### Attachments

`core.attachment` already stores:

- `id`
- `page_id`
- `storage_path`
- `file_name`
- `file_size`
- `mime_type`
- `created_by`
- `created_at`
- `deleted_at`

Important current behavior:

- uploads create DB metadata and object storage bytes together
- download only serves rows where `deleted_at IS NULL`
- code comments already state that inline-chip removal should not delete immediately
- comment replies can also reference attachments through `core.comment_reply_attachments`

### Images

`core.image_asset` already stores:

- `id`
- `page_id`
- `public_name`
- `storage_key`
- `original_file_name`
- `file_size`
- `mime_type`
- `width`
- `height`
- `created_by`
- `created_at`
- `deleted_at`

Important current behavior:

- uploads require `pageId`
- image fetch resolves by `public_name`
- image serving only returns rows where `deleted_at IS NULL`
- there is no cleanup implementation yet for images

## Quota Accounting Already Depends On Active Rows

Quota reconciliation sums only active assets:

- `core.attachment WHERE deleted_at IS NULL`
- `core.image_asset WHERE deleted_at IS NULL`

That means soft-deleting orphan rows is enough to remove them from future reconciled usage. The cleanup job also updates usage incrementally at delete time so quota state does not wait for the next full reconciliation pass.

## Document History Changes The Liveness Rule

`core.page` does not map to a single document snapshot.

The repo shows that a page can have multiple document records through `core.page_doc_map`, with:

- `page_id`
- `doc_id`
- `draft`
- `version`

and editor reads already distinguish between:

- latest published document
- latest draft document

This matters because product history is intentional. An asset that is absent from the latest document may still be required by:

- an older published version the product wants to preserve
- a retained draft version
- future page-history features

Therefore the cleanup job must not use the rule:

- "not referenced by the latest doc for the page"

That rule would incorrectly delete assets still needed for historical page versions.

## Unpublished Drafts Stored As Binary Yjs State

There is another important complication in this repo:

- unpublished draft content is stored in `core.content_draft.data_binary`
- that value is a Yjs update blob
- the current decode path appears to live in the client/WASM flow, not in Go server cleanup code

That means the cleanup job cannot safely assume:

- it can parse every retained draft directly from Postgres, or
- absence from published JSON means absence from the current draft

For images and attachments, an asset may still be live because it is referenced only by an unpublished draft.

So the cleanup design must explicitly account for draft-only references.

## Current Write-Path Findings

The current application write paths are asymmetric:

- draft save sends opaque Yjs binary in `data`
- publish sends structured `nodeData`
- image upload returns `public_name` to the client, not `core.image_asset.id`
- attachment upload already returns stable `attachmentId`

This has a direct design consequence:

- draft save cannot rely on server-side extraction in Phase 2 because the request body does not contain parseable editor structure
- publish receives structured `nodeData`, but this design does not use a separate publish-only derivation path because draft and publish must follow one contract

Phase 2 uses one explicit reference payload contract for both draft save and publish.

## Reference Sources Are Different For The Two Asset Classes

### Attachment references

An attachment is still in use if either of these is true:

- its `attachmentId` still appears in any retained persisted page document content for that page
- it is still linked from `core.comment_reply_attachments`

### Image references

An image is still in use if its public URL still appears in any retained persisted page document content for the page that owns the asset.

Current editor image URLs are formed as:

- `/api/v1/media/image/{public_name}`

or the same path under the configured API base URL.

## Immediate Delete Would Be Unsafe

The existing attachment service comment is correct: removing an inline chip is not the same as permanent delete.

Unsafe cases include:

- user removes a chip and immediately undoes
- autosave lag means the last persisted doc still references the asset
- two browser tabs temporarily diverge
- image node replacement creates a short-lived unused asset before the next save

The cleanup design must therefore be asynchronous and retention-based.

---

## Design Principles

- Treat the database as the authoritative source for asset liveness.
- Detect references from a normalized DB-backed reference index, not bucket listings.
- Soft-delete first, hard-delete later.
- Be page-scoped wherever possible to keep scans bounded.
- Make every step idempotent so retries are safe.
- Prefer conservative false negatives over aggressive false positives.

---

## Proposed Design

## 1. Cleanup Has Two Phases

### Phase A: Mark orphaned

For candidate assets that are no longer referenced:

- set `deleted_at = now()`
- decrement `billing.space_usage.storage_bytes_used`
- write a usage event describing the cleanup delta

At this point:

- the asset stops being downloadable through normal APIs
- quota usage drops immediately
- the underlying blob is still retained for a short grace period

### Phase B: Purge blob

For rows already soft-deleted and older than the retention threshold:

- delete the object-storage blob
- keep or remove the DB row based on the chosen audit policy

Chosen implementation:

- delete the blob
- keep the soft-deleted row for audit/debugging

That keeps the system observable and avoids breaking usage-event provenance.

## 2. Use A Scheduled Background Job

Introduce a periodic cleanup worker in the server process, similar in spirit to quota reconciliation.

Default cadence:

- mark pass every 1 hour
- purge pass every 6 hours

Default retention windows:

- orphan mark threshold: 24 hours since last observed as unreferenced
- blob purge threshold: 7 days after `deleted_at`

These values are config-driven, but these defaults are part of the design:

- mark pass every 1 hour
- purge pass every 6 hours
- orphan mark threshold 24 hours
- blob purge threshold 7 days

## 3. Add Explicit Cleanup State

`deleted_at` alone is not enough to support a safe mark threshold, because the system must distinguish:

- active and still referenced
- active but newly unreferenced
- soft-deleted and pending purge
- purged

Required metadata additions for both `core.attachment` and `core.image_asset`:

- `orphaned_at TIMESTAMPTZ NULL`
- `purged_at TIMESTAMPTZ NULL`

Semantics:

- `orphaned_at`: first time the system observed no live references
- `deleted_at`: time the row was logically deleted and removed from active usage
- `purged_at`: time the blob was permanently deleted

Why both `orphaned_at` and `deleted_at`:

- `orphaned_at` supports a grace window before logical deletion
- `deleted_at` remains the product-facing active/inactive flag already used by reads and quota queries

## 4. Introduce `core.asset_reference`

The cleanup design assumes a new normalized reference table exists and is the primary source of truth for asset liveness.

Chosen table:

- `core.asset_reference`

Fields:

- `asset_type` such as `attachment` or `image`
- `asset_id` referencing `core.attachment.id` or `core.image_asset.id`
- `page_id`
- `doc_id`
- `source_kind` such as `published_doc`, `draft_doc`, `comment_reply`
- `source_id`
- `last_seen_at`
- `created_at`
- `updated_at`

Uniqueness boundary:

- one row per `(asset_type, asset_id, source_kind, source_id)`

Required DB constraints:

- `asset_type IN ('attachment', 'image')`
- `source_kind IN ('draft_doc', 'published_doc', 'comment_reply')`

Purpose:

- assets remain owned by `page_id` for storage, quota, and permission concerns
- references become many-to-many across drafts, published versions, and comment replies
- cleanup queries become relational and history-aware

## 5. Define Liveness Separately For Attachments And Images

### Attachment liveness rule

An attachment row is live if any of the following holds:

- at least one retained `core.asset_reference` row exists for that attachment
- or, during migration only, a still-unbackfilled comment linkage must conservatively block cleanup

If neither holds, the attachment is orphaned.

### Image liveness rule

An image asset row is live if at least one retained `core.asset_reference` row exists for that image asset.

The match supports:

- absolute URLs ending in `/media/image/{public_name}`
- relative URLs ending in `/media/image/{public_name}`

The cleanup logic does not require the full host to match.

## 6. Reference Table Population Strategy

The most important implementation decision is how `core.asset_reference` is populated and kept correct over time.

Chosen approach:

- backfill existing retained data once
- forward-fill on every future write path that can change references
- make cleanup depend on `core.asset_reference`, not on ad hoc document parsing during cleanup

This is better than parsing product content inside the cleanup job because:

- draft-only references become explicit
- history retention is represented directly in rows
- cleanup remains simple and auditable
- Yjs draft decoding is removed from the critical delete path

### Forward-fill

`core.asset_reference` is updated on the application write paths that change retained asset usage.

### Reference payload contract

Phase 2 adds one optional request field to both draft-save and publish requests:

- `assetReferences`

Payload shape:

```json
{
  "assetReferences": {
    "attachments": ["attachment-uuid-1", "attachment-uuid-2"],
    "images": ["image-public-name-1", "image-public-name-2"]
  }
}
```

Contract rules:

- `attachments` contains `core.attachment.id`
- `images` contains image `public_name` in the first rollout
- the server resolves image `public_name` to `core.image_asset.id` before writing `core.asset_reference`
- `public_name` is globally unique in the current schema, so duplicate-name resolution is not ambiguous
- the server only resolves `public_name` against an active `core.image_asset` row whose `page_id` matches the request page
- the server only accepts an attachment id if the attachment row is active and its `page_id` matches the request page
- if `assetReferences` is present, it is the full authoritative snapshot for that source
- empty arrays mean "replace existing refs with none"
- omitted `assetReferences` means "do not modify `core.asset_reference` for this request"

Why `public_name` is the chosen Phase 2 image identifier:

- current image upload returns `public_name` to the frontend
- current editor state naturally stores `/media/image/{public_name}` URLs
- adding `image_asset.id` end-to-end is a separate API evolution and does not block Phase 2

This does not create duplicate-name ambiguity because:

- `core.image_asset.public_name` already has a unique constraint
- image upload generates unique public names
- server-side resolution is scoped to active rows and the current page

This omission rule is required for backward-compatible rollout:

- old clients can continue saving drafts/publishing without immediately wiping references
- new clients can start writing explicit snapshots

### Canonical normalization rule

Before any write to `core.asset_reference`, the server normalizes request payload references into canonical stored references:

- attachment input: attachment UUID -> validated active `core.attachment.id`
- image input: `public_name` -> resolved active `core.image_asset.id`

This normalization is shared application logic. Draft save, publish, and comment flows do not each implement their own reference-resolution rules.

#### Draft save

When the editor saves a draft:

- extract the full current attachment/image set from the editor state on the client
- delete existing `draft_doc` reference rows for that `doc_id`
- insert the new full set as `source_kind = 'draft_doc'`

This is snapshot replacement, not incremental mutation.

Phase 2 does not derive draft references from server-side Yjs decoding.

#### Publish

When a document version is published:

- send the full published attachment/image set using the same `assetReferences` contract
- delete any existing `published_doc` rows for that published `doc_id`
- insert the new set as `source_kind = 'published_doc'`

Published references are retained for as long as that published version is retained by product policy.

Although the current publish request includes structured `nodeData`, Phase 2 uses the explicit request payload so draft and publish follow one rule.

#### Comment reply create/edit/delete

When a comment reply attachment set changes:

- delete existing `comment_reply` rows for that reply id
- insert the new attachment set as `source_kind = 'comment_reply'`

When the reply is deleted or no longer retained:

- delete its `comment_reply` rows

### Backfill existing data

`core.asset_reference` needs a one-time bootstrap before cleanup can trust it.

#### Published document backfill

For every retained published `doc_id`:

- load the published document content for that exact `doc_id` using a dedicated historical-doc query/helper
- extract attachment IDs and image public names
- resolve image public names to image asset ids
- insert `published_doc` reference rows

The backfill design does not use "latest page document" helpers for this step. It requires a `doc_id`-specific published-document loader so older retained versions can be indexed exactly.

#### Comment attachment backfill

For every retained comment reply attachment relation:

- read `core.comment_reply_attachments`
- insert `comment_reply` reference rows

#### Draft backfill

For every active draft in `core.content_draft`:

- do not decode Yjs binary during initial backfill
- mark the page coverage as `blocked_binary_draft`
- exclude the page from cleanup until a future draft save or publish writes explicit `assetReferences`

This is the chosen rule. Historical binary drafts are not backfilled in the initial system.

### Completion rule

Cleanup is enabled only for assets whose reference coverage is known complete.

That means:

- published history backfill completed
- comment attachment backfill completed
- draft references are either indexed by a new write-path update or explicitly blocked from cleanup

### Reference row removal

Reference rows are removed when their source snapshot no longer retains those references.

Rules:

- `draft_doc`: replace the full set on every draft save
- `published_doc`: keep rows while that published version is retained; remove them only when that retained version is pruned
- `comment_reply`: replace the full set on reply edit; remove on reply deletion or retention end

### Draft binary problem

`core.content_draft.data_binary` is not a cleanup-friendly storage format.

A background cleanup job does not depend on ad hoc decoding of Yjs binary blobs unless the server owns a reliable, version-compatible decoder for the exact editor schema in production.

If cleanup depends on best-effort draft decoding, then a decode failure can incorrectly make live assets look orphaned.

That failure mode is too dangerous.

### Retained history set

The cleanup design uses this explicit retention boundary:

- every retained published `core.page_doc_map` row is live history
- the latest active draft snapshot is live editable state
- comment replies and their attachment links are live while the reply is retained

For the current product, every existing published `core.page_doc_map` row is treated as retained. Cleanup does not prune history and does not infer a narrower retention rule.

If document-version pruning is introduced later, the prune workflow must delete `published_doc` rows for the pruned `doc_id` in the same transaction that removes that retained version from product history.

### What `asset_reference` actually represents

`asset_reference` does not mean:

- assets used by the latest page version only

It means:

- assets referenced by any retained source snapshot that the product still treats as live history or current editable state

That includes:

- the latest active draft state for a draft doc
- every retained published document version
- comment reply attachment references, if applicable

So yes, an old published version can and does continue to hold asset references in `asset_reference` even after the current published version no longer uses those assets.

Example:

1. Published doc `101` references image `img_A`
2. Later published doc `102` references image `img_B` and no longer references `img_A`
3. If published doc `101` is still retained in product history, `asset_reference` still contains:
   - `published_doc -> doc 101 -> img_A`
   - `published_doc -> doc 102 -> img_B`

In that state:

- `img_A` is not part of the current published version
- but `img_A` is still live because a retained published version still references it

Only after doc `101` is no longer retained by product policy, and no other retained draft, published doc, or comment reply references `img_A`, can `img_A` enter orphan cleanup.

### Source-retention matrix

The intended `asset_reference` retention behavior is:

- `draft_doc`: track only the latest active draft snapshot for that doc
- `published_doc`: track every retained published version
- `comment_reply`: track the current attachment set for that reply while the reply is retained

This means the table is not a mutation log and not a pure "current page state" table.

It is a retained-reference index keyed by source snapshots that still matter to the product.

## 7. State Machine

For each asset row:

### Live and referenced

- `orphaned_at = NULL`
- `deleted_at = NULL`
- `purged_at = NULL`

### First observed orphan

- if not referenced and `orphaned_at IS NULL`, set `orphaned_at = now()`

### Still orphaned past grace window

- if not referenced and `orphaned_at <= now() - orphan_mark_grace`, set:
  - `deleted_at = now()`
- decrement quota usage by `file_size`
- emit usage event with negative delta

### Re-referenced before logical deletion

- if referenced again while `deleted_at IS NULL`, clear `orphaned_at`

### Soft-deleted past purge window

- if `deleted_at <= now() - purge_grace` and `purged_at IS NULL`, delete blob and set `purged_at = now()`

### Re-reference after logical deletion

This is treated as unsupported in normal product flow, because active reads already exclude `deleted_at IS NOT NULL`.

If it happens due to a race or manual DB changes:

- do not auto-resurrect in the first implementation
- log it as data drift for manual inspection

---

## Detailed Job Flow

## Mark Pass

1. Load a batch of active pages.
2. For each page, load active assets and retained `core.asset_reference` coverage.
3. Resolve the live asset set from `core.asset_reference`.
4. Load active attachment rows for the page.
5. Load active image asset rows for the page.
6. For each asset:
   - if referenced, clear `orphaned_at` when present
   - if unreferenced and `orphaned_at IS NULL`, set `orphaned_at = now()`
   - if unreferenced and orphan grace elapsed, set `deleted_at = now()`
7. If reference coverage for a page is incomplete, skip cleanup for that page.
8. When `deleted_at` is set:
   - update `billing.space_usage`
   - insert a `billing.space_usage_event`

## Purge Pass

1. Select rows from `core.attachment` and `core.image_asset` where:
   - `deleted_at IS NOT NULL`
   - `purged_at IS NULL`
   - purge grace has elapsed
2. Delete the blob from object storage.
3. If delete succeeds or object is already absent:
   - set `purged_at = now()`
4. If delete fails:
   - leave row unchanged except for failure logging/metrics
   - retry next run

---

## Schema And Query Changes

## Schema changes

For `core.asset_reference`:

- create the table and supporting indexes
- add check constraint for `asset_type`
- add check constraint for `source_kind`
- index by `(asset_type, asset_id)`
- index by `(source_kind, source_id)`
- index by `(page_id, doc_id)`

For `core.asset_reference_coverage`:

- create the table and supporting indexes
- add check constraint for `draft_status`

For `core.attachment`:

- add `orphaned_at TIMESTAMPTZ`
- add `purged_at TIMESTAMPTZ`
- add index on `(deleted_at, purged_at)`
- add index on `(page_id, deleted_at)`

For `core.image_asset`:

- add `orphaned_at TIMESTAMPTZ`
- add `purged_at TIMESTAMPTZ`
- add index on `(deleted_at, purged_at)`
- add index on `(page_id, deleted_at)`

## Helper queries

- list page IDs in batches
- load reference rows for a page
- load active attachments for a page
- load active image assets for a page
- resolve active attachment id scoped to page
- resolve active image `public_name` scoped to page
- replace reference rows for a given `(source_kind, source_id)`
- backfill published reference rows
- backfill comment reply reference rows
- load published document content for an exact historical `doc_id`
- mark draft coverage as unknown or indexed
- mark orphan detection timestamps
- soft-delete eligible rows with `deleted_at IS NULL` guards
- mark purge completion with `purged_at IS NULL` guards

All update queries are written so reruns are harmless.

---

## Quota Integration

When an asset transitions from active to soft-deleted:

- decrement `billing.space_usage.storage_bytes_used` by `file_size`
- insert a negative `billing.space_usage_event`

Event shape:

- `metric_key = 'storage_bytes'`
- `event_type = 'cleanup_delete'`
- `source_type = 'attachment_cleanup'` or `image_cleanup`
- `source_id = asset id`

Why update quota at logical delete instead of purge:

- the asset is already inactive from the product’s perspective
- waiting for blob purge would keep storage limits artificially high
- reconciliation already treats soft-deleted rows as inactive

---

## Failure Handling

## Blob missing at purge time

Treat this as successful purge and set `purged_at`.

Reason:

- the desired end state is “blob not present”
- repeated hard failures on missing objects would create noisy permanent retry loops

## Quota update fails during logical delete

Logical delete and quota delta happen in one DB transaction.

If the transaction fails:

- the row must remain active
- the job retries later

## Document parse failure for one page

- log the page ID and continue with other pages
- do not mark any assets from that page in that run

This avoids corrupting cleanup decisions because of one malformed document.

## Wrongful delete caused by a cleanup bug

The design must assume the cleanup job can be wrong.

Recovery must therefore be designed into the lifecycle rather than treated as an operational afterthought.

### Recovery policy

- logical delete must be reversible
- physical purge must be delayed
- purge must re-check liveness before deleting bytes
- every delete action must be auditable

### Recovery before purge

If an asset was soft-deleted incorrectly but its blob has not yet been purged:

- clear `deleted_at`
- clear `orphaned_at`
- leave `purged_at` as `NULL`
- add a compensating `billing.space_usage_event`
- increment `billing.space_usage.storage_bytes_used` by `file_size`

Because the blob still exists, this restore path is low risk and is the primary safety net.

### Recovery after purge

If the blob was already purged, recovery depends on bucket-level retention.

Required object-storage protection:

- bucket versioning enabled on the runtime storage bucket

Object lock is not part of this design. Backup/replication is additional protection, not the primary recovery mechanism.

Recovery after purge is:

- restore the blob from the previous object version or backup
- clear `deleted_at`
- clear `orphaned_at`
- keep `purged_at` as immutable audit history
- write compensating quota usage events

Without bucket retention or backup, a wrongful physical purge is not reliably recoverable.

### Purge must have a second safety check

The purge worker must not assume the earlier orphan mark was correct.

Immediately before deleting the blob, it:

- reload current references for the owning page
- re-evaluate whether the asset is still orphaned
- skip purge if the asset is now referenced again

This protects against:

- cleanup job bugs fixed after the initial mark
- autosave or replication lag
- late user edits that reintroduce the reference

### Audit requirements

Every logical delete, restore, and purge emits a durable audit record or usage event metadata that includes:

- asset id
- asset type
- page id
- storage key
- file size
- job run id or correlation id
- action type such as `marked_orphaned`, `soft_deleted`, `restored`, `purged`
- timestamp

This makes investigation and replay tractable if a cleanup bug is reported later.

## Wasabi Object Version Recovery

The deployment assumption for this design is:

- Wasabi bucket versioning is enabled for the object bucket used by attachments and images

That versioning setting is the recovery mechanism after a bad blob delete.

### What versioning protects

When versioning is enabled on the Wasabi bucket:

- overwriting an object creates a new object version
- deleting an object key typically creates a delete marker rather than immediately erasing older versions
- an older version can be retrieved explicitly by `versionId`

So a bad purge is recoverable as long as the prior object version still exists.

### How recovery is keyed

Recovery is driven by the stored object key, not directly by the application asset id.

The application row tells operators which key to inspect:

- for images, use `core.image_asset.storage_key`
- for attachments, use `core.attachment.storage_path`, normalized to the stored object key form

The recovery flow is:

1. Identify the affected asset row in Postgres.
2. Read the stored object key from the row.
3. List Wasabi object versions for that key.
4. Select the correct prior version using:
   - `Key`
   - `VersionId`
   - `LastModified`
   - delete-marker state
5. Restore the prior object version as the current object state.
6. Clear `deleted_at` in Postgres and restore quota usage with a compensating positive usage event.

### Example Wasabi CLI workflow

List versions for the stored key:

```bash
aws s3api list-object-versions \
  --bucket YOUR_BUCKET \
  --prefix "images/example-object-key.png" \
  --endpoint-url https://s3.YOUR_REGION.wasabisys.com
```

Inspect or download a specific prior version:

```bash
aws s3api get-object \
  --bucket YOUR_BUCKET \
  --key "images/example-object-key.png" \
  --version-id VERSION_ID \
  recovered-file.bin \
  --endpoint-url https://s3.YOUR_REGION.wasabisys.com
```

If the latest state is a delete marker, recovery usually means either:

- removing the delete marker, or
- copying the chosen older version back onto the same key as the current version

### Operational expectation

This design treats Wasabi bucket versioning as mandatory recovery infrastructure for blob purge safety.

Without object versioning or an equivalent backup system:

- logical delete is reversible before purge
- blob purge becomes effectively irreversible

### Admin recovery flow

Before purge:

- find the asset row by id or storage key
- confirm the blob still exists
- clear delete markers
- restore quota usage

After purge:

- restore the blob from bucket versioning or backup
- clear delete markers
- restore quota usage
- record the restore action for audit

### Rollout guardrails

To reduce the chance of wrongful deletes in the first place:

- run the mark pass in dry-run mode first
- expose per-run summaries in logs or admin tooling
- start with long purge grace periods in production
- cap the number of assets that can be soft-deleted or purged in one run
- alert on unusual delete spikes

---

## Observability

Emit structured logs and metrics for:

- pages scanned
- attachments scanned
- images scanned
- assets newly orphaned
- assets restored from orphaned state
- assets logically deleted
- blobs purged
- purge failures
- parse failures
- total bytes removed from active quota

Admin visibility:

- an endpoint or report showing recently soft-deleted assets
- per-run cleanup summaries

---

## Rollout Plan

## Phase 1

- add schema fields and indexes
- implement extraction helpers
- implement mark pass in dry-run mode only
- log which assets would be orphaned or deleted

## Phase 2

- enable real orphan marking and logical delete
- keep blob purge disabled
- validate that quota usage moves as expected

## Phase 3

- enable blob purge after retention window

## Phase 4

- add admin tooling for inspection and manual replay

---

## Resolved Decisions

- Published backfill uses the same server-side published-document projection that current document reads use for a specific `doc_id`, built from the persisted published representation already served by the editor backend. The cleanup design does not use `core.doc.data` as a separate source of truth.
- Comment attachments use the same orphan flow as all other assets. No separate retention policy exists beyond retained `comment_reply` references.
- Cleanup only runs on pages in spaces where `core.space.deleted_at IS NULL`. Archived spaces are included because they are still retained content; soft-deleted spaces are excluded.
- Soft-deleted asset rows remain in the database indefinitely for audit and recovery. This design does not physically delete asset metadata rows.
- Initial draft backfill does not decode historical Yjs binary. Historical drafts are blocked from cleanup until a future draft save or publish writes explicit `assetReferences`.

---

## History-Safe Cleanup Rule

To be explicit, an asset for page `P` is eligible for orphan cleanup only if all of the following are true:

- it is not referenced by any retained document version of page `P`
- for attachments, it is not referenced by `core.comment_reply_attachments`
- it remains unreferenced through the orphan grace window

This is the minimum safe rule for a product that intends to preserve page history.

---

## First Implementation Scope

Keep the first delivery narrow:

- support attachments and images
- introduce and rely on `core.asset_reference`
- backfill published document references
- backfill comment reply attachment references
- forward-fill draft, publish, and comment reply reference rows on every write
- exclude not-yet-indexed draft coverage from cleanup
- add `orphaned_at` and `purged_at`
- perform soft-delete plus quota decrement
- purge blobs later

Do not include in the first pass:

- bucket-only orphan discovery
- restore tooling
- permanent DB row deletion
- best-effort cleanup based on opaque Yjs blob parsing alone

This scope solves the real leak without making cleanup logic too clever to trust.
