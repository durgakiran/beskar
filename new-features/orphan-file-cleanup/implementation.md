# Implementation Plan: Orphaned File And Image Cleanup

> This document translates [design.md](./design.md) into an execution-ready implementation plan.
>
> Scope: schema, backend services, reference indexing, backfill, cleanup job, rollout, and verification required to safely clean orphaned attachments and images without breaking document history or unpublished drafts.

---

## Summary

This implementation has seven workstreams that must land in order:

1. Add cleanup and reference-index schema.
2. Add backend primitives for `core.asset_reference`.
3. Forward-fill references on draft save, publish, and comment attachment writes.
4. Backfill references for existing published docs, comment attachments, and safe draft cases.
5. Implement the orphan mark/purge worker using `core.asset_reference`.
6. Add admin safety controls, observability, and repair tooling.
7. Roll out gradually with coverage gating before any real deletes happen.

Target end state:

- attachments remain owned by `core.attachment.page_id`
- images remain owned by `core.image_asset.page_id`
- `core.asset_reference` becomes the liveness source of truth
- published history remains fully protected
- current drafts remain protected
- cleanup soft-deletes first, purges later
- quota usage drops when assets become logically deleted
- cleanup is blocked for pages whose reference coverage is incomplete

---

## Implementation Principles

- Keep asset ownership and asset references separate.
- Make `core.asset_reference` authoritative before enabling cleanup.
- Treat draft decoding uncertainty as a blocker, not a best-effort warning.
- Replace reference sets snapshot-by-snapshot; do not append mutation history.
- Keep all destructive cleanup behind feature flags and dry-run mode first.
- Prefer skipping cleanup over deleting a maybe-live asset.

---

## Phase Overview

| Phase | Goal | Output |
| --- | --- | --- |
| Phase 0 | Schema foundation | `core.asset_reference` + cleanup metadata columns + indexes |
| Phase 1 | Reference write path foundation | backend helpers and transactional replace APIs |
| Phase 2 | Forward-fill references | draft save, publish, comment reply flows write reference rows |
| Phase 3 | Backfill existing data | published/comment backfill + draft coverage classification |
| Phase 4 | Cleanup worker | mark and purge jobs driven by reference coverage |
| Phase 5 | Operations and safety | admin tooling, metrics, dry-run, caps, recovery controls |
| Phase 6 | Rollout | verify coverage, enable mark, then enable purge |

---

## Phase 0: Schema Foundation

## Story 0.1 — Add `core.asset_reference`

**Goal**

Create the normalized retained-reference table used for asset liveness.

**Files**

- new Liquibase changelog under `db/beskar/updates/`
- `db/beskar/update.xml`

**Implementation**

- Add `core.asset_reference`.
- Fields:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `asset_type TEXT NOT NULL`
  - `asset_id TEXT NOT NULL`
  - `page_id BIGINT NOT NULL`
  - `doc_id BIGINT NULL`
  - `source_kind TEXT NOT NULL`
  - `source_id TEXT NOT NULL`
  - `last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- Add uniqueness constraint:
  - `(asset_type, asset_id, source_kind, source_id)`
- Add check constraints:
  - `asset_type IN ('attachment', 'image')`
  - `source_kind IN ('draft_doc', 'published_doc', 'comment_reply')`
- Add indexes:
  - `(asset_type, asset_id)`
  - `(page_id, doc_id)`
  - `(source_kind, source_id)`
  - `(page_id, asset_type)`

**Decisions**

- `asset_id` is stored as text across attachment UUIDs and image asset UUIDs.
- `source_kind` values for first rollout:
  - `draft_doc`
  - `published_doc`
  - `comment_reply`

**Verification**

- Liquibase applies cleanly on fresh and existing DBs.
- uniqueness and supporting indexes exist as expected.

---

## Story 0.2 — Add cleanup lifecycle columns

**Goal**

Add the metadata needed for reversible delete and delayed purge.

**Files**

- new Liquibase changelog under `db/beskar/updates/`

**Implementation**

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

**Verification**

- columns exist
- reads remain unchanged because existing paths already gate on `deleted_at IS NULL`

---

## Story 0.3 — Add reference coverage tracking

**Goal**

Track whether a page is safe for cleanup.

**Files**

- new Liquibase changelog under `db/beskar/updates/`

**Implementation**

Add the coverage table:

- `core.asset_reference_coverage`

Fields:

- `page_id BIGINT PRIMARY KEY`
- `published_backfilled_at TIMESTAMPTZ`
- `comment_backfilled_at TIMESTAMPTZ`
- `draft_status TEXT NOT NULL`
- `draft_checked_at TIMESTAMPTZ`
- `cleanup_eligible BOOLEAN NOT NULL DEFAULT false`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

`draft_status` values:

- `unknown`
- `indexed`
- `blocked_binary_draft`

Add check constraint:

- `draft_status IN ('unknown', 'indexed', 'blocked_binary_draft')`

**Purpose**

- cleanup worker can skip pages whose reference coverage is incomplete
- rollout can be verified explicitly instead of inferred

**Verification**

- rows can be upserted per page
- cleanup eligibility can be computed deterministically

---

## Phase 1: Reference Write Path Foundation

## Story 1.1 — Add `asset_reference` repository/service layer

**Goal**

Introduce one backend module that owns all reference-table writes.

**Files**

- new package under `server/`
  - path: `server/assetref/`

**Implementation**

- Add typed helpers:
  - `ReplaceDraftDocReferences(...)`
  - `ReplacePublishedDocReferences(...)`
  - `ReplaceCommentReplyReferences(...)`
  - `ListPageAssetReferences(...)`
  - `MarkCoverage...(...)`
- Add shared normalization helpers:
  - validate attachment UUID exists, is active, and belongs to the request page
  - resolve image `public_name` to active `core.image_asset.id` scoped to the request page
  - normalize request payloads into canonical stored refs before replace helpers are called
- Each replace helper:
  - run inside the caller’s transaction
  - delete existing rows for `(source_kind, source_id)`
  - bulk insert the new set
  - update `last_seen_at` / `updated_at`

**Verification**

- full snapshot replacement works
- repeated writes are idempotent
- no duplicate rows survive for the same source snapshot
- normalization rejects wrong-page and soft-deleted assets

---

## Story 1.2 — Define extraction payloads

**Goal**

Define how the server receives normalized asset references from the editor/app.

**Files**

- request types under `server/editor/`
- frontend request types under `ui/`

**Implementation**

- Extend both draft-save and publish request bodies with one optional field:
  - `assetReferences`
- Shape:
  - `attachments: string[]`
  - `images: string[]`
- `attachments` carries attachment UUIDs.
- `images` carries image `public_name` in the first rollout.

**Decisions**

- Current codebase findings:
  - draft save sends only opaque Yjs binary in `data`
- publish sends structured `nodeData`
- image upload currently returns `public_name`, not `image_asset.id`
- Therefore Phase 2 standardizes on one explicit payload contract for both draft save and publish.
- The server:
  - accept `public_name` initially for images
  - resolve `public_name` to `core.image_asset.id`
  - require that the resolved `core.image_asset` row is active and belongs to the same page
  - require that each attachment row is active and belongs to the same page
  - treat `assetReferences` as the full authoritative snapshot when present
  - treat empty arrays as "replace with no refs"
  - treat omitted `assetReferences` as "do not modify refs" for backward-compatible rollout

`public_name` is safe for Phase 2 because:

- `core.image_asset.public_name` is globally unique in the schema
- upload generates unique names
- server-side resolution is page-scoped and only accepts active rows

**Verification**

- request validation rejects malformed ids
- asset/page ownership is checked before writing references
- omission vs empty-array semantics are covered by tests

---

## Phase 2: Forward-Fill References

## Story 2.1 — Forward-fill on draft save

**Goal**

Every draft save rewrites the current `draft_doc` reference set.

**Files**

- draft save controller/service in `server/editor/`
- relevant frontend draft-save caller in `ui/`

**Implementation**

- Extend draft-save request payload to include optional `assetReferences`.
- In the same transaction that persists `core.content_draft`:
  - if `assetReferences` is omitted, do not modify `draft_doc` refs
  - if `assetReferences` is present:
    - validate referenced assets belong to the page
    - resolve image `public_name` to `core.image_asset.id`
    - call `ReplaceDraftDocReferences(docID, pageID, refs)`
    - mark draft coverage as `indexed`
- If no asset references exist, write an empty snapshot by deleting old `draft_doc` rows for that doc.

**Important rule**

- do not attempt server-side draft extraction from `data_binary` in Phase 2
- the request payload is the source of truth for new draft writes

**Verification**

- adding/removing images in a draft updates `draft_doc` rows correctly
- removing all assets clears stale `draft_doc` rows
- old clients without `assetReferences` do not accidentally clear existing refs

---

## Story 2.2 — Forward-fill on publish

**Goal**

Every published version gets its own retained `published_doc` reference snapshot.

**Files**

- publish flow under `server/editor/`

**Implementation**

- Extend publish request payload to include optional `assetReferences`.
- In the publish transaction:
  - if `assetReferences` is omitted, do not modify `published_doc` refs for this request
  - if `assetReferences` is present:
    - validate referenced assets belong to the page
    - resolve image `public_name` to `core.image_asset.id`
  - persist the published version
  - if `assetReferences` is present:
    - replace `published_doc` rows for that published `doc_id`
    - update coverage to reflect published indexing for the page

**Important rule**

- even though publish currently receives structured `nodeData`, Phase 2 uses the same explicit request contract as draft save
- do not delete old `published_doc` rows for older retained published versions
- only replace rows for the exact published `doc_id` being written

**Verification**

- publishing version N does not remove references for retained version N-1
- current publish rows match the published snapshot exactly
- empty arrays clear only the current published doc snapshot for that `doc_id`

---

## Story 2.3 — Forward-fill on comment attachment writes

**Goal**

Comment reply attachment references are reflected in `asset_reference`.

**Files**

- `server/comment/commentService.go`

**Implementation**

- After reply attachment relations are written:
  - replace `comment_reply` rows for that reply id
- On reply deletion, remove `comment_reply` rows for that reply

**Verification**

- editing a reply attachment set rewrites rows exactly
- replies with no attachments leave no stale `comment_reply` rows

---

## Phase 3: Backfill Existing Data

## Story 3.1 — Build published-doc backfill tool

**Goal**

Populate `published_doc` references for all retained published history.

**Files**

- new command under `server/cmd/`
  - path: `server/cmd/backfillassetrefs/`

**Implementation**

- Iterate retained published `core.page_doc_map` rows where `draft = 0`.
- Load each document version by exact `doc_id` through a dedicated historical published-document loader.
- Extract:
  - attachment IDs
  - image URLs / public names
- Resolve image references to `core.image_asset.id`.
- Write `published_doc` rows through the shared assetref service logic.

**Current-state note**

- this backfill does not depend on the new request payload contract
- it uses the existing stored published representation directly, but through a `doc_id`-specific helper rather than page-level latest-document reads

**Important rule**

- if a published doc cannot be parsed, fail or record it explicitly; do not silently skip

**Verification**

- sample pages with old published versions get expected reference rows
- repeated backfill runs converge

---

## Story 3.2 — Backfill comment attachment references

**Goal**

Bootstrap `comment_reply` references from existing relational data.

**Files**

- same command under `server/cmd/`

**Implementation**

- Read `core.comment_reply_attachments`
- Join to replies and pages as needed
- Insert/replace `comment_reply` rows

**Verification**

- existing replies with attachments are represented fully
- repeated runs are idempotent

---

## Story 3.3 — Handle existing drafts conservatively

**Goal**

Classify current draft coverage safely.

**Files**

- backfill command
- coverage tracking helpers

**Implementation**

For each page/doc with active `core.content_draft`:

- do not decode the binary draft during initial backfill
- mark `draft_status = 'blocked_binary_draft'`

Cleanup remains disabled for pages with blocked draft status.

**Current-state note**

- current draft saves persist only Yjs binary `data_binary`
- Phase 2 forward-fill will solve this for newly updated drafts
- historical untouched drafts remain blocked until a future draft save or publish writes explicit references

**Verification**

- every page with active draft ends up either indexed or explicitly blocked
- no page with unknown draft coverage is marked cleanup-eligible

---

## Story 3.4 — Add completion gating

**Goal**

Do not allow cleanup to run on pages without complete reference coverage.

**Implementation**

- Compute `cleanup_eligible` only when:
  - published backfill complete
  - comment backfill complete
- draft coverage is `indexed`, or there is no active draft

**Verification**

- worker queries can filter to `cleanup_eligible = true`

---

## Phase 4: Cleanup Worker

## Story 4.1 — Implement mark pass

**Goal**

Identify unreferenced assets using `core.asset_reference` and soft-delete them after the grace period.

**Files**

- new cleanup package under `server/`
  - path: `server/assetcleanup/`

**Implementation**

- Load cleanup-eligible pages in batches.
- For each page:
  - load active attachments/images
  - load live referenced asset ids from `core.asset_reference`
  - mark first-observed unreferenced rows with `orphaned_at`
  - clear `orphaned_at` if asset is referenced again
  - soft-delete assets whose orphan grace has elapsed
- Restrict candidate pages to spaces where `core.space.deleted_at IS NULL`.
- Soft-delete transaction must:
  - set `deleted_at`
  - decrement `billing.space_usage.storage_bytes_used`
  - write compensating negative `billing.space_usage_event`

**Verification**

- first pass only marks `orphaned_at`
- second pass after grace soft-deletes
- re-reference before delete clears `orphaned_at`

---

## Story 4.2 — Implement purge pass

**Goal**

Delete blobs only after logical delete and retention delay.

**Files**

- same cleanup package

**Implementation**

- Select rows where:
  - `deleted_at IS NOT NULL`
  - `purged_at IS NULL`
  - purge grace elapsed
- Before purge:
  - re-check that no live `asset_reference` exists
- Delete blob from object storage
- Set `purged_at` on success or already-missing blob

**Verification**

- purge skips re-referenced assets
- missing blob is treated as successful end state

---

## Story 4.3 — Add config and feature flags

**Goal**

Make cleanup controllable in production.

**Files**

- cleanup package config
- `.env.example`
- deploy env docs/examples

**Implementation**

- Add flags:
  - `ASSET_CLEANUP_ENABLED`
  - `ASSET_CLEANUP_DRY_RUN`
  - `ASSET_CLEANUP_PURGE_ENABLED`
  - `ASSET_CLEANUP_MARK_INTERVAL`
  - `ASSET_CLEANUP_PURGE_INTERVAL`
  - `ASSET_CLEANUP_ORPHAN_GRACE`
  - `ASSET_CLEANUP_PURGE_GRACE`
  - `ASSET_CLEANUP_MAX_MARKS_PER_RUN`
  - `ASSET_CLEANUP_MAX_PURGES_PER_RUN`

**Verification**

- dry-run logs intended actions without mutating DB or storage
- caps are enforced

### Asset Cleanup Environment Variables

| Variable | Default | Meaning | When to change it |
| --- | --- | --- | --- |
| `ASSET_CLEANUP_ENABLED` | `false` | Master switch for the background asset cleanup worker. If `false`, no mark or purge loop runs. | Turn on only after backfill and coverage validation are complete. |
| `ASSET_CLEANUP_DRY_RUN` | `true` | Runs cleanup selection logic without mutating DB, quota, or storage. | Keep `true` during validation; switch to `false` when real mark/purge actions are desired. |
| `ASSET_CLEANUP_PURGE_ENABLED` | `false` | Separate switch for irreversible blob purge. If `false`, purge loops and admin purge runs are skipped even when cleanup is enabled. | Keep `false` through dry-run and mark-only rollout; turn on only in Phase 6.5. |
| `ASSET_CLEANUP_ADMIN_ENABLED` | `false` | Enables admin HTTP routes for cleanup operations. | Turn on only if runtime/manual cleanup control APIs are needed. |
| `ASSET_CLEANUP_ADMIN_TOKEN` | empty | Shared secret required by the cleanup admin endpoints via `X-Asset-Cleanup-Admin-Token`. | Set whenever admin routes are enabled. |
| `ASSET_CLEANUP_MARK_INTERVAL` | `1h` | How often the mark pass runs. The mark pass identifies unreferenced assets, sets `orphaned_at`, and later soft-deletes them after grace. | Reduce for faster feedback in small environments or increase to lower background load. |
| `ASSET_CLEANUP_PURGE_INTERVAL` | `6h` | How often the purge pass runs. The purge pass deletes blobs for already soft-deleted assets after retention. | Usually keep slower than mark. |
| `ASSET_CLEANUP_ORPHAN_GRACE` | `24h` | Minimum time an asset must remain unreferenced after `orphaned_at` before it can be soft-deleted. | Increase for extra safety; decrease only if faster logical cleanup is intentional. |
| `ASSET_CLEANUP_PURGE_GRACE` | `168h` | Minimum time after `deleted_at` before blob purge is allowed. `168h` equals 7 days. | Increase if a longer recovery window is needed before irreversible blob deletion. |
| `ASSET_CLEANUP_MAX_MARKS_PER_RUN` | `100` | Upper cap on mark-pass mutations per run. Limits how many assets can be newly orphaned or soft-deleted in one cycle. | Keep low during rollout; raise after confidence. |
| `ASSET_CLEANUP_MAX_PURGES_PER_RUN` | `50` | Upper cap on blob purges per run. Limits irreversible operations per cycle. | Keep low during rollout; raise gradually later. |

### Operational Modes

| Mode | Recommended values |
| --- | --- |
| Worker disabled | `ASSET_CLEANUP_ENABLED=false` |
| Validation | `ASSET_CLEANUP_ENABLED=true`, `ASSET_CLEANUP_DRY_RUN=true`, `ASSET_CLEANUP_PURGE_ENABLED=false` |
| Mark-only confidence stage | `ASSET_CLEANUP_ENABLED=true`, `ASSET_CLEANUP_DRY_RUN=false`, `ASSET_CLEANUP_PURGE_ENABLED=false` |
| Full cleanup | `ASSET_CLEANUP_ENABLED=true`, `ASSET_CLEANUP_DRY_RUN=false`, `ASSET_CLEANUP_PURGE_ENABLED=true` |

Important distinction:

- `ASSET_CLEANUP_ENABLED=false` means the worker does not run at all.
- `ASSET_CLEANUP_ENABLED=true` with `ASSET_CLEANUP_DRY_RUN=true` means the worker runs read-only and only reports what it would do.
- `ASSET_CLEANUP_PURGE_ENABLED=false` means irreversible blob purge is skipped even when mark/soft-delete is live.

---

## Phase 5: Operations And Safety

## Story 5.1 — Add observability

**Goal**

Make reference coverage and cleanup behavior visible.

**Implementation**

- structured logs for:
  - backfill progress
  - pages blocked from cleanup
  - newly orphaned assets
  - soft-deleted assets
  - purged assets
  - restore-worthy anomalies
- metrics for:
  - coverage counts by draft status
  - assets marked/deleted/purged
  - bytes removed
  - purge failures

---

## Story 5.2 — Add repair/admin commands

**Goal**

Provide controlled recovery and reindex paths.

**Files**

- new admin commands or endpoints

**Implementation**

- add reindex commands:
  - one page
  - one doc
  - all published docs
- if document-version pruning is ever introduced, the prune workflow deletes `published_doc` rows for that `doc_id` in the same transaction
- add restore helpers:
  - clear `orphaned_at` / `deleted_at`
  - restore quota usage by positive compensating event

**Verification**

- targeted reindex fixes drift without full rerun

---

## Story 5.3 — Add wrongful-delete guardrails

**Goal**

Reduce blast radius if cleanup logic is wrong.

**Implementation**

- keep mark and purge separate
- require purge revalidation
- enforce per-run caps
- require bucket versioning in deployment docs and runtime setup

---

## Phase 6: Rollout

## Story 6.1 — Deploy schema and write-path changes first

**Goal**

Begin collecting `asset_reference` for new writes before cleanup exists.

**Rollout**

1. Deploy schema.
2. Deploy reference write-path code.
3. Verify new draft/publish/comment writes populate `asset_reference`.

---

## Story 6.2 — Run backfill and classify coverage

**Goal**

Bootstrap historical data before cleanup is enabled.

**Rollout**

1. Keep cleanup disabled while backfill is incomplete:
   - `ASSET_CLEANUP_ENABLED=false`
   - do not run mark or purge jobs during diagnosis
2. Record the run start time and run published backfill:
   - `date -u`
   - run the backfill from the Go container on the Docker network:

     ```sh
     docker run --rm -it \
       --network custom_local_network \
       --env-file /Users/kiran/projects/beskar/docker/env/dev.env \
       -e PG_HOST=postgres \
       -e PG_PORT=5432 \
       -e PG_DB=beskar \
       -e PG_USER=app_user \
       -e PG_PASSWORD=app_user_pwd \
       -v /Users/kiran/projects/beskar:/src \
       -w /src/server \
       golang:1.23.3-alpine \
       /usr/local/go/bin/go run ./cmd/backfillassetrefs --reindex-all-published
     ```
3. Check the published backfill summary:
   - expected shape: `published backfill: scanned=<n> updated=<n> failed=<n>`
   - if `failed=0`, continue to comment backfill
   - if `failed>0`, identify failed pages/docs before continuing
4. Identify pages whose published coverage did not complete:

   ```sql
   SELECT
     p.id AS page_id,
     p.space_id,
     COUNT(d.doc_id) AS published_doc_count,
     MIN(d.version) AS first_published_version,
     MAX(d.version) AS last_published_version
   FROM core.page p
   JOIN core.space s ON s.id = p.space_id
   JOIN core.page_doc_map d ON d.page_id = p.id AND d.draft = 0
   LEFT JOIN core.asset_reference_coverage c ON c.page_id = p.id
   WHERE s.deleted_at IS NULL
     AND COALESCE(p.type, 'document') = 'document'
     AND c.published_backfilled_at IS NULL
   GROUP BY p.id, p.space_id
   ORDER BY p.id;
   ```

5. For each failed page, list the published doc versions to isolate candidate docs:

   ```sql
   SELECT
     d.page_id,
     d.doc_id,
     d.title,
     d.version
   FROM core.page_doc_map d
   JOIN core.page p ON p.id = d.page_id
   JOIN core.space s ON s.id = p.space_id
   WHERE d.page_id = :page_id
     AND d.draft = 0
     AND s.deleted_at IS NULL
     AND COALESCE(p.type, 'document') = 'document'
   ORDER BY d.version ASC, d.doc_id ASC;
   ```

6. Use the logs and targeted reindex commands to identify the exact failing record:
   - all-pages backfill logs include `asset cleanup: published backfill failed` with `page_id`; the wrapped error includes `reindex published doc <doc_id>` when a doc version failed
   - rerun one failed page after fixing transient data/environment issues:
     - use the same Docker command and replace the final flag with `--page-id <page_id>`
   - if the page still fails, test its doc versions one by one:
     - use the same Docker command and replace the final flag with `--doc-id <doc_id>`
   - record `page_id`, `doc_id`, title, version, and the error message in the rollout notes
7. Repair the failing data or the normalizer/extractor, then rerun the narrowest safe command:
   - for one doc, use the same Docker command with `--doc-id <doc_id>`
   - after all docs on a page pass individually, rerun the page so `published_backfilled_at` and eligibility are updated:
     - use the same Docker command with `--page-id <page_id>`
8. Re-run the missing-coverage query from step 4.
   - it must return zero rows before cleanup can be considered for enablement
9. Run comment attachment backfill:
   - use the same Docker command with `--backfill-comments`
10. Classify draft coverage:
    - use the same Docker command with `--classify-drafts`
11. Confirm `cleanup_eligible` counts:

    ```sql
    SELECT
      cleanup_eligible,
      draft_status,
      COUNT(*) AS pages
    FROM core.asset_reference_coverage
    GROUP BY cleanup_eligible, draft_status
    ORDER BY cleanup_eligible, draft_status;
    ```

**Exit criteria**

- zero unexpected parse failures for published docs
- all active-draft pages are either indexed or explicitly blocked

---

## Story 6.3 — Enable dry-run cleanup

**Goal**

Validate candidate deletions before mutating data.

**Rollout**

1. Confirm Phase 6.2 coverage before enabling the worker:

   ```sql
   SELECT
     cleanup_eligible,
     draft_status,
     COUNT(*) AS pages
   FROM core.asset_reference_coverage
   GROUP BY cleanup_eligible, draft_status
   ORDER BY cleanup_eligible, draft_status;
   ```

   ```sql
   SELECT p.id AS page_id
   FROM core.page p
   JOIN core.space s ON s.id = p.space_id
   LEFT JOIN core.asset_reference_coverage c ON c.page_id = p.id
   WHERE s.deleted_at IS NULL
     AND COALESCE(p.type, 'document') = 'document'
     AND (
       c.page_id IS NULL
       OR c.published_backfilled_at IS NULL
       OR c.comment_backfilled_at IS NULL
     )
   ORDER BY p.id;
   ```

   The second query should return zero rows for pages expected to participate in cleanup.

2. Deploy the server with dry-run enabled and info logs visible:

   ```env
   ASSET_CLEANUP_ENABLED=true
   ASSET_CLEANUP_DRY_RUN=true
   SERVER_LOG_LEVEL=info
   SERVER_LOG_TO_FILES=false
   ```

   For manual admin triggering, also enable the admin route:

   ```env
   ASSET_CLEANUP_ADMIN_ENABLED=true
   ASSET_CLEANUP_ADMIN_TOKEN=<strong-random-token>
   ```

3. Keep destructive rollout settings conservative:
   - keep `ASSET_CLEANUP_DRY_RUN=true`
   - keep `ASSET_CLEANUP_MAX_MARKS_PER_RUN` low for the first run
   - keep `ASSET_CLEANUP_MARK_INTERVAL` short only if you want automatic dry-run passes soon after deploy
   - otherwise use the admin API to trigger a single mark pass

4. Trigger a dry-run mark pass through the admin API.

   The route is protected by both normal API authentication and `X-Asset-Cleanup-Admin-Token`.

   Reusable form:

   ```sh
   BESKAR_API_BASE="http://localhost:9095"
   BESKAR_ACCESS_TOKEN="<user_access_token>"
   ASSET_CLEANUP_ADMIN_TOKEN="<asset_cleanup_admin_token>"

   curl -sS -X POST "$BESKAR_API_BASE/api/v1/admin/asset-cleanup/run/mark" \
     -H "Authorization: Bearer $BESKAR_ACCESS_TOKEN" \
     -H "X-Asset-Cleanup-Admin-Token: $ASSET_CLEANUP_ADMIN_TOKEN"
   ```

   Local dev form using `docker/env/dev.env`:

   ```sh
   curl -sS -X POST "http://localhost:9095/api/v1/admin/asset-cleanup/run/mark" \
     -H "Authorization: Bearer <user_access_token>" \
     -H "X-Asset-Cleanup-Admin-Token: local-asset-cleanup-admin-token"
   ```

   Local dev form with response saved for review:

   ```sh
   curl -sS -X POST "http://localhost:9095/api/v1/admin/asset-cleanup/run/mark" \
     -H "Authorization: Bearer <user_access_token>" \
     -H "X-Asset-Cleanup-Admin-Token: local-asset-cleanup-admin-token" \
     | tee /tmp/asset-cleanup-run-mark.json
   ```

   Expected response shape:

   ```json
   {
     "pagesScanned": 0,
     "assetsMarked": 0,
     "assetsDeleted": 0,
     "assetsReactivated": 0,
     "bytesRemoved": 0,
     "reachedRunCap": false,
     "completedAt": "..."
   }
   ```

5. Check worker status:

   ```sh
   curl -sS "http://localhost:9095/api/v1/admin/asset-cleanup/status" \
     -H "Authorization: Bearer <user_access_token>" \
     -H "X-Asset-Cleanup-Admin-Token: <asset_cleanup_admin_token>"
   ```

6. Review server logs from the dry-run mark pass:
   - `asset cleanup: asset newly orphaned`
   - `asset cleanup: soft deleting orphaned asset`
   - `asset cleanup: asset referenced again`
   - `asset cleanup: mark pass completed`
   - every log line must include `dry_run=true`

7. Verify dry-run did not mutate asset rows:

   ```sql
   SELECT COUNT(*) AS orphaned_assets
   FROM (
     SELECT id FROM core.attachment WHERE orphaned_at IS NOT NULL OR deleted_at IS NOT NULL
     UNION ALL
     SELECT id FROM core.image_asset WHERE orphaned_at IS NOT NULL OR deleted_at IS NOT NULL
   ) x;
   ```

   Compare this count to the value before enabling dry-run. A dry-run pass must not increase it.

8. Spot-check candidate assets from the logs:
   - open the `page_id`
   - inspect current draft state if one exists
   - inspect published/history views where relevant
   - confirm the logged `asset_id` is not present in any current retained reference

9. Optionally trigger a dry-run purge pass only to validate purge candidate reporting.

   This requires `ASSET_CLEANUP_PURGE_ENABLED=true`; set it back to `false` before Phase 6.4.

   ```sh
   curl -sS -X POST "http://localhost:9095/api/v1/admin/asset-cleanup/run/purge" \
     -H "Authorization: Bearer <user_access_token>" \
     -H "X-Asset-Cleanup-Admin-Token: <asset_cleanup_admin_token>"
   ```

   This must also log `dry_run=true` and must not set `purged_at` or delete blobs.

**Exit criteria**

- candidate deletes look correct
- no pages with incomplete coverage appear in candidate set
- dry-run logs are visible and every cleanup action log includes `dry_run=true`
- dry-run does not change `orphaned_at`, `deleted_at`, `purged_at`, quota usage, or blob storage

---

## Story 6.4 — Enable mark-only cleanup

**Goal**

Start reversible cleanup without blob deletion.

**Rollout**

1. Confirm dry-run results from Phase 6.3 are acceptable:
   - candidate assets were reviewed
   - no pages with incomplete coverage appeared in the candidate set
   - dry-run logs consistently showed `dry_run=true`
   - dry-run did not change `orphaned_at`, `deleted_at`, `purged_at`, quota usage, or blob storage

2. Capture baseline counts before enabling real mark/soft-delete:

   ```sql
   SELECT
     'attachment' AS asset_type,
     COUNT(*) FILTER (WHERE orphaned_at IS NOT NULL) AS orphaned,
     COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted,
     COUNT(*) FILTER (WHERE purged_at IS NOT NULL) AS purged
   FROM core.attachment
   UNION ALL
   SELECT
     'image' AS asset_type,
     COUNT(*) FILTER (WHERE orphaned_at IS NOT NULL) AS orphaned,
     COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted,
     COUNT(*) FILTER (WHERE purged_at IS NOT NULL) AS purged
   FROM core.image_asset;
   ```

3. Deploy with mark/soft-delete enabled but purge disabled:

   ```env
   ASSET_CLEANUP_ENABLED=true
   ASSET_CLEANUP_DRY_RUN=false
   ASSET_CLEANUP_PURGE_ENABLED=false
   SERVER_LOG_LEVEL=info
   SERVER_LOG_TO_FILES=false
   ```

   Keep the first live run small:

   ```env
   ASSET_CLEANUP_MAX_MARKS_PER_RUN=10
   ASSET_CLEANUP_ORPHAN_GRACE=24h
   ```

   Keep admin enabled if you want to trigger a controlled single pass:

   ```env
   ASSET_CLEANUP_ADMIN_ENABLED=true
   ASSET_CLEANUP_ADMIN_TOKEN=<strong-random-token>
   ```

4. Trigger one live mark pass through the admin API:

   ```sh
   curl -sS -X POST "https://app.durgakiran.com/api/v1/admin/asset-cleanup/run/mark" \
     -H "Authorization: Bearer <user_access_token>" \
     -H "X-Asset-Cleanup-Admin-Token: <asset_cleanup_admin_token>" \
     | tee /tmp/asset-cleanup-live-mark.json
   ```

   Expected first-pass behavior:
   - assets with no live references and no existing `orphaned_at` get `orphaned_at`
   - assets already orphaned longer than `ASSET_CLEANUP_ORPHAN_GRACE` may get `deleted_at`
   - quota usage decreases only for assets that get `deleted_at`
   - no blobs are deleted because `ASSET_CLEANUP_PURGE_ENABLED=false`

5. Check status:

   ```sh
   curl -sS "https://app.durgakiran.com/api/v1/admin/asset-cleanup/status" \
     -H "Authorization: Bearer <user_access_token>" \
     -H "X-Asset-Cleanup-Admin-Token: <asset_cleanup_admin_token>"
   ```

6. Review logs:
   - `asset cleanup: asset newly orphaned`
   - `asset cleanup: soft deleting orphaned asset`
   - `asset cleanup: asset referenced again`
   - `asset cleanup: mark pass completed`
   - log lines should show `dry_run=false`

7. Verify purge stayed disabled:

   ```sql
   SELECT
     'attachment' AS asset_type,
     COUNT(*) AS purged
   FROM core.attachment
   WHERE purged_at IS NOT NULL
   UNION ALL
   SELECT
     'image' AS asset_type,
     COUNT(*) AS purged
   FROM core.image_asset
   WHERE purged_at IS NOT NULL;
   ```

   Counts must not increase during Phase 6.4.

8. Verify live mutations are limited to mark/soft-delete:

   ```sql
   SELECT
     'attachment' AS asset_type,
     COUNT(*) FILTER (WHERE orphaned_at IS NOT NULL) AS orphaned,
     COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted,
     COUNT(*) FILTER (WHERE purged_at IS NOT NULL) AS purged
   FROM core.attachment
   UNION ALL
   SELECT
     'image' AS asset_type,
     COUNT(*) FILTER (WHERE orphaned_at IS NOT NULL) AS orphaned,
     COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted,
     COUNT(*) FILTER (WHERE purged_at IS NOT NULL) AS purged
   FROM core.image_asset;
   ```

9. Spot-check every asset affected by the first live run:
   - open the logged `page_id`
   - confirm `asset_id` is absent from `core.asset_reference`
   - confirm relevant draft/history views still render
   - restore immediately with the admin restore endpoint if anything looks wrong

10. Leave `ASSET_CLEANUP_PURGE_ENABLED=false` until Phase 6.5.

**Exit criteria**

- soft-deletes behave correctly
- no wrongful-delete reports
- `purged_at` counts do not increase
- no blob delete logs appear

---

## Story 6.5 — Enable purge

**Goal**

Delete blobs after confidence is established.

**Rollout**

1. Confirm Phase 6.4 has been stable for the full purge retention window:
   - no wrongful-delete reports
   - restore endpoint works for logically deleted, non-purged assets
   - `purged_at` counts have not increased
   - mark logs show expected candidates only

2. Confirm the object store has recovery protection before enabling irreversible purge:
   - bucket/object versioning is enabled, or
   - provider-level backups/snapshots are available, or
   - you explicitly accept that blob deletion is irreversible

3. Capture purge baseline counts:

   ```sql
   SELECT
     'attachment' AS asset_type,
     COUNT(*) FILTER (WHERE deleted_at IS NOT NULL AND orphaned_at IS NOT NULL AND purged_at IS NULL) AS purge_pending,
     COUNT(*) FILTER (WHERE purged_at IS NOT NULL) AS purged
   FROM core.attachment
   UNION ALL
   SELECT
     'image' AS asset_type,
     COUNT(*) FILTER (WHERE deleted_at IS NOT NULL AND orphaned_at IS NOT NULL AND purged_at IS NULL) AS purge_pending,
     COUNT(*) FILTER (WHERE purged_at IS NOT NULL) AS purged
   FROM core.image_asset;
   ```

4. Preview purge candidates before enabling live purge:

   ```sql
   SELECT
     'attachment' AS asset_type,
     a.id::text AS asset_id,
     a.page_id,
     a.file_size,
     a.deleted_at,
     a.purged_at
   FROM core.attachment a
   JOIN core.page p ON p.id = a.page_id
   JOIN core.space s ON s.id = p.space_id
   WHERE a.deleted_at IS NOT NULL
     AND a.orphaned_at IS NOT NULL
     AND a.purged_at IS NULL
     AND a.deleted_at <= now() - interval '168 hours'
     AND s.deleted_at IS NULL
   UNION ALL
   SELECT
     'image' AS asset_type,
     i.id::text AS asset_id,
     i.page_id,
     i.file_size,
     i.deleted_at,
     i.purged_at
   FROM core.image_asset i
   JOIN core.page p ON p.id = i.page_id
   JOIN core.space s ON s.id = p.space_id
   WHERE i.deleted_at IS NOT NULL
     AND i.orphaned_at IS NOT NULL
     AND i.purged_at IS NULL
     AND i.deleted_at <= now() - interval '168 hours'
     AND s.deleted_at IS NULL
   ORDER BY deleted_at ASC, asset_id ASC
   LIMIT 50;
   ```

   Adjust the interval to match `ASSET_CLEANUP_PURGE_GRACE`.

5. Deploy with purge enabled but conservative:

   ```env
   ASSET_CLEANUP_ENABLED=true
   ASSET_CLEANUP_DRY_RUN=false
   ASSET_CLEANUP_PURGE_ENABLED=true
   ASSET_CLEANUP_PURGE_GRACE=168h
   ASSET_CLEANUP_MAX_PURGES_PER_RUN=1
   SERVER_LOG_LEVEL=info
   SERVER_LOG_TO_FILES=false
   ```

6. Trigger one purge pass manually:

   ```sh
   curl -sS -X POST "https://app.durgakiran.com/api/v1/admin/asset-cleanup/run/purge" \
     -H "Authorization: Bearer <user_access_token>" \
     -H "X-Asset-Cleanup-Admin-Token: <asset_cleanup_admin_token>" \
     | tee /tmp/asset-cleanup-live-purge.json
   ```

   Expected first-pass behavior:
   - at most `ASSET_CLEANUP_MAX_PURGES_PER_RUN` blobs are deleted
   - each purged asset gets `purged_at`
   - logs include `asset cleanup: purging blob` with `dry_run=false`
   - logs include `asset cleanup: purge pass completed`

7. Verify the purge result:

   ```sql
   SELECT
     'attachment' AS asset_type,
     COUNT(*) FILTER (WHERE deleted_at IS NOT NULL AND orphaned_at IS NOT NULL AND purged_at IS NULL) AS purge_pending,
     COUNT(*) FILTER (WHERE purged_at IS NOT NULL) AS purged
   FROM core.attachment
   UNION ALL
   SELECT
     'image' AS asset_type,
     COUNT(*) FILTER (WHERE deleted_at IS NOT NULL AND orphaned_at IS NOT NULL AND purged_at IS NULL) AS purge_pending,
     COUNT(*) FILTER (WHERE purged_at IS NOT NULL) AS purged
   FROM core.image_asset;
   ```

   `purged` should increase by no more than the configured per-run cap.

8. Check status:

   ```sh
   curl -sS "https://app.durgakiran.com/api/v1/admin/asset-cleanup/status" \
     -H "Authorization: Bearer <user_access_token>" \
     -H "X-Asset-Cleanup-Admin-Token: <asset_cleanup_admin_token>"
   ```

9. Keep `ASSET_CLEANUP_MAX_PURGES_PER_RUN=1` until the first purge pass is verified end to end.

10. Increase caps gradually only after stable behavior:
    - `1`
    - `5`
    - `10`
    - higher only after logs, DB counts, and support reports stay clean

11. Continue monitoring:
    - purge pass error logs
    - object-store delete errors
    - `purged_at` count deltas
    - restore requests for already-purged assets

---

## Verification Matrix

## Automated verification

- unit tests for reference replacement helpers
- unit tests for cleanup liveness resolution
- unit tests for orphan state transitions
- unit tests for quota deltas on logical delete/restore
- backfill command tests on sample docs/history

## Integration verification

- save draft with image/attachment -> `draft_doc` rows created
- remove asset from draft and save -> old `draft_doc` row removed
- save draft without `assetReferences` -> no `draft_doc` mutation
- publish page version -> `published_doc` rows created for new `doc_id`
- older published version retains its rows
- publish without `assetReferences` -> no `published_doc` mutation
- comment reply attachment edit rewrites `comment_reply` rows
- cleanup skips pages with blocked draft coverage

## Manual verification

- page with history where image exists only in old published version is not deleted
- page with active binary draft is skipped until indexed
- asset removed everywhere becomes orphaned, then deleted after grace
- wrongly orphaned asset can be restored before purge

---

## Task Breakdown

1. Schema PR:
   - `core.asset_reference`
   - coverage table
   - cleanup columns/indexes
2. Backend PR:
   - `assetref` service
   - request validation/types
3. Write-path PR:
   - draft save
   - publish
   - comment replies
4. Backfill PR:
   - published/comment backfill command
   - coverage classification
5. Cleanup PR:
   - mark worker
   - purge worker
   - flags/metrics
6. Rollout PR/docs:
   - ops runbook
   - env docs
   - recovery instructions

This sequencing keeps cleanup disabled until the reference model is trustworthy.
