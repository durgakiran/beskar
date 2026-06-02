# Story Breakdown: Project Management V1

This document turns the project-management requirements into an implementable story map. It covers the full V1 feature, not only ticket hierarchy.

Source documents:

- [requirements.md](/Users/kiran/projects/beskar/new-features/project-management/requirements.md)
- [architecture.md](/Users/kiran/projects/beskar/new-features/project-management/architecture.md)
- [ux.md](/Users/kiran/projects/beskar/new-features/project-management/ux.md)

## V1 framing

V1 should deliver:

- project pages inside Beskar spaces
- tickets with status, priority, assignee, reporter, labels, due date, links, attachments, and comments
- lightweight hierarchy with fixed ticket types
- list, board, my-work, create, and detail flows
- project activity and page-local live refresh
- stable agent-friendly APIs with idempotent writes and filterable reads

V1 should not depend on:

- custom workflows
- sprints or story points
- external notification delivery
- advanced dependency graphs
- automation builders

## Story Map

### Epic A: Scope, identity, and foundations

#### PM-01: Lock the V1 scope and notification boundary

As the product team, we need a clear V1 boundary so implementation does not depend on unfinished notification or workflow systems.

Acceptance criteria:

- V1 explicitly uses project activity and page-local events only
- V1 does not require Slack, email, chat, or provider-specific outbound delivery
- V1 does not require custom workflows, custom fields, or sprint systems

Dependencies:

- none

#### PM-02: Finalize project key and ticket identifier contract

As the system, we need stable human-readable ticket identifiers so users, agents, and deep links can reference tickets safely.

Acceptance criteria:

- each project has a stable key contract
- each ticket has a stable identifier format
- identifier behavior is defined if a project key changes
- API and UI routes use the same canonical identifier rules

Dependencies:

- none

#### PM-03: Add `project` as a native Beskar page type

As a user, I need project management to live inside the same space/page system as documents and whiteboards.

Acceptance criteria:

- `project` exists as a page type
- projects appear in space navigation
- projects can be opened through the existing page-routing model
- project archive behavior preserves ticket history

Dependencies:

- `PM-01`
- `PM-02`

#### PM-04: Define permission and archive rules for projects and tickets

As the system, I need clear authorization rules so project data is visible and editable only to allowed users and agents.

Acceptance criteria:

- project read/write/archive permissions are defined
- ticket mutations inherit or extend the project permission model consistently
- archived projects and archived tickets remain readable according to policy
- unauthorized mutations return structured errors

Dependencies:

- `PM-03`

### Epic B: Ticket domain model

#### PM-05: Persist the core ticket schema

As the system, I need a structured ticket model so tickets can be queried and mutated without UI-specific logic.

Acceptance criteria:

- tickets store title, description, status, priority, due date, assignee, reporter, labels, rank, and audit fields
- projects own tickets directly
- soft-delete and archive fields are supported where required
- canonical enums and field names are documented

Dependencies:

- `PM-02`

#### PM-06: Implement the fixed status and priority model

As a user or agent, I need stable workflow semantics so ticket state can be reasoned about without workspace-specific prompts.

Acceptance criteria:

- fixed status set is implemented
- transition side effects such as `completedAt` and `startedAt` are defined
- priority values are explicit and documented
- invalid transitions return structured errors

Dependencies:

- `PM-05`

#### PM-07: Implement ticket hierarchy

As a user or agent, I need explicit parent/child relationships so large work can be decomposed without ambiguity.

Acceptance criteria:

- fixed ticket types are implemented
- `parentTicketId`, `rootTicketId`, and `depth` are persisted
- invalid hierarchy combinations are rejected
- cycles and cross-project parenting are rejected

Dependencies:

- `PM-05`

#### PM-08: Implement deterministic ranking and sibling ordering

As a user, I need ticket ordering to remain stable across list and board views, even under concurrent updates.

Acceptance criteria:

- tickets have a stable rank token
- sibling ordering remains deterministic after move or reparent
- board reorder and backlog reorder use the same canonical ordering logic

Dependencies:

- `PM-05`
- `PM-07`

#### PM-09: Define the ticket resource model for links and attachments

As the system, I need a consistent content model so tickets can hold related resources without special-case logic.

Acceptance criteria:

- tickets support a generic links list
- tickets support ticket-owned attachments
- links to deleted or archived Beskar pages remain representable as unavailable resources
- description-pasted links can be normalized into the ticket link model

Dependencies:

- `PM-05`

### Epic C: Project and ticket APIs

#### PM-10: Build core project and ticket CRUD APIs

As a client or agent, I need stable APIs to create, read, update, archive, and list projects and tickets.

Acceptance criteria:

- project CRUD endpoints exist for V1 needs
- ticket CRUD endpoints exist for V1 needs
- responses return canonical project and ticket payloads
- routes align with the page and project architecture

Dependencies:

- `PM-03`
- `PM-05`

#### PM-11: Build filterable ticket query APIs

As a user or agent, I need query APIs that match the UI views so I can fetch exact ticket sets without scraping.

Acceptance criteria:

- filtering supports status, type, assignee, reporter, label, due date, updated-after, parent, and root
- full-text search supports title and description
- sorting supports updated time, created time, due date, priority, and rank
- query state is serializable for URL sharing

Dependencies:

- `PM-06`
- `PM-07`
- `PM-08`
- `PM-10`

#### PM-12: Support idempotent, concurrent-safe mutations

As an agent, I need safe write semantics so retries and concurrent changes do not corrupt project state.

Acceptance criteria:

- create and update operations support idempotency keys
- optimistic concurrency is enforced
- bulk create and bulk update are supported
- partial failures are returned per ticket in bulk operations

Dependencies:

- `PM-10`

#### PM-13: Return structured errors and canonical mutation results

As a client or agent, I need machine-readable failures and canonical results so I can recover without heuristics.

Acceptance criteria:

- validation errors identify the exact failing field or rule
- transition and hierarchy errors are structured
- mutation responses return the full updated object or a well-defined delta
- error responses do not rely on human-only strings

Dependencies:

- `PM-10`
- `PM-12`

### Epic D: Activity, events, and live refresh

#### PM-14: Record canonical project and ticket activity

As a user or agent, I need a reliable activity log so every material change can be audited.

Acceptance criteria:

- ticket create, update, comment, status change, hierarchy change, and assignment changes create activity rows
- activity rows include actor, timestamp, old value, and new value where relevant
- activity types are machine-readable

Dependencies:

- `PM-10`

#### PM-15: Build the durable page-event pipeline

As the system, I need durable page-local events so open project views can refresh without coupling event delivery to request handlers.

Acceptance criteria:

- canonical events are persisted as part of the write flow
- event publishing is decoupled from request completion
- consumers can safely resume after failure
- the event model does not require new notification channels

Dependencies:

- `PM-14`

#### PM-16: Support incremental activity and event consumption

As a client or agent consumer, I need cursor- or time-based incremental reads so large projects can refresh efficiently.

Acceptance criteria:

- activity can be fetched incrementally
- page events can be consumed incrementally
- clients can recover from missed events through refetch

Dependencies:

- `PM-14`
- `PM-15`

### Epic E: Project shell and shared UI infrastructure

#### PM-17: Build the core project shell and routing

As a user, I need a consistent project shell so list, board, my-work, create, and detail views feel like one product.

Acceptance criteria:

- project shell fits inside the existing space/page model
- view tabs, header, and routing are consistent across project surfaces
- desktop, iPad, and mobile shells exist

Dependencies:

- `PM-03`
- `PM-11`

#### PM-18: Implement shared UI states and feedback patterns

As a user, I need consistent state handling so the project surfaces behave predictably.

Acceptance criteria:

- loading states exist
- empty-project and empty-filter states exist
- error and permission states exist
- save feedback is inline and lightweight
- archived/read-only states are supported

Dependencies:

- `PM-17`

### Epic F: List view

#### PM-19: Build the compact project list view

As a user, I need a list view that shows the most useful ticket information without unnecessary density.

Acceptance criteria:

- list view includes compact default columns
- top controls include search, filter, sort, view options, and add
- long summaries are handled correctly
- desktop, iPad, and mobile variants exist

Dependencies:

- `PM-11`
- `PM-17`

#### PM-20: Add inline edits, selection, and bulk actions to list view

As a user, I need to triage many tickets quickly from the list view.

Acceptance criteria:

- status, priority, assignee, and other allowed fields are editable inline
- row selection is supported
- bulk action flows exist
- interaction cost is minimized and avoids unnecessary edit buttons

Dependencies:

- `PM-12`
- `PM-19`

#### PM-21: Add hierarchy-aware list rendering

As a user or agent-assisted user, I need hierarchy represented directly in the list so planning and execution work stay connected.

Acceptance criteria:

- hierarchy stays inside the ticket column
- parent rows can expand and collapse
- children are visibly nested under parents
- hierarchy filters such as type, parent, root, and leaf-only are supported

Dependencies:

- `PM-07`
- `PM-11`
- `PM-19`

### Epic G: Board and my-work views

#### PM-22: Build the board view

As a user, I need a board view for workflow-oriented ticket movement.

Acceptance criteria:

- board columns map to canonical statuses
- cards can move between columns
- board state updates optimistically with safe recovery on failure
- desktop, iPad, and mobile variants exist

Dependencies:

- `PM-06`
- `PM-08`
- `PM-17`

#### PM-23: Make the board hierarchy-aware without overloading it

As a user, I need board cards to preserve planning context while staying compact.

Acceptance criteria:

- default board favors actionable leaf tickets
- child cards show compact parent context
- parent/planning tickets remain reachable through filters or search

Dependencies:

- `PM-07`
- `PM-22`

#### PM-24: Build the my-work view

As an assignee, I need a personal queue that keeps enough project context to act quickly.

Acceptance criteria:

- my-work shows assigned work in a compact, scannable format
- parent context is visible where useful
- desktop, iPad, and mobile variants exist

Dependencies:

- `PM-11`
- `PM-17`

### Epic H: Create and detail flows

#### PM-25: Build the create-ticket route

As a user, I need a dedicated ticket-creation flow that keeps key metadata visible while I write the description.

Acceptance criteria:

- create is opened from `Add`
- create flow uses the same editing grammar as ticket detail
- type, parent, status, assignee, reporter, priority, due date, and labels are supported
- desktop, iPad, and mobile variants exist

Dependencies:

- `PM-07`
- `PM-10`
- `PM-17`

#### PM-26: Build the desktop ticket-detail drawer

As a user, I need a contextual ticket detail surface so I can edit a ticket without losing list or board context.

Acceptance criteria:

- desktop list, board, and my-work can open ticket detail in a drawer
- drawer supports direct inline editing
- drawer shows compact hierarchy, links, and discussion context

Dependencies:

- `PM-14`
- `PM-17`
- `PM-25`

#### PM-27: Build the ticket-detail full page

As a user, I need a dedicated ticket page for deeper editing and direct navigation.

Acceptance criteria:

- full-page ticket detail route exists
- title, description, metadata, links, child tickets, and activity are laid out clearly
- desktop, iPad, and mobile variants exist

Dependencies:

- `PM-17`
- `PM-25`
- `PM-26`

#### PM-28: Make detail fields directly updatable in place

As a user, I need to update ticket fields with minimal clicks.

Acceptance criteria:

- status is a dropdown or equivalent direct control
- type, parent ticket, assignee, priority, due date, and labels use the correct control type
- create and detail share a consistent editing grammar
- extra `Edit` buttons are avoided unless they add real value

Dependencies:

- `PM-12`
- `PM-27`

#### PM-29: Show child tickets and support create-child entry points

As a user, I need to see and extend ticket hierarchy from ticket detail.

Acceptance criteria:

- parent tickets show a child-ticket section when applicable
- child rows/cards are actionable
- create-child flows can prepopulate the parent relationship

Dependencies:

- `PM-07`
- `PM-27`
- `PM-28`

### Epic I: Collaboration content

#### PM-30: Build ticket comments and mention-ready discussion

As a user, I need ticket-specific discussion separate from document comments.

Acceptance criteria:

- tickets support chronological comments
- comment composer exists in detail views
- mention syntax is supported in the content model even if notifications are deferred

Dependencies:

- `PM-14`
- `PM-27`

#### PM-31: Build links detection, normalization, and management

As a user, I need related resources to be captured from the description and managed explicitly after create.

Acceptance criteria:

- links pasted into descriptions can be detected and normalized
- internal Beskar pages and external URLs share one links model
- links are shown as actionable rows, not just metadata text

Dependencies:

- `PM-09`
- `PM-27`

#### PM-32: Build ticket attachments

As a user, I need ticket-owned files so relevant assets live with the work item.

Acceptance criteria:

- attachments can be associated with a ticket
- attachments use the existing file authorization model
- attachments appear alongside links in detail views

Dependencies:

- `PM-09`
- `PM-27`

### Epic J: Search, export, and interoperability

#### PM-33: Support URL-stable project views

As a user or agent, I need list state to live in the URL so exact filtered views can be shared and reopened.

Acceptance criteria:

- list filters and sort are encoded in the URL
- shared URLs reopen the same logical view
- hierarchy-related filters survive round-trip

Dependencies:

- `PM-11`
- `PM-19`

#### PM-34: Provide CSV export for V1

As a user, I need to export tickets without losing the active query context.

Acceptance criteria:

- export returns CSV for the current filtered/sorted ticket set
- exported fields include data not always visible in the compact list
- export behavior is defined across desktop and smaller-device overflow patterns

Dependencies:

- `PM-11`
- `PM-33`

#### PM-35: Provide JSON export for agent and system interoperability

As an agent or integrator, I need JSON export of project and ticket data so I can consume Beskar state without scraping views.

Acceptance criteria:

- JSON export returns canonical project and ticket structures
- hierarchy, links, and activity-relevant fields are preserved
- if not shipped in the same release as CSV, it has a defined near-term follow-up plan

Dependencies:

- `PM-10`
- `PM-11`

#### PM-36: Ensure descriptions and comments round-trip cleanly

As a user or agent, I need text content to survive markdown and copy/paste flows without hidden semantics.

Acceptance criteria:

- critical meaning is not stored only in styling or local UI state
- descriptions and comments round-trip through markdown or a documented rich-text format
- copied/exported content remains parseable

Dependencies:

- `PM-30`
- `PM-35`

### Epic K: Agent acceleration and operational safeguards

#### PM-37: Expose child rollups and subtree summaries

As an agent or project lead, I need rollups on parent tickets so progress can be understood without opening every child.

Acceptance criteria:

- parent tickets expose total child count
- parent tickets expose open/done counts and useful status summaries
- rollups are informational only in V1

Dependencies:

- `PM-07`
- `PM-14`

#### PM-38: Add agent-friendly helper workflows

As an agent or agent-assisted user, I need first-class workflows for decomposition and bulk organization.

Acceptance criteria:

- create-child is supported as a first-class flow
- subtree-oriented fetch patterns are supported
- bulk hierarchy changes are supported safely

Dependencies:

- `PM-12`
- `PM-29`
- `PM-37`

#### PM-39: Add failure-mode safeguards and observability

As the system, I need operational safeguards so concurrency, retries, and incremental updates do not degrade project correctness.

Acceptance criteria:

- duplicate retries do not create duplicate tickets
- reorder races and partial failures are detectable and recoverable
- event publish failures are observable and recoverable
- linked-resource deletion does not corrupt ticket history

Dependencies:

- `PM-12`
- `PM-15`

## Recommended delivery order

### Phase 1: Foundations and core model

- `PM-01`
- `PM-02`
- `PM-03`
- `PM-04`
- `PM-05`
- `PM-06`
- `PM-07`
- `PM-08`
- `PM-09`

### Phase 2: Core APIs and activity

- `PM-10`
- `PM-11`
- `PM-12`
- `PM-13`
- `PM-14`
- `PM-15`
- `PM-16`

### Phase 3: Core UI and ticket workflows

- `PM-17`
- `PM-18`
- `PM-19`
- `PM-20`
- `PM-21`
- `PM-22`
- `PM-23`
- `PM-24`
- `PM-25`
- `PM-26`
- `PM-27`
- `PM-28`
- `PM-29`

### Phase 4: Collaboration, export, and polish

- `PM-30`
- `PM-31`
- `PM-32`
- `PM-33`
- `PM-34`
- `PM-35`
- `PM-36`

### Phase 5: Agent acceleration and hardening

- `PM-37`
- `PM-38`
- `PM-39`

## Strong V1 cut

If scope has to be reduced, the strongest V1 cut is:

- `PM-01` through `PM-29`
- `PM-33`
- `PM-34`
- `PM-39`

That ships:

- native projects in the Beskar page tree
- core ticket model and hierarchy
- stable APIs and activity/events
- list, board, my-work, create, and detail flows
- shared query URLs
- CSV export

The first follow-up stories to defer are:

- `PM-35`
- `PM-36`
- `PM-37`
- `PM-38`

unless agent acceleration is more important than export breadth.
