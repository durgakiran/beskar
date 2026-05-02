# Implementation Plan: Document Version Retention Cleanup

> This document translates [design.md](./design.md) into an execution-ready implementation plan.
>
> Scope: schema, backend services, plan-limit integration, cleanup worker, admin controls, observability, tests, and rollout required to safely prune old published document versions while handing asset lifecycle to the existing orphan-file cleanup job.

---

## Summary

This implementation has six workstreams that should land in order:

1. Add schema and plan-limit foundation.
2. Build read-only candidate selection and impact estimation.
3. Implement transactional pruning with audit records.
4. Add worker, config, and admin controls.
5. Add plan entitlement read surface only if product UI needs it.
6. Roll out in dry-run, staging cleanup, then production cleanup.

Target end state:

- `billing.plan_limit` controls document history retention through `document_history_retention_days`.
- The `basic` plan retains 7 days of historical published document versions.
- Users cannot configure retention directly.
- Only active spaces and document pages are eligible.
- Deleted spaces and whiteboards are excluded in V1.
- The latest published version and active draft are always retained.
- Old non-latest published document versions are pruned in small transactional batches.
- `published_doc` asset references for pruned versions are deleted in the same transaction.
- Attachments, image asset rows, and blobs are not deleted by this job.
- Existing orphan-file cleanup later handles assets that become unreferenced.

---

## Implementation Principles

- Keep this job single-purpose: prune old published document versions for active document pages.
- Keep deleted-space teardown outside this job.
- Resolve retention from the active billing plan, with a defensive fallback.
- Treat missing active subscriptions or missing plan limits as fallback-to-default cases.
- Prefer skipping a candidate over deleting a maybe-needed version.
- Re-check all safety rules inside the prune transaction.
- Delete `published_doc` asset references before deleting `page_doc_map`.
- Ship destructive behavior disabled and dry-run first.

---

## Phase Overview

| Phase | Goal | Output |
| --- | --- | --- |
| Phase 0 | Preconditions and schema | plan limit seed, cleanup log table, supporting indexes |
| Phase 1 | Read-only selection | repository queries and dry-run impact estimates |
| Phase 2 | Transactional cleanup | safe batch pruning with audit and asset-reference deletion |
| Phase 3 | Worker and admin controls | config, scheduler, status, dry-run/run endpoints |
| Phase 4 | Entitlement read surface | optional read-only plan capability response, skipped for V1 unless UI needs it |
| Phase 5 | Tests and verification | unit, integration, operational checks |
| Phase 6 | Rollout | dry-run validation, staging cleanup, production enablement |

---

## Phase 0: Preconditions And Schema

## Story 0.1 - Confirm asset-reference backfill is complete

**Goal**

Prevent document-version pruning from racing the asset-reference backfill.

**Files**

- rollout runbook or release checklist
- `server/docversioncleanup/repository.go`
- `server/docversioncleanup/worker.go`
- `server/docversioncleanup/admin.go`

**Implementation**

- Confirm `core.asset_reference` exists and is populated for retained published history.
- Confirm `core.asset_reference_coverage` is healthy for pages expected to participate in asset cleanup.
- Keep `DOCUMENT_VERSION_CLEANUP_ENABLED=false` until published-doc asset reference backfill is complete.
- Document that this cleanup can run independently after backfill because it owns deleting only pruned `published_doc` references.
- Add a preflight query that verifies every active document page with published versions has a `core.asset_reference_coverage` row with `published_backfilled_at IS NOT NULL`.
- Admin status and dry-run responses must include the preflight result.
- Destructive cleanup must refuse to prune when the preflight fails.

**Verification**

- Backfill status queries return no unexpected missing published-doc reference coverage.
- Destructive cleanup returns a clear preflight failure when published-doc reference coverage is incomplete.
- Asset cleanup can still identify live assets from latest published, draft, and comment references.

## Story 0.2 - Seed `document_history_retention_days` for plans

**Goal**

Add the plan entitlement that drives retention.

**Files**

- `db/beskar/updates/billing.xml` or a new Liquibase changelog under `db/beskar/updates/`
- `db/beskar/update.xml`, if a new changelog is created

**Implementation**

- Insert or update a `billing.plan_limit` row for `p.code = 'basic'`:
  - `metric_key = 'document_history_retention_days'`
  - `limit_value = 7`
  - `limit_unit = 'days'`
  - `enforcement_mode = 'cleanup'`
- Add mandatory validation for this metric anywhere plan limits are seeded or edited:
  - value must be an integer
  - value must be `>= 1`
  - unit must be `days`
- Add a migration or verification query that fails rollout if any `document_history_retention_days` row has `limit_value < 1` or `limit_unit <> 'days'`.

**Verification**

- Fresh database has the `basic` plan limit.
- Existing database migration is idempotent.
- Re-running Liquibase does not duplicate the limit.
- Invalid `document_history_retention_days` rows are rejected or caught before rollout.

## Story 0.3 - Add cleanup audit table

**Goal**

Persist enough information to explain every pruned document version.

**Files**

- new Liquibase changelog under `db/beskar/updates/`
- `db/beskar/update.xml`

**Implementation**

- Add `core.document_version_cleanup_log`.
- Required fields:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `doc_id BIGINT NOT NULL`
  - `page_id BIGINT NOT NULL`
  - `space_id UUID NOT NULL`
  - `account_id UUID NOT NULL`
  - `plan_id UUID NULL`
  - `plan_code TEXT NULL`
  - `version TIMESTAMPTZ NOT NULL`
  - `reason TEXT NOT NULL`
  - `retention_days INTEGER NOT NULL`
  - `retention_cutoff TIMESTAMPTZ NOT NULL`
  - `content_node_count INTEGER NOT NULL DEFAULT 0`
  - `text_node_count INTEGER NOT NULL DEFAULT 0`
  - `asset_reference_count INTEGER NOT NULL DEFAULT 0`
  - `cleaned_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - `job_run_id UUID NOT NULL`
- Add indexes:
  - `(cleaned_at DESC)`
  - `(page_id, cleaned_at DESC)`
  - `(account_id, cleaned_at DESC)`
  - `(plan_code, cleaned_at DESC)`
  - `(job_run_id)`
  - unique `(doc_id)`
- Grant the app user `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on `core.document_version_cleanup_log`, matching the existing Liquibase grant pattern.
- Add rollback that drops indexes, grants, and the table.

**Verification**

- Migration applies on fresh and existing databases.
- Unique `doc_id` prevents duplicate audit rows.
- Nullable `plan_id` and `plan_code` support fallback cases with no active plan.
- App user can insert audit rows during cleanup.
- Rollback removes the audit table cleanly.

## Story 0.4 - Add candidate-selection indexes if missing

**Goal**

Keep dry-run and cleanup scans bounded as historical versions grow.

**Files**

- Liquibase changelog under `db/beskar/updates/`

**Implementation**

Add or confirm supporting indexes for:

- `core.page_doc_map(page_id, draft, version DESC, doc_id DESC)`
- `core.page_doc_map(draft, version, doc_id)`
- `core.page_doc_map(doc_id)` if not already primary/unique
- `billing.account_subscription(account_id, status, effective_from DESC, created_at DESC)`
- `billing.plan_limit(plan_id, metric_key)`
- `core.asset_reference(source_kind, source_id)`

**Verification**

- Candidate query uses indexes in `EXPLAIN`.
- Latest-published lookup does not full-sort unnecessarily on production-like data.

---

## Phase 1: Read-Only Candidate Selection

## Story 1.1 - Create `server/docversioncleanup` package

**Goal**

Add a focused backend package for selection, dry-run, pruning, config, and admin wiring.

**Files**

- `server/docversioncleanup/config.go`
- `server/docversioncleanup/queries.go`
- `server/docversioncleanup/types.go`
- `server/docversioncleanup/repository.go`
- `server/docversioncleanup/worker.go`
- `server/docversioncleanup/admin.go`

**Implementation**

- Mirror the style of `server/assetcleanup`.
- Define config:
  - `DOCUMENT_VERSION_CLEANUP_ENABLED`, default `false`
  - `DOCUMENT_VERSION_CLEANUP_DRY_RUN`, default `true`
  - `DOCUMENT_VERSION_DEFAULT_RETENTION_DAYS`, default `7`
  - `DOCUMENT_VERSION_CLEANUP_BATCH_SIZE`, default `500`
  - `DOCUMENT_VERSION_CLEANUP_MAX_DOCS_PER_RUN`, default `500`
  - `DOCUMENT_VERSION_CLEANUP_INTERVAL`, default `24h`
  - `DOCUMENT_VERSION_CLEANUP_ADMIN_ENABLED`, default `false`
  - `DOCUMENT_VERSION_CLEANUP_ADMIN_TOKEN`, default empty
- Reject invalid retention defaults and batch sizes by falling back to safe defaults.

**Verification**

- Config unit tests cover defaults, valid env values, and invalid env values.

## Story 1.2 - Implement active-plan retention resolution

**Goal**

Resolve effective retention exactly as defined in the design.

**Files**

- `server/docversioncleanup/queries.go`
- `server/docversioncleanup/repository.go`
- `server/docversioncleanup/types.go`

**Implementation**

- Only subscriptions where `lower(billing.account_subscription.status) = 'active'` count.
- Select the active subscription with latest `effective_from`, then latest `created_at`.
- Join to `billing.plan` for `plan_code`.
- Join to `billing.plan_limit` for `document_history_retention_days`.
- If there is no active subscription or no matching plan limit, use `DOCUMENT_VERSION_DEFAULT_RETENTION_DAYS`.
- Return `account_id`, `plan_id`, `plan_code`, `retention_days`, and `retention_cutoff`.

**Verification**

- Active subscription uses plan value.
- Missing active subscription falls back to default.
- Non-active subscription is ignored.
- Mixed-case active statuses are handled consistently or rejected by validation.
- Missing plan limit falls back to default.
- Downgrade to shorter retention changes candidates on next query.

## Story 1.3 - Implement candidate query

**Goal**

Identify prunable old published document versions without mutating data.

**Files**

- `server/docversioncleanup/queries.go`
- `server/docversioncleanup/repository.go`

**Implementation**

- Select only:
  - `d.draft = 0`
  - `d.version < retention_cutoff`
  - active spaces only: `s.deleted_at IS NULL`
  - document pages only by default: `COALESCE(p.type, 'document') = 'document'`
  - non-latest published versions
- Latest published tie-breaker:
  - highest `version`
  - then highest `doc_id`
- Exclude whiteboards in V1. Do not add a runtime include-whiteboards flag until a separate whiteboard retention design is approved.
- Structure query so optional retention holds can be added later.
- Do not depend on UI or browser state.

**Verification**

- Page with only one old published version is not selected.
- Page with multiple old versions selects all old versions except latest.
- Deleted-space pages are not selected.
- Draft rows are not selected.
- Whiteboards are excluded by default.

## Story 1.4 - Implement dry-run impact estimation

**Goal**

Report cleanup impact before enabling destructive cleanup.

**Files**

- `server/docversioncleanup/repository.go`
- `server/docversioncleanup/types.go`
- `server/docversioncleanup/worker.go`

**Implementation**

- Given a batch or scan limit, return:
  - fallback retention days
  - affected plan codes
  - candidate version count
  - affected account count
  - affected page count
  - oldest candidate version
  - newest candidate version
  - estimated `core.content` rows
  - estimated `core.text_node` rows
  - estimated `published_doc` asset reference rows
- No rows are inserted, updated, or deleted.

**Verification**

- Dry-run can run repeatedly with identical output when data is unchanged.
- Counts match direct SQL spot checks.

---

## Phase 2: Transactional Cleanup

## Story 2.1 - Implement prune batch transaction

**Goal**

Safely prune a bounded batch of old published document versions.

**Files**

- `server/docversioncleanup/repository.go`
- `server/docversioncleanup/worker.go`
- `server/docversioncleanup/types.go`

**Implementation**

Process candidates in page-scoped batches. Each page-scoped batch runs in its own transaction so a page-specific failure can be skipped without rolling back unrelated pages in the same run.

1. Select candidate `page_doc_map` rows for one page-scoped batch with `FOR UPDATE SKIP LOCKED`.
2. Recompute latest published `doc_id` for affected pages.
3. Recompute effective retention for affected accounts.
4. Remove candidates that are now latest or no longer older than cutoff.
5. Count affected `content`, `text_node`, and `published_doc` references.
6. Insert `core.document_version_cleanup_log` rows.
7. Delete `core.asset_reference` rows:
   - `source_kind = 'published_doc'`
   - `source_id = doc_id::text`
8. Delete `core.page_doc_map` rows.
9. Commit.

The locked rows must be the candidate `core.page_doc_map` rows. The latest-version safety check must be recomputed after those locks are acquired.

**Verification**

- Page-scoped batch rollback leaves document rows, asset references, and audit rows unchanged for that page-scoped batch.
- Audit insertion and deletion happen in the same transaction.
- `published_doc` references are removed before `page_doc_map` rows.
- Cascades remove `content` and `text_node` rows.
- Latest published safety is checked after acquiring locks.

## Story 2.2 - Preserve safety rules under concurrency

**Goal**

Prevent accidental deletion of current readable or editable state.

**Files**

- `server/docversioncleanup/repository.go`
- tests under `server/docversioncleanup`

**Implementation**

- Re-check latest published version inside the transaction.
- Never select or delete `draft = 1`.
- Use deterministic latest tie-breaker.
- Keep cleanup idempotent if the same job is retried.
- Treat already-deleted `doc_id` as a no-op after prior committed batches.
- If a page-scoped batch fails due to unexpected constraints, roll back that page-scoped transaction, record the page in the run result's skipped pages, log the page and doc ids, and continue with the next page-scoped batch.

**Verification**

- Concurrent publish and cleanup leave at least one latest published version.
- Two cleanup workers using `SKIP LOCKED` do not process the same row.
- Re-running cleanup after success does not create duplicate audit rows.
- A failed page-scoped batch does not roll back successfully committed page-scoped batches from the same run.

## Story 2.3 - Keep asset lifecycle separate

**Goal**

Ensure document cleanup only releases historical references and never deletes assets directly.

**Files**

- `server/docversioncleanup/repository.go`
- tests under `server/docversioncleanup`

**Implementation**

- Do not delete from:
  - `core.attachment`
  - `core.image_asset`
  - object storage
- Delete only `core.asset_reference` rows for the pruned published `doc_id`.
- Leave `draft_doc` and `comment_reply` asset references untouched.
- Let `server/assetcleanup` mark and purge assets later according to its own grace periods.

**Verification**

- Asset referenced by latest published version remains live.
- Asset referenced by draft remains live.
- Asset referenced by comment remains live.
- Asset referenced only by pruned versions becomes unreferenced but is not immediately deleted.

---

## Phase 3: Worker And Admin Controls

## Story 3.1 - Add cleanup worker

**Goal**

Run dry-run or cleanup on a schedule with bounded batches.

**Files**

- `server/docversioncleanup/worker.go`
- `server/docversioncleanup/types.go`

**Implementation**

- Implement `NewWorker(config Config)`.
- Implement `Start(ctx context.Context)` with `DOCUMENT_VERSION_CLEANUP_INTERVAL`.
- Implement `RunDryRunOnce(ctx)` for read-only measurement.
- Implement `RunCleanupOnce(ctx)`:
  - if `DryRun=true`, run dry-run logic only
  - if `DryRun=false`, prune page-scoped batches until either no candidates remain, `DOCUMENT_VERSION_CLEANUP_MAX_DOCS_PER_RUN` is reached, or the run is canceled
  - `DOCUMENT_VERSION_CLEANUP_BATCH_SIZE` caps each candidate fetch and page-scoped transaction size
  - `DOCUMENT_VERSION_CLEANUP_MAX_DOCS_PER_RUN` caps total pruned docs per worker or admin run
- Track last run status in memory similar to asset cleanup.
- Emit structured logs for:
  - `job_run_id`
  - `account_id`
  - `plan_id`
  - `plan_code`
  - `retention_days`
  - `retention_cutoff`
  - `dry_run`
  - `candidate_count`
  - `deleted_count`
  - `page_id`
  - `doc_id`
  - `version`

Emit metrics:

- `document_version_cleanup_candidates_total`
- `document_version_cleanup_deleted_total`
- `document_version_cleanup_skipped_latest_total`
- `document_version_cleanup_skipped_page_total`
- `document_version_cleanup_preflight_failed_total`
- `document_version_cleanup_errors_total`
- `document_version_cleanup_duration_seconds`
- `document_versions_retained_total`
- `document_version_retention_days_distribution`

**Verification**

- Disabled worker does not run.
- Dry-run worker does not mutate data.
- Cleanup worker respects batch size.
- Cleanup worker respects max docs per run.
- Failed batch does not stop earlier committed batches from remaining valid.
- Metrics are emitted for dry-run, successful cleanup, skipped pages, and preflight failure.

## Story 3.2 - Add admin endpoints

**Goal**

Allow controlled manual dry-run, cleanup, and status checks.

**Files**

- `server/docversioncleanup/admin.go`
- `server/main.go`

**Implementation**

- Add routes behind existing auth plus admin token:
  - `GET /api/v1/admin/document-versions/cleanup/status`
  - `POST /api/v1/admin/document-versions/cleanup/dry-run`
  - `POST /api/v1/admin/document-versions/cleanup/run`
- Use `DOCUMENT_VERSION_CLEANUP_ADMIN_ENABLED`.
- Use `DOCUMENT_VERSION_CLEANUP_ADMIN_TOKEN`.
- Return dry-run and cleanup result payloads with counts and `job_run_id`.
- Include preflight status in all admin responses.
- Mount routes in `server/main.go` only when admin config is enabled and token is present.

**Verification**

- Admin routes return 404 when disabled.
- Admin routes return 403 with wrong token.
- Dry-run endpoint returns estimates without mutation.
- Run endpoint refuses destructive cleanup when preflight fails.
- Run endpoint respects `DOCUMENT_VERSION_CLEANUP_DRY_RUN`.

## Story 3.3 - Add environment documentation

**Goal**

Make rollout controls discoverable.

**Files**

- `.env.example`
- README or deployment docs used for server env vars

**Implementation**

- Document all `DOCUMENT_VERSION_*` env vars.
- Defaults:
  - enabled `false`
  - dry-run `true`
  - default retention days `7`
  - batch size `500`
  - max docs per run `500`
  - interval `24h`
  - admin enabled `false`

**Verification**

- Local server starts with defaults.
- Invalid env values fall back safely.

---

## Phase 4: Optional Plan Entitlement Read Surface

Skip this phase for V1 unless product explicitly needs to show document-history retention in the UI.

## Story 4.1 - Return read-only retention capability if needed

**Goal**

Expose the current plan retention days without making it user-editable.

**Files**

- existing billing/quota/account endpoint files, depending on chosen surface
- `server/quota` if quota remains the plan-capability API owner

**Implementation**

- Return:
  - `accountId`
  - `planCode`
  - `documentHistoryRetentionDays`
- Do not add a PATCH/update path for users.
- Use the same active-plan resolution rules:
  - only `lower(status) = 'active'`
  - fallback to default when missing

**Verification**

- Basic plan returns 7 days.
- Missing active plan returns fallback.
- Users cannot update retention through account or workspace settings.

---

## Phase 5: Tests And Verification

## Story 5.1 - Unit tests

**Status**

Implemented.

**Goal**

Cover the policy rules in isolation.

**Files**

- `server/docversioncleanup/*_test.go`

**Test cases**

- Candidate selection excludes latest published version.
- Candidate selection excludes drafts.
- Candidate selection excludes deleted spaces.
- Candidate selection excludes whiteboards in V1 with no runtime override.
- Candidate selection uses deterministic latest tie-breaking.
- Candidate selection uses active-plan retention days.
- Candidate selection falls back when active subscription is missing.
- Candidate selection falls back when plan limit is missing.
- Candidate selection ignores non-active subscriptions.
- Candidate selection treats active subscription status case consistently.
- Plan-limit seed gives `basic` 7 days.
- Prune removes only `published_doc` references for pruned docs.
- Prune does not remove draft or comment references.

## Story 5.2 - Integration tests

**Status**

Implemented as an opt-in DB integration suite for dev rollout validation, skipped by default during normal `go test ./...`.

**Goal**

Validate database behavior across document, asset reference, and audit tables.

**Files**

- `server/docversioncleanup/integration_test.go`

**How to run**

Run against the dev rollout database after the latest Liquibase migrations have been applied:

1. Set normal server DB env vars for dev:
   - `PG_USER`
   - `PG_PASSWORD`
   - `PG_HOST`
   - `PG_PORT`
   - `PG_DB`
2. Enable the opt-in suite:
   - `DOCUMENT_VERSION_CLEANUP_INTEGRATION_TESTS=true`
3. Run:
   - `cd server`
   - `go test ./docversioncleanup -run Integration -count=1`
4. Confirm the tests clean up their generated account, plan, space, page, document, asset-reference, and audit rows.

**Execution steps in the test harness**

1. Create isolated billing account, plan, plan limit, active subscription, space, document page, and asset-reference coverage rows.
2. Insert multiple published versions with controlled timestamps.
3. Insert a draft version to prove draft rows are not candidates.
4. Insert content and text-node rows under the prunable doc to verify FK cascade behavior.
5. Insert `published_doc` and `comment_reply` asset references for the prunable doc.
6. Run `ListCandidateVersions` and assert only old non-latest published docs are candidates.
7. Run `PruneNextPageBatch` and assert:
   - pruned `page_doc_map` row is gone
   - latest, recent, and draft docs remain
   - content and text-node rows cascade
   - only the `published_doc` asset reference for the pruned doc is removed
   - `comment_reply` references remain
   - cleanup log records account, plan, plan code, retention days, and job run
8. Create a second fixture without an active subscription and assert fallback retention is used.
9. Clean up all generated rows after each test.

**Test cases**

- Implemented:
  - One old published version is retained because it is latest.
  - Multiple old versions keep newest and prune older versions.
  - Mixed old/recent versions prune only older-than-cutoff non-latest versions.
  - Active plan retention overrides fallback retention.
  - Missing active subscription falls back to default retention.
  - Active draft survives cleanup.
  - `content` and `text_node` rows cascade for pruned docs.
  - `core.document_version_cleanup_log` records account and plan context.
  - `published_doc` asset references are removed for pruned versions.
  - `comment_reply` asset references are not directly deleted by this job.
- Still manual or future coverage:
  - Failed prune transaction rolls back audit rows and deletes.
  - Failed page-scoped transaction records skipped page details and does not roll back other page-scoped transactions.
  - Downgrade to shorter retention changes candidates on next cleanup pass.

## Story 5.3 - Operational verification

**Goal**

Prove the job is safe under realistic runtime conditions.

**Verification**

- Dry-run returns counts without deleting rows.
- Destructive cleanup is blocked when published-doc asset reference preflight fails.
- Re-running cleanup is idempotent.
- Two concurrent cleanup workers do not delete latest versions.
- Concurrent publish and cleanup leave a latest published version available.
- Orphan-file cleanup sees assets from pruned versions as unreferenced only when no other retained source references them.
- Pages render after cleanup.
- Edit mode opens after cleanup.
- Comments load after cleanup.

---

## Phase 6: Rollout

Roll out dev first, one step at a time. Do not enable destructive cleanup until the read-only measurement and scheduled dry-run steps are clean.

## Phase 6.1 - Dev read-only measurement

**Goal**

Deploy schema and code to dev with mutation disabled, then measure candidates through admin dry-run.

**Status**

Step 1 complete. Step 2 is next.

**Steps**

1. Prepare dev rollout config locally.
   - Status: complete.
   - Compose templates must pass all `DOCUMENT_VERSION_*` env vars into the server container.
   - `docker/env/dev.env` must use:
     - `DOCUMENT_VERSION_CLEANUP_ENABLED=false`
     - `DOCUMENT_VERSION_CLEANUP_DRY_RUN=true`
     - `DOCUMENT_VERSION_CLEANUP_ADMIN_ENABLED=true`
     - `DOCUMENT_VERSION_CLEANUP_ADMIN_TOKEN=<dev token>`
     - `DOCUMENT_VERSION_DEFAULT_RETENTION_DAYS=7`
   - Validate config rendering:
     - `./docker/scripts/validate-config.sh --env docker/env/dev.env`
2. Apply database changes in dev only when schema is not yet current:
   - Status: next.
   - `./docker/scripts/render-configs.sh --env docker/env/dev.env`
   - `docker compose -f docker/.generated/compose.yml -p beskar-dev up -d postgres`
   - `docker compose -f docker/.generated/compose.yml -p beskar-dev run --rm --build db-init`
   - Skip this step if `db-init` has already applied `db/beskar/updates/document_version_cleanup.xml` in dev.
3. Rebuild and recreate only the dev server container:
   - Status: next.
   - `./docker/scripts/render-configs.sh --env docker/env/dev.env`
   - `docker compose -f docker/.generated/compose.yml -p beskar-dev up -d --build --force-recreate --no-deps server`
4. Confirm migration state in dev.
   - `core.document_version_cleanup_log` exists.
   - `billing.plan_limit` contains `basic/document_history_retention_days = 7 days`.
   - Candidate indexes exist on `core.page_doc_map`.
5. Confirm server config in the running dev container:
   - `DOCUMENT_VERSION_CLEANUP_ENABLED=false`
   - `DOCUMENT_VERSION_CLEANUP_DRY_RUN=true`
   - `DOCUMENT_VERSION_CLEANUP_ADMIN_ENABLED=true`
6. Confirm asset-reference backfill is complete.
   - Admin status must report published-doc reference preflight success before cleanup is enabled.
7. Run admin dry-run in dev.
   - Use `POST /api/v1/admin/document-versions/cleanup/dry-run`.
   - Include `X-Document-Version-Cleanup-Admin-Token`.
8. Record counts by account, plan, space, page, and version age.
9. Spot-check candidate `doc_id` values.
10. Confirm latest published versions are never selected.
11. Confirm drafts, deleted spaces, and whiteboards are excluded.
12. Confirm no rows were deleted:
   - `core.page_doc_map`
   - `core.asset_reference`
   - `core.attachment`
   - `core.image_asset`

**How to verify dry-run in dev**

The admin dry-run endpoint returns aggregate impact only. Use it for:
- preflight pass/fail
- candidate version count
- affected account count
- affected page count
- affected plan codes
- oldest and newest candidate version timestamps

For `doc_id` inspection and exclusion checks, run SQL against the dev DB after the dry-run:

1. Open a `psql` shell:
   - `docker compose -f docker/.generated/compose.yml -p beskar-dev exec postgres psql -U admin -d beskar`
2. Materialize the same candidate set as the cleanup query:

```sql
CREATE TEMP VIEW doc_version_cleanup_candidates AS
WITH latest_published AS (
    SELECT DISTINCT ON (page_id)
        doc_id,
        page_id
    FROM core.page_doc_map
    WHERE draft = 0
    ORDER BY page_id, version DESC, doc_id DESC
)
SELECT
    d.doc_id,
    d.page_id,
    p.space_id,
    s.account_id,
    COALESCE(active_plan.plan_code, 'fallback') AS plan_code,
    d.version,
    COALESCE(pl.limit_value::integer, 7) AS retention_days,
    now() - make_interval(days => COALESCE(pl.limit_value::integer, 7)) AS retention_cutoff,
    FLOOR(EXTRACT(EPOCH FROM (now() - d.version)) / 86400) AS version_age_days
FROM core.page_doc_map d
JOIN core.page p ON p.id = d.page_id
JOIN core.space s ON s.id = p.space_id
LEFT JOIN LATERAL (
    SELECT sub.plan_id, bp.code AS plan_code
    FROM billing.account_subscription sub
    JOIN billing.plan bp ON bp.id = sub.plan_id
    WHERE sub.account_id = s.account_id
      AND lower(sub.status) = 'active'
      AND (sub.effective_to IS NULL OR sub.effective_to > now())
    ORDER BY sub.effective_from DESC, sub.created_at DESC
    LIMIT 1
) active_plan ON true
LEFT JOIN billing.plan_limit pl
  ON pl.plan_id = active_plan.plan_id
 AND pl.metric_key = 'document_history_retention_days'
 AND pl.limit_value > 0
 AND pl.limit_unit = 'days'
LEFT JOIN latest_published lp ON lp.doc_id = d.doc_id
WHERE d.draft = 0
  AND d.version < (
    now() - make_interval(days => COALESCE(pl.limit_value::integer, 7))
  )
  AND lp.doc_id IS NULL
  AND s.deleted_at IS NULL
  AND COALESCE(p.type, 'document') = 'document';
```

3. Record counts by account, plan, space, and page:

```sql
SELECT
    account_id,
    plan_code,
    space_id,
    page_id,
    COUNT(*) AS candidate_versions,
    MIN(version_age_days) AS min_age_days,
    MAX(version_age_days) AS max_age_days
FROM doc_version_cleanup_candidates
GROUP BY account_id, plan_code, space_id, page_id
ORDER BY candidate_versions DESC, account_id, space_id, page_id;
```

4. Spot-check candidate `doc_id` values:

```sql
SELECT
    doc_id,
    account_id,
    plan_code,
    space_id,
    page_id,
    version,
    version_age_days,
    retention_days
FROM doc_version_cleanup_candidates
ORDER BY version ASC, doc_id ASC
LIMIT 200;
```

5. Confirm latest published versions are never selected:

```sql
WITH latest_published AS (
    SELECT DISTINCT ON (page_id) doc_id, page_id
    FROM core.page_doc_map
    WHERE draft = 0
    ORDER BY page_id, version DESC, doc_id DESC
)
SELECT COUNT(*) AS wrongly_selected_latest
FROM doc_version_cleanup_candidates c
JOIN latest_published lp ON lp.doc_id = c.doc_id;
```

Expected result: `0`

6. Confirm drafts, deleted spaces, and whiteboards are excluded:

```sql
SELECT COUNT(*) AS draft_candidates
FROM doc_version_cleanup_candidates c
JOIN core.page_doc_map d ON d.doc_id = c.doc_id
WHERE d.draft <> 0;
```

Expected result: `0`

```sql
SELECT COUNT(*) AS deleted_space_candidates
FROM doc_version_cleanup_candidates c
JOIN core.space s ON s.id = c.space_id
WHERE s.deleted_at IS NOT NULL;
```

Expected result: `0`

```sql
SELECT COUNT(*) AS whiteboard_candidates
FROM doc_version_cleanup_candidates c
JOIN core.page p ON p.id = c.page_id
WHERE COALESCE(p.type, 'document') <> 'document';
```

Expected result: `0`

## Phase 6.2 - Dev scheduled dry-run

**Goal**

Exercise the worker without mutation.

**Status**

Step 1 complete locally. Step 2 is next.

**Steps**

1. Enable scheduled worker in dev with dry-run only:
   - Status: complete locally.
   - `DOCUMENT_VERSION_CLEANUP_ENABLED=true`
   - `DOCUMENT_VERSION_CLEANUP_DRY_RUN=true`
   - Keep `DOCUMENT_VERSION_CLEANUP_ADMIN_ENABLED=true` for on-demand status checks.
   - Use a short dev interval:
     - `DOCUMENT_VERSION_CLEANUP_INTERVAL=10m`
2. Deploy only after Phase 6.1 is clean.
   - Status: next.
   - `./docker/scripts/render-configs.sh --env docker/env/dev.env`
   - `docker compose -f docker/.generated/compose.yml -p beskar-dev up -d --build --force-recreate --no-deps server`
3. Confirm running server config in dev:
   - `DOCUMENT_VERSION_CLEANUP_ENABLED=true`
   - `DOCUMENT_VERSION_CLEANUP_DRY_RUN=true`
   - `DOCUMENT_VERSION_CLEANUP_INTERVAL=10m`
4. Capture a baseline before the first scheduled run:
   - `SELECT COUNT(*) FROM core.page_doc_map;`
   - `SELECT COUNT(*) FROM core.asset_reference;`
   - `SELECT COUNT(*) FROM core.attachment;`
   - `SELECT COUNT(*) FROM core.image_asset;`
5. Wait for at least one scheduled interval and inspect server logs.
   - Look for:
     - `document version cleanup: dry run completed`
     - `preflight_passed`
     - `candidate_count`
     - `affected_page_count`
     - `affected_account_count`
6. Review counts for at least one retention decision cycle.
7. Alert on unexpected candidate spikes or errors.
8. Confirm no `page_doc_map` or `asset_reference` rows are deleted by comparing against the baseline.
9. Confirm metrics/logs are emitted for candidates, duration, preflight status, and errors.

**How to verify scheduled dry-run in dev**

1. Restart only the server:
   - `./docker/scripts/render-configs.sh --env docker/env/dev.env`
   - `docker compose -f docker/.generated/compose.yml -p beskar-dev up -d --build --force-recreate --no-deps server`
2. Check the rendered env in compose:
   - `rg -n "DOCUMENT_VERSION_CLEANUP_(ENABLED|DRY_RUN|INTERVAL)" docker/.generated/compose.yml`
3. Tail server logs:
   - `docker compose -f docker/.generated/compose.yml -p beskar-dev logs --tail 200 -f server`
4. Confirm no mutation before and after a worker cycle:
   - run the four baseline `COUNT(*)` queries before the interval
   - run the same four queries after the interval
   - expected result: counts do not change
5. Inspect the last dry-run status through the admin endpoint:
   - `GET /api/v1/admin/document-versions/cleanup/status`
   - verify `stats.lastDryRun` is populated after the worker cycle

## Phase 6.3 - Dev manual cleanup

**Goal**

Validate destructive behavior in dev before any production rollout.

**Status**

Step 1 complete locally. Step 2 is next.

**Steps**

1. Set a small batch size:
   - Status: complete locally.
   - `DOCUMENT_VERSION_CLEANUP_BATCH_SIZE=25`
   - `DOCUMENT_VERSION_CLEANUP_MAX_DOCS_PER_RUN=25`
2. Disable dry-run only for a controlled manual run:
   - Status: complete locally.
   - `DOCUMENT_VERSION_CLEANUP_DRY_RUN=false`
3. Keep scheduled worker disabled for the first destructive run:
   - Status: complete locally.
   - `DOCUMENT_VERSION_CLEANUP_ENABLED=false`
4. Run cleanup through the admin endpoint:
   - Status: next.
   - `POST /api/v1/admin/document-versions/cleanup/run`
5. Verify pages render, edit mode opens, and comments load.
6. Verify audit rows match pruned doc ids.
7. Verify `published_doc` refs drop only for pruned versions.
8. Verify asset cleanup later marks only newly unreferenced assets.

**How to verify manual cleanup in dev**

1. Restart only the server with the manual-cleanup config:
   - `./docker/scripts/render-configs.sh --env docker/env/dev.env`
   - `docker compose -f docker/.generated/compose.yml -p beskar-dev up -d --build --force-recreate --no-deps server`
2. Confirm rendered env:
   - `rg -n "DOCUMENT_VERSION_CLEANUP_(ENABLED|DRY_RUN|BATCH_SIZE|MAX_DOCS_PER_RUN)" docker/.generated/compose.yml`
   - expected:
     - `DOCUMENT_VERSION_CLEANUP_ENABLED: "false"`
     - `DOCUMENT_VERSION_CLEANUP_DRY_RUN: "false"`
     - `DOCUMENT_VERSION_CLEANUP_BATCH_SIZE: "25"`
     - `DOCUMENT_VERSION_CLEANUP_MAX_DOCS_PER_RUN: "25"`
3. Snapshot the candidate set before the run:
   - use the `doc_version_cleanup_candidates` temp view from Phase 6.1
   - `SELECT COUNT(*) FROM doc_version_cleanup_candidates;`
   - `SELECT doc_id FROM doc_version_cleanup_candidates ORDER BY version ASC, doc_id ASC LIMIT 25;`
4. Run the cleanup endpoint once:
   - `POST /api/v1/admin/document-versions/cleanup/run`
   - include `X-Document-Version-Cleanup-Admin-Token`
5. Validate the response:
   - `dryRun=false`
   - `prunedVersionCount <= 25`
   - `reachedRunCap` matches whether exactly 25 docs were pruned
   - batch `pageId` values are present
6. Verify audit rows match the deleted docs:
   - `SELECT doc_id, page_id, account_id, plan_code, retention_days, job_run_id FROM core.document_version_cleanup_log ORDER BY cleaned_at DESC LIMIT 25;`
7. Verify pruned docs were actually removed:
   - `SELECT COUNT(*) FROM core.page_doc_map WHERE doc_id IN (<pruned_doc_ids>);`
   - expected result: `0`
8. Verify the latest published version for each affected page still exists:
   - for each affected `page_id`, query:
     - `SELECT doc_id, version FROM core.page_doc_map WHERE page_id = <page_id> AND draft = 0 ORDER BY version DESC, doc_id DESC LIMIT 1;`
9. Verify `published_doc` refs were removed only for pruned versions:
   - `SELECT COUNT(*) FROM core.asset_reference WHERE source_kind = 'published_doc' AND source_id IN (<pruned_doc_ids_as_text>);`
   - expected result: `0`
10. Verify non-published refs were not directly deleted by this job:
   - `SELECT source_kind, COUNT(*) FROM core.asset_reference WHERE source_id IN (<pruned_doc_ids_as_text>) GROUP BY source_kind;`
   - expected: no direct delete requirement except `published_doc`
11. Verify the app still works on affected pages:
   - open at least one affected page in read mode
   - open the same page in edit mode
   - load comments on that page

## Phase 6.4 - Production cleanup

**Goal**

Enable controlled production pruning only after dev read-only, dev scheduled dry-run, and dev manual cleanup are clean.

**Steps**

1. Start with conservative batch size.
2. Keep admin run endpoint available for controlled manual runs.
3. Enable scheduled cleanup only after manual run results are clean.
4. Monitor:
   - candidate count
   - deleted count
   - skipped latest count
   - skipped protected count, if holds are added
   - errors
   - duration
   - affected accounts/pages
5. Increase batch size only after several successful runs.

---

## Out Of Scope For V1

- User-editable retention settings.
- User-facing version history browser.
- User-facing restore UI for pruned versions.
- Whiteboard version pruning.
- Runtime whiteboard cleanup enablement flag.
- Deleted-space teardown.
- Direct deletion of `core.attachment`, `core.image_asset`, or object-storage blobs.
- Version retention holds, unless product explicitly asks for pinned versions before launch.

---

## Done Criteria

- `basic` plan has `document_history_retention_days = 7`.
- Cleanup log schema exists with account and plan audit context.
- Dry-run can estimate candidates and row impact without mutation.
- Cleanup prunes only old non-latest published document versions.
- Cleanup never deletes drafts, latest published versions, deleted-space data, or whiteboards in V1.
- Cleanup deletes `published_doc` asset references for pruned versions in the same transaction.
- Cleanup does not delete attachment/image asset rows or blobs.
- Admin endpoints and worker are disabled by default and dry-run first.
- Destructive cleanup refuses to run until published-doc asset-reference preflight passes.
- Unit and integration tests cover plan resolution, safety rules, audit rows, and asset-reference handoff.
