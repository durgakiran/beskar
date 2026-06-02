# Specification: Project Management

## Product requirement

Beskar needs a lightweight project and ticket management feature that feels native to the existing product rather than a bolted-on clone of Jira, Linear, or Trello. The feature should help teams plan work, track execution, and connect tickets to Beskar documents and whiteboards without introducing heavy process or a large configuration surface.

The primary design goal is **strong compatibility with AI agents**. Agents should be able to reliably read project state, create or update tickets, move work through well-defined transitions, and attach context from Beskar pages through stable APIs and predictable schemas. Humans should still get a clean UI, but the system must avoid hidden workflow state, ambiguous field semantics, and UI-only logic that agents cannot reason about.

## Core principles

- **Lightweight by default**: V1 should support projects, tickets, lightweight ticket hierarchy, assignments, priorities, statuses, labels, due dates, and comments/activity. Do not build sprints, story points, custom workflow builders, or complex dependency graphs in the first version.
- **Beskar-native**: Projects live inside spaces and should behave like other Beskar resources. Tickets should link naturally to documents, whiteboards, attachments, comments, mentions, and activity history.
- **Notification-compatible**: The ticket domain should expose stable activity and event data so Beskar can later plug project updates into broader notification and integration systems without reworking ticket state. V1 does not require project-specific outbound delivery to Slack, Google Chat, Gmail, GitHub, or other channels.
- **Agent-friendly**: Every important object needs a stable ID, machine-readable state, deterministic mutation rules, and bulk-friendly APIs. Agents must not be forced to scrape HTML or infer business state from presentation.
- **Low-friction collaboration**: Humans should be able to create and update tickets quickly from list and board views, while agents should be able to operate through direct JSON APIs with idempotent writes.
- **No shadow system**: Ticket permissions, auditability, and navigation should reuse Beskar patterns where possible rather than inventing a separate admin model.

## V1 feature shape

Introduce a new top-level page type: `project`.

A project is a navigable Beskar page inside a space. It owns:

- project metadata
- project views
- tickets
- ticket hierarchy
- ticket activity
- linked Beskar resources

Each project should support these V1 views:

- **List view**: spreadsheet-like backlog and planning view
- **Board view**: status-column workflow view
- **My work view**: filtered list for the current user
- **Ticket detail view**: full-screen page or right-side panel with complete ticket context

Timeline, sprint, workload, and reporting dashboards are explicitly deferred.

## Information architecture

### 1. Project

A project is both:

- a `core.page` record with `type = 'project'`
- a structured project record with project-specific metadata

This keeps the feature aligned with Beskar's existing space/page tree, routing, permissions, and sidebar model.

Suggested project fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Canonical project id |
| `pageId` | bigint | Back-reference to `core.page` |
| `spaceId` | UUID | Parent space |
| `key` | string | Short unique key such as `OPS`, `WEB`, `MKT` |
| `name` | string | Human display name |
| `description` | markdown text | Lightweight overview |
| `defaultView` | enum | `list` or `board` |
| `statusScheme` | enum | V1 fixed scheme, not user-configurable |
| `createdBy` | UUID | Creator |
| `createdAt` / `updatedAt` | timestamps | Audit fields |
| `archivedAt` | timestamp nullable | Soft archive |

### 2. Ticket

Tickets are structured records inside a project, not free-form documents pretending to be tasks.

Suggested ticket fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Canonical stable id |
| `projectId` | UUID | Parent project |
| `number` | integer | Monotonic per-project sequence |
| `identifier` | string | Derived display key such as `OPS-42` |
| `type` | enum | Fixed V1 ticket types such as `epic`, `story`, `task`, `subtask`, `bug` |
| `title` | string | Required, short summary |
| `description` | markdown text | Rich text, but stored as predictable markdown or JSON document |
| `status` | enum | Fixed V1 states |
| `priority` | enum | `none`, `low`, `medium`, `high`, `urgent` |
| `assigneeIds` | UUID[] | Multiple assignees allowed in schema; UI may choose single-assignee first |
| `reporterId` | UUID | Creator / owner of request |
| `labelNames` | string[] | Lightweight tags, normalized server-side |
| `dueAt` | timestamp nullable | Optional due date |
| `startedAt` | timestamp nullable | Set when work begins |
| `completedAt` | timestamp nullable | Set when done |
| `linkedPageId` | bigint nullable | Optional Beskar document page |
| `linkedWhiteboardId` | bigint nullable | Optional Beskar whiteboard page |
| `parentTicketId` | UUID nullable | Optional parent ticket inside the same project |
| `rootTicketId` | UUID nullable | Top-level ancestor for fast tree queries; nullable for root tickets |
| `depth` | smallint | Hierarchy depth for list/tree rendering and validation |
| `rank` | numeric/string sortable token | Stable ordering in backlog and board |
| `createdBy` / `updatedBy` | UUID | Audit |
| `createdAt` / `updatedAt` | timestamps | Audit |
| `archivedAt` | timestamp nullable | Soft delete / archive |

### 3. Ticket hierarchy model

V1 should support a lightweight, explicit ticket hierarchy inside a project. This should be strong enough for planning large work items without turning Beskar into a full Jira clone.

Suggested fixed V1 ticket types:

- `epic`
- `story`
- `task`
- `subtask`
- `bug`

Suggested hierarchy rules:

- `epic` is a parent/planning item and cannot itself be a subtask.
- `story`, `task`, and `bug` can exist top-level or under an `epic`.
- `subtask` must have a parent ticket and cannot have children.
- Parent and child tickets must belong to the same project.
- The system must reject cycles and invalid parent/child type combinations.
- Reparenting is allowed for authorized users and agents, but every hierarchy change must be captured in activity.

V1 hierarchy behavior should stay intentionally simple:

- parent status rollups are informational only in V1
- completing all children must not automatically close the parent
- board/list ordering should remain deterministic within each sibling set
- cross-project hierarchy is explicitly out of scope

### 4. Ticket status model

V1 should use a fixed, explicit workflow:

- `backlog`
- `todo`
- `in_progress`
- `in_review`
- `done`
- `canceled`

Rules:

- Tickets can move between any active states, but every transition must be captured in activity.
- `done` sets `completedAt` if empty.
- Leaving `done` clears `completedAt`.
- `in_progress` may set `startedAt` if empty.
- `canceled` is terminal in UI but still reversible by authorized users.

This fixed scheme is more compatible with AI agents than user-defined statuses in V1 because agents can reason about stable semantics without workspace-specific prompts.

## Beskar integration

### Page tree and navigation

- Projects appear in the same space navigation model as documents and whiteboards.
- Sidebar should support a project icon and route into the project's default view.
- Projects can be nested in the page tree if Beskar wants hierarchy parity with documents.
- Ticket hierarchy stays entirely inside a single project; there is no cross-project parent/child relationship in V1.

### Documents and whiteboards

- Each ticket may include a generic links list containing Beskar pages and external URLs.
- Beskar page links can point to documents, whiteboards, or other useful space resources.
- Links pasted into the ticket description should be detected and normalized automatically where possible.
- Users and agents should still be able to manage related links explicitly after the ticket exists.

### Comments, mentions, and notifications

- Tickets need a chronological comment thread separate from inline document comments.
- Ticket comments should support `@mentions`.
- Project activity and comment history should be visible inside the project UI without depending on the broader notifications system.
- If project activity is later connected to Beskar notifications, payloads must include project id, ticket id, and ticket identifier for reliable deep-linking.
- Mention-triggered notifications, due-date reminders, and external channel delivery are follow-up work after the notification platform expands beyond its current scope.

### Attachments

- Tickets should support file attachments using the same storage and authorization model Beskar is already defining for generic file attachments.
- Attachments belong to the ticket, not only to a linked document.

## AI agent compatibility requirements

This is the most important non-negotiable part of the feature.

### Stable machine contract

- Every project and ticket must expose both internal IDs and human-friendly keys.
- All enums must be explicit and documented.
- Ticket payloads must expose hierarchy fields directly: `type`, `parentTicketId`, `rootTicketId`, and `depth`.
- Server responses must include canonical field names and avoid UI-derived ambiguity.
- Mutation responses must return the full updated object or a clearly versioned delta.

### Deterministic mutations

- Support idempotency keys for create and update operations initiated by agents.
- Support bulk create and bulk update endpoints for common agent workflows.
- Support optimistic concurrency through `updatedAt`, `version`, or equivalent revision fields.
- Reject invalid transitions with structured errors, not human-only strings.

### Filterable read APIs

Agents should be able to query tickets without scraping views. V1 API support should include:

- filter by status
- filter by type
- filter by assignee
- filter by reporter
- filter by label
- filter by due date
- filter by updated-after timestamp
- filter by parent ticket
- filter by root/ancestor ticket
- full-text search on title and description
- sort by updated time, created time, due date, priority, and rank

### Activity and audit

- Every material change should generate an activity event with actor, timestamp, field changed, old value, and new value.
- Activity types should be machine-readable, for example `ticket.created`, `ticket.status_changed`, `ticket.assignees_changed`, `ticket.comment_added`.
- Agents should be able to fetch activity incrementally using cursor or timestamp pagination.

### Plain-text and markdown friendliness

- Ticket descriptions and comments should round-trip cleanly through markdown or a documented structured rich-text format.
- Avoid storing critical meaning only in styling, drag position, or client-local state.
- Copy/paste and export should produce clean text that other agents or systems can parse.

## Technical approach

### Backend model

Suggested schema layout:

- `core.page` adds `type = 'project'`
- new schema/package for project management, for example `project` or `projects`
- `project.projects`
- `project.tickets`
- `project.ticket_comments`
- `project.ticket_activity`
- `project.ticket_assignees`
- `project.ticket_links`
- `project.ticket_attachments`

Hierarchy should be modeled directly in `project.tickets` through `type`, `parent_ticket_id`, `root_ticket_id`, and `depth` fields rather than introducing a heavy workflow/configuration subsystem in V1.

This feature should follow the existing server pattern used elsewhere in Beskar:

- one server package for the domain
- clear `types.go`, `queries.go`, `service.go`, `controller.go`, validation, and router files
- space-scoped routes
- permission checks through existing auth and Permify patterns

### Activity and future notification architecture

Project management V1 should persist structured project activity and may expose project-scoped event feeds for live UI refresh or agent consumers. It should not send Slack messages, emails, or chat posts directly from ticket handlers, and it should not depend on new project-specific notification channels to ship V1.

Suggested V1 event flow:

```text
ticket/project mutation
  -> ticket activity record
  -> optional project event feed
  -> project UI / agent consumers
```

Suggested event families:

- `project.created`
- `project.updated`
- `ticket.created`
- `ticket.updated`
- `ticket.status_changed`
- `ticket.parent_changed`
- `ticket.assigned`
- `ticket.unassigned`
- `ticket.comment_added`

Each emitted event should include:

- event id
- event type
- actor
- space id
- project id and project key
- ticket id and ticket identifier when applicable
- canonical URLs back into Beskar
- machine-readable before/after field changes
- compact human summary text for UI and debugging

Activity/event persistence matters for reliability:

- the primary ticket write and activity row commit together
- any page-local event feed is emitted after commit
- failure to notify live subscribers must not rewrite or roll back ticket state
- future notification triggers should be layered on top of the canonical activity/event model rather than embedded in ticket handlers

### Future notification and integration compatibility

Project management should leave room for future notification and integration work, but those capabilities are not required for the initial rollout. External systems do not become the source of truth.

Follow-up integration rules:

- Integrations are **outbound notifications and updates**, not full bidirectional sync.
- Beskar remains the canonical system for project/ticket state.
- Channel adapters render from the same canonical event payload.
- Later channel configuration should be project- or space-scoped rather than hardcoded in ticket logic.
- Later event delivery must be idempotent using a stable event key and per-channel dedupe key.
- Later channel failures must never roll back a ticket update that already succeeded.
- If Beskar later adds GitHub, Slack, Google Chat, Gmail, or other project adapters, they should consume the same canonical event payloads defined here.

### Future notification policy

Not every ticket mutation should become a notification. When project notifications are added later, define a clear event policy matrix rather than notifying on all ticket activity.

Suggested high-value follow-up events:

- ticket assigned to a user
- ticket moved to `in_review`
- ticket moved to `done`
- user mentioned in a ticket comment once mention notifications exist

Default low-value events that should remain project activity only unless configured otherwise:

- label edits
- rank-only reorder events
- typo-only title/description edits
- bulk housekeeping changes

Watcher-driven comment notifications, due-date reminders, and per-channel preference matrices should be designed as part of the notification expansion work rather than the core ticket domain.

### Permission model

V1 should inherit permissions from the parent project page:

- if a user can view the project page, they can read its tickets
- if a user can edit the project page, they can create and update tickets
- delete/archive actions may require the same or slightly stronger permission, but should not invent a separate role system yet

Per-ticket ACLs are out of scope for V1.

### Routing

Suggested URL shape:

- `/space/{spaceId}/project/{pageId}`
- `/space/{spaceId}/project/{pageId}/ticket/{ticketIdentifier}`

Suggested API shape:

- `GET /project/space/{spaceId}/page/{pageId}`
- `GET /project/space/{spaceId}/page/{pageId}/tickets`
- `POST /project/space/{spaceId}/page/{pageId}/tickets`
- `PATCH /project/space/{spaceId}/page/{pageId}/tickets/{ticketId}`
- `POST /project/space/{spaceId}/page/{pageId}/tickets/bulk`
- `GET /project/space/{spaceId}/page/{pageId}/activity`

Exact route naming can be adjusted to match Beskar's current API conventions, but the scoping rules should remain explicit.

## UI design and behavior

### Project list view

- Dense, keyboard-friendly table with compact default columns
- Default list rows should prioritize ticket, status, priority, and assignee avatar over lower-signal metadata
- Inline edit in the default list should focus on status, priority, and assignee; labels and due date can stay in detail or secondary controls
- Multi-select for batch actions
- Persistent filters reflected in URL query params
- Create entry via primary `Add` action

### Project board view

- Columns map directly to the fixed status enum
- Drag-and-drop changes rank and status
- Keyboard alternative to drag-and-drop is required for accessibility and agent parity
- Card density should stay compact; cards are not mini documents

### Ticket detail view

- Title, description, status, assignee, priority, labels, due date
- Activity stream and comments
- Links and related Beskar resources
- Attachment list
- Copyable ticket identifier and deep link
- Inline editing for status, priority, assignee, labels, due date, description, and comments without modal detours
- Prefer direct manipulation over separate `Edit` affordances; editable chips, fields, and composers should open from the control itself
- Ticket detail page should reuse the same field and metadata patterns as the create route, but populated with live values
- Not every metadata control should look like the same dropdown: status/priority are single-selects, assignee is a people picker, due date is a date picker, labels are tokenized multi-selects, and reporter is typically a read-only people field in detail view
- Use avatar-backed people treatments where space allows so ownership is visible at a glance

### Fast capture

V1 should support very fast ticket entry:

- create from project `Add` action
- open a dedicated create route that mirrors ticket-detail sections, with title, status, and assignee first
- visually group the create route around the same ideas as ticket detail without adding extra section-heading noise
- keep status, assignee, reporter, priority, and due date visible before a large description can push them below the fold
- on iPad, keep the ticket body and metadata visible together instead of forcing a long single-column form
- on mobile, surface title plus core metadata first and push lower-signal fields like reporter and labels into a secondary group
- create from a selected document context via "Create ticket"
- optional slash command later, such as `/ticket`

Creating a ticket from a document should prefill a source link automatically.

## Search, export, and interoperability

- Ticket lists should be addressable through URL query params so humans and agents can share exact filtered views.
- Provide CSV export for tickets in V1.
- Provide JSON export for project and ticket data in V1 or very soon after.
- Keep activity/event payloads extensible enough that webhook-style delivery or other adapters can be added later without schema churn.
- Future external integrations should reuse the same canonical event payloads used by project activity APIs.

## Corner cases and edge handling

- Ticket identifiers must remain stable even if the project key changes; define whether old identifiers redirect or are preserved as aliases.
- Archiving a project should not destroy ticket history.
- Deleting or archiving a linked Beskar page must not corrupt the ticket; show the link as unavailable.
- Board ordering must remain stable under concurrent edits.
- Bulk agent updates should support partial-failure reporting per ticket.
- Any future notification generation must be idempotent to avoid duplicate agent-triggered spam.
- If project notifications are added later, channel fan-out must handle partial external failures cleanly.
- If project notifications are added later, users must not receive notifications for tickets they no longer have permission to view unless the event is explicitly a safe access-change notice.

## Out of scope for V1

- Custom status workflows
- Sprints, cycles, or iterations
- Story points and velocity charts
- Advanced dependency graphs
- Gantt or timeline planning
- Per-ticket custom fields
- Automations builder / if-this-then-that rules
- Project-specific in-app notification types before the generic notification feed supports them
- Project-specific email triggers before the notification trigger model expands beyond invites
- Outbound Slack, Google Chat, Gmail, or GitHub project notifications
- Due-date reminder notifications and watcher/subscription rules
- Full bidirectional issue/task sync with GitHub, Jira, Linear, Slack, or Google systems
- Provider-specific workflow automation that changes Beskar ticket state based on arbitrary external events
- Agent-only hidden metadata fields that humans cannot inspect

## Recommended implementation phases

### Phase 1: Core data model and APIs

- add `project` page type
- add project and ticket schema
- implement CRUD, filtering, sorting, ranking, and activity
- expose stable agent-friendly JSON APIs

### Phase 2: Core UI

- add sidebar and page routing support
- build project list view
- build ticket detail view
- support create/edit/archive flows

### Phase 3: Board and collaboration

- add board view
- add comments, mentions, attachments, and project activity UI
- add linked Beskar resources panel

### Phase 4: Live refresh and follow-up hooks

- expose structured project/ticket events for page-local refresh and agent consumers
- keep the activity/event model compatible with future notification triggers
- document the dependency on the broader notification expansion before adding project-specific triggers

### Phase 5: Agent acceleration

- add bulk mutation endpoints
- add idempotency keys and concurrency guards everywhere needed
- add JSON export and richer incremental activity APIs

## Success criteria

The feature is successful when:

- a team can manage day-to-day work in Beskar without needing an external tracker for simple projects
- each ticket can connect cleanly to Beskar docs and whiteboards
- ticket activity is durable, queryable, and visible inside Beskar without relying on UI-only state
- an AI agent can read, create, update, assign, and transition tickets through documented APIs without relying on UI scraping
- the system stays meaningfully simpler than a full enterprise project-management suite
