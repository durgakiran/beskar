# Glideboard Phase 3 - Asset Workflows and Libraries Acceptance Plan

- **Status:** Implementation complete; manual product validation and deployed rollout evidence pending
- **Frozen acceptance version:** `P3-v1`
- **Frozen on:** 2026-08-12
- **Source:** [Remaining Gap Analysis and Implementation Roadmap](./remaining-gap-analysis-and-implementation-roadmap.md), Phase 3

`P3-v1` is the immutable baseline for this execution run. Component iteration
counts do not reset when the orchestrator approves a later scope revision.

## Phase Acceptance Criteria

Phase 3 is complete only when:

1. Picker, drag/drop, paste, and imperative imports use one cancellable workflow with visible progress and actionable errors.
2. Raster and SVG assets support aspect-safe placement, resize, crop, replace, download, alt text, and recoverable missing states.
3. SVG assets persist an explicit native-color or themeable-monochrome mode.
4. Assets survive reload, hierarchy operations, collaboration, duplicate, cross-board transfer, export, version rendering, and source-library deletion.
5. A searchable, keyboard-accessible Assets panel provides Recent, Favorites, My Shapes, Team Library, and installed vendor groups through one generic placement tool.
6. Library dependencies retain provenance, license, source version, portability, and reference-aware deletion semantics without adding one schema/tool type per asset.
7. Automated rollout checks cover migration, storage/quota modes, CSP and malicious content, authorization, tenant isolation, backup/restore, retention, redacted telemetry, and decoder-isolation decision evidence.
8. Phase-owned modules have at least 90% statement, branch, function, and line coverage; all package builds, tests, and browser workflows pass with zero acceptance failures.

## Components

### P3-C1 - Asset Shape Model and Rendering

- **Acceptance version:** `P3-C1-v1`

Acceptance criteria:

- Raster shapes persist nondestructive crop bounds and alt text; invalid values are rejected.
- SVG shapes persist native or monochrome color mode and theme color.
- Image resizing preserves aspect ratio by default while allowing an explicit unlocked mode.
- The inspector persists the aspect-lock setting used by both numeric and pointer resizing, and exposes usable alt-text, raster crop/reset, and SVG color-mode/theme controls.
- Raster Crop Reset synchronizes persisted and visible draft values immediately; a focused reset button cannot leave stale values that Apply can restore.
- SVG native/monochrome controls expose their selected state with `aria-pressed` as well as visual styling.
- Asset inspector inputs retain focus and selection, suppress canvas shortcuts while editing, and repaint immediately after valid changes.
- Real browser typing in asset inspector fields cannot activate tool shortcuts or create shapes; crop/alt drafts remain mounted until explicit commit or blur.
- Resolver failure renders a bounded, selectable missing-asset placeholder rather than blank content.
- Native, monochrome, cropped, missing, accessibility, serialization, explicit copy/paste, collaboration, and export behavior is covered by tests and browser interaction.

### P3-C2 - Asset Lifecycle Controller

- **Acceptance version:** `P3-C2-v1`

Acceptance criteria:

- Imports expose stable queued/uploading/complete/error/cancelled state and progress.
- A caller can cancel, retry, and dismiss an import without leaving orphan records.
- Disposal aborts and settles imports before the final tracked save; no import can commit after disposal begins.
- Commit-response retries remain fenced by cancellation/disposal; terminal-state recovery cannot turn an aborted import into a late completed job.
- Replace atomically swaps immutable asset references while preserving geometry, crop, and alt text.
- Selected assets expose accessible Replace and Download commands through the inspector/public handle, with browser-verifiable success and failure states.
- Persistence requires a staged transaction or guaranteed cleanup handle; rollback cannot be omitted when cancellation or late validation fails, so no orphan bytes remain.
- Production uploads use a server-issued staging token with explicit commit and idempotent rollback; final persistence cannot occur before the client receives compensation capability.
- A lost commit response is resolved by retrying to a known terminal state or by reference-safe compensation; it cannot leave committed bytes and quota without a live editor reference.
- A compensated committed token has an explicit replay-safe terminal state; later commit/cancel requests cannot return a nil record, panic, or resurrect deleted bytes.
- Every production and demo portability materializer rolls back its staging token when stage or commit fails, including failures before compensation is returned to the caller.
- Rollback/cleanup failure is surfaced as an actionable orphan-cleanup error even when the initiating operation was cancelled; it cannot be downgraded to a normal cancelled state.
- Quota reservation and recoverable staging metadata are recorded atomically, or carry persisted correlation data that independent cleanup can release after request cancellation or process interruption.
- A repository-owned sweeper processes expired prepared/uploading/staged and cleanup-pending transactions, with bounded retries and tests proving quota/byte recovery after process interruption.
- Sweeper retries have a maximum-attempt policy and observable exhausted/dead-letter state while retaining all recovery metadata.
- The sweeper is owned by the application shutdown context and tests prove cancellation and worker completion.
- Shutdown coverage cancels an active/in-flight sweeper pass and proves completion, not only a worker cancelled before start.
- Cancellation uses one pass-wide bounded drain deadline; shutdown latency cannot multiply by cleanup batch size.
- Blob cleanup failure remains retryable and cannot discard the metadata needed to locate orphaned bytes.
- Download resolves original bytes through a trusted host API and verifies MIME type, byte length, and immutable content hash.
- Limits and error categories are available to product UI; cancellation is not reported as failure.
- Production HTTP failures map quota, permission, validation, conflict, network, and storage categories accurately so the UI never recommends retry for a hard denial.
- HTTP 429 is a distinct retryable rate-limit outcome that honors `Retry-After`; it is not categorized as image size/quota guidance.
- Resetting demo data immediately clears import-job history as well as records and bytes.
- Reset is exception-safe and succeeds from read-only mode by restoring mutation permission before the privileged clear.
- Negative authorization tests prove every staging/retain route returns before invoking its service dependency.
- Declared full-package test scripts are order-independent and deterministic, not only passing when files run in isolation.
- Declared browser suites own a fresh server/port and cannot silently reuse stale local servers; deployed-only security specs run only through their dedicated command.
- Local cut/delete and undo semantics do not depend on portable clipboard serialization or browser clipboard permission; external clipboard persistence is best-effort.

### P3-C3 - Unified Import UI

- **Acceptance version:** `P3-C3-v1`

Acceptance criteria:

- An accessible toolbar command opens a PNG/JPEG/WebP/SVG picker.
- The picker supports multiple files and remains discoverable from the main menu, matching the tldraw media workflow.
- Canvas drop, clipboard paste, and picker share one multi-file import pipeline.
- Drop-point placement is deterministic; initial geometry fits the viewport and preserves source aspect.
- A visible upload surface provides progress, cancel, retry, dismiss, and specific recovery messages.
- Read-only mode blocks ingress; focus and live-region announcements are correct.
- Demo acceptance controls make slow upload, storage failure/retry, cancellation, and read-only behavior reproducible without production-only flags.
- Toolbar, import status, style/layers panels, zoom, and status overlays remain usable without overlap at 390px mobile width.
- Browser tests cover the real toolbar and main-menu discovery paths, multi-file picker, paste/drop, progress actions, focus/live region, errors, responsive layout, and read-only mode.
- Read-only browser expectations preserve the intentional browse-only Assets toolbar while hiding mutation/import commands, and progress-action coverage includes Dismiss.

### P3-C4 - Asset Placement and Library Model

- **Acceptance version:** `P3-C4-v1`

Acceptance criteria:

- One generic placement tool places any supported library item by click or drag.
- Armed click placement provides a visible canvas affordance (cursor, preview, or persistent status) that identifies the active asset before the next click.
- The actual canvas surface displays the armed cursor/preview; child canvas styling cannot override the app-level affordance.
- Pointer movement and hover updates preserve the armed cursor until placement, cancellation, or tool change.
- Placement progress, cancellation, and actionable failure remain visible at app scope after the Assets panel closes; failures cannot be console-only or written into unmounted panel state.
- Demo acceptance controls can hold materialization pending long enough to verify visible progress and cancellation deterministically.
- Catalog activation restores focus to the canvas or app-level placement controls so immediate Escape reliably cancels before any placement.
- Post-placement side-effect failures, including recording recents, route to app-level notices rather than panel-local state that may be unmounted.
- Persistent placement and side-effect failures expose `role="alert"` with actionable recovery text.
- Glideboard registers the generic tool and exposes a public/controller path for configuring the active item and materializer.
- The public Glideboard handle and debug acceptance surface can configure and exercise generic placement.
- Provider contracts cover catalog search, groups, favorites, recents, installation state, and materialization.
- Materialization completes before shape creation and is atomic on failure/cancellation.
- Compensation is limited to pre-commit failures; post-commit callbacks cannot roll back bytes referenced by committed records.
- Placed records retain content hash, provenance, license, source library, and source version.
- Library uninstall/deletion is only possible through an enforceable operation that derives retained dependencies internally; callers cannot bypass resolution or supply a false empty list.
- Hash deduplication merges missing provenance/license/source-version metadata rather than silently discarding it.

### P3-C5 - Assets Panel

- **Acceptance version:** `P3-C5-v1`

Acceptance criteria:

- Search and keyboard navigation work across Recent, Favorites, My Shapes, Team Library, and installed vendor groups.
- Search updates results without refetching static groups/favorites/recents/installations or replacing the entire catalog with a loading state on every keystroke.
- During debounce, every section/count renders from the same accepted query snapshot; raw and previous-result queries cannot be mixed.
- Results show useful thumbnails, names, source/license context, favorite state, and missing/unavailable states.
- Selecting an item updates the active asset and enters the generic placement tool; drag placement also works.
- Loading, empty, error, retry, responsive, and read-only states are complete.
- Unavailable items expose no enabled placement or favorite mutation actions.
- Real browser keyboard input in search cannot leak canvas shortcuts; native HTML drag from a catalog card to canvas must place the asset.
- Shortcut suppression follows the focused control and composed event path, so browser/framework retargeting cannot bypass it.
- Demo acceptance controls expose catalog loading and failure/retry states.
- Reset Demo clears records, bytes, import history, favorites, and recents so acceptance runs start deterministically.
- Reset invalidates any mounted Assets panel immediately, clearing in-memory catalog and favorite overrides without requiring close/reopen.

### P3-C6 - Portability and Historical Resolution

- **Acceptance version:** `P3-C6-v1`

Acceptance criteria:

- Cross-board transfer materializes raster bytes in the destination before committing records.
- Portable fragments are strictly schema-validated and bounded by record, string, metadata, and embedded-byte limits before decoding, authorization, or persistence.
- Every embedded asset ID is non-empty, included in UTF-8 string limits, and canonical raster IDs match exactly `asset:sha256:<64 lowercase hex>` at the editor/demo portability boundary.
- Duplicate, hierarchy copy, collaboration, reload, export, and historical snapshots resolve immutable assets.
- Same-board duplicate and reload preserve raster resolution without creating asset IDs whose bytes were never materialized.
- Demo storage survives React StrictMode replay and reload without disposing restored bytes.
- Raster export is self-contained or uses an explicit durable export resolver, including historical version context.
- Portable SVG export enforces the same canonical lowercase raster ID validation before invoking any host export hook.
- Production cross-board clipboard/export and historical rendering invoke the portability/resolution contracts rather than leaving them test-only.
- Host adapters implement retain, materialize, and rollback endpoints/contracts end to end; compensation never calls an unregistered route.
- Durable references are restricted to explicitly trusted same-origin asset routes and never send credentials to clipboard-supplied origins.
- Same-origin means the application window origin; configuring a cross-origin API base cannot expand the durable-reference trust boundary.
- Historical resolution uses validated document/version identifiers, canonical asset IDs require the full `asset:sha256:` prefix, and rollback reference counts are page-scoped.
- Resolution context validates the schema and types of documentId, versionId, snapshotId, createdAt, and metadata values rather than relying only on aggregate JSON-size checks.
- Reference-aware retention registration is mandatory and prevents deletion of bytes needed by live or retained historical documents.
- Failure is atomic and user-recoverable: all records are validated and mutations authorized before materialization, compensation is required, and rollback failure is surfaced.
- Fragment size accounting uses actual encoded JSON bytes, including punctuation, booleans, nulls, and numeric encodings.
- Raster payload limits also cap the complete base64-expanded encoded fragment, not only decoded byte totals.
- Browser acceptance proves duplicate and cross-board copy outcomes through observable record counts and resolved asset rendering, not only command execution.
- Browser acceptance asserts the exact portable request sequence for create-fragment, paste/materialize, and export operations.
- Demo browser acceptance exposes a deterministic permission-independent cross-board transfer operation; certification cannot depend on system clipboard permission or inaccessible page-isolated state.
- The built Glideboard package is consumable through its declared exports by the UI and demo; emitted internal imports resolve under standard ESM package rules.
- Phase-owned test files run under the declared test runner without relying on undeclared globals, and the demo package declares every test dependency it invokes.

### P3-C7 - Rollout, Security, and Coverage Gate

- **Acceptance version:** `P3-C7-v1`

Acceptance criteria:

- A repeatable command produces a pass/fail evidence report for every roadmap rollout item.
- Ephemeral migration and filesystem/S3-compatible storage tests cover dedupe, quota modes, cleanup, and restore using owned assertions; arbitrary zero-exit commands cannot fabricate a pass.
- Ephemeral evidence comes only from repository-owned probes with a fixed result schema and directly verified resources; self-reported checksums or caller-supplied commands are not trust anchors.
- Browser security tests assert no script execution, unexpected network access, DOM injection, or cross-tenant reads after terminal processing; tenant fixtures and authenticated identities are positively established before denial assertions.
- Terminal selectors are repository-owned, initially absent, and correlated to the submitted upload; caller-selected always-visible elements cannot satisfy browser security evidence.
- Browser terminal correlation uses a repository-generated per-upload ID/token propagated into the terminal DOM node; filename-only correlation is insufficient.
- Cross-tenant tests prove distinct tenant identifiers as well as distinct users, and positively verify the protected fixture in its owning tenant.
- Coverage thresholds of 90% are enforced for Phase 3-owned modules.
- The coverage manifest includes every Phase 3 production module and integration surface; it cannot cherry-pick already well-covered files.
- A machine-checked semantic inventory includes every Phase 3 production path, including authorization helpers and board-deletion asset/quota/object cleanup.
- Coverage reports are generated by repository-owned commands, schema-validated, and cryptographically bound to the reviewed source/build; caller-selected or substituted JSON cannot satisfy the gate.
- Producers write reports atomically themselves and bind production sources, transitive Phase 3 sources, tests, package/config inputs, and build artifacts; recomputing a digest over caller-writable raw JSON is insufficient.
- Coverage report metric keys must exactly equal the manifest keys; missing and extra entries both fail.
- Scoped entries fail when any required metric dimension selects zero instrumentation, and stale/empty ranges are rejected.
- Build binding hashes real emitted packages, bundles, tarballs, binaries, or image digests in addition to source/config/test inputs.
- The Go coverage producer emits the exact validated report consumed by the verifier, including every manifest entry.
- Ephemeral evidence includes a validated SHA-256 sidecar and exercises real filesystem and S3-compatible adapters for dedupe, failed deletion/retry, quota release, and restore.
- Ephemeral migration evidence applies the real Liquibase changelog, and S3 evidence uses a real disposable S3-compatible service rather than an HTTP fixture; result JSON is derived from observed assertions, never hard-coded pass values.
- S3 restore evidence deletes and then restores the object through the intended recovery path, verifies post-restore content and metadata hashes, and records observed resource IDs, row counts, changelog identities, and checksums.
- Evidence fetching accepts credential-free HTTPS only and prevents loopback, private, link-local, metadata-service, DNS-rebinding, and redirect SSRF; local `file:` evidence is rejected.
- Disposable topology failures preserve or print service diagnostics before cleanup.
- Validator crashes, report-directory/write failures, and nested command failures are status-checked and fail closed while retaining complete diagnostics.
- Environment-specific owner evidence is schema-validated for owner, reviewer, environment, build digest, procedure, result, timestamp, and artifact URL, then recorded as required, supplied, or blocking; it is never silently inferred from local tests.
- Supplied owner evidence is artifact-backed and rejects placeholders/test domains; its digest must match the referenced local or fetched evidence artifact.

## Scope Control and Review Loop

- Builders and critics cannot modify acceptance criteria.
- Critics classify findings as: **A** existing-criterion defect, **B** candidate
  missing phase requirement, **C** non-blocking enhancement, or **D** later-phase
  requirement.
- Category A blocks the component. The orchestrator alone adjudicates category B
  against the roadmap, safety, consistency, usability, and phase exit criteria.
  Categories C and D go to the backlog.
- Approved scope changes receive a new acceptance version and rationale without
  resetting the component's iteration counter.
- After iteration 6, new blocking scope is accepted only when omission violates
  an explicit roadmap exit criterion, causes a safety/data-loss risk, or makes
  the implemented workflow unusable.
- Each component receives a dedicated builder and a separate, fresh-context,
  read-only blind critic. A builder/critic pair is one iteration, with a maximum
  of ten iterations per component.
- Builders must report focused and full tests, affected and downstream builds,
  package-artifact checks, browser tests with retries disabled, coverage, and
  every known failure before critic handoff.
- Shared-package writers run serially. Critics test the exact worktree revision
  and may report PASS only with zero required failures or skipped checks.
- After all components pass, the phase receives a sequential integration build,
  package-artifact verification, greater-than-90% four-metric coverage run,
  browser acceptance pass on port 7153, and an orchestrator comparison against
  equivalent tldraw workflows before Phase 4 begins.

## Initial Baseline Audit

The frozen criteria describe required behavior, not current completion. The
2026-08-12 preflight established:

- Glideline production build: pass.
- Glideboard production build: fail at `Canvas.tsx` because `activeTool` can be
  undefined when passed to `getCanvasToolCursor`.
- Glideline demo production build: pass, with a non-blocking chunk-size warning.

These are baseline findings for the first controlled component iteration and
do not modify `P3-v1`.
