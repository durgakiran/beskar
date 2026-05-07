# Inline Comments Permission-Aware Actions Implementation Plan

## Scope

This plan closes the current feature gap for comment review actions on content pages in both read-only and edit modes:

- Show edit/delete/reply/resolve/unresolve controls only when the current user can perform the action.
- Support editing and deleting replies from the opened thread view.
- Support editing and deleting the opening/root comment from list and thread-detail views.
- Support the same permission-aware actions in edit-page floating thread cards, gutter-opened threads, and docked side panel cards.
- Keep comment bodies as plain text for this phase.
- Keep document read-only state separate from comment review permissions.

Out of scope for this phase:

- Rich text formatting inside comments.
- Mentions inside comments.
- Thread-level moderation dashboards.
- Real-time SSE correctness beyond preserving the current behavior.

Primary reference doc:

- `new-features/inline-comments/design-and-feature-gaps.md`

Primary design reference:

- `tededox home page.pen`

## Target Architecture

The backend remains the source of truth for permissions. The UI should consume action capabilities from API responses and should not recreate authorization logic from roles, ownership, or `editor.isEditable`.

This applies to all comment surfaces:

- Read-only comments side panel.
- Read-only mobile bottom sheet.
- Edit-page docked side panel.
- Edit-page gutter-opened floating thread card.
- Edit-page selection-created thread flow.

Add explicit capability payloads:

```ts
interface CommentThreadCapabilities {
  canResolve: boolean;
  canUnresolve: boolean;
  canDeleteThread: boolean;
  canReply: boolean;
  canEditOpeningReply: boolean;
  canDeleteOpeningReply: boolean;
}

interface CommentReplyCapabilities {
  canEditReply: boolean;
  canDeleteReply: boolean;
}
```

Attach capabilities to existing API models:

```ts
interface CommentThread {
  capabilities?: CommentThreadCapabilities;
}

interface CommentReply {
  capabilities?: CommentReplyCapabilities;
}
```

For backward compatibility, editor UI should treat missing capability fields as `false` for destructive/edit actions and should only preserve existing behavior where needed during transition.

## Backend Implementation

### 1. Extend Response Types

Files:

- `server/comment/types.go`

Add:

```go
type CommentThreadCapabilities struct {
    CanResolve            bool `json:"canResolve"`
    CanUnresolve          bool `json:"canUnresolve"`
    CanDeleteThread       bool `json:"canDeleteThread"`
    CanReply              bool `json:"canReply"`
    CanEditOpeningReply   bool `json:"canEditOpeningReply"`
    CanDeleteOpeningReply bool `json:"canDeleteOpeningReply"`
}

type CommentReplyCapabilities struct {
    CanEditReply   bool `json:"canEditReply"`
    CanDeleteReply bool `json:"canDeleteReply"`
}
```

Add fields:

```go
Capabilities CommentThreadCapabilities `json:"capabilities"`
Capabilities CommentReplyCapabilities  `json:"capabilities"`
```

### 2. Centralize Capability Computation

Files:

- `server/comment/commentService.go`

Add helper functions close to the service layer:

```go
func buildThreadCapabilities(ctx context.Context, thread CommentThread, userID string) CommentThreadCapabilities
func buildReplyCapabilities(ctx context.Context, docID string, reply CommentReply, userID string) CommentReplyCapabilities
func hydrateCapabilities(ctx context.Context, threads []CommentThread, userID string) []CommentThread
```

Rules should match target enforcement:

- `canReply`: `PAGE_ADD_COMMENT` and thread is not resolved.
- `canEditReply`: reply author is current user and user has `PAGE_ADD_COMMENT`.
- `canDeleteReply`: reply author has `PAGE_ADD_COMMENT`, or user has the approved admin/moderator reply-delete capability.
- `canResolve`: thread is not resolved and user is thread creator or has `PAGE_EDIT`.
- `canUnresolve`: thread is resolved and user is thread creator or has `PAGE_EDIT`.
- `canDeleteThread`: user is thread creator or has `PAGE_DELETE`.
- `canEditOpeningReply`: opening reply exists and `canEditReply` for that reply.
- `canDeleteOpeningReply`: opening reply exists and `canDeleteReply` for that reply.

Implementation detail:

- Avoid many repeated `CheckPermission` calls per reply.
- Compute page permissions once per document for the current user:
  - `canAddComment`
  - `canEditPage`
  - `canDeletePage`
  - `canModerateComments`
- Pass those booleans into helper functions.
- Do not use `PAGE_DELETE` as a proxy for `canModerateComments`.

### 3. Apply Capabilities To All Comment Responses

Files:

- `server/comment/commentController.go`
- `server/comment/commentService.go`

Responses that must include capabilities:

- `GET /comment/documents/{docId}/threads`
- `POST /comment/documents/{docId}/threads`
- `PATCH /comment/threads/{threadId}/resolve`
- `PATCH /comment/threads/{threadId}/unresolve`
- `PATCH /comment/threads/{threadId}/orphan`
- `POST /comment/threads/{threadId}/replies`
- `PATCH /comment/replies/{replyId}`

For reply-only responses, either:

- Return reply capabilities directly on the reply, or
- After mutation, return the updated thread instead of only the reply.

Preferred for minimal API change:

- Keep existing reply response shape.
- Add capabilities to the returned reply.
- UI continues patching the reply into its current thread.

### 4. Implement Moderator Delete Semantics

Product decision:

- Admin/moderator users can delete any reply.
- Page deleters cannot delete other users' replies unless they also have the admin/moderator reply-delete capability.
- Reply authors can delete their own replies when they have `PAGE_ADD_COMMENT`.

Current backend behavior does not match this decision:

- `DeleteReply` first requires `PAGE_ADD_COMMENT`.
- It then allows reply author or `PAGE_DELETE`.

Required backend change:

- Keep own-reply delete available to reply authors with `PAGE_ADD_COMMENT`.
- Remove `PAGE_DELETE` as the condition for deleting other users' replies.
- Add a dedicated admin/moderator check for deleting other users' replies.
- If no existing permission maps cleanly to this product rule, introduce a clearly named internal capability helper, for example `canModerateComments`, and wire it to the approved admin role/permission.

### 5. Backend Tests

Add focused service/controller tests if test harness exists for comments. Required cases:

- Viewer can list threads but all action capabilities are false.
- Commenter can create/reply and edit/delete own replies.
- Commenter cannot edit/delete other replies.
- Thread owner can resolve/unresolve/delete own thread.
- Page editor can resolve/unresolve other threads.
- Page deleter can delete other threads.
- Page deleter cannot delete other users' replies unless they also have admin/moderator permission.
- Admin/moderator can delete other users' replies.
- Resolved thread sets `canReply=false`, `canResolve=false`, `canUnresolve` based on permission.

## Editor Package Implementation

### 1. Extend Types

Files:

- `packages/editor/src/types/index.ts`

Add:

```ts
export interface CommentThreadCapabilities {
  canResolve: boolean;
  canUnresolve: boolean;
  canDeleteThread: boolean;
  canReply: boolean;
  canEditOpeningReply: boolean;
  canDeleteOpeningReply: boolean;
}

export interface CommentReplyCapabilities {
  canEditReply: boolean;
  canDeleteReply: boolean;
}
```

Add optional fields to `CommentThread` and `CommentReply`.

### 2. Add Capability Helpers

Files:

- `packages/editor/src/components/comment-ui.tsx` or a new `comment-capabilities.ts`

Add small helpers:

```ts
export function canEditReply(reply: CommentReply): boolean;
export function canDeleteReply(reply: CommentReply): boolean;
export function canReplyToThread(thread: CommentThread): boolean;
export function canResolveThread(thread: CommentThread): boolean;
export function canUnresolveThread(thread: CommentThread): boolean;
export function canDeleteThread(thread: CommentThread): boolean;
```

Default behavior:

- Missing capability fields return `false` for edit/delete/resolve/reply controls.
- This avoids exposing dead controls when backend capability data is not present.

### 3. Refactor `ReplyItem`

Files:

- `packages/editor/src/components/CommentSidePanel.tsx`
- `packages/editor/src/components/CommentThreadCard.tsx`

Change `ReplyItem` props:

- Remove `readonlyMode` as an action guard.
- Add optional `canEdit` and `canDelete`, or read directly from `reply.capabilities`.

Required behavior:

- Show edit button when `reply.capabilities.canEditReply`.
- Show delete button when `reply.capabilities.canDeleteReply`.
- Keep edit textarea, attachment edit, cancel/save behavior.
- Show inline error if edit/delete fails.
- Do not allow save while attachments are uploading.
- Apply this in both side-panel reply rows and floating-card reply rows.

### 4. Finish Opening Comment Editing In Thread Detail

Files:

- `packages/editor/src/components/CommentSidePanel.tsx`

Current list cards have a partial opening edit path. Thread detail needs parity:

- Add edit state for opening reply in `ThreadDetail`.
- Render edit button when `thread.capabilities.canEditOpeningReply`.
- Render delete button based on either:
  - `thread.capabilities.canDeleteOpeningReply`, if deleting the opening reply is allowed as reply deletion, or
  - `thread.capabilities.canDeleteThread`, if opening delete is represented as deleting the whole thread.

Product decision:

- Prefer opening/root comment delete to delete the whole thread, because the thread cannot exist meaningfully without its opening comment.
- Label/tooltip should make this clear: `Delete thread`.

### 5. Capability-Gate Thread Actions

Files:

- `packages/editor/src/components/CommentSidePanel.tsx`
- `packages/editor/src/components/CommentThreadCard.tsx`

Use thread capabilities for:

- Resolve.
- Unresolve.
- Delete thread.
- Reply composer visibility.
- Opening comment edit.
- Opening comment delete/thread delete.

Do this in both:

- Thread list card (`ThreadCard` read-only path).
- Thread detail (`ThreadDetail`).
- Editable mode cards in `CommentSidePanel`.
- Edit-page floating thread cards in `CommentThreadCard`.

### 6. Preserve Read-Only Comment Review

Do not use `editor.isEditable` to hide comment actions.

Allowed use of `editor.isEditable`:

- Choosing comments panel presentation/copy.
- Hiding document editing controls.
- Filtering draft/published threads if that rule still applies.

Not allowed:

- Hiding reply edit/delete.
- Hiding thread resolve/delete.
- Hiding reply composer when `canReply=true`.

### 7. Unify Edit-Page Comment Surfaces

Files:

- `packages/editor/src/components/CommentSidePanel.tsx`
- `packages/editor/src/components/CommentThreadCard.tsx`
- `ui/app/core/editor/tiptap.tsx`

Required behavior:

- `CommentThreadCard` must use the same capability helpers as `CommentSidePanel`.
- `CommentThreadCard` must show reply edit/delete based on `reply.capabilities`, not `reply.authorId`.
- `CommentThreadCard` must show opening edit based on `thread.capabilities.canEditOpeningReply`.
- `CommentThreadCard` must show resolve/unresolve/delete-thread based on thread capabilities.
- `CommentThreadCard` must show reply composer based on `thread.capabilities.canReply`.
- Edit-mode `CommentSidePanel` cards must use the same capability checks as read-only cards.
- Edit pages should continue showing draft/unpublished threads when the user is editing.
- Read-only pages should continue filtering to `publishedVisible=true`.

Implementation recommendation:

- Move capability checks into shared helpers first.
- Update `CommentSidePanel` and `CommentThreadCard` to consume those helpers.
- Avoid copying boolean expressions directly into both components.

### 8. Design Alignment Pass

Files:

- `packages/editor/src/components/CommentSidePanel.css`
- `packages/editor/src/components/CommentThreadCard.css`
- `ui/app/components/ReadOnlyContentMain.tsx` if app-level overrides are still needed.

Bring the following closer to the Pen:

- Desktop panel width around 380px.
- Close button 32px.
- Thread action buttons 26-28px.
- Reply action buttons 24px.
- Thread detail header: title/subtitle top row, close button, `All threads` chip below.
- Thread list footer: reply count left, `Open thread` right.
- Edit-page floating thread card action buttons and reply rows should stay visually aligned with the side-panel patterns.
- Mobile bottom sheet: no horizontal overflow, action buttons remain reachable.

## UI App Implementation

### 1. Map Backend Capabilities

Files:

- `ui/app/core/http/commentApiHandler.ts`

Update mappers:

```ts
const mapBackendReply = (r: any): CommentReply => ({
  ...
  capabilities: r.capabilities,
});

const mapBackendThread = (t: any): CommentThread => ({
  ...
  capabilities: t.capabilities,
});
```

Guard optional fields with defaults if needed.

### 2. Rebuild Local Editor Package

Because the UI consumes `@durgakiran/editor`, run:

```bash
npm --prefix packages/editor run build
```

For dev Docker flow:

```env
UI_USE_LOCAL_EDITOR_DIST=true
```

Then rebuild/recreate the UI image so `packages/editor/dist` is overlaid into `node_modules/@durgakiran/editor`.

## Verification Plan

### Static Verification

Run:

```bash
npm --prefix packages/editor run build
npm --prefix ui run build
go test ./server/comment ./server/editor
```

If package-level Go tests are not organized by those paths, run the nearest supported Go test command and record gaps.

Expected:

- Editor package builds.
- UI builds.
- No new TypeScript errors.
- Existing React hook warnings are acceptable only if already present.

### Backend API Verification

Create test users or use existing seeded users for these roles:

- Viewer only.
- Commenter.
- Thread/reply author.
- Page editor.
- Page deleter.
- Admin/moderator.

For each role, call:

```bash
GET /api/v1/comment/documents/{pageId}/threads
```

Verify:

- Every thread has `capabilities`.
- Every reply has `capabilities`.
- Capability booleans match the permission matrix.

Mutation checks:

- Author can edit own reply.
- Author can delete own reply.
- Non-author commenter cannot edit/delete other reply.
- Page editor can resolve/unresolve another user's thread.
- Page deleter can delete another user's thread.
- Admin/moderator can delete another user's thread only when they also have thread ownership or page delete permission.
- Page deleter cannot delete another user's reply unless they also have admin/moderator permission.
- Admin/moderator can delete another user's reply.

### Browser Verification

Use a real browser on desktop and mobile widths.

Desktop viewports:

- `1440x900`
- `1280x800`

Mobile viewports:

- `390x844`
- `360x780`

Flows:

1. Open read-only content page.
2. Open comments side panel.
3. Confirm thread list matches design:
   - Width.
   - Header.
   - Close button size.
   - Open/resolved filters.
   - Thread card actions.
   - Reply count and open-thread footer.
4. Open a thread.
5. Confirm thread detail matches design:
   - Header and `All threads` chip.
   - Opening comment actions.
   - Reply rows.
   - Reply edit/delete icons.
   - Reply composer visibility.
6. Edit own reply.
7. Delete own reply.
8. Try role without permission and confirm controls are hidden.
9. Confirm mobile bottom sheet does not slide under top nav and has no horizontal overflow.

Edit-page flows:

1. Open editable content page.
2. Select text and create a new comment thread.
3. Confirm the newly created thread opens in the floating thread card.
4. Open an existing thread from the gutter marker.
5. Confirm floating thread card actions are capability-gated:
   - Resolve/unresolve.
   - Opening/root comment edit.
   - Delete thread.
   - Follow-up reply edit/delete.
   - Reply composer.
6. Open docked comments side panel from edit mode.
7. Confirm edit-mode side-panel cards use the same capability behavior as read-only cards.
8. Verify draft/unpublished comments remain visible in edit mode.

### Regression Checks

Verify existing comment flows still work:

- Create a new thread in edit mode.
- Add attachments to a new comment.
- Add attachments to a reply.
- Edit reply attachments.
- Edit/delete replies from edit-page floating thread card.
- Edit/delete replies from edit-page docked side panel.
- Resolve and unresolve a thread.
- Delete a thread.
- Published/read-only filtering still hides draft-only comments from view mode.

## Rollout Plan

### Phase 1: Backend Capabilities Behind Compatible Response Shape

- Add capability fields as optional additions.
- Do not remove any existing fields.
- Ship backend first.
- Confirm old UI continues to function when extra fields are present.

### Phase 2: Editor Package Capability-Aware UI

- Update `packages/editor` to consume capabilities.
- Keep missing capabilities conservative.
- Build the package and test locally in UI.

### Phase 3: UI App Mapper And Docker Dev Flow

- Map capabilities in `commentApiHandler`.
- Build `packages/editor/dist`.
- Use `UI_USE_LOCAL_EDITOR_DIST=true` for dev deployment.
- Rebuild UI image and verify on `app.durgakiran.com` dev environment.

### Phase 4: Design Alignment And Mobile Polish

- Apply CSS refinements after functional actions are correct.
- Verify desktop/mobile screenshots against the Pen.

### Phase 5: Production Rollout

- Publish or otherwise promote the updated `@durgakiran/editor` package.
- Update UI dependency if using published package.
- Build production UI image.
- Deploy backend and UI together or backend first, UI second.

Recommended deployment order:

1. Backend with capability fields.
2. UI/editor consuming capability fields.

Rollback:

- If backend deploy fails, rollback backend only.
- If UI deploy fails, rollback UI image; backend extra fields are backward compatible.
- If capability logic is wrong, hide controls by hotfixing UI to require capability fields and set affected backend capabilities to false until corrected.

## Open Decisions

1. Which backend permission or role represents admin/moderator comment moderation?
   - Product decision: admin can delete replies; page deleter alone cannot.
   - Implementation must not use `PAGE_DELETE` as the reply moderation signal.

2. Should editing/deleting replies remain available on resolved threads?
   - Recommendation: allow delete for moderation, allow edit for own replies if product wants typo fixes after resolution.

3. Should orphaned threads allow replies?
   - Recommendation: no replies by default; allow delete and possibly resolve/unresolve only if product explicitly wants cleanup workflows.

4. Should deleting the opening/root reply delete the whole thread?
   - Recommendation: yes, treat opening delete as thread delete.

5. Should the API return updated thread after reply mutations?
   - Recommendation: eventually yes, but keep reply-only responses for this phase to reduce API churn.
