# Glideboard Remaining Gap Analysis and Implementation Roadmap

- **Status:** Derived implementation roadmap
- **Derived on:** 2026-08-06
- **Source roadmap:** [Current-State Gap Analysis and Implementation Roadmap](./current-gap-analysis-and-implementation-roadmap.md)
- **Completed foundation:** [Correctness and Data-Safety Implementation Plan](./correctness-and-data-safety-implementation-plan.md)
- **Primary scope:** `packages/glideline`, `packages/glideboard`, and the Beskar whiteboard host

## 1. Purpose and Assumption

This document contains the work that remains from the source roadmap after subtracting the completed correctness and data-safety program.

The subtraction is based on the implementation-status statements in the correctness plan and the instruction that the plan has been implemented. It is a planning reconciliation, not a new line-by-line code audit. Items that were only partially covered by the correctness plan remain here with their completed foundation removed.

The old Phase 0 is no longer part of the feature roadmap. The next implementation phase begins with hierarchy, groups, and frames.

## 2. Completed Scope Excluded from This Roadmap

The following source-roadmap work is treated as complete and must not be planned again:

| Completed foundation | Source-roadmap coverage |
| --- | --- |
| Board-scoped controller, lifecycle isolation, and scoped imperative API | COR-01 and Phase 0.1 |
| Save coordination, local recovery, revision conflicts, publish fencing, and durable Yjs checkpoints | COR-02, persistence portions of Sections 15 and 16, and Phase 0.2 |
| Atomic immutable store transactions, one commit event, exact history, and transient interaction previews | COR-03 and Phase 0.3 |
| Deterministic parent-scoped ordering used by rendering and hit testing | COR-04 and Phase 0.4 |
| Canonical transforms and rotated geometry for the current flat-record model | COR-05 and the flat-model portion of Phase 1.3 |
| Record-kind validation, migrations, explicit replace/import semantics, opaque future records, graph integrity, and exact secondary indices | COR-06 and Phase 0.6-0.8 |
| Generic safe plain-text editing for all opted-in shapes, including one arrow label and rotated text | COR-07, the plain-text portion of Section 12, and Phase 0.5 |
| Command gateway and mutation-policy enforcement across UI, APIs, AI/MCP, history, and direct-store paths | Section 9, Section 15.3's enforcement foundation, and Phase 0.9 |
| Graph-aware copy, paste, and duplicate within Glideline, including descendants, bindings, assets, ID remapping, and one-step undo | Section 10.1 and the engine portion of Phase 3.6 |
| Yjs field-addressable convergence, schema negotiation, tombstones, safe remote apply, local-only undo, and bounded awareness data | Section 15.1's data-convergence foundation and old Phase 5.1-5.2 |
| Real viewport culling with pinned interaction records and canonical z-order | COR-08 and Phase 0.10 |
| Safe SVG/raster ingress, immutable asset identity, host storage/resolution, engine-owned SVG rendering, raster validation, and hostile-content tests | Security foundation in Section 11 and old Phase 3.1-3.3 |

Completed foundations still need to be extended where the record model changes. In particular, the transform service, order queries, graph clipboard, collaboration projection, export, and culling must become hierarchy-aware when nested parent-local coordinates are introduced.

## 3. Remaining Work Register

| ID | Priority | Remaining capability | Current starting point | Depends on |
| --- | --- | --- | --- | --- |
| REM-01 | P0 | Hierarchical document model and nested transforms | Default page and relationship validation exist; editing remains effectively flat | Completed correctness foundation |
| REM-02 | P0 | Structural groups | Missing | REM-01 |
| REM-03 | P0 | Frames as real containers | Visual frame utility exists; containment behavior is missing | REM-01 |
| REM-04 | P0 | Inherited lock and visibility | Mutation policy exists; object-level durable inheritance and UI are missing | REM-01 |
| REM-05 | P1 | Align, distribute, match size, flip, and tidy | Z-order commands exist | REM-01 |
| REM-06 | P1 | Precision inspector, nudging, and feature shortcut wiring | Core move/resize/rotate exists | REM-01 |
| REM-07 | P1 | Snap manager, guides, and grid settings | Only special-case connector/rotation snapping and visual grid exist | REM-01 |
| REM-08 | P1 | Layers panel | Canonical order and parent queries exist; product UI is missing | REM-01, REM-04 |
| REM-09 | P1 | OS clipboard and copy-as-image | Internal graph fragment exists; cross-application formats are missing | REM-01, export service |
| REM-10 | P1 | Asset workflow and libraries | Safe ingress/storage exists; full product workflow and libraries are incomplete | Hierarchy-aware graph/export |
| REM-11 | P0 rollout gate | External-upload operational rollout | Package and host code path complete; deployment evidence is pending | Operations/security owners |
| REM-12 | P1 | Canvas rich text | Safe plain text exists; structured rich text is missing | Hierarchy, export, schema negotiation |
| REM-13 | P1 | Advanced connector content and route editing | One safe plain-text arrow label exists | Snap/command infrastructure |
| REM-14 | P1 | Page UI and page workflows | Page record/default-page foundation exists | REM-01 |
| REM-15 | P1 | Minimap, search, named views, and templates | Viewport queries and canonical geometry exist | REM-08, REM-14 |
| REM-16 | P1 | Product import/export workflows | Safe replacement/import and engine SVG/PNG exist; File UI and bounded service are incomplete | REM-01, REM-10, REM-12 |
| REM-17 | P1 | Collaboration status and presence UX | Data convergence and bounded awareness exist; product presence UI is incomplete | REM-01, REM-14 |
| REM-18 | P1 | Product roles, comments, and durable version history | Mutation-policy and revision foundations exist; product workflows are missing | Host/backend integration |
| REM-19 | P1 | Accessibility completion | Partial native controls only | Each product surface |
| REM-20 | P1 | Touch, stylus, and responsive interaction | Basic pointer events only | Core interaction surfaces |
| REM-21 | P1 | Reliability, recovery UX, and observability | Typed foundation exists; complete product diagnostics/recovery UI is pending | Product surfaces and host |
| REM-22 | P2 | Advanced diagramming and facilitation | Not started | Stable P1 foundation |

## 4. Phase 1 - Hierarchy, Groups, Frames, Lock, and Visibility

### 4.1 Hierarchical document model

Extend the existing record and integrity foundation into the user-facing structural model:

- make every root shape a child of a page and every nested shape a child of a group or frame;
- use parent-local position and rotation;
- compose local/world transforms through all ancestors;
- preserve world geometry during reparenting with `inverse(newParentWorld) * oldWorld`;
- derive children from the parent index rather than storing mutable `childIds`;
- prevent parent cycles and invalid parent types;
- extend culling, ordering, routing, hit testing, selection, clipboard, collaboration, and export to hierarchy traversal;
- migrate legacy documents to a default page without changing visible geometry.

The existing flat-model transform implementation is the base, not the final implementation. Nested transform composition, inversion, transformed outlines, and parent-aware resize behavior remain required.

### 4.2 Structural groups

Implement an explicit non-visual group shape and commands for:

- group selected compatible siblings;
- ungroup one or more groups;
- enter a group and select its contents;
- nested selection, movement, rotation, resize, delete, copy, paste, duplicate, export, and collaboration;
- order preservation around grouped and ungrouped content;
- one atomic history action per group or ungroup command.

Group resize must apply scaling through descendant shape resize contracts so text and stroke widths are not permanently distorted by a stored parent scale.

### 4.3 Frames

Turn frames into hierarchy containers with behavior distinct from groups:

- add a frame tool;
- move descendants with the frame;
- resize frame bounds without scaling children by default;
- reparent eligible shapes when dropped into or out of a frame while preserving world position;
- support title, background, optional clipping, selection, ordering, export, and collaboration;
- provide an explicit remove-frame-without-deleting-content command if normal Delete removes the subtree.

### 4.4 Lock and visibility

Add durable object-level `isLocked` and `isHidden` behavior with ancestor inheritance:

- locked descendants render but cannot be ordinarily selected or mutated;
- hidden descendants do not render, hit-test, route as obstacles, export normally, or participate in ordinary selection;
- layers and commands expose lock/unlock and hide/show;
- trusted migration, remote, and administrative paths use explicit override capabilities.

### 4.5 Exit criteria

- Group then ungroup preserves world geometry for translated, resized, rotated, and nested content.
- Reparenting into or out of a rotated frame does not move content in page space.
- Frames move descendants and resize without unintended child scaling.
- Order, hits, export, routing, collaboration, clipboard, and culling agree for nested content.
- Legacy documents migrate to a default page and round-trip without data loss.
- Lock and visibility inheritance is enforced through commands and rendering, not only UI state.

## 5. Phase 2 - Arrange, Precision, Snapping, and Layers

**Implementation status:** Complete in `packages/glideline` and `packages/glideboard` (2026-08-11).

Delivered: hierarchy-aware arrange commands, precision geometry controls, nudging and shortcuts, engine-owned snapping and guides, separate grid settings, and a canonical hierarchy layers panel.

### 5.1 Arrange commands

Add Glideline commands, reused by toolbar, context menu, keyboard, AI, and MCP, for:

- align left, horizontal center, right, top, vertical middle, and bottom;
- distribute horizontal/vertical centers or gaps;
- match width, height, or both;
- flip horizontally or vertically;
- tidy into a row or grid as a later increment.

Mixed sizes, rotated bounds, and parent-local coordinates must have deterministic behavior. Each operation is one history entry.

### 5.2 Precision and keyboard workflows

- editable X, Y, width, height, and rotation controls;
- aspect-ratio lock and reset rotation;
- Arrow nudge by 1 pixel and Shift+Arrow by 10 pixels;
- platform-correct Select All, Group, Ungroup, Lock, and Zoom shortcuts;
- focus ownership that prevents canvas shortcuts while a text field or label editor is active.

The command gateway is already complete. This phase adds the missing feature commands, predicates, UI, and shortcut registrations rather than another command architecture.

### 5.3 Snapping and guides

Implement one engine-owned snap manager with ephemeral guide descriptors. Support:

- grid intersections;
- object edges and centers;
- equal gaps and spacing;
- matching width and height;
- rotation increments;
- frame boundaries and page-local coordinates;
- screen-pixel tolerance converted through zoom;
- separate show-grid and snap-to-grid settings;
- temporary positional-snap disable with Alt.

### 5.4 Layers panel

Expose the page/group/frame tree with:

- selection and multi-selection;
- inline rename;
- reorder within a parent;
- drag reparent with cycle prevention;
- hide/show and lock/unlock;
- expand/collapse;
- locate and reveal on canvas.

Layer order must use the same canonical sibling order as rendering, hit testing, connector targeting, and export.

### 5.5 Exit criteria

- Arrange and precision operations work identically through all registered command surfaces.
- Rotated and nested selections align and distribute deterministically.
- Snapping and guides remain visually stable at every supported zoom level.
- Layer reorder/reparent changes canvas behavior immediately and cannot create cycles.

## 6. Phase 3 - Asset Product Workflows and Libraries

The safety plan already delivered secure SVG/raster ingestion, canonical assets, host persistence, and trusted resolution. Do not rebuild that pipeline.

### 6.1 Remaining image and SVG workflow

- visible file picker and drag/drop entry points where not already exposed;
- upload progress, cancellation, limits, and actionable errors;
- image resize, crop, replace, download, original-aspect placement, and alt text;
- recoverable missing-asset state;
- explicit SVG native-color versus themeable-monochrome modes;
- hierarchy-aware asset copy/paste, collaboration, persistence, export, and historical resolution.

### 6.2 Assets panel and libraries

Add a searchable Assets panel with:

- Recent and Favorites;
- My Shapes and Team Library;
- installed vendor groups such as AWS, Azure, Google Cloud, and Kubernetes;
- active asset thumbnail and one generic asset-placement tool;
- library dependency, deletion, retention, licensing, and portability rules.

Large libraries must not create a schema type or tool class per asset.

### 6.3 Operational rollout gate

Before broad external-upload rollout:

- apply and verify the Liquibase migration in deployed environments;
- exercise configured object-store and quota modes;
- run the CSP/network malicious corpus in the deployed origin topology;
- verify authorization, tenant isolation, encryption, backup/restore, deletion/retention, telemetry redaction, and abuse controls;
- decide whether the deployment requires process-level decoder isolation and, if so, place inspection behind a sandboxed worker.

### 6.4 Exit criteria

- Assets survive reload, collaboration, duplicate, cross-board paste, library deletion, export, and historical-version rendering.
- The complete user workflow exposes progress, cancellation, errors, missing-state recovery, and accessibility semantics.
- Security and operations owners provide deployment evidence for the rollout gate.

## 7. Phase 4 - Pages, Navigation, Clipboard, Import/Export, and Rich Content

### 7.1 Pages

Add create, rename, duplicate, reorder, and delete operations; active-page state; per-page camera state; deterministic active-page deletion fallback; and page-aware selection, hit testing, search, export, collaboration, and culling.

### 7.2 Navigation

- minimap for active-page extents and viewport navigation;
- search across labels, names, assets, types, and metadata;
- reveal search results in layers and on canvas;
- named camera views/bookmarks;
- reusable selection/page templates with explicit asset and plugin dependencies.

### 7.3 OS clipboard

Build OS integration on the completed graph clipboard:

- `application/x-glideboard+json` for lossless board fragments;
- SVG or PNG for other applications;
- `text/plain` for text-only selections;
- cross-tab and cross-board paste;
- copy as image;
- atomic rejection of malformed or unsupported payloads.

### 7.4 Import and export product workflow

- File menu for Glideboard JSON import/export;
- selection/page SVG and PNG export;
- transparent or colored background, padding, scale, and resolution;
- bounded and cancellable export with progress, pixel/memory limits, font policy, resource policy, and empty-selection handling;
- import preview/error summary before replace or insert;
- PDF export after hierarchy, assets, and rich-text export are correct.

Safe temporary validation and atomic replacement/import already exist; this phase adds the product workflow and complete renderer coverage.

### 7.5 Canvas rich text

Extract a separately built `@durgakiran/editor/canvas-text` entry rather than embedding the full document editor. The remaining work includes:

- frozen versioned canvas extension profile and isolated CSS;
- lightweight static renderer and at most one active TipTap/ProseMirror editor per board;
- structured, sanitized, versioned JSON rather than persisted HTML;
- standalone text migration with persisted bounds and `auto`, `fixed-width`, and `fixed` sizing modes;
- marks for bold, italic, underline, strike, inline code, safe links, text color, highlight, and paragraph alignment;
- deterministic plain-text projection for search, AI, accessibility, clipboard, and downgrade rendering;
- schema-aware SVG/PNG/PDF text-run export;
- lazy loading, peer singleton compatibility, and bundle-size checks;
- explicit last-commit-wins disclosure or feature gating until character-level collaboration ships.

The completed plain-text edit-session controller remains the lifecycle and narrow-patch foundation. Rich-text model, rendering, formatting, sizing, export, and collaborative spans are still pending.

### 7.6 Connectors

The correctness plan delivered one safe route-relative plain-text arrow label. Remaining connector work is:

- multiple labels where product requirements call for them;
- label background and offset controls;
- open/filled arrow, circle, diamond, bar, and none endpoint styles;
- manually editable orthogonal waypoints;
- add/remove waypoint commands;
- explicit manual versus automatic routing mode.

### 7.7 Exit criteria

- Active-page filtering is consistent across render, hit test, search, export, and collaboration.
- JSON round-trip is lossless and failed import leaves the board unchanged.
- Export appearance and order match the canvas for hierarchy, assets, labels, and rich text.
- Static rich-text shapes mount no editor instance; each board mounts at most one active editor.
- Rich-text edit, cancel, commit, one-step canvas undo, clipboard, accessibility, zoom/rotation, and export pass browser tests.

## 8. Phase 5 - Collaboration Product UX, Roles, Comments, and Versions

The safety plan completed the data-convergence and durability foundation. This phase is product behavior on top of it.

### 8.1 Collaboration and presence UX

- connection, offline, reconnect, incompatibility, quarantine, and conflict status UI;
- remote selection and active tool;
- current label/rich-text edit target;
- collaborator avatars;
- remote viewport and follow-user;
- cleanup and throttling verification through complete product flows.

### 8.2 Roles and capabilities

- map host roles for owner, editor, commenter, and viewer to command capabilities;
- define commenter selection/comment behavior and publish visibility;
- expose clear disabled states and errors while retaining server-side authorization;
- preserve safe downgrade behavior during active gestures and editing.

The command-boundary enforcement mechanism is complete; only product role definition, host mapping, and UX remain.

### 8.3 Comments

Use host-owned first-class comment threads anchored to a page point or shape ID. Support mentions, resolve/reopen, orphaned anchors, permissions, notifications, and view/publish rules. Do not store comment threads in shape metadata.

### 8.4 Durable version history

Add attributable server revisions with revision/parent IDs, timestamp, author, optional name/description, snapshot or compaction policy, restore permissions, audit/recovery workflow, and restore-as-a-new-revision semantics.

### 8.5 Collaborative rich text

Before claiming simultaneous character-level editing:

- allocate a stable `Y.XmlFragment` per rich-text shape;
- bind the active editor to the board's existing provider;
- define fragment create/delete/copy/duplicate/restore/garbage-collection behavior;
- negotiate rich-text schema compatibility;
- separate text caret awareness from board cursor awareness;
- scope TipTap/Yjs undo while editing and board history outside editing;
- test simultaneous characters and marks, remote delete, offline edit, reconnect, and schema mismatch.

### 8.6 Exit criteria

- Product status accurately reports connected, offline, recovering, incompatible, quarantined, and conflicted states.
- Remote selection, editing presence, viewport, and follow-user clean up without stale awareness.
- Viewer and commenter capabilities match the approved product contract through UI and public APIs.
- Comment and version restore workflows are permission-checked, attributable, and recoverable.
- Rich text converges at character and mark granularity before collaborative editing is advertised.

## 9. Cross-Cutting Platform Work

### 9.1 Accessibility

- semantic toolbar, menu, picker, dialog, and layer-tree roles;
- accessible names, pressed/expanded state, focus order, and roving tab index;
- keyboard navigation for pickers, context menus, canvas objects, layers, and export;
- selection and operation announcements through a live region;
- focus visibility, high contrast, reduced motion, and screen-reader coverage;
- automated axe checks with no serious or critical violations.

Accessibility acceptance belongs in every phase rather than a final cleanup milestone.

### 9.2 Touch and stylus

- single-pointer selection, drawing, and resize;
- two-finger pan and pinch without accidental shape creation;
- long-press context menu;
- responsive toolbar and panels;
- pointer-cancel and lost-capture recovery;
- pressure propagation and palm-rejection policy;
- appropriately sized touch targets.

### 9.3 Reliability and observability

- board-level React error boundary;
- host-facing error, durability, sync, incompatibility, and diagnostic callbacks;
- structured logging without board-content or token leakage;
- corruption, quarantine, conflict, and missing-asset recovery UI;
- instrumentation for mounted shapes, frame time, route time, document size, export resource use, and collaboration bandwidth;
- enforced performance budgets for 2k- and 10k-shape boards and agreed larger stress tiers.

## 10. Phase 6 - Advanced Diagramming and Facilitation

Defer until the general P1 foundation is stable:

- tables and swimlanes;
- UML, BPMN, ERD, and architecture-specific shapes;
- mind maps and org charts;
- auto-layout and auto-layout containers;
- reusable components and symbols;
- data-bound shapes;
- presentation mode and page links;
- timers, voting, clustering, and facilitation workflows;
- richer canvas blocks such as headings, mixed font sizes, task lists, tables, math, or embeds.

## 11. Remaining Product Decisions

| Topic | Decision required | Recommended default |
| --- | --- | --- |
| Group drill-in | One click selects group or enters children? | One click selects group; Enter or double-click enters |
| Frame clipping | Clip overflowing children by default? | Off by default |
| Frame deletion | Delete descendants or preserve them? | Delete subtree; separate Remove Frame preserves children |
| Page priority | Near-term product feature or model-only foundation? | Deliver after hierarchy unless product scope explicitly defers UI |
| Asset libraries | Which vendor/team libraries ship and who can install them? | Start with curated vendor libraries plus team-managed libraries |
| SVG color behavior | Native color, recolorable, or both? | Explicit native-color and themeable-monochrome modes |
| Product limits | Board, asset, library, export, and rich-text limits by tier | Set configurable defaults and tune from benchmark evidence |
| Comments | Creation permissions and publish visibility | Reuse Beskar document-comment policy unless whiteboard needs differ |
| Platform support | Required browser, tablet, and stylus matrix | Define before Phase 2 interaction UI is finalized |
| Rich-text release | Allow shape-level last-commit-wins before collaborative spans? | Gate simultaneous editing clearly; do not imply character-level convergence |

Each decision needs a named product or engineering owner before its dependent phase begins.

## 12. Recommended Next Action

Start Phase 1 with a hierarchy design and migration checkpoint. The first implementation slice should extend the current flat transform/order/index services to nested parent-local records, migrate legacy boards to a default page, and prove geometry-preserving reparenting. Group and frame UI should follow only after those engine invariants pass property and collaboration tests.
