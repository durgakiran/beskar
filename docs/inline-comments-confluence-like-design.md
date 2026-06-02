# Inline Comments Design

## Summary

This design uses a selector-based annotation model for inline comments, inspired by
the W3C Web Annotation specification (`TextQuoteSelector` + `TextPositionSelector`).

The core idea is:

- comments are stored outside the editor document as first-class entities
- each comment thread has an anchor that describes the selected text at creation time
- highlights are rendered as decorations in both edit mode and view mode
- a `publishedVisible` flag controls whether a comment is shown in view mode

This supports the required behavior:

- comments created in edit mode are visible only in edit mode until publish
- after publish, those comments are visible in both modes
- comments created in view mode are visible immediately in both modes

---

## Why This Design

The existing mark-based approach in TipTap is not sufficient as the only source of truth.

If a comment highlight exists only as a document mark:

- edit-mode comments naturally follow draft and publish semantics
- but view-mode comments cannot become visible immediately without mutating published
  content or bypassing publish

To avoid that limitation, comment anchors must be stored independently from the editor
document and rendered as a projection.

The mark in the TipTap document is used only as a rendering aid in edit mode. It is not
relied on as the canonical anchor. The `CommentAnchor` record in the database is the
source of truth.

---

## Design Principles

- Use one comment system for both edit mode and view mode.
- Keep comment anchors independent from the editor document.
- Make visibility rules explicit through metadata, not through document versioning.
- Render highlights as decorations from a projection layer, not from editor marks alone.
- Preserve threads even if the anchor text is removed or the document diverges.
- Use TipTap in non-editable mode for view mode so both modes share the same selection
  and decoration APIs.

---

## Data Model

### CommentThread

Each inline comment thread is a first-class record independent of the document.

Fields:

- `id` — UUID, generated client-side at creation time
- `documentId`
- `anchor: CommentAnchor` — location of the annotated text
- `publishedVisible: boolean` — controls view-mode visibility
- `orphaned: boolean` — set when the anchor can no longer be resolved
- `resolvedAt`
- `resolvedBy`
- `createdAt`
- `createdBy`

### CommentReply

Each thread has a flat list of replies. There is no nesting; replies are always
children of the thread.

Fields:

- `id`
- `threadId`
- `body`
- `createdAt`
- `createdBy`
- `editedAt` — set when the reply is edited

The first reply is the opening comment. The thread record is a container for anchor
metadata and lifecycle state; content lives in `CommentReply`.

### CommentAnchor

The anchor describes the selected text at creation time so it can be re-resolved
against the document later.

Fields:

- `quotedText` — exact text of the selection
- `prefixText` — up to 32 characters preceding the selection
- `suffixText` — up to 32 characters following the selection
- `blockId` — the `id` attribute of the enclosing ProseMirror block node
- `start` — character offset within the block at creation time
- `end` — character offset within the block at creation time
- `versionHint` — either `"draft"` or `"published"` to record which document version
  was active when the anchor was created

`start` and `end` are treated as hints, not as ground truth. In a collaborative
editing environment offsets drift as peers insert and delete text. The resolution
strategy below treats `quotedText` + context as the primary signal.

---

## Reply and Thread Structure

A thread is always a container with a flat list of replies:

```
CommentThread
├── CommentReply  ← opening comment (required)
├── CommentReply  ← reply 1
└── CommentReply  ← reply N
```

There are no nested replies. This matches Confluence behavior and keeps the data
model and UI simple for v1.

---

## Visibility Model

The same thread record exists in both modes. Visibility is determined by policy,
not by document version.

### Edit mode

Renders all threads regardless of `publishedVisible`.

### View mode

Renders only threads where `publishedVisible = true`.

---

## Comment Creation Rules

### Created in edit mode

1. User selects text.
2. A floating tooltip appears above the selection with a "Comment" action.
3. User clicks the action (or presses `Cmd/Ctrl + Alt + M`).
4. A popover opens anchored to the selection coordinates.
5. User types the opening comment and presses `Cmd/Ctrl + Enter` or clicks Submit.
6. Client generates a UUID for the thread.
7. Client builds a `CommentAnchor` from the current selection (see anchor creation
   below).
8. Client calls `POST /threads` with `publishedVisible = false`.
9. On success, the TipTap mark is applied to persist the highlight in the draft
   document.
10. View mode does not render the thread until it is promoted.

### Created in view mode

Steps 1–7 are the same. View mode uses TipTap in non-editable mode so the same
selection and decoration APIs are available.

8. Client calls `POST /threads` with `publishedVisible = true`.
9. No TipTap mark is applied because the document is read-only. Highlight is rendered
   as a decoration only.
10. Edit mode renders the thread highlight immediately.
11. View mode renders the thread highlight immediately.

### Anchor creation

When the user has an active selection:

1. Read the selection range from the ProseMirror state.
2. Resolve the nearest block ancestor that carries a `data-block-id` attribute.
3. Record `quotedText`, `prefixText`, `suffixText`, `blockId`, `start`, and `end`.
4. Store `versionHint` as `"draft"` or `"published"` based on current mode.

Both edit mode and view mode use TipTap for rendering. In edit mode TipTap is
editable; in view mode it is non-editable (`editable: false`). The same ProseMirror
position and selection APIs work in both modes. Block-level nodes must carry an `id`
attribute so they can be targeted by `blockId`.

---

## Publish Behavior

On explicit publish only:

- All threads for the document where `publishedVisible = false` are set to
  `publishedVisible = true`.

Auto-save and background syncs never promote comments. A user can draft multiple
comments across many editing sessions; they all remain hidden in view mode until
an explicit publish action is taken.

The publish endpoint is responsible for this transition atomically:

```
POST /api/documents/:docId/publish
```

This endpoint:

1. Saves the current draft as the new published version.
2. Updates all eligible `publishedVisible = false` threads for the document to
   `publishedVisible = true`.

Both steps happen in the same database transaction so that comment visibility
is always consistent with the published content version.

---

## Rendering Architecture

Highlights are rendered as ProseMirror decorations sourced from the fetched
thread list, not from marks persisted in the document JSON.

The TipTap mark in the document is only used as an in-editor visual aid in edit
mode and as a backup signal during anchor resolution. It is not the rendering source.

### Edit mode projection

Inputs:

- draft document text (live TipTap state)
- all threads for the document

Output:

- resolved anchors for all threads → decorations applied to editor view

### View mode projection

Inputs:

- published document text (TipTap non-editable state)
- threads where `publishedVisible = true`

Output:

- resolved anchors → decorations applied to view

---

## Anchor Resolution Strategy

Resolution runs client-side every time the thread list is loaded or the document
changes. It resolves each anchor independently.

Order of attempts:

1. Find the block node with `id = blockId`. Within that block, check whether the
   text at `[start, end]` exactly equals `quotedText`. If yes, use these positions.
2. Within the same block, search for an exact substring match of `quotedText`.
   If exactly one match is found, use it.
3. Within the same block, search for `quotedText` preceded by `prefixText` and
   followed by `suffixText`. If a confident match is found, use it.
4. Repeat steps 2–3 across all blocks in the document.

If no reliable match is found after all steps:

- mark the thread as `orphaned = true`
- do not render a highlight
- keep the thread in the side panel with an orphaned visual state

---

## Overlapping Anchors

Two threads may have anchors that overlap or nest within the same text range.

### Rendering

Both highlights are rendered as separate decorations. Where they overlap, the
decorations are stacked. CSS uses semitransparent background colors so both
highlights remain visible in the overlap zone. Each decoration carries a
`data-comment-id` attribute.

Highlight colors use a fixed palette:

- Default thread highlight: `rgba(253, 224, 71, 0.4)` (yellow)
- Overlapping zone: colors blend naturally because both spans are semitransparent

### Click handling

When the user clicks on text that falls under more than one highlight, a small
disambiguation popover appears listing all threads anchored to that text. The user
selects which thread to open from the list. Each list item shows the author avatar,
opening comment excerpt, and reply count.

If only one thread covers the clicked position, the selection popover is skipped and
that thread opens directly in the side panel.

---

## Real-time Collaboration and Yjs

The project uses Yjs for collaborative editing. Character offsets in `start` and `end`
are recorded at anchor creation time but are not updated as peers insert or delete text.

This is acceptable because:

- `start` and `end` are used only as a first-pass hint in resolution step 1
- if that hint misses after concurrent edits, resolution falls through to
  quote + context matching (steps 2–4)
- `quotedText` + `prefixText` + `suffixText` is the durable signal

The system does not attempt to maintain Yjs relative positions for anchors. The
quote + context approach is more resilient than absolute offsets for text that
shifts due to collaborative editing, and it does not require Yjs-specific types to
be stored in the anchor record.

### Concurrent anchor creation

Two users commenting on the same or overlapping text simultaneously produce two
independent thread records with unique UUIDs. Both threads coexist. Highlights
overlap (see above).

### Anchor re-resolution on document change

After each Yjs transaction that changes document content, the client re-runs
anchor resolution for all visible threads and updates decorations. This is
debounced to avoid running on every keystroke; a 300 ms idle debounce is sufficient.

---

## UX Trigger for Comment Creation

### Selection tooltip

When a user makes a non-empty, non-whitespace-only text selection:

- a compact floating tooltip appears above the selection midpoint
- the tooltip shows a comment icon (💬) and the label "Comment"
- keyboard shortcut: `Cmd/Ctrl + Alt + M`

The tooltip is dismissed when the selection is cleared or the user presses Escape.
The tooltip does not appear on node selections (images, embeds, code blocks).

### Comment input popover

After clicking the comment icon or using the keyboard shortcut:

- a popover opens anchored to the selection rectangle
- the popover contains a text input and a Submit button
- the selection is preserved while the popover is open
- submitting with `Cmd/Ctrl + Enter` or clicking Submit creates the thread
- Escape dismisses the popover without creating a thread

### Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Open comment input | `Cmd/Ctrl + Alt + M` |
| Submit comment | `Cmd/Ctrl + Enter` |
| Dismiss / Cancel | `Escape` |
| Next comment | `Alt + ]` |
| Previous comment | `Alt + [` |

---

## Orphaned Thread UX

When a thread becomes orphaned (anchor cannot be resolved):

- No highlight is shown in the document.
- In the side panel the thread card shows a warning banner:
  `"The commented text was deleted or moved and could not be relocated."`
- The thread card is visually subdued (reduced opacity, no yellow accent).
- The thread remains readable and replyable. Users can still resolve or delete it.
- The author of the thread receives an in-app notification when orphaning occurs.
- Orphaned threads are excluded from the gutter indicator count.
- Orphaned threads are included in the side panel count but grouped below active
  threads under an "Orphaned" collapsed section.

Manual re-attachment (letting the user select new text to re-anchor a thread) is
not in scope for v1. The thread can be resolved and a new thread started if needed.

---

## TipTap Integration

TipTap is the rendering host in both edit mode and view mode.

In edit mode, TipTap is editable. A `CommentMark` is applied to highlighted text
as a transient in-editor aid and as a persistence mechanism for the draft document.

In view mode, TipTap is non-editable (`editable: false`). The comment mark is not
used for persistence. Highlights are rendered only as decorations.

### Decoration rendering

A ProseMirror plugin (`CommentDecorationPlugin`) subscribes to the resolved thread
list. It maps each resolved anchor to a decoration and applies the decoration set to
the editor view. This plugin runs in both edit and view mode.

### Mark in edit mode

The `CommentMark` stored in the document JSON serves two purposes:

1. It ensures the yellow highlight appears immediately without waiting for anchor
   resolution on initial load.
2. It provides a backup signal: the mark's position in the document gives step 1 of
   the resolution strategy a reliable starting point on fresh load.

When a comment is resolved, the mark is removed from the document. When the document
is published without an active TipTap session (e.g., API-triggered publish), the mark
in the draft document is not removed automatically; it is cleaned up on the next
edit-mode load.

### Orphan detection

A ProseMirror plugin traverses each transaction's step map. When a `comment` mark
for a given `commentId` disappears completely from the document after a step, it fires
an `onCommentOrphaned(commentId)` callback. This triggers `PATCH /threads/:id/orphan`
to update the server record.

---

## Permissions

Roles follow the existing Permify schema: `owner > admin > editor > commentor > viewer`.

| Action | Minimum role |
|---|---|
| View comment highlights and threads | `viewer` |
| Create a new thread | `commentor` |
| Reply to a thread | `commentor` |
| Edit own reply | `commentor` (author only) |
| Delete own reply | `commentor` (author only) |
| Resolve a thread | `commentor` (own) or `editor`+ |
| Unresolve a thread | `editor`+ |
| Delete any thread | `admin` or `owner` |
| Bulk resolve all threads | `admin` or `owner` |

View mode creation sets `publishedVisible = true`. Edit mode creation sets
`publishedVisible = false`. Both paths require `commentor` or higher.

---

## Notifications

- **New thread**: All active collaborators on the document receive a real-time
  badge update on the side panel icon via WebSocket.
- **Reply on your thread**: The thread author and all prior repliers receive an
  in-app notification. No self-notification.
- **Your thread orphaned**: The thread author receives an in-app notification.
- **Email**: Batched. Rapid replies within a 5-minute window are collapsed into a
  single digest email.

Notification delivery is handled by the existing notification infrastructure.
No new notification primitives are introduced for inline comments in v1.

---

## Backend API Changes

### Create thread

```
POST /api/documents/:docId/threads
Body:
  {
    commentId: uuid,
    body: string,
    publishedVisible: boolean,
    anchor: {
      quotedText: string,
      prefixText: string,
      suffixText: string,
      blockId: string,
      start: number,
      end: number,
      versionHint: "draft" | "published"
    }
  }
Auth: commentor+
Returns: 201 CommentThread
```

### Get threads

```
GET /api/documents/:docId/threads
Query: ?includeResolved=false
Returns: 200 CommentThread[]
  Each thread includes:
    - thread metadata
    - anchor metadata
    - all replies
    - orphaned state
    - publishedVisible state
```

### Resolve thread

```
PATCH /api/threads/:threadId/resolve
Auth: commentor (own) or editor+
Returns: 200 CommentThread
```

### Orphan thread (internal)

```
POST /api/threads/:threadId/orphan
Auth: internal collab server only
Returns: 200
```

### Replies

```
POST   /api/threads/:threadId/replies
       Body: { body: string }
       Returns: 201 CommentReply

PATCH  /api/replies/:replyId
       Body: { body: string }
       Auth: author only

DELETE /api/replies/:replyId
       Auth: author or admin+
```

### Publish endpoint (updated)

```
POST /api/documents/:docId/publish
```

In one database transaction:

1. Save draft content as the new published version.
2. Set `publishedVisible = true` on all threads for this document where
   `publishedVisible = false`.

---

## Text Removal and Editing Edge Cases

| Scenario | Behavior |
|---|---|
| Exact quoted text deleted | Anchor cannot be resolved; thread becomes orphaned; highlight removed; thread stays in side panel |
| Text partially changed | If selector still resolves confidently, highlight is preserved; otherwise orphan |
| Whole block removed | All threads anchored to that block become orphaned |
| Text moved within doc | If quote and context still match, re-attaches at new position |
| Draft and published diverge | A thread may highlight in edit mode but not view mode, or vice versa; this is correct and expected |
| Two users comment on same range | Both threads coexist; overlap rendering applies |
| Whitespace-only selection | Comment action disabled; no thread can be created |
| Node selection (image, embed) | Comment action hidden; text-range only in v1 |

---

## Migration & Data Cleanup

Since this feature is not yet deployed to production, we do not need to implement backward-compatibility migration scripts for existing marks. The project is actively developed by full-stack agents.

The migration strategy is simply:
1. Wipe the existing `comment_threads` and `comment_replies` rows safely in the local development database.
2. Allow users to start fresh with the new anchor-based comments.

---

## Open Questions

- Should orphaned threads be automatically cleaned up (deleted) after a configurable
  period of inactivity, or kept indefinitely?
- Should inline comments be included in document exports (PDF/DOCX) as an appendix, or
  stripped entirely? The requirements doc notes an "optional Comments Appendix" but this
  is not yet specced.

---

## Implementation Plan

### Phase 1 — Editor UI & Types

- Update TypeScript interfaces (`CommentThread`, `CommentAnchor`).
- Update `CommentSidePanel` to group Active vs. Orphaned threads and handle `publishedVisible` filtering.
- Update `CommentThreadCard` to show orphaned visual indicators.
- Create the overlap disambiguation popover.

### Phase 2 — Anchor Extraction & Resolution Core

- Implement the 4-step anchor resolution cascade (`findExactMatch`, `findQuoteMatch`, `findContextMatch`, generic fallback).
- Create client-side anchor extraction logic from ProseMirror selection states.
- Implement the `CommentDecorationPlugin` to render highlights from resolved anchors.
- Prevent default click events on decorations when selecting text ranges.

### Phase 3 — Backend Database & API Integrations

- Wipe existing comment data in the local development database.
- Add `anchor` (JSONB) and `publishedVisible` (boolean, default false) to the `comment_threads` table.
- Update create/get thread APIs to accept and return anchor metadata.
- Update the publish endpoint to atomically flip `publishedVisible = false` to `true`.

### Phase 4 — Final Integration & Verification

- Wire the Editor's thread creation logic to map active text selections to the `CommentAnchor` payload.
- Wire orphan detection and trigger the internal orphan API.
- Test both Edit and View modes thoroughly.

---

## Test Plan

- Create a comment in edit mode. Verify it appears in edit mode but not view mode before publish.
- Publish the document. Verify the same comment now appears in both modes.
- Create a comment in view mode. Verify it appears immediately in both modes.
- Delete the anchored text entirely. Verify the thread becomes orphaned: highlight removed,
  warning shown in side panel, author notified.
- Partially edit anchored text such that `quotedText` still appears. Verify the
  highlight re-attaches.
- Create two overlapping comments. Verify both highlights render and the disambiguation
  popover appears on click.
- Simulate concurrent edits by two users via Yjs. Verify both anchors resolve after the
  document settles.
- Verify auto-save does not promote `publishedVisible = false` comments.
- Verify that resolving a thread removes the mark in edit mode and the decoration in both modes.
- Verify orphaned threads appear in the side panel under the Orphaned section and remain
  accessible.
