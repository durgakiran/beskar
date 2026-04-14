# Inline Comments UI — Full Implementation Plan

This plan is structured for sequential execution by an agent. Each phase has atomic, testable tasks.
Follow phases in order. Do not skip to a later phase unless the prior phase's testable milestone passes.

---

## Phase 1: Editor Package — Shared Design Tokens & Base Component Refactoring

**Location:** `packages/editor/src/components/`  
**Testing:** `packages/editor-demo` (mock handler, no backend required)  
**Goal:** Establish the visual language shared across all comment UI surfaces.

### 1.1 Update CSS design tokens

**Files:**
- `packages/editor/src/components/CommentSidePanel.css`
- `packages/editor/src/components/CommentThreadCard.css`

**Tasks:**
1. Replace all custom hex colors for comment thread backgrounds with Radix UI CSS variables:
   - The primary comment block background: `var(--accent-2)`
   - The primary comment block border: `var(--accent-6)`
   - High-contrast text inside primary block: `var(--accent-12)`
   - Quote pill background: `var(--gray-1)`
   - Quote pill border: `var(--gray-4)`
   - Section labels ("Discussion"): `var(--gray-11)`
   - Reply composer background: `var(--gray-2)`
   - Reply composer border: `var(--gray-5)`
2. Ensure all updated variables have light-mode defaults from `theme.css` as fallbacks.
3. Do **not** touch `theme.css` itself — it already has Radix mappings.

### 1.2 Refactor `Avatar` component

**Files:**
- `packages/editor/src/components/CommentSidePanel.tsx` (its internal `Avatar`)
- `packages/editor/src/components/CommentThreadCard.tsx` (its internal `Avatar`)

**Tasks:**
1. Standardize both `Avatar` components to `border-radius: 50%`, fixed dimensions `32px × 32px`.
2. Background: `var(--accent-9)`, text: `var(--accent-contrast)`.
3. Font size: `12px`, font-weight: `600`.

### 1.3 Refactor `ReplyItem` — inline actions, no kebab

**Files:**
- `packages/editor/src/components/CommentThreadCard.tsx` (`ReplyItem` component)
- `packages/editor/src/components/CommentSidePanel.tsx` (`ReplyItem` component)

**Tasks:**
1. Remove the kebab-style menu from reply rows.
2. Place "Edit" (pencil icon, `FiEdit2`) and "Delete" (trash icon, `FiTrash2`) icon buttons **inline** on the right side of the `ctc-reply-header` row — always visible, not hover-only.
3. Style them as small ghost buttons (16px size, `var(--gray-11)` color, hover: `var(--gray-12)`).
4. Add a vertical `2px` left border (`var(--gray-5)`) to each `ReplyItem` as the thread connector line (left margin `8px`, padding-left `12px`).

### 1.4 Build the shared `PrimaryCommentBlock` structure

**Files:**
- `packages/editor/src/components/CommentThreadCard.tsx`
- `packages/editor/src/components/CommentSidePanel.tsx`

**Tasks:**
1. Both files have a concept of showing the opening comment (quoted text + author body). Extract these into a consistent HTML structure that can be styled uniformly:
   ```
   <div class="primary-comment-block">        ← accent-2 bg, accent-6 border, 8px border-radius
     <div class="primary-comment-header">     ← flex row: Avatar | [Name + Time] | [Actions]
     </div>
     <div class="primary-comment-quote">      ← gray-1 bg, gray-4 border, italic text in quotes
       "quotedText"
     </div>
     <p class="primary-comment-body">         ← text of the opening reply
     </p>
   </div>
   ```
2. Timestamp format: `2h ago`, `32m ago`, `3d ago` — no block-type context string (no "· Paragraph 2").
3. Actions (Resolve ✓, Edit ✎, Delete 🗑) appear as inline icon buttons in the header row right-aligned.

**Testable Milestone — Phase 1:**  
Run editor-demo (steps in Verification Plan A). The existing comment UI renders without crashes. Token colors look correct in the browser — light purple header, gray quote boxes. No hard-coded hex colors remain in the two CSS files.

---

## Phase 2: Editor Package — Refactor `CommentThreadCard.tsx` (Floating Popover)

**Location:** `packages/editor/src/components/CommentThreadCard.tsx`  
**Testing:** `packages/editor-demo` (mock handler)  
**Goal:** Match Image 1 precisely.

### 2.1 Replace the navigation-bar header

**Current state:** The `ctc-nav-bar` div contains `< >` prev/next arrows on the left and a close button on the right.

**New structure:**
```html
<div class="ctc-header">
  <div class="ctc-header-left">
    <span class="ctc-header-title">Comment thread</span>
    <span class="ctc-header-subtitle">1 thread · {replies.length + 1} comments</span>
  </div>
  <button class="ctc-close-btn" onClick={onClose}><FiX /></button>
</div>
```
- Remove `<KebabMenu />` entirely.
- Remove the `KebabMenu` component definition.
- Remove `handleEditMain` and `openingEditNonce` state (editing is now inline via `ReplyItem`).

### 2.2 Apply Primary Comment Block to opening thread

Replace the current `ctc-author-row` + `ctc-intro-panel` combo with the shared `PrimaryCommentBlock` structure from Phase 1.4:
- Avatar + Name + `formatRelativeTime(createdAt)`.
- Inline `Resolve (FiCheckCircle)`, `Edit (FiEdit2)`, `Delete (FiTrash2)` icon buttons.
  - Edit triggers `setEditing(true)` **inside the embedded `ReplyItem` (variant="embedded")** as before, but now via a direct nonce or state directly passed — no kebab menu routing needed.
  - Resolve calls `handleResolve()`.
  - Delete calls `handleDelete()`.
- Quoted text in the pill box.
- Opening reply body rendered as `<ReplyItem variant="embedded">`.

### 2.3 Add "Discussion" section header above replies

```html
<div class="ctc-discussion-header">
  <FiMessageSquare size={13} />
  <span>Discussion</span>
</div>
```
Render this above `followUps.map(...)`. Style: `var(--gray-11)` color, `11px` font, uppercase letter-spacing.

### 2.4 Replace the reply `<input>` with expanded composer

**Current:**
```html
<div class="ctc-reply-bar">
  <input class="ctc-reply-field" ...>
```

**New:**
```html
<div class="ctc-reply-composer">
  <div class="ctc-reply-composer-label">Reply to thread</div>
  <textarea class="ctc-reply-textarea" placeholder="Write a reply..." rows={3} ...></textarea>
  <div class="ctc-reply-composer-actions">
    <button class="ctc-attach-btn">
      <FiPaperclip size={14} /> Attach
    </button>
    <button class="ctc-send-btn" disabled={!replyBody.trim()}>
      <FiCornerDownLeft size={14} /> Reply
    </button>
  </div>
</div>
```
- `Attach` button is **wired in Phase 4** (file input, upload, attach to reply). For now it is a styled placeholder only.
- `Reply` button calls `handleSubmitReply()`.
- `Cmd/Ctrl + Enter` in the textarea also submits.

**Testable Milestone — Phase 2:**  
Click a highlighted comment span in editor-demo. The floating card shows: new header without arrows, purple primary comment block with inline action buttons, Discussion label, replies with threading lines, expanded textarea composer.

---

## Phase 3: Editor Package — Refactor `CommentSidePanel.tsx`

**Location:** `packages/editor/src/components/CommentSidePanel.tsx`  
**Testing:** `packages/editor-demo` (mock handler)  
**Goal:** Match Image 2 (list view) and Image 3 (thread detail view).

### 3.1 Redesign `ThreadCard` (list view, readonly mode)

The current `isReadOnly` branch renders a `<button>` with a basic preview. Replace it with:

```html
<div class="csp-thread-card csp-thread-card--list">
  <!-- Primary Comment Block (as per Phase 1.4 structure) -->
  <div class="primary-comment-block">
    <div class="primary-comment-header">
      <Avatar name={thread.createdByName} />
      <div class="csp-thread-meta">
        <span class="csp-author">{thread.createdByName}</span>
        <span class="csp-ts">{formatRelativeTime(thread.createdAt)}</span>
      </div>
      <!-- Inline actions: Resolve, Edit, Delete -->
    </div>
    <div class="primary-comment-quote">"{quotedText}"</div>
    <p class="primary-comment-body">{rootBody}</p>
  </div>
  <!-- View Thread link -->
  <button class="csp-view-thread-btn" onClick={() => onOpenThread(thread.id)}>
    <FiMessageSquare size={13} /> View thread
  </button>
</div>
```

Remove `isReadOnly` and `isEditable` distinctions inside `ThreadCard` for rendering — unify the structure.  `isActive` class still applies for the highlighted state.

### 3.2 Merge `ReadonlyThreadDetail` into a unified `ThreadDetail`

**Current:** `ReadonlyThreadDetail` is a separate component only used in view mode (non-editable).  
**New:** Rename to `ThreadDetail`, usable in both edit and read-only modes. The layout:

```html
<>
  <!-- Panel header -->
  <div class="csp-header">
    <div class="csp-title-block">
      <h3 class="csp-title">Comment thread</h3>
      <div class="csp-subtitle">1 thread · {replies.length + 1} comments</div>
    </div>
    <div class="csp-header-actions">
      <button class="csp-back-chip" onClick={onBack}>
        <FiArrowLeft /> All threads
      </button>
      <button class="csp-close-btn" onClick={onClose}><FiX /></button>
    </div>
  </div>

  <!-- Scrollable body -->
  <div class="csp-body csp-body--thread">
    <!-- Primary Comment Block (Phase 1.4 structure) -->
    ...

    <!-- Discussion section -->
    <div class="csp-discussion-header">Discussion</div>
    <div class="csp-replies csp-replies--detail">
      {followUps.map(reply => <ReplyItem key={reply.id} ... />)}
    </div>

    <!-- Reply Composer (same structure as Phase 2.4) -->
    <div class="csp-reply-composer">
      <div class="csp-reply-composer-label">Reply to thread</div>
      <textarea ...></textarea>
      <div class="csp-reply-composer-actions">
        <button class="csp-attach-btn"><FiPaperclip /> Attach</button>
        <button class="csp-send-btn"><FiCornerDownLeft /> Reply</button>
      </div>
    </div>
  </div>
</>
```

Update the main `CommentSidePanel` to use `ThreadDetail` instead of `ReadonlyThreadDetail` for **both** edit and view modes when `selectedThreadId` is set.

### 3.3 Update the Open/Resolved filter tabs (view mode)

Current: `Open` and `Resolved` pill buttons are already in place. Confirm they still work correctly after the ThreadCard redesign.

**Testable Milestone — Phase 3:**  
In editor-demo: open the side panel. Thread cards show the purple primary block with inline actions and "View thread" button. Click "View thread" — the detail panel opens with the unified layout (Discussion section, threaded replies, expanded Reply composer with Attach and Reply buttons).

---

## Phase 4: Attachment Support — Editor Package Types & Mock API

**Location:** `packages/editor/src/types/index.ts` (types) + `packages/editor-demo/src/mockCommentHandler.ts` (mock)  
**Testing:** `packages/editor-demo`  
**Goal:** Wire up the Attach button so it works end-to-end in the demo environment, proving the flow before real backend integration.

### 4.1 Extend `CommentReply` type

**File:** `packages/editor/src/types/index.ts`

Add `attachments` field to `CommentReply`:
```typescript
export interface CommentAttachment {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface CommentReply {
  id: string;
  threadId: string;
  authorId: string | null;
  authorName: string | null;
  body: string;
  editedAt?: string;
  createdAt: string;
  attachments?: CommentAttachment[];   // ← NEW
}
```

Also extend `CommentAPIHandler` to accept attachments in `addReply` and `editReply`:
```typescript
export interface CommentAPIHandler {
  // ...existing methods...
  addReply: (threadId: string, body: string, attachments?: CommentAttachment[]) => Promise<CommentReply>;
  editReply: (replyId: string, body: string, attachments?: CommentAttachment[]) => Promise<CommentReply>;
}
```

### 4.2 Update `mockCommentHandler.ts`

**File:** `packages/editor-demo/src/mockCommentHandler.ts`

1. Update `addReply` signature to accept optional `attachments?: CommentAttachment[]` and store them on the created `CommentReply` object.
2. Update `editReply` signature similarly.
3. Add 1–2 seed attachments to `seedThread1.replies[0]` for visual testing:
   ```typescript
   attachments: [
     { id: 'att-1', url: '#', fileName: 'requirements.pdf', mimeType: 'application/pdf', fileSize: 204800 }
   ]
   ```

### 4.3 Wire the Attach button in `CommentThreadCard.tsx` and `CommentSidePanel.tsx`

In both the popover and side panel detail/composer:
1. Add a hidden `<input type="file" ref={fileInputRef}>` element.
2. The `Attach` button click triggers `fileInputRef.current?.click()`.
3. On `onChange`, read the selected file, create a local preview object:
   ```typescript
   const mockAttachment: CommentAttachment = {
     id: crypto.randomUUID(),
     url: URL.createObjectURL(file),
     fileName: file.name,
     mimeType: file.type,
     fileSize: file.size,
   };
   setPendingAttachments(prev => [...prev, mockAttachment]);
   ```
4. Render `pendingAttachments` as a chip list below the textarea with a remove (×) button.
5. On submit, pass `pendingAttachments` into `addReply(threadId, body, pendingAttachments)`.
6. In `ReplyItem`, render `reply.attachments` as a file-chip list below the body text (icon + filename + size).

**Testable Milestone — Phase 4:**  
In editor-demo: open a thread detail. Click Attach, pick any file. A chip appears below the textarea showing the filename. Submit reply. The reply appears with the file chip. Seeded thread 1 already shows a PDF chip.

---

## Phase 5: Backend — Go Server Attachment Support for Comment Replies

**Location:** `server/comment/` and `db/beskar/updates/`  
**Testing:** Full app (`sh ./docker/app/app.sh` + `docker restart tededox-server`)  
**Goal:** Persist attachment references in the database as part of comment replies.

### 5.1 Add a DB migration for `comment_reply_attachments`

**File:** `db/beskar/updates/comments.xml`

Add a new `changeSet` after the existing `id="5-add-inline-comment-anchor-metadata"`:

```xml
<changeSet id="6-create-comment-reply-attachments-table" author="kiran kumar">
  <createTable tableName="comment_reply_attachments" schemaName="core">
    <column name="id" type="UUID" defaultValueComputed="gen_random_uuid()">
      <constraints primaryKey="true" nullable="false"/>
    </column>
    <column name="reply_id" type="UUID">
      <constraints nullable="false"
        foreignKeyName="fk_cra_reply"
        references="core.comment_replies(id)"
        deleteCascade="true"/>
    </column>
    <column name="attachment_id" type="UUID">
      <constraints nullable="false"
        foreignKeyName="fk_cra_attachment"
        references="core.attachments(id)"
        deleteCascade="true"/>
    </column>
    <column name="created_at" type="TIMESTAMPTZ" defaultValueComputed="now()">
      <constraints nullable="false"/>
    </column>
  </createTable>
  <sql>
    GRANT SELECT, INSERT, DELETE ON TABLE core.comment_reply_attachments TO ${app_user};
  </sql>
</changeSet>
```

> [!NOTE]
> This joins to `core.attachments` — the existing attachment storage table used by the document attachment system. Files are uploaded via the existing `POST /api/v1/attachments/upload` endpoint before being associated with a reply.

### 5.2 Update Go types

**File:** `server/comment/types.go`

Add `Attachments` to `CommentReply`:
```go
type CommentAttachment struct {
    ID         string `json:"id"`
    URL        string `json:"url"`
    FileName   string `json:"fileName"`
    MimeType   string `json:"mimeType"`
    FileSize   int64  `json:"fileSize"`
}

type CommentReply struct {
    ID          string              `json:"id"`
    ThreadID    string              `json:"threadId"`
    Author      *AuthorInfo         `json:"author"`
    Body        string              `json:"body"`
    EditedAt    *time.Time          `json:"editedAt,omitempty"`
    CreatedAt   time.Time           `json:"createdAt"`
    Attachments []CommentAttachment `json:"attachments"`  // ← NEW (always an array, never nil)
}
```

### 5.3 Add validation type for create/edit reply

**File:** `server/comment/commentValidations.go`

Update `CreateReplyReq` and `EditReplyReq` to include optional attachment IDs:
```go
type CreateReplyReq struct {
    Body          string   `json:"body"`
    AttachmentIDs []string `json:"attachmentIds,omitempty"`
}

type EditReplyReq struct {
    Body          string   `json:"body"`
    AttachmentIDs []string `json:"attachmentIds,omitempty"`
}
```

### 5.4 Add SQL queries

**File:** `server/comment/queries.go`

Add the following constants:
```go
// INSERT_REPLY_ATTACHMENT links an uploaded file to a reply
INSERT_REPLY_ATTACHMENT = `
    INSERT INTO core.comment_reply_attachments (reply_id, attachment_id)
    VALUES ($1, $2)`

// LIST_REPLY_ATTACHMENTS fetches attachment metadata joined for a set of reply IDs
LIST_REPLY_ATTACHMENTS = `
    SELECT cra.reply_id, a.id, a.file_name, a.mime_type, a.file_size,
           '/api/v1/attachments/' || a.id AS url
    FROM core.comment_reply_attachments cra
    JOIN core.attachments a ON a.id = cra.attachment_id
    WHERE cra.reply_id = ANY($1::uuid[])`
```

### 5.5 Update `commentService.go`

**File:** `server/comment/commentService.go`

1. **`CreateReply`**: After inserting the reply row, if `attachmentIDs` is non-empty, execute `INSERT_REPLY_ATTACHMENT` for each ID in a loop within the same connection context.
2. **`EditReply`**: After editing the reply body, delete existing `comment_reply_attachments` for the reply and re-insert `attachmentIDs`.
3. **`ListThreads`**: After fetching threads+replies, run `LIST_REPLY_ATTACHMENTS` with all collected `reply_id`s and attach the results to the corresponding `CommentReply.Attachments` slice.
4. Initialize `Attachments` to `[]CommentAttachment{}` (empty slice, not `nil`) for all replies to ensure JSON serializes as `[]` not `null`.

### 5.6 Update `commentController.go`

**File:** `server/comment/commentController.go`

1. In `createReply`: decode `req.AttachmentIDs`, pass to `svc.CreateReply(ctx, threadId, req.Body, req.AttachmentIDs, user.AId)`.
2. In `editReply`: decode `req.AttachmentIDs`, pass to `svc.EditReply(ctx, replyId, req.Body, req.AttachmentIDs, user.AId)`.

**Testable Milestone — Phase 5:**  
Run the DB migration: `sh ./docker/database/db.sh`. Restart the server: `docker restart tededox-server`. Use the API test files in `@requests/` to POST a reply with `"attachmentIds": ["existing-attachment-uuid"]`. Confirm the `GET /threads` response now has `"attachments": [{ "id": ..., "url": ..., ... }]` on the reply.

---

## Phase 6: UI Integration — Wire Attachments in `commentApiHandler.ts`

**Location:** `ui/app/core/http/commentApiHandler.ts`  
**Testing:** Full app (`docker restart tededox-ui`)  
**Goal:** The UI sends attachment IDs to the backend and correctly maps the attachment objects back.

### 6.1 Update `mapBackendReply`

**File:** `ui/app/core/http/commentApiHandler.ts`

```typescript
const mapBackendAttachment = (a: any): CommentAttachment => ({
  id: a.id,
  url: a.url,
  fileName: a.fileName,
  mimeType: a.mimeType,
  fileSize: a.fileSize,
});

const mapBackendReply = (r: any): CommentReply => ({
  ...r,
  authorId: r.author?.id || null,
  authorName: r.author?.name || "Deleted User",
  attachments: (r.attachments || []).map(mapBackendAttachment),
});
```

### 6.2 Update `addReply` and `editReply` to send attachment IDs

```typescript
addReply: async (threadId, body, attachments) => {
  const response = await post(
    `${BASE_URL}/api/v1/comment/threads/${threadId}/replies`,
    { body, attachmentIds: (attachments || []).map(a => a.id) },
    {}
  );
  return mapBackendReply(response.data.data);
},

editReply: async (replyId, body, attachments) => {
  const res = await fetch(`${BASE_URL}/api/v1/comment/replies/${replyId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("access_token")}` },
    body: JSON.stringify({ body, attachmentIds: (attachments || []).map(a => a.id) }),
    credentials: "include"
  });
  if (!res.ok) throw new Error(`Edit reply failed: ${res.status}`);
  const json = await res.json();
  return mapBackendReply(json.data);
},
```

### 6.3 Upload file first via existing attachment handler, then submit reply

**File:** `ui/app/core/editor/tiptap.tsx`

The `TipTap` component already has `attachmentHandler` with `uploadAttachment`. For comment attachments:
1. In `CommentThreadCard` and `CommentSidePanel` (the `Attach` button), the file input `onChange` should call `attachmentHandler.uploadAttachment(file)` **if available** — OR fall back to the mock local-URL approach from Phase 4.
2. On successful upload, create a `CommentAttachment` from the `AttachmentUploadResult` response and add it to `pendingAttachments`.
3. Pass `attachmentHandler` prop down from `TipTap` into `CommentThreadCard` and `CommentSidePanel`.

> [!IMPORTANT]
> This requires adding `attachmentHandler?: AttachmentAPIHandler` to `CommentThreadCardProps` and `CommentSidePanelProps` interfaces.

**Testable Milestone — Phase 6:**  
In the full app at `https://app.durgakiran.com` (login: `beskaruser1@gmail.com` / `Password@1`): open a document, click a comment highlight, attach a file via the new Attach button, submit the reply. Reload the page — the reply persists with the attachment chip shown.

---

## Verification Plan

### Part A — Testing `editor` & `editor-demo` (Phases 1–4)

Per `new-features/inline-comments/how-to-test-editor-package.md`:

```bash
# 1. Switch to Node 22
nvm use 22

# 2. Build the editor package (from repo root or packages/editor)
cd packages/editor
rm -rf node_modules package-lock.json
npx npm install
npm run build

# 3. Install and run editor-demo
cd ../editor-demo
rm -rf node_modules package-lock.json
npx npm install
npm run dev
```

Open `http://localhost:5173` (or the port shown). Use the browser-subagent to verify:
- Comment thread card shows new header, purple block, inline action buttons, discussion section, expanded textarea.
- Side panel card list shows purple blocks with "View thread" button.
- Side panel thread detail matches the card layout exactly.
- Attaching a file appends a chip; submitting reply shows the attachment.

### Part B — Testing full application (Phases 5–6)

Per `docs/how-to-test-app.md`:

```bash
# 1. Bring DB up and apply migrations
sh ./docker/database/db.sh

# 2. Bring all app containers up
sh ./docker/app/app.sh

# 3. After Go server changes, restart the server container
docker restart tededox-server

# 4. After UI changes, restart the UI container
docker restart tededox-ui
```

Open `https://app.durgakiran.com`, login with `beskaruser1@gmail.com` / `Password@1`.

Manual checks:
1. Comment cards in side panel render with new design.
2. Reply with attachment — verified the attachment row persists on page reload.
3. Resolve/Edit/Delete actions work inline in the new UI (no kebab).
4. Attachment is downloadable via the chip link.
