# Inline Comments Design And Feature Gaps

## Reference Sources

- Design reference: `tededox home page.pen`
  - Desktop read-only comments list: `Comments Panel`, `Inline comments`, `Open`, `Resolved`, thread cards.
  - Desktop read-only thread view: `Thread`, `1 thread · 3 comments`, `All threads`, reply edit/delete actions.
  - Desktop editing page comment thread popover/card states around `Content Page · Editing`.
  - Mobile read-only comments list and thread bottom sheet: `mCm*`, `threadCard`, `Comment thread`.
- Current editor implementation:
  - `packages/editor/src/components/CommentSidePanel.tsx`
  - `packages/editor/src/components/CommentSidePanel.css`
  - `packages/editor/src/types/index.ts`
- Current app/backend implementation:
  - `ui/app/core/http/commentApiHandler.ts`
  - `server/comment/commentService.go`
  - `server/comment/commentController.go`
  - `server/comment/types.go`

## Expected Behavior From Design

The read-only content page still supports comment review actions. "Read-only" means the document body is not editable; it does not mean comment threads are inactive.

The editable content page must support the same comment review actions. "Edit mode" means the document body can be changed; it does not grant comment edit/delete/reply permissions by itself. Comment actions still come from the comment capability contract.

The comments panel has two primary states:

- Thread list: shows `Inline comments`, open/resolved counts, filter pills, and thread summary cards.
- Thread detail: shows one selected thread, the opening comment, the discussion replies, and the reply composer.

Edit pages also have comment-specific surfaces:

- Selection popover: creates a new thread from selected text.
- Gutter markers: open existing threads anchored to document content.
- Floating thread card: shows the selected thread near the anchor while editing.
- Docked side panel: shows all document threads in edit mode.

Thread list cards should show:

- Author avatar, author name, relative time, and anchor context such as `Paragraph 2` or `Callout`.
- Resolve/unresolve, edit, and delete actions when the current user has permission.
- Selected quoted text in a rounded quote chip.
- Opening comment body.
- Reply count and an `Open thread`/`View thread` affordance.

Thread detail should show:

- Header title `Thread`, subtitle like `1 thread · 3 comments`, close button, and `All threads` back chip.
- Opening comment card with resolve/unresolve, edit, and delete actions when permitted.
- Discussion replies with edit and delete actions on each reply when permitted.
- Reply composer when the user can add comments and the thread is open.

Edit-mode thread cards and the docked side panel should follow the same action rules:

- Existing replies can be edited/deleted based on `reply.capabilities`.
- Opening/root comment can be edited based on `thread.capabilities.canEditOpeningReply`.
- Thread resolve/unresolve/delete actions are shown based on thread capabilities.
- Reply composer is shown based on `thread.capabilities.canReply`, not because the editor is editable.
- Draft and published thread visibility rules remain edit-mode-specific: edit pages may show all threads, while read-only pages should show only published-visible threads.

## Permission Model Expected By The UI

The UI should not infer comment actions from `editor.isEditable` alone. It needs explicit capabilities from the backend or an equivalent host-provided permission callback.

Expected thread capabilities:

- `canResolve`: thread creator or user with page edit permission.
- `canUnresolve`: thread creator or user with page edit permission.
- `canDeleteThread`: thread creator or user with page delete permission.
- `canEditOpeningReply`: opening reply author and user still has add-comment permission.
- `canReply`: user has add-comment permission and the thread is not resolved.

Expected reply capabilities:

- `canEditReply`: reply author and user still has add-comment permission.
- `canDeleteReply`: reply author with add-comment permission, or user has the approved admin/moderator capability.

The backend already mostly enforces these rules:

- `EditReply`: requires `PAGE_ADD_COMMENT` and reply author ownership.
- `DeleteReply`: currently requires `PAGE_ADD_COMMENT`, then allows reply author or `PAGE_DELETE`; this must change because page deleters should not automatically delete replies.
- `ResolveThread`/`UnresolveThread`: allows thread creator or `PAGE_EDIT`.
- `DeleteThread`: allows thread creator or `PAGE_DELETE`.
- `CreateReply`: requires `PAGE_ADD_COMMENT`.

The gap is that the frontend does not receive these decisions, so it cannot reliably show or hide controls before the user clicks them.

## Permission Matrix

Assumptions:

- `Owner` means the user authored the specific thread or reply.
- `Commenter` means the user has `PAGE_ADD_COMMENT`.
- `Editor` means the user has `PAGE_EDIT`.
- `Page Deleter` means the user has `PAGE_DELETE`.
- `Admin/Moderator` means the user has the product-approved admin capability for comment moderation. This must be distinct from `PAGE_DELETE`.
- Thread owner permissions apply to thread-level resolve/unresolve/delete.
- Reply owner permissions apply to the specific opening reply or follow-up reply.

| Scenario | View Threads | Create Thread | Reply | Edit Own Reply | Edit Other Reply | Delete Own Reply | Delete Other Reply | Resolve Own Thread | Resolve Other Thread | Delete Own Thread | Delete Other Thread |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Viewer only | Yes | No | No | No | No | No | No | No | No | No | No |
| Commenter, not owner | Yes | Yes | Yes | Yes, for replies they authored | No | Yes, for replies they authored | No | No | No | No | No |
| Thread owner with comment permission | Yes | Yes | Yes | Yes, for replies they authored | No | Yes, for replies they authored | No | Yes | Yes, own thread only | Yes | No |
| Reply owner with comment permission | Yes | Yes | Yes | Yes | No | Yes | No | Only if also thread owner | No | Only if also thread owner | No |
| Page editor with comment permission | Yes | Yes | Yes | Yes, for replies they authored | No | Yes, for replies they authored | No | Yes | Yes | Yes, own thread only | No |
| Page deleter with comment permission | Yes | Yes | Yes | Yes, for replies they authored | No | Yes, for replies they authored | No | Yes, if also editor or thread owner | Yes, if also editor | Yes | Yes |
| Page deleter without comment permission | Yes | No | No | No | No | No | No | Yes, if also editor or thread owner | Yes, if also editor | Yes | Yes |
| Admin/moderator with comment permission | Yes | Yes | Yes | Yes, for replies they authored | No | Yes | Yes | Yes, if also editor or thread owner | Yes, if also editor | Yes, if thread owner or page deleter | Yes, if also page deleter |
| Admin/moderator without comment permission | Yes | No | No | No | No | Yes, moderator delete only | Yes, moderator delete only | Yes, if also editor or thread owner | Yes, if also editor | Yes, if thread owner or page deleter | Yes, if also page deleter |
| Deleted user author | Yes | No | No | No | No | No | Depends on admin/moderator permission | No | Depends on editor permission | No | Depends on page delete permission |
| Resolved thread | Yes | No new replies | No | Yes, if reply edit permission is retained | No | Yes, if reply delete permission is retained | Yes, if admin/moderator | Unresolve if permitted | Unresolve if permitted | Yes, if permitted | Yes, if permitted |
| Orphaned thread | Yes | No new anchor action | Needs product decision | Needs product decision | No | Needs product decision | Needs product decision | No | No | Yes, if permitted | Yes, if permitted |

Implementation note: the current backend allows `PAGE_DELETE` to delete other users' replies after first requiring `PAGE_ADD_COMMENT`. This must be changed. Page deleters can delete threads/pages, but only admins/moderators can delete other users' replies.

UI capability fields should map to the matrix rather than re-evaluating role names:

| Capability | Should Be True When |
| --- | --- |
| `thread.capabilities.canResolve` | Thread is open and user is thread owner or has `PAGE_EDIT`. |
| `thread.capabilities.canUnresolve` | Thread is resolved and user is thread owner or has `PAGE_EDIT`. |
| `thread.capabilities.canDeleteThread` | User is thread owner or has `PAGE_DELETE`. |
| `thread.capabilities.canReply` | Thread is open and user has `PAGE_ADD_COMMENT`. |
| `thread.capabilities.canEditOpeningReply` | Opening reply exists, user authored it, and user has `PAGE_ADD_COMMENT`. |
| `thread.capabilities.canDeleteOpeningReply` | User authored opening reply and has `PAGE_ADD_COMMENT`, or user has admin/moderator reply-delete capability. |
| `reply.capabilities.canEditReply` | User authored the reply and has `PAGE_ADD_COMMENT`. |
| `reply.capabilities.canDeleteReply` | User authored the reply and has `PAGE_ADD_COMMENT`, or user has admin/moderator reply-delete capability. |

## Current Functional Gaps

1. Reply edit/delete is missing in read-only thread detail.
   - `ThreadDetail` passes `readonlyMode={!isEditable}` into `ReplyItem`.
   - `ReplyItem` hides edit/delete when `readonlyMode` is true.
   - Result: on read-only content pages, opening a thread hides reply edit/delete even when the backend would allow the current user to edit or delete the reply.

2. Reply edit/delete visibility is not permission-aware.
   - `ReplyItem` currently checks only `!readonlyMode && reply.authorId`.
   - It does not know the current user id.
   - It does not know whether the backend would allow delete via admin/moderator permission.
   - Result: actions can be hidden from authorized users or shown too broadly in editable contexts.

3. Opening/root comment edit is only partially implemented.
   - The list card can edit the opening reply when one exists.
   - The thread detail opening card still lacks inline edit behavior.
   - The design shows edit/delete actions on the opening comment in both list and detail states.

4. Thread delete and opening edit/delete actions are not capability gated.
   - Delete thread is always rendered in several places.
   - Opening edit currently checks only that an opening reply exists and the thread is not orphaned.
   - Result: users may see actions that fail with `403`.

5. Reply composer is not capability gated.
   - It is shown when the thread is not resolved.
   - It should also require `canReply`.
   - Result: users with view access but no comment permission may see a composer that fails.

6. Resolved/orphaned state handling is incomplete.
   - Resolved threads should disable reply composer and show unresolve only when permitted.
   - Orphaned threads should not offer anchor-dependent actions.
   - The UI should define whether edit/delete remains available for orphaned comments.

7. Error handling is mostly console-only.
   - Resolve/delete/edit failures are logged but not surfaced in the panel.
   - Permission failures should produce a small inline message or toast and refresh thread state if capabilities changed.

8. Backend responses do not expose comment action capabilities.
   - `CommentThread` and `CommentReply` types contain authors and timestamps, but no `permissions`/`capabilities`.
   - The editor package cannot make correct button decisions without duplicating backend authorization logic.

9. Auth headers are inconsistent in comment API calls.
   - Some `fetch` calls send `Authorization`; some delete calls rely only on cookies.
   - This is not directly a design gap, but it can create inconsistent behavior across environments.

10. Edit-page floating thread card is not capability-aware.
    - `CommentThreadCard` shows reply edit/delete when `reply.authorId` exists.
    - It shows opening edit, resolve/unresolve, delete thread, and reply composer based on local thread state such as resolved/orphaned, not capabilities.
    - Result: edit pages can show actions that the backend rejects, and can hide moderator actions that should be available.

11. Edit-page docked side panel does not have thread-detail parity.
    - In edit mode, `CommentSidePanel` renders list cards and active cards inline.
    - The selected full thread-detail state is only used when `!isEditable`.
    - Result: edit pages do not get the same detail layout/action behavior as read-only pages, even though the product should support the same comment review actions.

12. Comment action logic is duplicated across components.
    - `CommentSidePanel` and `CommentThreadCard` each implement reply editing, deleting, resolving, composer visibility, and opening-comment edit paths.
    - Without shared capability helpers and action components, read-only and edit pages can drift.

## Current Design Gaps

1. Desktop panel width and spacing should match the design state.
   - Design thread/list panel is about 380px wide.
   - Header padding is compact, close button is 32px, and action buttons are 24-28px depending on context.

2. Thread list footer is not aligned with design.
   - Design shows reply count on the left and `Open thread` on the right.
   - Current UI uses a full-width `View thread` button.

3. Thread list metadata is incomplete.
   - Design shows anchor context such as `Paragraph 2`, `Callout`, or `Code block`.
   - Current data model has `blockId` but no user-facing block label or paragraph label.

4. Thread detail header layout differs from design.
   - Design uses title/subtitle on the left, 32px close button on the right, and a separate `All threads` chip below.
   - Current header places back and close together in the header action row.

5. Thread detail opening card is missing edit mode styling.
   - Needs the same compact inline editor behavior as replies: textarea, attachment pills, attach, cancel, save.

6. Reply rows should match the design.
   - Reply action buttons are 24px circular icon buttons.
   - Reply avatars are smaller than opening-comment avatars.
   - Reply rows have a discussion rail/dot and compact dividers.

7. Mobile bottom-sheet states need parity.
   - Mobile list shows open/resolved count badges and `Open thread` labels.
   - Mobile thread detail has a compact bottom-sheet card state with selected text, conversation, and composer.
   - Reply edit/delete must remain reachable on mobile without causing horizontal overflow.

8. Edit-page popover/card states need parity.
   - The floating thread card should use the same compact action button sizing, reply row structure, and opening-comment edit states as the side panel where practical.
   - The edit-page docked panel can keep an editor-focused layout, but action visibility and reply behavior must match the capability matrix.

## Recommended Implementation Plan

1. Add explicit capabilities to the comment API contract.
   - Add `capabilities` to `CommentThread`.
   - Add `capabilities` to `CommentReply`.
   - Populate them in backend list/create/update responses using the same rules already enforced by service methods.

2. Update editor package types and UI guards.
   - Replace `readonlyMode` and `reply.authorId` checks for actions with capability checks.
   - Keep `editor.isEditable` only for document editing behavior, not comment review permissions.

3. Finish thread-detail actions.
   - Add edit opening reply in `ThreadDetail`.
   - Add permission-aware edit/delete for each follow-up reply.
   - Add permission-aware thread resolve/unresolve/delete.
   - Add permission-aware reply composer.
   - Apply the same capability checks to edit-page `CommentThreadCard` and edit-mode `CommentSidePanel` cards.

4. Normalize error handling.
   - Surface inline errors for failed edit/delete/resolve/reply actions.
   - Refresh or re-fetch threads after `403` so stale capabilities do not leave dead buttons on screen.

5. Bring list/detail visuals back to the Pen.
   - Update desktop panel width, header layout, close button size, action button size, card footer, and reply rows.
   - Update mobile bottom-sheet list/detail variants and verify no horizontal overflow.

6. Add tests/verification.
   - Editor package tests or story fixtures for author, non-author commenter, page editor, page deleter, admin/moderator, and viewer-only.
   - UI verification for desktop and mobile thread list/detail states in read-only mode.
   - UI verification for edit-page selection popover, gutter-opened thread card, and docked side panel.
   - Backend tests for capability payloads matching service enforcement.

## Acceptance Criteria

- A user who authored a reply can edit and delete that reply from the opened thread on read-only content pages.
- An admin/moderator can delete any reply from the opened thread.
- A user with page delete permission can delete threads, but cannot delete other users' replies unless they also have admin/moderator permission.
- A viewer without comment permissions cannot see reply composer, edit, or delete controls.
- A user who can resolve/unresolve sees only the correct resolve state action.
- Opening/root comment edit works in both list and thread detail states.
- Opening/root comment edit works in edit-page floating thread cards and docked side panel cards.
- Edit pages and read-only pages expose the same comment actions for the same user/thread/reply capability payload.
- Buttons shown in the UI should not fail with `403` under normal fresh data.
- Desktop and mobile comment panels match the Pen layout closely enough for width, button size, header structure, thread list footer, and reply row actions.
