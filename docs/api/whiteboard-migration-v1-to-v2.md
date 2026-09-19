# Whiteboard v1 → v2 migration on editor open

Status: implemented, including asset migration. Deploy `whiteboard_migration.xml`,
`whiteboard_assets_v2.xml`, then `whiteboard_assets_v2_legacy_cleanup.xml` through
the root Liquibase changelog before deploying the updated server/Yjs runtime and
UI/package builds. Migration reuses the existing asset catalog and snapshot
manifest tables. The append-only cleanup changeset lets board deletion also
queue the retained legacy files; previously applied changesets remain unchanged.

## Scope

When an editor opens a supported v1 whiteboard, migrate its latest state into a
v2 draft and publish it as version 1. Keep its page ID, space, hierarchy,
ownership, and permissions. Select the current draft when present; otherwise
select the latest publication. Older publications and their files remain in
legacy storage and are not imported into v2 history.

This publishes previously unpublished draft changes. View-only visitors keep
seeing the existing v1 publication until cutover commits. Migration runs on
editor open, not as a bulk backfill.

Supported assets:

- Canonical Glideboard raster records containing PNG, JPEG, or static WebP.
- Validated self-contained SVG assets containing sanitized paths.
- Live asset records without a current shape reference, including assets on
  inactive canvas pages. Their ownership is preserved too.

Unknown/custom record formats, unresolved asset references, external or embedded
image sources, and invalid files fail explicitly. Older foreign document roots
such as `tl_records` still need their own format converter. Asset support does
not make those mixed document formats compatible automatically.

## Flow

1. Page metadata identifies the board as v1, so the edit route opens a detached
   migration host.
2. `GET /migration-source` returns the selected legacy state, title, document ID,
   and fingerprint after bounded server inspection. It creates no v2 board.
3. The client checks retained local recovery, loads a detached Y.Doc, and sets
   `glideboard-meta.boardIdentity` to `v2:{spaceId}:{pageId}`. Glideboard applies
   its supported canvas schema migrations with editing and collaboration disabled.
4. A read-only, session-scoped adapter resolves files through the same page's
   authenticated v1 asset endpoint. It downloads and verifies all live raster
   files before capturing the stable final Yjs state and PNG preview. SVG paths
   remain inside the document.
5. The client posts the state, title, PNG, and source fingerprint with a stable
   idempotency key. Raster bytes and arbitrary source URLs are not in this request.
6. The server independently inspects both states. Their sorted raster descriptors
   and complete asset identities must match: a submitted state cannot strip,
   add, or change source asset records.
7. Before copying, the server checks page ownership, space mutability, the v1
   catalog, and available quota. Each source comes from the same page's committed
   `core.whiteboard_asset` catalog. Its original bytes are read and fully inspected
   for hash, MIME, size, and dimensions, then written under a new v2 storage key.
8. The server locks/rechecks the source and temporary copies, then atomically
   creates the v2 board, asset ownership, quota usage, full snapshot, snapshot
   associations and completed manifest, draft, first publication, PNG, receipt,
   and legacy retention references for the selected source's raster files.
9. The normal v2 editor loads authoritative server state. Images resolve through
   v2 asset routes; later publication and restore use the ordinary manifest checks.

Preparation does not modify legacy Yjs state or connect to its live collaboration
room. A failed image download, copy, quota check, preview, or cutover leaves the
page on v1. Existing legacy mutations use the same space/page lock order and are
rejected with `409 WHITEBOARD_MIGRATED` after cutover.

## APIs

Paths are relative to `/api/v2/editor/space/{spaceId}/whiteboard/{pageId}`.

| Endpoint | Contract |
| --- | --- |
| `GET /migration-source` | Requires edit permission. Returns `sourceDocId` as a decimal string, `title`, base64 `state`, `updateEncoding`, `stateDigest`, and `sourceFingerprint`. Supported assets are allowed. Already migrated boards return `contentApiVersion: 2`; the client opens v2 directly. Responses are not cached. |
| `POST /migrate` | Requires edit permission and a mutable space. Accepts the existing source ID/fingerprint, full state, title, and PNG preview; requires one UUID `Idempotency-Key`. Copies eligible assets and commits the complete v2 board atomically. Returns page ID, snapshot ID, version ID, and sequence `"0"`. |

The source fingerprint covers the actual bytes, title, selection/status, document
ID, and available revision counters. Recompute it under the shared lock before
cutover. A changed source returns `409 SOURCE_CHANGED`; discard the prepared
result and load the latest source with a new key.

The migration endpoint allows a 49 MiB JSON request, at most 32 MiB of decoded
Yjs state, and a PNG preview of at most 4 MiB, 4096 pixels per dimension, and
8 million pixels total. Raster files use the [v2 upload limits](whiteboard-assets-v2.md):
20 MiB per file, 16,384 pixels per dimension, and 64 million pixels overall.
Animated WebP is unsupported. The manifest is limited to 10,000 assets.

The ordinary incremental checkpoint endpoint is not used to submit migration.
Valid Yjs bytes alone do not prove a renderable canvas; both server inspection
and the client projection/preview checks must succeed.

## Ownership, storage, and quota

V1 files are retained for legacy history. V2 gets independent immutable physical
copies under `whiteboard-v2-assets/{pageId}/migration/{uniqueId}`. Reusing a v1
object key would let legacy cleanup invalidate the v2 board, so catalog entries
never share the original object key.

The cutover transaction also writes `core.asset_reference` entries for the
selected legacy document and its raster hashes, retaining its actual draft or
published source kind. Existing references remain. This prevents a delayed v1
upload rollback from deleting an original used by the retained source document.

Only live raster records in the selected source are copied. Files that belong
only to unselected history remain solely in v1. Sanitized SVG paths need no
external file or raster catalog entry.

The extra physical copies consume storage quota. A rollback-only preflight checks
capacity before storage work; the cutover transaction reserves and commits the
actual usage alongside the catalog. Retried completed requests do not copy or
charge again. Concurrent attempts may temporarily copy files independently, but
only one migration commits and the unused copies remain eligible for cleanup.

## Interrupted copies and cleanup

Before any storage write, persist a cleanup intent for that unique destination
key. Copying and final cutover have an overall two-minute deadline, with each
storage operation bounded to one minute. Cleanup eligibility begins after the
copy deadline plus the existing storage grace period.

The final transaction locks each intent and requires that it has never been
claimed or completed by cleanup. It rechecks the legacy catalog, inserts v2
ownership, and removes the intent atomically. A worker that already claimed an
object therefore cannot delete a file accepted by migration.

Failed or abandoned attempts leave durable cleanup jobs. A late failed write
rearms its exact object's job, including when an earlier cleanup pass had already
run. Temporary copies have no committed quota charge. The existing v2 asset
cleanup worker handles their removal; the original legacy objects are untouched.

Deleting a migrated board queues both catalogs' physical keys and any outstanding
upload objects before deleting their ownership rows. It releases the two catalogs'
usage and outstanding reservations in that same transaction. The cleanup worker
does not release quota a second time. Legacy keys become eligible only after
their page has been deleted, so live legacy catalogs and upload receipts remain
protected. Legacy direct uploads lock the page and object before writing, allowing
deletion to capture a transfer's committed catalog entry before the page disappears.

The additional XML changeset permits only page-bound canonical legacy keys on
`board_deleted` jobs. Its rollback requires draining and removing those jobs
first; it does not discard pending work to make rollback succeed. Soft-deleting
a space retains committed files for retention; it is not a physical board purge.

## Errors and retry behavior

| Response | Meaning |
| --- | --- |
| `409 MIGRATION_ASSETS_UNSUPPORTED` | The source contains unsupported or invalid asset semantics. |
| `422 MIGRATION_ASSET_MISMATCH` | Submitted asset identities/descriptors or legacy catalog metadata do not match the selected source. |
| `503 MIGRATION_ASSET_UNAVAILABLE` | The original bytes or destination storage could not be read/written. The same prepared request may be retried. |
| `409 ASSET_QUOTA_EXCEEDED` | There is insufficient capacity for the additional retained copies. |
| `409 SOURCE_CHANGED` | The selected legacy state changed during preparation/copying. Prepare again. |
| `422 MIGRATION_FORMAT_UNSUPPORTED` | The document cannot be classified safely, including unsupported roots or incomplete Yjs state. |

Missing catalog records, invalid image bytes, upload contention, and other limits
use the existing asset API errors. No error should silently discard an image or
publish a partial copy.

An uncertain POST keeps the exact request bytes and key in the mounted host.
Retry replays a completed receipt or retries the uncommitted operation. Reload
can discover a committed board through `migration-source`. Board/session changes
abort preparation and cannot send an old migration body to another page.

## Recovery and verification

Retained browser recovery for the selected v1 document blocks preparation and
offers the existing editor so those edits can be saved first. Migration does not
merge or clear local recovery. Stale legacy editors retain unsaved Yjs changes
when notified that the page has migrated. Browser-only changes on other devices
cannot be discovered by the server.

Tests cover canonical raster and inline vector inspection, unreferenced records,
asset stripping/mutation, unsupported references, source conflicts, matching
receipts, same-page ownership, quota, storage failure, cleanup races, atomic
rollback, publication/restore membership, and stale client callbacks.

For the disposable database suite, set `WHITEBOARD_MIGRATION_TEST_DSN` to a
database named `whiteboard_migration_test`. The suite resets that database's test
schemas and applies the actual Liquibase files. It must not use an application
database.

See the [asset migration browser verification](whiteboard-migration-assets-browser-verification-2026-09-16.md)
for image rendering, history/restore, missing originals, and request recovery.
