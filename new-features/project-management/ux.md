# Project Management UX

## Goal

Design project management as a native Beskar workspace surface, not a separate tool. The UX should feel like an extension of the existing `Space App` shell from `tededox home page.pen`: calm gray surfaces, muted chrome, strong text hierarchy, and restrained accent usage for focus and selection.

## Source design system

This UX should inherit tokens and shell patterns from `/Users/kiran/projects/beskar/tededox home page.pen`.

### Core shell patterns

- Reuse the existing topbar rhythm from `Primitive/Topbar`.
- Reuse the desktop sidebar anatomy from `Space App`: utility menu, `PAGES` section header, and `Primitive/PageTree` selection treatment.
- Keep the existing split between sidebar, resize rail, and main content.
- Use inline system notices in the style of `Primitive/StatusNotice`.

### Token direction

- Backgrounds: `color.bg.canvas`, `color.bg.surface`, `sidebar.background`
- Text: `color.text.default`, `color.text.subtle`, `color.text.muted`
- Borders: `color.border.default`, `color.border.subtle`, `color.border.selected`
- Brand/accent: `color.brand.primary`, `color.bg.selected`, `state.selected`
- Success/danger: `color.success.*`, `color.danger.*`
- Typography: `font.family.primary`, `font.family.mono`, `font.size.12/13/14/16/18`, `font.weight.medium/semibold/bold`
- Radius: `radius.sm`, `radius.md`, `radius.pill`
- Spacing: `space.4/6/8/10/12/14/16/20`

### Visual rules

- Preserve the Tededox neutral-first palette. Accent should mark active selection, primary actions, and focused states, not decorate every object.
- Favor medium density over airy marketing spacing. This feature is work-tracking, not promotion.
- Keep the main content background on `color.bg.canvas`, with cards, tables, and drawers using `color.bg.surface`.
- Use subtle borders rather than heavy shadows to define regions.

## Product structure

Project management lives inside the existing space shell.

### Primary surfaces

1. Project list view
2. Project board view
3. My work view
4. Ticket detail drawer on desktop
5. Ticket detail full page on mobile and deep-link contexts

### Supporting surfaces

1. New project empty state
2. New ticket flow that mirrors ticket detail structure
3. Filter/sort bar
4. Bulk action bar
5. Create ticket from document flow
6. Comment and activity thread
7. Hierarchy picker and child-ticket list

## Information architecture

### Shell

- Left sidebar stays consistent with the existing space tree.
- Desktop sidebar should match the existing `Space App` pattern: utility menu at top, page-section header, then the page tree itself.
- Projects appear in the same page tree as documents and whiteboards.
- The active project route opens into a project shell inside the main content region.
- Do not introduce a second project-switcher sidebar inside the project surface itself. Project selection belongs to the space/page tree, while the project surface is for project content and views.

### Project shell layout

Desktop:

- Topbar
- Left space/page tree
- Narrow resize rail
- Main project content

Main content stack:

1. Page header
2. View tabs
3. Context toolbar
4. Primary view body

### Page header

- Project name
- Optional short description
- Copyable project key
- Primary action: `Add`
- Secondary actions: `Filter`, `Sort`, `View options`, `Export`

### View tabs

- `List`
- `Board`
- `My work`

The tabs should feel like a lightweight settings-style segmented group, using the same visual language as the existing settings tabs in `Space App · Settings`.

## Screen definitions

### 1. Project list view

Purpose:

- Fast planning, triage, and bulk editing.

Structure:

- Header with project identity and actions
- Filter/sort bar
- Dense ticket table
- Optional bulk action bar when rows are selected

Default columns:

- Ticket
- Status
- Priority
- Owner

Cell behavior:

- Ticket cell shows identifier above or beside title
- Ticket cell should carry hierarchy affordances: indentation for children, expand/collapse for parents, and a compact type marker when needed
- Ticket title should clamp at two lines in compact list variants
- Status uses a compact pill
- Priority uses a small icon or color marker instead of text
- Owner uses avatar-only in the default compact list
- Labels, due date, and updated time stay available in filters, sort options, export, and ticket detail rather than the default row scan

List page feature inventory:

- Space shell: topbar, utility menu, `PAGES` header, active project in the page tree, and resize rail
- Header: project name, short description, copyable project key, and primary `Add` action
- View controls: segmented `List` / `Board` / `My work` tabs that stay in the project content area
- Filter/query controls: status, type, assignee, reporter, label, due date, updated-after, parent/root ticket, and full-text search on title/description
- Default list state should keep filter controls in one control bar above the table. Do not add a second active-filter bar unless a later overflow/menu state proves it necessary.
- Sort controls: updated time, created time, due date, priority, and rank
- Dense table: default columns are `Ticket`, `Status`, `Priority`, and `Owner`
- Hierarchy behavior: keep hierarchy inside the `Ticket` column through indenting and tree controls rather than adding dedicated hierarchy columns
- Secondary metadata: labels, due date, and updated time stay out of the default row and appear in filters, exports, and ticket detail
- Inline editing: default list exposes fast edits for status, priority, and owner; less-frequent fields move to ticket detail or future overflow controls
- Selection model: row multi-select with a bulk action bar for common batch updates
- Ticket creation: toolbar `Add` button opens create flow. Default list state should not show an inline quick-create row.
- Share/export: URL-addressable filter state, CSV export in V1, and JSON export shortly after
- Open-detail behavior: row click opens the ticket detail drawer on desktop and the full-page detail route on smaller devices
- Required states: loading skeletons, empty project, filtered empty, optimistic inline save feedback, and archived read-only handling

Label source:

- Labels come from the ticket `labelNames` field defined in [requirements.md](/Users/kiran/projects/beskar/new-features/project-management/requirements.md:84).
- They are project-scoped lightweight tags, normalized server-side, not generated from view state.
- Mock labels in this project-management pass use website-refresh examples such as `launch`, `qa`, `copy`, `pricing`, `legal`, and `quotes`.
- Default list rows intentionally do not render labels; they remain useful for filtering, exports, and ticket detail.

### 2. Project board view

Purpose:

- Fast workflow movement and workload scanning.

Structure:

- Same header and toolbar as list view
- Horizontal status columns
- Column header with status name and count
- Compact cards with the same low-noise metadata philosophy as list view

Card contents:

- Identifier
- Title
- Parent context when the card is a child item
- Priority marker
- Assignee avatar(s)
- Keep due date and other secondary metadata out of the default card unless a later state proves it is necessary

Behavior:

- Drag and drop changes status and rank
- Keyboard alternative supports move between columns and reorder within a column
- Default board should favor actionable leaf tickets. Parent/planning tickets such as epics should remain accessible through filters, search, and detail, without overwhelming the board columns by default.
- The board should never be the only source of truth for ticket detail; clicking opens the drawer

### 3. My work view

Purpose:

- Provide a low-noise personal queue.

Structure:

- Same project shell and compact table/card grammar as list view
- Default filters applied to current user
- Show parent context for child tickets so the user understands where the work belongs
- Keep actions minimal: update status, open ticket, and reprioritize quickly without restoring heavy metadata to the default scan path

### 4. Ticket detail drawer

Purpose:

- Let users inspect and edit a ticket without leaving list or board context.
- This desktop pattern should also support `My work`, where preserving the surrounding queue matters.

Desktop layout:

- Right-side drawer around 420-460px wide
- Ticket identifier and title at the top
- Compact overview block near the top for status, priority, assignee, reporter, labels, and due date
- Hierarchy block near the top or inside the overview for ticket type, parent, and child tickets
- Treat the overview as inline-editable controls, not read-only text
- Use pills, chips, and avatar rows so ownership and state scan quickly
- Do not require a separate `Edit` click before the actual control interaction
- Description
- Links and attachments
- Activity + comments with a lightweight reply composer

Ticket metadata block:

- Status: single-select control
- Type: single-select control
- Priority: single-select control
- Assignee: people picker with avatar-backed value
- Created by / reporter: read-only people field by default in ticket detail
- Parent ticket: ticket picker / relation field
- Labels: tokenized multi-select / add control
- Due date: date picker field
- Assignee and reporter should use avatar-backed treatments where space allows
- Keep links outside the metadata block; show them in their own content section or resources area
- Render links and attachments as a navigable resource list, not as loose text blocks
- Show each attachment as its own list row with file name and type/size metadata; avoid collapsing files into a single summary row like `3 attachments`

### 5. Ticket detail full page

Purpose:

- Support deep links, mobile, and more focused reading/editing.
- On desktop, this is a separate route from the contextual drawer pattern.

Use the same content sections as the drawer, but adapt the hierarchy by device:

- Reuse the same editing grammar as the create route wherever possible: editable title field, input-like metadata controls, and clear left-content/right-metadata grouping
- Desktop: use a full-page workspace with editable title and description on the left, keep links and attachments directly below description, show child tickets below links when present, and place a metadata rail of direct controls on the right
- iPad: keep the same split model, but compress the metadata rail into denser rows where needed and keep links and child tickets under description in the main column
- Mobile: keep a single column, place the editable title above grouped metadata controls, then follow with description, links, child tickets, and a compact comments composer

## Core flows

### Open a project

1. User selects a project from the page tree.
2. Main content opens the project shell.
3. Default view loads with saved or default filters.

### Quick-create a ticket

1. User clicks `Add`.
2. A dedicated create route opens using the same section structure as ticket detail.
3. The create route keeps core metadata, including ticket type and optional parent ticket, visible near the title so a long description does not push operational fields below the fold.
4. On desktop, prefer a two-column create layout: content on the left and a compact metadata rail on the right.
5. On iPad, keep the title and description grouped together and keep the metadata in a parallel rail so users can scan both at once.
6. On mobile, keep title plus core metadata above the description, move lower-signal fields like reporter and labels below, and keep the create action persistently available.
7. Ticket is created immediately into the current view context.
8. User can continue editing in the detail drawer.

### Triage from list view

1. User scans rows.
2. Inline edits status, priority, assignee, labels, or due date.
3. Multi-select reveals a bulk action bar.
4. Success is acknowledged inline, not through heavy modal interruption.

### Move work in board view

1. User drags or keyboard-moves a card.
2. Card lands in a new column or rank slot.
3. State updates immediately.
4. If the move fails, the card returns and an inline notice appears.

### Work inside ticket detail

1. User opens a ticket from list, board, or my work.
2. On desktop, the default open behavior can preserve context in a drawer; users can also navigate to a full ticket page.
3. Ticket detail exposes overview metadata, description, links, attachments, and comments/activity.
4. Ticket detail also exposes hierarchy context: type, parent ticket, and child tickets when present.
5. Users edit status, type, parent, priority, assignee, labels, due date, description, and comments inline.
6. Changes save inline and add to activity history.
7. Mention, comment, and attachment UX should work even before notifications are implemented.

### Create from document

1. User starts from a document context.
2. `Create ticket` opens a compact composer.
3. The originating document is prelinked.
4. After create, user can jump into the project or stay in the document.

## States

Every primary screen needs these states:

### Loading

- Use skeleton rows/cards rather than blank surfaces.
- Preserve structure during load so filters and columns do not jump.

### Empty project

- Friendly but product-focused empty state.
- Explain what a project is for.
- Primary action: `Create first ticket`
- Secondary hint: create from a document later

### Empty filtered result

- Keep the table or board shell visible.
- State should read as “no results for current filters,” not “no tickets exist.”
- Include `Clear filters`.

### Error

- Inline system notice in the `Primitive/StatusNotice` style.
- Keep the surrounding shell intact.

### Permission/restriction

- Show the project identity but replace the main region with a restricted-access state if needed.

### Archived

- Archived projects/tickets should appear read-only with a clear banner or notice.

### Save feedback

- Inline optimistic updates where safe.
- For failures, preserve user context and explain the failed field or action.

## Responsive behavior

### Device coverage rule

Every screen we actively design must have corresponding desktop, iPad, and mobile variants in the Pencil workspace.

Rules:

- Do not advance a screen to a polished state on desktop only.
- Each new primary surface should be represented as a device trio:
  - desktop
  - iPad
  - mobile
- The variants do not need equal fidelity in the first pass, but they must exist together so hierarchy and interaction tradeoffs are solved early.
- When a desktop pattern does not fit smaller breakpoints, adapt the structure rather than shrinking it mechanically.

### Desktop

- Sidebar visible
- List and board as full primary surfaces
- Ticket opens in a right drawer

### Tablet

- Sidebar may collapse behind a toggle
- Board can reduce card density
- Detail drawer can become a wider sheet

### Mobile

- Single-column shell
- View switcher remains accessible at top
- List is cardified or reduced to essential columns
- Board becomes vertically stacked sections or simplified grouped lists
- Ticket detail becomes a full page, not a drawer

## Initial design deliverables

The first design pass in Pencil should cover:

1. Project list view: desktop, iPad, mobile
2. Project board view: desktop, iPad, mobile
3. Ticket detail drawer: desktop
4. Ticket detail page: desktop, iPad, mobile
5. Empty project state: desktop, iPad, mobile

## Pen file plan

Create a dedicated project-management working file that starts from the Tededox base so we retain:

- light/dark variables
- topbar and sidebar primitives
- status notice primitive
- spacing, typography, and border tokens

The first frames in that file should be:

1. `Project Management · List · Desktop`
2. `Project Management · List · iPad`
3. `Project Management · List · Mobile`
4. `Project Management · Board · Desktop`
5. `Project Management · Board · iPad`
6. `Project Management · Board · Mobile`
7. `Project Management · Ticket Detail Drawer · Desktop`
8. `Project Management · Ticket Detail Page · Desktop`
9. `Project Management · Ticket Detail Page · iPad`
10. `Project Management · Ticket Detail Page · Mobile`
11. `Project Management · Empty State · Desktop`
12. `Project Management · Empty State · iPad`
13. `Project Management · Empty State · Mobile`
14. `Project Management · UX Map`
