# Requirements: Inline Comments

## Overview
Users must be able to select a range of text and add an inline comment thread to it. Other users viewing the document should see the highlighted text and be able to open the thread to read and reply to comments. Users can resolve threads when a discussion is concluded.

---

## Data Model

### Database Schema

```sql
-- Stores the thread itself (anchor in document)
CREATE TABLE comment_threads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL = deleted user
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stores individual replies inside a thread
CREATE TABLE comment_replies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  UUID NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
  author_id  UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL = deleted user
  body       TEXT NOT NULL,
  edited_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Key design decisions:**
- `ON DELETE SET NULL` on `created_by` / `author_id` — thread content survives user account deletion; UI renders "👤 Deleted User".
- Comment UUID is generated **client-side** at submit time and stored as a TipTap mark attribute. All thread content lives in the DB, not the document JSON.

---

## Authentication & Authorization

Permission checks use the existing Permify schema (`permify/schema.perm`). Roles: `owner > admin > editor > commentor > viewer`.

| Action | Minimum Role |
|---|---|
| View comments & threads | `viewer` |
| Create a comment thread | `commentor` |
| Reply to a thread | `commentor` |
| Edit **own** reply | `commentor` (author only) |
| Delete **own** reply | `commentor` (author only) |
| Resolve / Re-open a thread | `commentor` (own thread) or `editor`+ |
| Resolve / Delete **any** thread | `admin` or `owner` |

### Required Permify Schema Changes

```diff
 entity space {
+    permission add_comment = owner or admin or editor or commentor
 }

 entity page {
+    permission add_comment = space.add_comment
 }
```

Backend calls `permify.check(userId, "add_comment", pageId)` before creating or replying to any thread.

---

## Notifications

- **New thread**: All active collaborators receive a real-time badge on the side panel icon.
- **New reply**: Original thread author + all previous repliers receive in-app + optional email notification.
- **Batching**: Email notifications debounced — rapid replies within a 5-minute window batch into one digest.
- **No self-notifications**: A user replying to their own thread gets no notification.

---

## Corner Cases & Edge Handling

| Scenario | Behaviour |
|---|---|
| Overlapping comment ranges | Independent threads per selection; blended highlight colors |
| Entire commented text deleted | Mark removed; backend marks thread `orphaned`; shown grey with "(Text was deleted)" |
| Partial text deletion | Remaining text keeps mark; thread stays active |
| Thread resolved | `PATCH /threads/:id/resolve` → TipTap command scrubs mark from doc |
| Two users comment simultaneously | Both marks coexist with unique UUIDs; no conflict |
| Deleted user account | `ON DELETE SET NULL`; attribution renders "👤 Deleted User"; thread persists |
| User removed from workspace | FK valid; content preserved; user loses doc access |
| Suspended user | Same as removed — content preserved |
| Read-only / viewer mode | Highlights visible; write actions disabled with tooltip |
| Export (PDF/DOCX) | Highlights stripped; optional "Comments Appendix" page |
| No / whitespace-only text selected | Comment button disabled |
| Node selection (image, embed) | Comment button hidden; v1 text-range only |

---

## REST API Contract

### Threads
```
POST   /api/documents/:docId/threads
       Body: { commentId: uuid, quotedText: string, body: string }
       Auth: add_comment
       Returns: 201 CommentThread

GET    /api/documents/:docId/threads
       Query: ?includeResolved=false
       Returns: 200 CommentThread[]

PATCH  /api/threads/:threadId/resolve
       Auth: commentor (own) or editor+
       Returns: 200 CommentThread

DELETE /api/threads/:threadId
       Auth: commentor (own) or admin+
       Returns: 204

POST   /api/threads/:threadId/orphan   (internal — collab server only)
```

### Replies
```
POST   /api/threads/:threadId/replies
       Body: { body: string }
       Auth: add_comment
       Returns: 201 CommentReply

PATCH  /api/replies/:replyId
       Body: { body: string }
       Auth: author only
       Returns: 200 CommentReply

DELETE /api/replies/:replyId
       Auth: author or admin+
       Returns: 204
```

---

## TipTap Extension Design

**File:** `packages/editor/src/extensions/comment.ts`

```ts
import { Mark, mergeAttributes } from '@tiptap/core';

export const CommentMark = Mark.create({
  name: 'comment',

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: el => el.getAttribute('data-comment-id'),
        renderHTML: attrs => ({ 'data-comment-id': attrs.commentId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'comment-highlight' }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      addComment: (commentId: string) => ({ commands }) =>
        commands.setMark(this.name, { commentId }),

      removeComment: (commentId: string) => ({ tr, dispatch }) => {
        tr.doc.descendants((node, pos) => {
          node.marks.forEach(mark => {
            if (mark.type.name === 'comment' && mark.attrs.commentId === commentId) {
              tr.removeMark(pos, pos + node.nodeSize, mark.type);
            }
          });
        });
        dispatch?.(tr);
        return true;
      },
    };
  },
});
```

An orphan detection ProseMirror plugin traverses each transaction's step map. When a `comment` mark disappears completely from the doc, it fires `onCommentOrphaned(commentId)` callback, which the `DocumentEditor` uses to call `POST /api/threads/:id/orphan`.

---

## Component Tree

```
DocumentEditor
├── Editor (TipTap)
│   ├── BubbleMenu
│   │   └── CommentButton         ← disabled on node/whitespace selection
│   └── CommentInputPopover       ← React portal, anchored to selection coords
│
├── CommentGutter                 ← absolute div, right margin of editor
│   └── GutterIndicator[]         ← shows 💬 N, anchored by line Y-position
│
└── CommentSidePanel              ← slides from right
    ├── SidePanelHeader           ← title, ✕, show-resolved toggle
    └── ThreadList
        └── ThreadCard[]
            ├── ThreadHeader      ← avatar, name, timestamp, resolve/delete
            ├── QuotedTextChip    ← italic, truncated excerpt
            ├── ReplyList
            │   └── ReplyItem[]   ← avatar, body, edit/delete
            └── ReplyInput        ← textarea + send (Cmd+Enter)
```

---

## Real-time Data Flow

```
User A selects text → clicks 💬
        │
        ▼
CommentInputPopover opens
        │  User types, presses Submit (Cmd+Enter)
        ▼
1. UUID generated client-side
2. editor.commands.addComment(uuid)       ← marks text in TipTap/Yjs doc
3. POST /api/documents/:docId/threads     ← persists to DB
        │
        ▼ 201 Created
4. Event broadcast via WebSocket to all peers:
   { type: 'thread:created', threadId, documentId }
        │
        ▼ All peers
5. CommentSidePanel appends new ThreadCard
6. GutterIndicator updates reply count
7. Notifications dispatched
```

---

## UI Highlight States

| State | CSS |
|---|---|
| Default (unresolved) | `bg-yellow-100 border-b-2 border-dashed border-yellow-400` |
| Hovered | `bg-yellow-200`, cursor `pointer` |
| Active (cursor inside) | `bg-amber-200 border-yellow-500` |
| Resolved | Mark removed from document |
| Orphaned | Mark removed on text deletion |

---

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| Open comment input | `Cmd/Ctrl + Alt + M` |
| Submit comment | `Cmd/Ctrl + Enter` |
| Dismiss / Cancel | `Escape` |
| Next comment | `Alt + ]` |
| Previous comment | `Alt + [` |
