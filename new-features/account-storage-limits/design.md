# Design Doc: Personal Account Storage Limits And Plan-Ready Restrictions

## Summary

This document defines the design needed to make Beskar ready for personal account-level storage restrictions and future plan tiers such as basic, pro, and ultimate.

The goal of this phase is not to define what each plan includes. The goal is to introduce the right domain model, metering model, enforcement points, and operational safeguards so plan-specific limits can be added later without redesigning uploads, assets, or workspace ownership again.

This is a design-only document. No code, schema, billing provider, or product pricing decisions are introduced here.

The chosen direction in this document is:

- one personal account is tied to one user
- one personal account can own unlimited spaces
- storage limits apply at the account level across all owned spaces
- storage aggregates are maintained at the space level, not the account level
- collaborator limits apply at the space level
- space ownership transfer is disabled for now
- organizations/workspaces as a broader billing concept are deferred to a later phase

---

## Objective

- Introduce a first-class personal account boundary for quotas and future plans.
- Make storage usage measurable at the space level and enforceable at the account level.
- Make collaborator limits measurable and enforceable at the space level.
- Keep plan definitions data-driven so new tiers and restrictions can be added later without schema churn.
- Ensure uploads, attachments, and document images can be blocked before exceeding hard limits.
- Provide enough structure for future UI, billing, and admin tooling without requiring those features now.

---

## Non-Goals

- Defining the actual plan names, prices, or storage values.
- Integrating Stripe or any payment provider.
- Implementing invoicing, overages, or payment collection.
- Designing marketing pages or upgrade funnels.
- Introducing organizations or workspace-level billing entities.
- Enabling space ownership transfer.
- Changing current authorization semantics for page and space access.

---

## Current-State Findings

## Storage Assets Are Now Meterable

Beskar now has durable DB metadata for the two asset classes that matter for storage accounting:

- attachments in `core.attachment`
- document images in `core.image_asset`

Both models include `file_size`, which means space-level and account-level byte totals can be computed from Postgres without walking the bucket.

## The Current Product Boundary Is `space`, Not A Personal Account

Current core ownership is centered on `core.space`.

- pages belong to a `space`
- attachments belong to a `page`
- images belong to a `page`
- `core.space` already carries a `user_id` owner column

There is no dedicated personal billing/subscription account entity above `space`.

## Authentication And Authorization Reality

Beskar uses:

- Zitadel for authentication and identity
- Permify for authorization and permission checks

The `auth.*` schema in this repo is not an active product boundary for future account-plan work. It should be treated as dead code / historical residue unless a separate cleanup effort proves otherwise.

This matters because plan, quota, and billing design must align with the real runtime systems, not unused schema artifacts.

## `auth.accounts` Is Not The Right Place

The existing `auth.accounts` table in `db/beskar/updates/auth.xml` stores authentication provider accounts. It is not a product billing account and should not be reused for plan, quota, or storage ownership.

That naming collision matters. This design must avoid ambiguous terms such as `account` without a schema or domain qualifier.

## Enforcement Does Not Exist Yet

Current upload flows enforce:

- authentication
- page permission
- MIME and request-size validation

They do not enforce:

- account total storage limits across all owned spaces
- per-space collaborator limits
- plan-based upload restrictions
- soft-limit warnings
- account suspension or over-limit state

---

## Design Principles

- Separate personal commercial account concepts from auth-provider account concepts.
- Keep quota limits data-driven, not hardcoded by tier name.
- Use Postgres metadata as the primary source of quota accounting.
- Enforce limits at write time, not as an after-the-fact cleanup.
- Keep usage reconciliation possible if counters drift.
- Make future restrictions generic so storage is only one metric among many.
- Keep ownership transfer disabled until a future organization/workspace model exists.

---

## Proposed Domain Model

## 1. Introduce A Personal Account Entity

Add a new schema for commercial/account-plan concerns:

- `billing`

Recommended top-level entity:

- `billing.account`

This is the owner of:

- subscription state
- plan assignment
- quota usage
- future upgrade/downgrade history
- zero or more spaces

For this phase, `billing.account` is explicitly a personal account tied 1:1 to a user.

This is intentionally separate from:

- Zitadel identities
- Permify subjects and relations
- dead-code `auth.accounts`
- `core.space`

## 2. Make Each User Have Exactly One Personal Account

Recommended fields on `billing.account`:

- `id`
- `user_id`
- `status`
- `created_at`
- `updated_at`

Recommended constraints:

- unique constraint on `user_id`

Meaning:

- each product user has exactly one personal account
- plan assignment and storage usage attach to that account

## 3. Make Each `space` Belong To Exactly One Personal Account

Add:

- `core.space.account_id UUID NOT NULL`

with a foreign key to:

- `billing.account.id`

Reason:

- all current user content ultimately hangs under `space`
- attachment and image storage can then resolve account ownership through:
  - asset -> page -> space -> account
- collaborator limits can remain enforced at the space boundary

## 4. Initial Ownership Model

Because the product does not yet have organizations/workspaces as a separate billing concept, the initial model should be:

- one user has exactly one personal `billing.account`
- one personal `billing.account` can own unlimited spaces
- every `core.space` belongs to exactly one personal `billing.account`

For the first rollout:

- create one `billing.account` per existing user-owner
- assign each existing `core.space` to the `billing.account` of its current owner

This keeps the model simple now while remaining compatible with a later organization-owned model.

## Identity Mapping Principle

Personal account ownership should reference the real authenticated product user identity used elsewhere in Beskar.

That means:

- user identity should align with the Zitadel-backed application user id already used across `core.*`
- permission checks remain in Permify
- billing/account ownership must not depend on unused `auth.users` or `auth.accounts` rows

The billing model should integrate with the existing product identity conventions, not revive the dormant auth schema.

## 5. Space Ownership Constraints For This Phase

In the personal-account model:

- a space owner user and the owning personal account must align
- transferring space ownership is disabled
- moving a space between accounts is not supported

This avoids hidden billing responsibility changes before organizations/workspaces exist as a first-class concept.

---

## Proposed Plan And Restriction Model

## Use Generic Metrics, Not Plan-Specific Columns

Do not add columns such as:

- `is_pro`
- `storage_limit_gb`
- `max_collaborators`

directly onto `billing.account`.

Instead, use a generic plan and metric model.

Recommended tables:

- `billing.plan`
- `billing.plan_limit`
- `billing.account_subscription`

### `billing.plan`

Represents a named product tier, for example future codes like:

- `basic`
- `pro`
- `ultimate`

This table stores only identity and lifecycle, not the actual usage state.

Suggested fields:

- `id`
- `code`
- `display_name`
- `is_active`
- `created_at`
- `updated_at`

### `billing.plan_limit`

Stores limits by metric key, not by dedicated schema columns.

Suggested fields:

- `id`
- `plan_id`
- `metric_key`
- `limit_value`
- `limit_unit`
- `enforcement_mode`
- `created_at`
- `updated_at`

Example metric keys for this phase and near-future:

- `storage.bytes.total`
- `upload.bytes.max_attachment`
- `upload.bytes.max_image`
- `collaborators.count.per_space`
- `spaces.count.total`

This allows later plan work to add new restrictions without redesigning the model.

### `billing.account_subscription`

Represents the currently assigned plan for a personal account.

Suggested fields:

- `id`
- `account_id`
- `plan_id`
- `status`
- `effective_from`
- `effective_to`
- `source`
- `created_at`
- `updated_at`

This supports future upgrade/downgrade history cleanly.

---

## Proposed Usage And Metering Model

## 1. Maintain Space-Level Storage Aggregates

Recommended table:

- `billing.space_usage`

Suggested fields:

- `space_id`
- `storage_bytes_used`
- `storage_bytes_reserved`
- `last_reconciled_at`
- `updated_at`

Purpose:

- `storage_bytes_used` is the committed storage currently owned by the space
- `storage_bytes_reserved` is in-flight upload reservation capacity

Reason:

- space is the natural content container in the product today
- future space movement between accounts or organizations becomes much simpler
- aggregate storage can move by reassigning the space, without rebuilding every asset row
- account totals can be derived as the sum of owned spaces

## 2. Keep An Append-Only Usage Event Ledger

Recommended table:

- `billing.space_usage_event`

Suggested fields:

- `id`
- `space_id`
- `metric_key`
- `event_type`
- `delta_value`
- `source_type`
- `source_id`
- `correlation_id`
- `metadata JSONB`
- `created_at`

Event types should include at least:

- `reserve`
- `commit`
- `release`
- `adjust`
- `reconcile`

Reason:

- auditability
- debugging quota drift
- future billing visibility
- easier rebuild of summary tables if needed

## 3. Account-Level Totals Are Derived From Space Aggregates

The product may expose account-wide totals to the UI, but persisted metering should remain rooted in spaces.

Recommended rule:

- authoritative aggregate rows are maintained per space
- account-wide totals are computed as the sum of all spaces owned by the account
- an optional derived `account usage` view or cache may exist later, but it should not be the primary ownership unit for storage accounting

## 4. DB Metadata Is The Source Of Truth For Reconciliation

Committed storage should be derivable from:

- `SUM(core.attachment.file_size WHERE deleted_at IS NULL)`
- `SUM(core.image_asset.file_size WHERE deleted_at IS NULL)`

joined through:

- page -> space -> account

This means counters may be used for fast runtime checks, but a reconciliation job can always rebuild usage from canonical asset tables.

## 5. Collaborator Limits Are Enforced Per Space

Collaborator restrictions should not be modeled as account-wide usage in this phase.

Rules:

- each space has a collaborator count
- plan rules define the maximum collaborator count allowed per space
- collaborator enforcement happens when inviting or adding members to a space

This matches the current product shape better than pooled member limits across all spaces.

---

## Enforcement Model

## 1. Restriction Checks Must Happen Before Upload Completion

For storage-related uploads:

- attachment upload
- image upload

the server must resolve the owning space first, then the owning personal account before writing the blob or finalizing metadata.

Flow:

1. resolve `page_id`
2. resolve owning `space_id`
3. load `billing.space_usage`
4. resolve `space.account_id`
5. load active subscription and limits
6. compute account total as the sum of owned spaces
7. check both:
   - account total limit
   - space reservation/usage state for the target write
8. reject if hard limit would be exceeded
9. reserve bytes on the target space
10. perform blob upload + metadata write
11. commit space usage on success
12. release reservation on failure

## 2. Distinguish Soft Limits From Hard Limits

Plan limits should support at least two enforcement modes:

- `warn`
- `block`

Meaning:

- `warn`: upload succeeds but account is flagged as near or over soft threshold
- `block`: upload is rejected

This allows future product behavior such as grace periods without changing the core model.

## 3. Deletions Must Release Storage

When storage-owning assets are deleted or soft-deleted permanently:

- attachments
- images

the space usage model must decrement committed bytes.

If the product keeps soft-delete semantics, the design must define whether soft-deleted assets still count. Recommended rule:

- active assets count
- permanently deleted assets do not count

If soft-deleted assets remain recoverable and still occupy user-visible storage quota, that should be an explicit product decision later, not implicit behavior.

## 4. Collaborator Limits Must Be Enforced On Membership Changes

When users are invited or added to a space:

1. resolve the space's owning account
2. load the owning account's active plan limits
3. calculate current collaborator count for that space
4. reject the add/invite operation if the per-space collaborator limit would be exceeded

This is separate from storage enforcement and should use the same plan service, but a different metric.

---

## API And Service Surface

## Internal Service Responsibilities

Introduce an internal quota service responsible for:

- resolving account ownership for a page or space
- resolving the owning space for an asset mutation
- reading active limits
- reserving capacity
- committing usage
- releasing reservations
- validating per-space collaborator limits
- returning structured rejection reasons

This service should be the only place that knows how plan limits are applied.

## External API Readiness

Even if full billing UI is not built yet, the backend should be designed to expose:

- current account plan code
- account storage used
- account storage limit
- account percent consumed
- space storage used
- space storage reserved
- over-limit / warning state
- per-space collaborator limit
- current collaborator count per space

This can later power:

- workspace settings
- admin dashboards
- upgrade prompts

without changing the underlying enforcement model.

---

## Ownership Resolution Rules

## Account Boundary For Storage

Storage ownership must be determined by the space that owns the page.

Rules:

- attachment belongs to the account that owns the page's space
- image belongs to the account that owns the page's space

Do not derive billing ownership from:

- the uploading user
- current session identity alone
- dead-code `auth.accounts`

This avoids ambiguity for shared spaces and invited collaborators.

## Space Aggregate Boundary

For storage metering, the persisted aggregate boundary is the space.

Meaning:

- every attachment write affects one space aggregate
- every image write affects one space aggregate
- account-level enforcement is computed from owned spaces

This is the key design choice that keeps later space movement feasible.

## Collaborator Upload Rule

If a collaborator uploads a file or image into another user’s space:

- the bytes count against the owning account of that space
- not against the collaborator’s own personal account

This preserves a single quota owner for each space in the personal-account model.

## Ownership Transfer

Space ownership transfer is disabled in this phase.

Reason:

- transferring ownership would implicitly transfer billing responsibility and storage ownership
- the product does not yet have organization/workspace semantics to handle that safely

Future organization/workspace work may reintroduce transfer with explicit account reassignment rules.

## Cross-Space Moves

If the product later supports moving pages across spaces with existing assets, the design must define whether assets:

- stay with the original account
- or transfer to the destination account

Recommended future rule:

- assets move with the page's current space ownership

That means page transfer operations must also adjust `billing.space_usage` for the source and destination spaces.

---

## Operational Model

## Reconciliation Job

Add a periodic reconciliation process that:

- recalculates committed storage per space from `core.attachment` and `core.image_asset`
- compares results to `billing.space_usage.storage_bytes_used`
- writes `reconcile` adjustment events when drift is found
- allows collaborator counts per space to be recomputed from active membership records

This protects against:

- partial failures
- manual DB edits
- historical bugs

## Admin Repair Operations

The system should support safe admin actions such as:

- recompute one space's usage
- recompute all spaces
- reset stuck reservations older than a timeout
- recompute one space's collaborator count

Account-level totals should be viewable, but admin repair should target spaces as the durable aggregate unit.

This must exist before hard blocks are relied on in production.

---

## Schema Recommendations

Recommended additions:

- `billing.account`
- `billing.plan`
- `billing.plan_limit`
- `billing.account_subscription`
- `billing.space_usage`
- `billing.space_usage_event`
- `core.space.account_id`

Recommended indexes:

- `billing.account(user_id)`
- `billing.account_subscription(account_id, status, effective_from desc)`
- `billing.plan_limit(plan_id, metric_key)`
- `billing.space_usage(space_id)`
- `billing.space_usage_event(space_id, created_at desc)`
- `core.space(account_id)`

---

## Rollout Strategy

Suggested sequence:

1. introduce billing/account schema
2. create one personal account per user-owner
3. backfill `core.space.account_id`
4. create one default plan row and generic limit records
5. expose read-only account and space usage endpoints
6. implement reservation and usage accounting in upload flows using space aggregates
7. implement per-space collaborator limit checks
8. disable space ownership transfer explicitly if it is currently possible anywhere
9. run in monitor-only mode first
10. switch storage hard limits to blocking mode after verification

Monitor-only mode means:

- compute limits
- emit warnings and metrics
- do not yet reject uploads

This reduces rollout risk.

---

## Risks And Mitigations

## Risk: Wrong Long-Term Billing Boundary

If the product later decides that storage should be pooled differently than personal-account-owned spaces, a weak account model will cause churn.

Mitigation:

- introduce `billing.account` now
- attach `space` to account explicitly
- never overload `auth.accounts`
- keep the initial account model explicitly personal and defer organizations/workspaces

## Risk: Counter Drift

Space usage counters can drift from real DB metadata.

Mitigation:

- maintain append-only usage events
- run reconciliation jobs
- provide admin repair tools

## Risk: Partial Upload Failures

Blob upload and DB metadata writes can fail independently.

Mitigation:

- use reservation/commit/release semantics
- keep rollback logic explicit

## Risk: Plan Logic Spreads Across Controllers

If controllers enforce plan checks directly, plan behavior becomes inconsistent.

Mitigation:

- centralize in one quota/plan service

## Risk: Ownership Transfer Semantics

If ownership transfer remains enabled while quota ownership is account-based, billing responsibility can change implicitly and incorrectly.

Mitigation:

- disable space ownership transfer in this phase
- revisit only when organization/workspace support exists

---

## Out Of Scope

- pricing
- payment processing
- invoicing
- upgrade checkout flow
- exact plan thresholds
- collaborator-count UX
- marketing copy for plans
- organization/workspace billing
- space ownership transfer flows

---

## Acceptance Criteria

- The design defines a first-class personal account model separate from Zitadel auth identities, Permify permission state, and dead-code `auth.accounts`.
- The design defines how every storage-owning asset resolves to an account.
- The design defines that one account is tied to one user and can own unlimited spaces.
- The design defines account-wide storage enforcement based on space-level aggregates, plus per-space collaborator enforcement.
- The design defines that space ownership transfer is disabled in this phase.
- The design defines a data-driven plan/metric model rather than hardcoded tier columns.
- The design defines committed usage, reserved usage, and reconciliation behavior with `space` as the persisted aggregate boundary.
- The design defines upload-time enforcement flow for both attachments and images.
- The design is sufficient to implement storage quotas now and evolve to organization/workspace billing later.

---

## Recommended Next Document

After this design is accepted, create an implementation plan that covers:

- Liquibase changes for `billing.*` tables and `core.space.account_id`
- bootstrap strategy for personal accounts from current space owners
- server quota service interfaces
- upload flow changes for reservation/commit/release
- collaborator limit checks in invite/member flows
- read-only usage APIs
- monitor-only rollout plan
