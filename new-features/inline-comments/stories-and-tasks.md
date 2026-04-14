# User Stories & Tasks: Inline Comments

> **Development Strategy**: UI-First with mock APIs, verified in `packages/editor-demo` before any backend work. This keeps the feature independently testable and unblocks UI development from backend readiness.
>
> The flow mirrors how `ImageBlock` was built — pass a mock handler prop to `<Editor>`, develop fully in `packages/editor-demo`, then swap the handler for the real API.
>
> See `requirements.md` in this folder for the full spec.

---

## Epic: Inline Comments

Tasks are grouped into **3 phases**:


| Phase                     | Goal                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Phase 1 — UI (Mock)**   | TipTap extension + all UI components, wired to an in-memory mock store. Verified fully in `editor-demo`. |
| **Phase 2 — Backend**     | DB migrations, Permify update, REST API, real-time broadcast.                                            |
| **Phase 3 — Integration** | Swap mock handlers for real API calls; end-to-end verification.                                          |


---

## Phase 1: UI with Mock APIs (editor-demo)

> All Phase 1 tasks are verified by running `packages/editor-demo`. No backend required.

---

### Story 1 — `CommentMark` TipTap Extension

**As a** developer,  
**I want** a TipTap `Mark` extension that stores a `comment-id` on selected text,  
**So that** comment ranges can be tracked inside the editor document state.

#### Task 1.1 — Create `CommentMark` extension

- File: `packages/editor/src/extensions/comment.ts`
- Implements `addAttributes` (stores `commentId` → `data-comment-id`), `parseHTML`, `renderHTML` (wraps text in `<span class="comment-highlight" data-comment-id="...">`)
- **Verify in editor-demo:** Programmatically apply mark with `editor.commands.addComment('test-uuid')` on a selection. Inspect DOM — `<span data-comment-id="test-uuid" class="comment-highlight">` wraps the text. JSON snapshot shows the mark.

#### Task 1.2 — `addComment(commentId)` command

- `editor.commands.addComment(uuid)` applies the mark to the current text selection
- **Verify in editor-demo:** Select "hello", run command with a UUID, text is highlighted. Click elsewhere — no mark applied.

#### Task 1.3 — `removeComment(commentId)` command

- `editor.commands.removeComment(uuid)` removes all occurrences of that specific comment mark from the doc (other marks unaffected)
- **Verify in editor-demo:** Apply two marks with different UUIDs. Remove one. Only the targeted mark disappears.

#### Task 1.4 — Register in `getExtensions()` and export

- Add `CommentMark` to `baseExtensions` in `packages/editor/src/extensions/index.ts`
- Export from `packages/editor/src/index.ts`
- **Verify in editor-demo:** Editor initialises without console errors. No conflicts with existing marks (bold, italic, etc.).

---

### Story 2 — Mock Comment Handler

**As a** developer,  
**I want** a mock in-memory comment store that can be passed to `<Editor>` as a prop,  
**So that** the entire UI can be built and tested without a real backend.

#### Task 2.1 — Define `CommentAPIHandler` type

- File: `packages/editor/src/types.ts`
- Interface:
  ```ts
  export interface CommentAPIHandler {
    getThreads: (documentId: string) => Promise<CommentThread[]>;
    createThread: (documentId: string, commentId: string, quotedText: string, body: string) => Promise<CommentThread>;
    resolveThread: (threadId: string) => Promise<CommentThread>;
    unresolveThread: (threadId: string) => Promise<CommentThread>;
    deleteThread: (threadId: string) => Promise<void>;
    addReply: (threadId: string, body: string) => Promise<CommentReply>;
    editReply: (replyId: string, body: string) => Promise<CommentReply>;
    deleteReply: (replyId: string) => Promise<void>;
  }
  ```
- Also define `CommentThread` and `CommentReply` types
- **Verify:** TypeScript compiles cleanly.

#### Task 2.2 — Build `mockCommentHandler` in editor-demo

- File: `packages/editor-demo/src/mockCommentHandler.ts`
- In-memory `Map<threadId, CommentThread>` store
- Simulates 300ms network delay with `setTimeout`
- Pre-seeds 2 threads on a "demo-document" so the panel is not empty on first load
- **Verify in editor-demo:** Call `getThreads()` in console → returns pre-seeded threads after 300ms. Call `createThread(...)` → thread appears in subsequent `getThreads()` call.

#### Task 2.3 — Wire `commentHandler` prop to `<Editor>` in editor-demo

- Pass `commentHandler={mockCommentHandler}` to `<Editor>` in `App.tsx`, similar to `imageHandler`
- **Verify in editor-demo:** App renders without errors. Handler available to all comment UI components via React context.

---

### Story 3 — Comment Button in BubbleMenu / TextFormattingMenu

**As a** user,  
**I want** a comment button in the floating toolbar when I select text,  
**So that** I can trigger the comment input.

#### Task 3.1 — Add `CommentButton` to `TextFormattingMenu`

- Add `💬` icon button to `packages/editor/src/components/TextFormattingMenu.tsx`
- Button only shown when `commentHandler` prop is provided to the editor
- **Verify in editor-demo:** Select a word — button appears in the formatting menu. No handler → button absent.

#### Task 3.2 — Disabled state on invalid selection

- Button is `disabled` + `cursor-not-allowed` when: selection is empty, whitespace-only, or a node (non-text) is selected
- **Verify in editor-demo:** Select "  " (spaces) → button disabled. Click image block → button hidden. Select "hello" → button enabled.

---

### Story 4 — Comment Input Popover

**As a** user,  
**I want** a floating input box to appear when I click the comment button,  
**So that** I can type and submit my comment.

#### Task 4.1 — Build `CommentInputPopover` component

- File: `packages/editor/src/components/CommentInputPopover.tsx`
- Rendered via React portal; anchored to the bounding rect of the current selection (`getBoundingClientRect()`)
- Auto-growing `<textarea>` (max 5 lines), placeholder "Add a comment…"
- `Cancel` (ghost) and `Submit` (primary) buttons; `Submit` disabled until non-whitespace content
- Closes on `Escape`
- **Verify in editor-demo:** Click comment button after selecting text. Popover appears below highlighted region. Typing and cancelling clears and closes. Submit is disabled on empty input.

#### Task 4.2 — Submit flow (mock)

- On Submit:
  1. Generate UUID (`crypto.randomUUID()`)
  2. `editor.commands.addComment(uuid)` — marks text optimistically
  3. `commentHandler.createThread(docId, uuid, quotedText, body)` — mock call (300ms delay)
  4. On success → close popover, add thread to local panel state
  5. On error → `editor.commands.removeComment(uuid)` (rollback), show error toast
- `Cmd/Ctrl + Enter` submits
- **Verify in editor-demo:** Submit a comment → text highlighted yellow, thread card appears in side panel after ~300ms. Simulate error (throw in mockHandler) → highlight removed, toast shown.

---

### Story 5 — Highlight Styles

**As a** user,  
**I want** commented text to be visually distinct with hover and active states,  
**So that** I can spot and interact with comment ranges.

#### Task 5.1 — Comment highlight CSS

- Add styles to `packages/editor/src/styles/` (or global editor styles):
  ```css
  .comment-highlight {
    background: rgb(254 249 195);          /* yellow-100 */
    border-bottom: 2px dashed #facc15;     /* yellow-400 */
    cursor: pointer;
  }
  .comment-highlight:hover {
    background: rgb(254 240 138);          /* yellow-200 */
  }
  .comment-highlight.active {
    background: rgb(253 230 138);          /* amber-200 */
    border-bottom-color: #eab308;          /* yellow-500 */
  }
  ```
- `.active` class applied when cursor is inside the marked range (detect via `onSelectionUpdate`)
- **Verify in editor-demo:** Apply a comment mark. Text is underlined yellow. Hover → darker. Click inside → active state. Click outside → returns to default.

---

### Story 6 — Comment Side Panel

**As a** user,  
**I want** a side panel to read and reply to threads,  
**So that** discussions are accessible while editing.

#### Task 6.1 — Build `CommentSidePanel` shell

- File: `packages/editor/src/components/CommentSidePanel.tsx`
- Fixed-width right panel (`width: 320px`), slide-in via CSS transition
- Header: "Comments" title + `✕` close + "Show Resolved" toggle
- Opens when a comment mark is clicked or `openThread(threadId)` called
- **Verify in editor-demo:** Click a highlighted comment range → panel slides in. Click `✕` → closes. Toggle "Show Resolved" → state toggles (no threads yet needed).

#### Task 6.2 — Empty state

- When `threads.length === 0`, show centred placeholder: illustration + "No comments yet. Select some text to start a discussion."
- **Verify in editor-demo:** Start with no mock threads → empty state shown. Add a thread → empty state disappears.

#### Task 6.3 — Build `ThreadCard` component

- Thread header: Avatar (circular initials fallback), author name, relative timestamp, Resolve `✓` button, kebab `⋮` delete menu
- Quoted text chip: `bg-muted px-2 py-1 rounded text-sm italic`, truncated to 80 chars
- Orphaned thread: UI dynamically checks if `thread.commentId` exists in `editor.state.doc`. If missing, grey muted header + "(Text was deleted)" chip in place of quoted text
- **Verify in editor-demo:** Pre-seed mock with 1 thread (and render it in editor demo without matching text mark). Card renders distinctly greyed out.

#### Task 6.4 — Build `ReplyItem` component

- Avatar, author name, body, relative timestamp
- Edit/Delete menu visible only when `userId === reply.author_id`
- Deleted user: "👤 Deleted User" grey italic name, generic avatar
- **Verify in editor-demo:** Seed mock with replies. Own reply shows Edit/Delete. Other user's reply shows no edit controls. Set `author_id: null` on one reply → shows "Deleted User".

#### Task 6.5 — Build `ReplyInput` component

- Textarea at the bottom of each `ThreadCard`, Send button + `Cmd+Enter`
- When `userRole === 'viewer'`: input disabled with title tooltip "You don't have permission to reply"
- **Verify in editor-demo:** Type a reply and send → reply appended optimistically. Set `isViewer` mock prop → input disabled with tooltip visible on hover.

#### Task 6.6 — Connect panel to mock handler

- On panel open: call `commentHandler.getThreads(docId)` and render results
- Resolve → `commentHandler.resolveThread(threadId)`, move to resolved view
- Unresolve (Reopen) → `commentHandler.unresolveThread(threadId)`, move back to active view
- Delete → `commentHandler.deleteThread(threadId)`, remove card
- Add reply → `commentHandler.addReply(threadId, body)`, append to thread
- Edit reply → `commentHandler.editReply(replyId, body)`, update in place
- Delete reply → `commentHandler.deleteReply(replyId)`, remove from list
- **Verify in editor-demo:** Full CRUD round-trip using the mock. Optimistic updates; error rollback on simulated failures.

---

### Story 7 — Gutter Comment Indicators

**As a** user,  
**I want** a reply count badge in the margin next to each comment,  
**So that** I can see at a glance where discussions are.

#### Task 7.1 — Build `CommentGutter` and `GutterIndicator`

- `CommentGutter`: absolute `div` positioned in the right margin of the editor
- For each thread, compute the Y-coordinate of the first line of the comment range using ProseMirror's `view.coordsAtPos()`
- `GutterIndicator`: small pill `💬 N` anchored to that Y-coordinate; clicking it opens the side panel focused on that thread
- **Verify in editor-demo:** Apply 2 comment marks on different lines. Two indicators appear at the correct vertical positions. Clicking one opens the panel scrolled to that thread.

---

### Story 8 — Orphan Handling (UI side)

**As a** user,  
**I want** deleted comment text to be gracefully handled in the side panel,  
**So that** context is preserved even after edits.

#### Task 8.1 — React state updates for Orphan detection

- The `CommentSidePanel` component should re-render and check if any thread's `commentId` is missing from the editor's text content.
- Update tracking via `editor.on('transaction')` to keep a `Set` of active `commentId`s in state.
- **Verify in editor-demo:** Apply comment mark. Delete all the highlighted text. Thread card in side panel immediately changes to orphaned state ("(Text was deleted)") without any delay or mock API call.

---

### Story 9 — Keyboard Shortcuts

**As a** user,  
**I want** keyboard shortcuts for comment navigation,  
**So that** I can navigate discussions without the mouse.

#### Task 9.1 — Register keyboard shortcuts

- `Cmd/Ctrl + Alt + M`: open `CommentInputPopover` on current selection (no-op if selection invalid)
- `Alt + ]`: move focus to next comment mark in document; scroll panel to that thread
- `Alt + [`: move focus to previous comment mark; scroll panel to that thread
- **Verify in editor-demo:** Each shortcut performs its action. `Alt + ]` cycles through multiple marked ranges correctly. Shortcut with no comments: no-op.

---

### Story 10 — Global Comments Toggle

**As a** user,  
**I want** a persistent button (e.g. in the top-right header or floating on the page),  
**So that** I can toggle the Comments Side Panel open and closed at any time, even if there are no highlights visible.

#### Task 10.1 — Add global toggle button
- Add a persistent `💬` toggle button (with a badge showing the total number of unresolved threads).
- Clicking it toggles the `CommentSidePanel` open/closed state.
- **Verify in editor-demo:** Close the side panel. Have only an orphaned comment in the document. The global hook shows `💬 1`. Click it, the panel opens and the orphaned comment is accessible.

---

## Phase 2: Backend API

> These tasks are independent of Phase 1 and can be worked in parallel. The backend is a **Go/chi** server (`server/`) using **pgx** for Postgres and **Liquibase XML** changesets for schema migrations (`db/beskar/updates/`). Auth checks go through the existing **Permify gRPC** client (`server/core/permify.go`). Follow the established package layout: one folder per domain (`server/comment/`) with `types.go`, `queries.go`, `commentService.go`, `commentController.go`, `commentValidations.go`, and `comment.go` (router).

---

### Task B1 — DB Migration: `comment_threads` table

- **File:** `db/beskar/updates/comments.xml` (new file); add `<include file="updates/comments.xml" />` to `db/beskar/update.xml`.
- Create the `core` schema changeset is already present; add a new changeset inside `comments.xml`:
  ```xml
  <changeSet id="1-create-comment-threads-table" author="kiran kumar">
    <createTable tableName="comment_threads" schemaName="core">
      <column name="id" type="UUID" defaultValueComputed="gen_random_uuid()">
        <constraints primaryKey="true" nullable="false"/>
      </column>
      <column name="document_id" type="UUID">
        <constraints nullable="false"
          foreignKeyName="fk_ct_document"
          references="core.page_doc_map(doc_id)"
          deleteCascade="true"/>
      </column>
      <column name="comment_id" type="UUID">
        <constraints nullable="false" unique="true"/>
      </column>
      <column name="quoted_text" type="TEXT">
        <constraints nullable="false"/>
      </column>
      <column name="created_by" type="VARCHAR(255)"/>
      <!-- Stores Zitadel User ID. No FK to avoid tight coupling. -->
      <column name="resolved_by" type="VARCHAR(255)"/>
      <column name="resolved_at" type="TIMESTAMPTZ"/>
      <column name="created_at" type="TIMESTAMPTZ" defaultValueComputed="now()">
        <constraints nullable="false"/>
      </column>
    </createTable>
    <addForeignKeyConstraint
      baseTableSchemaName="core" baseTableName="comment_threads"
      baseColumnNames="created_by"
      referencedTableSchemaName="core" referencedTableName="users"
      referencedColumnNames="id"
      constraintName="fk_ct_created_by"
      onDelete="SET NULL"/>
    <addForeignKeyConstraint
      baseTableSchemaName="core" baseTableName="comment_threads"
      baseColumnNames="resolved_by"
      referencedTableSchemaName="core" referencedTableName="users"
      referencedColumnNames="id"
      constraintName="fk_ct_resolved_by"
      onDelete="SET NULL"/>
  </changeSet>
  ```
- Add a second changeset to grant table privileges to `${app_user}` (matches the pattern in `notifications.xml`).
- **Verify:** Run `liquibase update` — migration applies cleanly. Run `liquibase rollback` — rolls back without errors. Inspect the table in psql: `ON DELETE SET NULL` on both FK columns, `comment_id` is unique.

---

### Task B2 — DB Migration: `comment_replies` table

- **File:** same `db/beskar/updates/comments.xml`, second changeset block.
  ```xml
  <changeSet id="2-create-comment-replies-table" author="kiran kumar">
    <createTable tableName="comment_replies" schemaName="core">
      <column name="id" type="UUID" defaultValueComputed="gen_random_uuid()">
        <constraints primaryKey="true" nullable="false"/>
      </column>
      <column name="thread_id" type="UUID">
        <constraints nullable="false"
          foreignKeyName="fk_cr_thread"
          references="core.comment_threads(id)"
          deleteCascade="true"/>
      </column>
      <column name="author_id" type="VARCHAR(255)"/>
      <!-- Stores Zitadel User ID. No FK to avoid tight coupling. -->
      <column name="body" type="TEXT">
        <constraints nullable="false"/>
      </column>
      <column name="edited_at" type="TIMESTAMPTZ"/>
      <column name="created_at" type="TIMESTAMPTZ" defaultValueComputed="now()">
        <constraints nullable="false"/>
      </column>
    </createTable>
    <addForeignKeyConstraint
      baseTableSchemaName="core" baseTableName="comment_replies"
      baseColumnNames="author_id"
      referencedTableSchemaName="core" referencedTableName="users"
      referencedColumnNames="id"
      constraintName="fk_cr_author"
      onDelete="SET NULL"/>
  </changeSet>
  ```
- **Verify:** Migration applies. Delete a `comment_threads` row manually → all its `comment_replies` cascade-delete. Delete a user row → `author_id` is `NULL`; reply row is preserved.

---

### Task B3 — Update Permify schema (`add_comment` permission)

- **File:** `permify/schema.perm`
- Add the `add_comment` permission to both entities:
  ```diff
   entity space {
  +    permission add_comment = owner or admin or editor or commentor
   }

   entity page {
  +    permission add_comment = space.add_comment
   }
  ```
- Add the corresponding Go constant to `server/core/permissions.go`:
  ```go
  const (
      // existing ...
      PAGE_ADD_COMMENT = "add_comment"
  )
  ```
- Push the updated schema to Permify: call `WriteSchema` via the gRPC client (or re-run the existing schema write script in `requests/permify/schema/write_schema.zapy`).
- **Verify:** Using `requests/permify/schema/read_schema.zapy`, confirm the new permission appears. Call `core.CheckPermission("page", pageId, "user", viewerUserId, "add_comment")` → returns `false`. Same call with a `commentor` user → returns `true`.

---

### Task B4 — Go package scaffold: `server/comment/`

- Create the package with the standard file layout:
  - `types.go` — Go structs mirroring DB rows and JSON response shapes:
    ```go
    type CommentThread struct {
        ID          string        `json:"id"`
        DocumentID  string        `json:"documentId"`
        CommentID   string        `json:"commentId"`
        QuotedText  string        `json:"quotedText"`
        CreatedBy   *AuthorInfo   `json:"createdBy"`   // nil for deleted user
        ResolvedBy  *AuthorInfo   `json:"resolvedBy,omitempty"`
        ResolvedAt  *time.Time    `json:"resolvedAt,omitempty"`
        CreatedAt   time.Time     `json:"createdAt"`
        Replies     []CommentReply `json:"replies"`
    }

    type CommentReply struct {
        ID       string      `json:"id"`
        ThreadID string      `json:"threadId"`
        Author   *AuthorInfo `json:"author"` // nil for deleted user
        Body     string      `json:"body"`
        EditedAt *time.Time  `json:"editedAt,omitempty"`
        CreatedAt time.Time  `json:"createdAt"`
    }

    type AuthorInfo struct {
        ID   string `json:"id"`
        Name string `json:"name"`
    }
    ```
  - `queries.go` — SQL constant strings (see Tasks B5–B11 below for each query).
  - `commentService.go` — business logic calling `core.GetPool()`, executing queries, calling `core.CheckPermission`.
  - `commentController.go` — HTTP handlers reading URL params via `chi.URLParam`, decoding JSON body, calling service layer, calling `core.SendSuccessResponse` / `core.SendFailedReponse`.
  - `commentValidations.go` — request body structs with `validate` tags.
  - `comment.go` — `Router() *chi.Mux` function.
- Mount the router in `server/main.go`:
  ```go
  import comment "github.com/durgakiran/beskar/comment"
  // ...
  r.Mount("/api/v1/comment", mw.CheckAuthentication()(comment.Router()))
  ```
- **Verify:** `go build ./...` compiles. Server starts without errors.

---

### Task B5 — `POST /api/v1/comment/documents/:docId/threads`

- **Route:** `r.Post("/documents/{docId}/threads", createThread)` in `comment.go`.
- **Request body:**
  ```json
  { "commentId": "<uuid>", "quotedText": "selected text", "body": "first reply text" }
  ```
- **Handler flow (`commentController.go` → `commentService.go`):**
  1. Extract `userId` from context via `core.GetUserInfo(ctx)`.
  2. Call `core.CheckPermission("page", docId, "user", userId, PAGE_ADD_COMMENT)` — return 403 on failure.
  3. Validate body (non-empty `commentId`, `quotedText`, `body`).
  4. `INSERT INTO core.comment_threads (document_id, comment_id, quoted_text, created_by) VALUES ($1,$2,$3,$4) RETURNING id, created_at`.
  5. `INSERT INTO core.comment_replies (thread_id, author_id, body) VALUES ($1,$2,$3) RETURNING id, created_at`.
  6. Return 201 with the full `CommentThread` (including the opening reply nested under `replies`).
- **SQL constants (`queries.go`):**
  ```go
  const INSERT_THREAD = `INSERT INTO core.comment_threads (...) VALUES (...) RETURNING ...`
  const INSERT_REPLY  = `INSERT INTO core.comment_replies (...) VALUES (...) RETURNING ...`
  ```
- **Verify:** 201 with correct JSON. 403 when called with a viewer token. 422 when `commentId` or `body` is missing. Confirm row exists in DB.

---

### Task B6 — `GET /api/v1/comment/documents/:docId/threads`

- **Route:** `r.Get("/documents/{docId}/threads", listThreads)`.
- **Query params:** `?includeResolved=false` (default `false`).
- **Query strategy:** single JOIN query to fetch threads and replies. Because user profiles live in Zitadel, do not join on the dead `core.users` table:
  ```sql
  SELECT
      t.id, t.comment_id, t.quoted_text,
      t.created_by, t.resolved_by, t.created_at, t.resolved_at,
      r.id AS reply_id, r.author_id, r.body, r.edited_at, r.created_at AS reply_created_at
  FROM core.comment_threads t
  LEFT JOIN core.comment_replies r ON r.thread_id = t.id
  WHERE t.document_id = $1
    AND ($2 OR t.resolved_at IS NULL)
  ORDER BY t.created_at ASC, r.created_at ASC
  ```
- Assemble into `[]CommentThread` in Go, collapsing multiple rows per thread.
- **User Resolution (`commentService.go`)**: Extract all unique Zitadel user IDs from the returned rows. Fetch their profiles (name, avatar) from Zitadel via API (or local Redis cache) and populate the `createdBy`, `resolvedBy`, and `author` structs. If Zitadel returns 404 for a user, leave their `AuthorInfo` as `null` to indicate a deleted user.
- Auth: `view` permission check (any authenticated user with access to the document can read threads).
- **Verify:** 200 with nested replies in JSON. `includeResolved=true` returns resolved threads too. A thread whose `created_by` user was deleted in Zitadel has `createdBy: null`.

---

### Task B7 — `PATCH /api/v1/comment/threads/:threadId/resolve`

- **Route:** `r.Patch("/threads/{threadId}/resolve", resolveThread)`.
- **Auth rules:** the user MUST have document access, AND be either the thread creator or an `editor`:
  1. Fetch thread row to get `created_by` and `document_id`.
  2. Call `core.CheckPermission("page", docId, "user", userId, PAGE_ADD_COMMENT)` → IF false return 403 (verifies they still have access to the document).
  3. If `userId == thread.created_by` → allowed.
  4. Else call `core.CheckPermission("page", docId, "user", userId, PAGE_EDIT)` → allowed if true.
  5. Otherwise return 403.
- **SQL:**
  ```sql
  UPDATE core.comment_threads
  SET resolved_by = $1, resolved_at = now()
  WHERE id = $2 AND resolved_at IS NULL
  RETURNING *
  ```
- Return 200 with the updated `CommentThread`.
- **Verify:** Thread creator can resolve. A `viewer` gets 403. An `editor` who is not the creator can resolve. Calling again on an already-resolved thread returns the existing resolved state unchanged (idempotent).

---

### Task B7.1 — `PATCH /api/v1/comment/threads/:threadId/unresolve`

- **Route:** `r.Patch("/threads/{threadId}/unresolve", unresolveThread)`.
- **Auth rules:** Same as B7 (user MUST have document access, AND be either thread creator or an `editor`).
- **SQL:** `UPDATE core.comment_threads SET resolved_by = NULL, resolved_at = NULL WHERE id = $1 AND resolved_at IS NOT NULL RETURNING *`
- Return 200 with the updated `CommentThread`.
- **Verify:** Thread creator can unresolve. An `editor` (who is not the creator) can also unresolve. A `viewer` gets 403. Thread becomes visible in the active threads list again.

---

### Task B8 — `DELETE /api/v1/comment/threads/:threadId`

- **Route:** `r.Delete("/threads/{threadId}", deleteThread)`.
- **Auth rules:** the user MUST have document access, AND be either the thread creator or an `admin`:
  1. Fetch thread to get `created_by` and `document_id`.
  2. Call `core.CheckPermission("page", docId, "user", userId, PAGE_ADD_COMMENT)` → IF false return 403.
  3. If `userId == thread.created_by` → allowed.
  4. Else call `core.CheckPermission("space", spaceId, "user", userId, SPACE_EDIT)` → allowed if true.
  5. Otherwise 403.
- **SQL:** `DELETE FROM core.comment_threads WHERE id = $1` — replies cascade via DB.
- Return 204 (no body).
- **Verify:** 204 on success; replies are gone from DB; 403 for an `editor` who didn't create the thread; 403 for a `commentor` who didn't create the thread; 404 for an unknown threadId.

---

### Task B10 — `POST /api/v1/comment/threads/:threadId/replies`

- **Route:** `r.Post("/threads/{threadId}/replies", createReply)`.
- **Request body:** `{ "body": "reply text" }`.
- **Handler flow:**
  1. `core.GetUserInfo` → extract userId.
  2. Fetch thread to confirm it exists and get `document_id`; 404 if missing.
  3. `core.CheckPermission("page", docId, "user", userId, PAGE_ADD_COMMENT)` → 403 for viewer.
  4. `INSERT INTO core.comment_replies (thread_id, author_id, body) VALUES ($1,$2,$3) RETURNING `*.
  5. Fetch `AuthorInfo` from Zitadel API (or local cache).
  6. Return 201 with `CommentReply`.
- **Verify:** 201 with reply JSON. 403 for viewer token. 404 for unknown `threadId`. 422 for empty body.

---

### Task B11 — `PATCH /api/v1/comment/replies/:replyId`

- **Route:** `r.Patch("/replies/{replyId}", editReply)`.
- **Request body:** `{ "body": "updated text" }`.
- **Auth rules:** the user MUST have document access, AND be the reply author:
  1. Fetch reply and join thread to get `document_id` and `author_id`.
  2. Call `core.CheckPermission("page", docId, "user", userId, PAGE_ADD_COMMENT)` → IF false return 403.
  3. If `userId != reply.author_id` → return 403.
- **SQL:**
  ```sql
  UPDATE core.comment_replies SET body = $1, edited_at = now()
  WHERE id = $2 AND author_id = $3
  RETURNING *
  ```
- If zero rows updated, return 403 (either not author or reply not found — do not distinguish to avoid leaking existence).
- Return 200 with updated `CommentReply`.
- **Verify:** 200 for the reply author with correct `editedAt` populated. 403 for any other user. 422 for empty body.

---

### Task B12 — `DELETE /api/v1/comment/replies/:replyId`

- **Route:** `r.Delete("/replies/{replyId}", deleteReply)`.
- **Auth rules:** the user MUST have document access, AND be the reply author or an `admin`:
  1. Fetch reply to get `author_id` and join thread to get `document_id`.
  2. Call `core.CheckPermission("page", docId, "user", userId, PAGE_ADD_COMMENT)` → IF false return 403.
  3. If `userId == reply.author_id` → allowed.
  4. Else check `SPACE_EDIT` permission → allowed if `admin`/`owner`.
  5. Otherwise 403.
- **SQL:** `DELETE FROM core.comment_replies WHERE id = $1`.
- Return 204.
- **Verify:** 204 for the author. 204 for an admin. 403 for another commentor. 404 for unknown replyId.

---

### Task B13 — Real-time broadcasts via Server-Sent Events (SSE)

- **File:** `server/comment/commentEvents.go` and `server/comment/comment.go`.
- Expose a new SSE endpoint `GET /api/v1/comment/documents/:docId/events`.
- Instead of using a signalling server or WebRTC, the Go server uses an in-memory Hub (or Redis PubSub/Postgres LISTEN/NOTIFY if multi-instance) to distribute events to connected SSE clients.
- After each write operation succeeds (create thread, resolve, unresolve, delete, create reply, edit reply, delete reply), publish a lightweight event to the PubSub channel for `docId`:
  ```json
  { "type": "thread:created" | "thread:resolved" | "thread:unresolved" | "thread:deleted" | "reply:created" | "reply:edited" | "reply:deleted",
    "documentId": "<uuid>",
    "payload": { ...thread or reply object (or just ID for deletions)... } }
  ```
- The SSE endpoint streams these events to the client. Keep-alive pings should be sent to prevent connection drops.
- **Verify:** Two browser sessions open on the same document. User A creates a comment or edits a reply → within 1 second User B's browser receives the event (confirm in DevTools Network tab under EventStream).

---


## Phase 3: Integration

> Replace the Phase 1 mock handler with real API calls and verify end-to-end. All Phase 3 tasks require both Phase 1 (UI) and Phase 2 (backend) to be complete.

---

### Task I1 — Build `commentApiHandler` in the main app

- **File:** `ui/app/core/http/commentApiHandler.ts`
- Implements `CommentAPIHandler` (from `@beskar/editor`) using the existing `get` / `post` helpers from `ui/app/core/http/call.ts` (axios with Bearer token from `localStorage.getItem("access_token")`).
- Base URL comes from `process.env.NEXT_PUBLIC_API_URL` (already set in `.env.local`).
- All paths use the `/api/v1/comment/` prefix established in Phase 2.
  ```ts
  import { get, post } from './call';
  import type { CommentAPIHandler, CommentThread, CommentReply } from '@beskar/editor';

  export function makeCommentApiHandler(documentId: string): CommentAPIHandler {
    const base = process.env.NEXT_PUBLIC_API_URL;
    return {
      getThreads: () =>
        get(`${base}/api/v1/comment/documents/${documentId}/threads`)
          .then(r => r.data.data),

      createThread: (_docId, commentId, quotedText, body) =>
        post(`${base}/api/v1/comment/documents/${documentId}/threads`,
          { commentId, quotedText, body }, {})
          .then(r => r.data.data),

      resolveThread: (threadId) =>
        post(`${base}/api/v1/comment/threads/${threadId}/resolve`, {}, { method: 'PATCH' })
          .then(r => r.data.data),

      deleteThread: (threadId) =>
        // use axios.delete via the pattern in useDelete.ts
        ...,

      addReply: (threadId, body) =>
        post(`${base}/api/v1/comment/threads/${threadId}/replies`, { body }, {})
          .then(r => r.data.data),

      editReply: (replyId, body) =>
        // PATCH /replies/:replyId
        ...,

      deleteReply: (replyId) =>
        // DELETE /replies/:replyId
        ...,
    };
  }
  ```
- **Verify:** Call each method from the browser console against a locally running backend. Check network tab for correct status codes and response shapes.



---

### Task I3 — Integrate `commentApiHandler` in `DocumentEditor` / `TipTap`

- **File:** `ui/app/core/editor/tiptap.tsx`
- Construct `makeCommentApiHandler(pageId)` inside the component and pass it to `<EditorBeskar commentHandler={...} />`.
- Also pass `onCommentClick` → open the `CommentInputPopover`, and wire `onThreadCreated` to reload threads and open the thread card — matching the pattern already built in `editor-demo/App.tsx`.
- The `documentId` passed to the handler must be the page's `docId` string (available in the existing `getDocFromDatabase` response: `docId`).
- **Verify:** Full create-thread flow works with the real DB. Existing threads load on document open. Gutter indicators appear for all threads.

---

### Task I4 — Subscribe to Server-Sent Events (SSE) in the UI

- **File:** `ui/app/core/hooks/useCommentEvents.ts`.
- Create a custom hook that connects to the Go server's SSE endpoint. (If using Bearer tokens instead of cookies, use e.g. `@microsoft/fetch-event-source` to maintain the auth header):
  ```ts
  useEffect(() => {
    // Note: Use fetch-event-source if you need to pass an Authorization header
    const sse = new EventSource(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/comment/documents/${pageId}/events`);
    
    sse.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.documentId !== pageId) return;
      switch (msg.type) {
        case 'thread:created':     setThreads(prev => [...prev, msg.payload]); break;
        case 'thread:resolved':    markThreadResolved(msg.payload.id, true); break;
        case 'thread:unresolved':  markThreadResolved(msg.payload.id, false); break;
        case 'thread:deleted':     setThreads(prev => prev.filter(t => t.id !== msg.payload.id)); break;
        case 'reply:created':      addReplyToState(msg.payload); break;
        case 'reply:edited':       updateReplyInState(msg.payload); break;
        case 'reply:deleted':      removeReplyFromState(msg.payload.id); break;
      }
    };
    
    return () => sse.close();
  }, [pageId]);
  ```
- **Verify:** Open two browser sessions (different users) on the same document. User A adds a comment → User B's thread list and gutter update live without any page refresh.

---

### Task I5 — End-to-end: deleted user scenario

- Have a comment thread authored by a user, then delete that user entirely from the Zitadel console.
- **Verify:**
  - `GET /api/v1/comment/documents/:docId/threads` → Zitadel API will fail to find the user profile. The Go backend should map their `AuthorInfo` to `null` and successfully return the thread.
  - UI renders "👤 Deleted User" with a generic placeholder avatar for all affected thread headers and reply items.
  - All other threads and replies from active users are unaffected.

---

### Task I6 — End-to-end: permission boundaries

Test every API endpoint against each Permify role. Expected results per the permission table in `requirements.md`:


| Endpoint                | viewer | commentor (non-author) | commentor (author) | editor | admin |
| ----------------------- | ------ | ---------------------- | ------------------ | ------ | ----- |
| GET threads             | ✅ 200  | ✅ 200                  | ✅ 200              | ✅ 200  | ✅ 200 |
| POST thread             | ❌ 403  | ✅ 201                  | ✅ 201              | ✅ 201  | ✅ 201 |
| PATCH resolve (own)     | ❌ 403  | ❌ 403                  | ✅ 200              | ✅ 200  | ✅ 200 |
| PATCH resolve (other's) | ❌ 403  | ❌ 403                  | ❌ 403              | ✅ 200  | ✅ 200 |
| PATCH unresolve (own)   | ❌ 403  | ❌ 403                  | ✅ 200              | ✅ 200  | ✅ 200 |
| PATCH unresolve (other) | ❌ 403  | ❌ 403                  | ❌ 403              | ✅ 200  | ✅ 200 |
| DELETE thread (own)     | ❌ 403  | ❌ 403                  | ✅ 204              | ❌ 403  | ✅ 204 |
| DELETE thread (other's) | ❌ 403  | ❌ 403                  | ❌ 403              | ❌ 403  | ✅ 204 |
| POST reply              | ❌ 403  | ✅ 201                  | ✅ 201              | ✅ 201  | ✅ 201 |
| PATCH reply (own)       | ❌ 403  | ❌ 403                  | ✅ 200              | ❌ 403  | ❌ 403 |
| DELETE reply (own)      | ❌ 403  | ❌ 403                  | ✅ 204              | ❌ 403  | ✅ 204 |
| DELETE reply (other's)  | ❌ 403  | ❌ 403                  | ❌ 403              | ❌ 403  | ✅ 204 |


- **Verify:** Each cell in the table confirmed with a real API request (use Zappy request files in `requests/` or a test script). No role gets access it shouldn't have.

