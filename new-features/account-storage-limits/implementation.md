# Implementation Plan: Personal Account Storage Limits And Plan-Ready Restrictions

> This document translates [design.md](./design.md) into an execution-ready implementation plan.
>
> Scope: UX planning, schema, backend services, enforcement, rollout, and verification required to introduce personal-account storage limits with space-level aggregates and per-space collaborator limits.

This plan is intentionally staged so that UX design happens first. No implementation should begin until the UX phase has defined the user-facing flows, messages, and states clearly enough to avoid rework.

---

## Summary

This implementation has six workstreams:

1. UX design and product behavior definition
2. Schema and domain model foundation
3. Read-only metering and usage APIs
4. Enforcement in upload and collaborator flows
5. Monitoring, admin operations, and rollout controls
6. Verification and production rollout

Target end state:

- one personal `billing.account` per user
- one account can own unlimited spaces
- each `space` belongs to one account
- storage aggregates are persisted per space
- account-level storage totals are derived from owned spaces
- collaborator limits are enforced per space
- uploads are blocked when account storage limits are exceeded
- invites/member adds are blocked when collaborator limits are exceeded
- ownership transfer remains disabled

---

## Implementation Principles

- UX-first: define the product behavior before schema or controller changes.
- Keep plan restrictions data-driven.
- Persist storage usage at the `space` level.
- Derive account-level totals from spaces.
- Centralize all quota checks in one backend service.
- Support monitor-only rollout before hard blocking.
- Preserve existing auth and permission checks; quota checks are additional gates.

---

## Phase Overview

| Phase | Goal | Output |
| --- | --- | --- |
| Phase 0 | UX and product behavior | approved UX flows, copy, states, and edge-case decisions |
| Phase 1 | Schema foundation | `billing.*` tables + `core.space.account_id` |
| Phase 2 | Read-only usage model | space/account usage computation + read APIs |
| Phase 3 | Enforcement | upload and collaborator limit checks |
| Phase 4 | Operations | reconciliation, admin repair, monitor-only controls |
| Phase 5 | Rollout | validate, enable monitor mode, then blocking mode |

---

## Phase 0: UX Design First

## Goal

Define the complete user-facing behavior before any implementation starts.

This phase must happen first. Backend behavior depends on decisions from this phase, especially for:

- when to warn
- when to block
- what counts against storage
- how collaborator limits are communicated
- what settings surfaces exist
- how upgrade prompts behave

## UX Workstreams

### Story 0.1 — Define quota surfaces

Decide where users can see storage and collaborator limits.

Required surfaces to consider:

- space settings
- account settings
- upload error states in the editor
- invite/member management screens
- future upgrade surfaces

Expected decisions:

- whether account storage is shown in account settings only, or also in each space
- whether per-space storage is visible to users or admin-only initially
- whether collaborator limit is shown preemptively in settings or only on failure

### Story 0.2 — Define states and messages

Design all states for:

- under limit
- near limit
- at limit
- over limit
- blocked by plan restriction
- blocked because account is suspended
- collaborator cap reached

Required output:

- UX copy guidelines
- inline error patterns
- empty states
- warning banners or notices
- consistent terminology for:
  - account
  - storage used
  - storage limit
  - collaborators
  - upgrade

### Story 0.3 — Define upload behavior

Decide how uploads should behave when close to or over limits.

Questions to settle:

- do we show a warning before the user chooses a file, after file selection, or only on failure
- should the editor show exact remaining storage or only generic messaging
- how should attachment upload failure differ from image upload failure
- should we show the attempted file size in the rejection message

### Story 0.4 — Define collaborator-limit behavior

Design the UX for member invite/add failure due to collaborator limits.

Questions to settle:

- show current collaborator count or not
- show plan upgrade CTA or not
- differentiate between invite creation and actual acceptance limits
- how pending invites count, if at all

### Story 0.5 — Define admin and support surfaces

Decide what internal or admin-facing visibility is required.

Needed outputs:

- admin readout for account storage
- admin readout for per-space storage
- admin readout for collaborator counts
- support/debug states for stuck reservations or mismatched totals

## UX Deliverables Required Before Implementation

- wireframes or flow definitions for all quota-related screens and errors
- final product terminology
- warning and blocking copy
- collaborator-limit interaction design
- account settings information architecture
- decision log for edge cases

No schema or backend implementation should begin until these are accepted.

---

## UX Guidelines

These are the minimum UX rules the implementation must respect once development starts.

### 1. Account and space concepts must not be conflated

Users should understand:

- storage limit is tied to the personal account
- collaborator limit is tied to the individual space

If both are shown on one screen, the UI must visually separate them.

### 2. Blocking should be specific

Do not show generic “something went wrong” errors for quota failures.

Required distinction:

- upload rejected because file is too large for the request-type limit
- upload rejected because account storage is full
- invite rejected because space collaborator limit is reached

### 3. Warnings should be actionable

If the product warns but does not block yet, the user should know:

- what limit is being approached
- whether action is needed now
- where to learn more or upgrade later

### 4. Avoid surprise blocking during multi-step actions

For example:

- if possible, detect collaborator limit before sending the invite
- detect upload limit before fully completing a long upload

### 5. Preserve editor trust

Quota failures in the editor must:

- leave the document intact
- not remove unrelated content
- clearly mark the failed upload action

### 6. Keep terminology stable

If product language uses “account”, do not mix in “workspace plan” or “organization plan” in the same phase.

### 7. Design for future upgrades without hard-coding them now

UX should leave room for later:

- upgrade buttons
- plan comparison
- billing details

But implementation in this phase should not depend on those flows existing yet.

---

## Phase 1: Schema And Domain Foundation

## Story 1.1 — Add `billing.account`

**Goal**

Create the personal account entity tied 1:1 to a user.

**Files**

- new Liquibase changelog under `db/beskar/updates/`
- master changelog include update

**Implementation**

- add `billing.account`
- fields:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id UUID NOT NULL`
  - `status TEXT NOT NULL`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- add unique constraint on `user_id`

**Decision**

`user_id` must map to the actual application user identity used across current `core.*` ownership, not dead `auth.*` tables.

### Story 1.2 — Add plan tables

**Goal**

Create a plan and restriction model that is generic.

**Files**

- same Liquibase area

**Implementation**

- add `billing.plan`
- add `billing.plan_limit`
- add `billing.account_subscription`

**Rules**

- plan metrics remain generic by `metric_key`
- no plan-specific columns on `billing.account`

### Story 1.3 — Add space-level usage tables

**Goal**

Persist storage usage at the `space` boundary.

**Files**

- same Liquibase area

**Implementation**

- add `billing.space_usage`
- add `billing.space_usage_event`

Suggested `billing.space_usage` fields:

- `space_id`
- `storage_bytes_used`
- `storage_bytes_reserved`
- `last_reconciled_at`
- `updated_at`

Suggested `billing.space_usage_event` fields:

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

### Story 1.4 — Add `core.space.account_id`

**Goal**

Link every space to its owning account.

**Implementation**

- add `core.space.account_id UUID NOT NULL`
- add foreign key to `billing.account.id`
- backfill existing spaces from current owner mapping

### Story 1.5 — Explicitly disable ownership transfer

**Goal**

Ensure quota ownership cannot move implicitly.

**Implementation**

- identify all current ownership transfer entry points, if any
- block them or mark them unavailable
- document this behavior in UX and product copy

---

## Phase 2: Read-Only Metering And Usage APIs

## Story 2.1 — Add quota service foundation

**Goal**

Create one internal service for plan and quota logic.

**Implementation**

- resolve `page -> space -> account`
- resolve active account subscription
- resolve plan limits
- read `billing.space_usage`
- derive account-level totals from owned spaces

### Story 2.2 — Add reconciliation queries

**Goal**

Make space totals recomputable from canonical asset metadata.

**Implementation**

- aggregate active attachments per space
- aggregate active image assets per space
- produce derived account totals as sum of spaces

### Story 2.3 — Add read-only usage APIs

**Goal**

Expose storage/collaborator information for future UX surfaces.

**Suggested endpoints or service contracts**

- account usage summary
- space usage summary
- space collaborator limit summary

**Required fields**

- account plan code
- account storage used
- account storage limit
- account percent consumed
- space storage used
- space storage reserved
- collaborator limit per space
- current collaborator count per space

### Story 2.4 — Add monitor-only instrumentation

**Goal**

Calculate quota outcomes before blocking anything.

**Implementation**

- emit logs/metrics when an action would exceed limits
- keep requests succeeding in monitor mode
- add structured reason codes

---

## Phase 3: Enforcement

## Story 3.1 — Enforce limits on attachment upload

**Goal**

Block attachment uploads when account storage limit would be exceeded.

**Files**

- `server/attachment/controller/attachmentController.go`
- `server/attachment/services/attachmentService.go`
- new quota service package

**Implementation**

1. resolve page
2. resolve space
3. resolve account
4. load target space aggregate
5. derive account total from all spaces
6. check limits
7. reserve bytes in `billing.space_usage`
8. write blob + metadata
9. commit used bytes on success
10. release reservation on failure

### Story 3.2 — Enforce limits on image upload

**Goal**

Apply the same flow to document image uploads.

**Files**

- `server/media/controller/mediaController.go`
- `server/media/services/imageService.go`

**Implementation**

- same reservation/commit/release pattern as attachments
- target space aggregate is updated
- account total limit is enforced via derived total

### Story 3.3 — Enforce collaborator limits

**Goal**

Block invite/member additions that exceed the per-space collaborator cap.

**Likely files**

- `server/invite/*`
- `server/space/*`

**Implementation**

- resolve space
- count active collaborators
- compare against plan limit
- reject if exceeded

**Design decision to confirm in UX**

- whether pending invites count toward the cap

### Story 3.4 — Release storage on deletion

**Goal**

Ensure space storage is decremented when assets stop counting.

**Implementation**

- identify attachment deletion lifecycle
- identify image deletion lifecycle
- define exactly when usage is decremented

If full deletion lifecycle is not implemented yet, document that enforcement is correct for new writes and reconciliation remains the repair mechanism.

---

## Phase 4: Operations And Admin Support

## Story 4.1 — Reconciliation job

**Goal**

Repair drift between `billing.space_usage` and real asset metadata.

**Implementation**

- recompute storage per space from `core.attachment` and `core.image_asset`
- compare to stored aggregates
- write `reconcile` events
- update `last_reconciled_at`

### Story 4.2 — Admin repair tools

**Goal**

Make quota issues operable.

**Needed operations**

- recompute one space
- recompute all spaces
- list spaces with negative or inconsistent reserved bytes
- clear stale reservations
- inspect account total derived from spaces

### Story 4.3 — Monitor mode and feature flags

**Goal**

Allow safe rollout.

**Suggested flags**

- quota system enabled
- storage blocking enabled
- collaborator blocking enabled
- monitor-only mode

---

## Phase 5: Rollout And Verification

## Story 5.1 — Pre-rollout validation

Before enabling blocking:

- verify each user has one personal account
- verify each space has `account_id`
- verify each space has a `billing.space_usage` row
- verify derived account totals match expected storage sums
- verify collaborator counting logic against real membership data

### Story 5.2 — UX verification

Before hard enforcement, validate:

- account usage screen copy
- space collaborator limit copy
- upload rejection states
- invite rejection states
- monitor-mode warning presentation

### Story 5.3 — Enable monitor-only mode

Run with:

- warnings and logs enabled
- no request blocking

Observe:

- projected over-limit uploads
- projected collaborator-limit violations
- unexpected false positives

### Story 5.4 — Enable blocking mode

After monitor-only confidence:

- enable storage blocking
- enable collaborator blocking
- keep reconciliation and admin tools available

---

## Testing Plan

## Backend tests

- unit tests for plan limit lookup
- unit tests for derived account total from spaces
- unit tests for reservation/commit/release logic
- unit tests for collaborator count enforcement
- unit tests for reconciliation logic

## Integration tests

- attachment upload succeeds under limits
- attachment upload blocks over limit
- image upload succeeds under limits
- image upload blocks over limit
- collaborator invite succeeds under cap
- collaborator invite blocks over cap
- failed uploads release reserved bytes

## Manual verification

- upload files across multiple spaces owned by the same account
- confirm account total reflects sum of spaces
- confirm a large upload in one space can block uploads in another if account total is exhausted
- confirm collaborator limit is isolated to the specific space
- confirm ownership transfer paths are unavailable

---

## Risks

## UX ambiguity risk

If users do not understand the difference between:

- account storage limit
- per-space collaborator limit

the feature will feel arbitrary.

Mitigation:

- do UX first
- keep labels and copy explicit

## Derived-total performance risk

If account totals are always derived in expensive queries, uploads may slow down.

Mitigation:

- start with correct derivation logic
- add optimized read paths or cached account summaries later if needed
- keep `space` as the durable aggregate regardless

## Hidden collaborator semantics risk

If invite acceptance, pending invites, and active members are not modeled clearly, collaborator enforcement will be inconsistent.

Mitigation:

- settle counting rules during UX/product phase
- reflect the same rules in backend and UI

---

## Deliverables

Implementation should ultimately produce:

- accepted UX flows and copy
- Liquibase changes for `billing.*` + `core.space.account_id`
- quota service package
- read-only usage APIs
- upload enforcement
- collaborator enforcement
- reconciliation/admin tooling
- rollout flags and validation runbook

---

## Recommended Sequencing Rule

When this work starts later, follow this order strictly:

1. UX design and product decisions
2. schema and read models
3. read-only APIs and monitor mode
4. enforcement in backend
5. admin/reconciliation
6. blocking rollout

Do not start with controller-level blocking logic before the UX and read model are settled.
