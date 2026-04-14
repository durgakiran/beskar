# User Stories & Tasks: Generic File Attachments (Inline)

> **Strategy**: Editor package and `packages/editor-demo` first (types, inline node, paste/drop, slash entry, mock handler). Backend and `ui` integration follow once the upload/download contract is stable.
>
> Full product spec: [`req-file-attachments.md`](./req-file-attachments.md).

---

## Architecture decision log

| # | Decision | Chosen approach |
| --- | --- | --- |
| 1 | **Blob lifecycle on chip delete** | Application / backend job responsibility. Editor does not call `deleteAttachment` on chip removal unless the app explicitly wires it via the optional hook. |
| 2 | **Video MIME routing** | Route `video/*` through the existing image flow (or reject with a toast) — **not** through the attachment flow in v1. |
| 3 | **Upload cancellation** | `uploadAttachment(file, { signal?: AbortSignal })` — v1 includes the signal parameter in the type even if the mock and initial backend implementation don't abort. |
| 4 | **`pageId` threading** | Bound into the handler closure at construction: `createAttachmentHandler(pageId)`. Not passed per-call. |
| 5 | **Inline vs block** | **Inline node** (`inline: true`, `atom: true`, `group: 'inline'`). Renders as a chip within text flow, not a full-width block. |
| 6 | **`onAttachmentsChange` shape** | Single callback `(attachments: AttachmentRef[]) => void` — fires with the current list of completed (non-uploading) attachments in the doc. App maintains its own panel. |

---

## Epic: File attachments

| Phase | Goal |
| --- | --- |
| **Phase 1 — Editor package** | Types, `AttachmentInline` inline node + chip view, paste/drop + slash UX, `onAttachmentsChange` emission, read-only behavior, registration in `getExtensions`. |
| **Phase 2 — Editor demo (mock)** | Mock `AttachmentAPIHandler`, wiring, manual/automated checks without backend. |
| **Phase 3 — Backend** | DB schema, upload API, storage, validation, authorized download, config for limits and allowlist. |
| **Phase 4 — App integration** | `ui` uses real handler; shared config for max size / MIME rules; rejection toasts wired; app attachment panel subscribes to `onAttachmentsChange`. |

---

## Phase 1: Editor package (`packages/editor`)

> Verify with unit-level checks where noted; full interactive checks land in Phase 2 (editor-demo).

---

### Story 1 — Types and upload contract

**As a** developer,
**I want** shared TypeScript types for attachment upload results, the handler API, and the `onAttachmentsChange` callback,
**So that** the node, plugins, and app all agree on fields and behavior.

#### Task 1.1 — Define `AttachmentUploadResult`, `AttachmentRef`, and `AttachmentAPIHandler`

**What this task is:** TypeScript interfaces only — no UI. Same idea as the existing `ImageAPIHandler` + `ImageUploadResult` pair: the editor package stays dumb about HTTP details; the host app implements the handler.

**`AttachmentUploadResult`** — Success payload after `uploadAttachment` resolves. Stored in the inline node attrs.

| Field | Purpose |
| --- | --- |
| `attachmentId` | Stable server id (for retries, future delete, or APIs that don't use raw URLs). |
| `url` | Download/source reference stored in the node (may be a path or API URL). |
| `mimeType`, `fileName`, `fileSize` | Shown on the chip; should match what was uploaded. |

**`AttachmentRef`** — Lightweight read-only summary emitted via `onAttachmentsChange`. Same fields as `AttachmentUploadResult` (the app doesn't need to re-parse doc JSON).

**`AttachmentAPIHandler`** — Callbacks the host implements:

| Member | Required | Purpose |
| --- | --- | --- |
| `uploadAttachment(file, { signal? })` | **Yes** | POST the `File`; return `AttachmentUploadResult`. Reject on failure. |
| `getAttachmentUrl?(url)` | Optional | Rewrite a stored URL (CDN host, fresh signed URL) before display or download. |
| `downloadAttachment?(params)` | Optional | App-owned download (auth headers, blob save). Falls back to credentialed fetch + blob save if absent. |
| `deleteAttachment?(attachmentId)` | Optional | Needed only if lifecycle policy is "immediate delete on chip removal". |

- **File**: `packages/editor/src/types/index.ts` (alongside `ImageAPIHandler`).
- **Verify**: `pnpm exec tsc --noEmit` in `packages/editor` passes with no new errors.

#### Task 1.2 — Extend `EditorProps` / `GetExtensionsOptions`

- **Files**: `packages/editor/src/types/index.ts`, `packages/editor/src/extensions/index.ts`.
- Add optional fields:
  - `attachmentHandler?: AttachmentAPIHandler`
  - `maxAttachmentBytes?: number`
  - `onAttachmentRejected?: (reason: 'too_large' | 'mime_not_allowed', file: File) => void`
  - `allowedMimeAccept?: string` (native `accept` attribute value for the file picker)
  - `onAttachmentsChange?: (attachments: AttachmentRef[]) => void`
- Thread `attachmentHandler` (and size/config/callbacks) into extension configuration the same way `imageHandler` is threaded into `ImagePasteDrop`.
- **Verify**: `Editor` props accept the new optional fields; `getExtensions` compiles when called with and without `attachmentHandler`.

---

### Story 2 — `AttachmentInline` schema and serialization

**As a** developer,
**I want** an inline TipTap node that serializes attachment metadata to JSON/HTML,
**So that** documents round-trip and collaborate correctly.

#### Task 2.1 — Create `AttachmentInline` node extension

- **File**: `packages/editor/src/nodes/AttachmentInline.ts` (schema name: `attachmentInline`).
- **Attrs**: `attachmentId` (string | null while uploading), `fileUrl` (string), `fileName`, `fileSize` (number), `fileType` (MIME string), `placeholderId` (string, client-generated for collab), `uploadStatus` (`'uploading' | 'success' | 'error'`), `errorMessage` (string, optional).
- **Rules**: `inline: true`, `atom: true`, `group: 'inline'`. Not draggable as a block — it sits within text flow.
- **parseHTML / renderHTML**: stable `data-*` attributes; a `<span>` wrapper with `data-type="attachment-inline"`.
- **Verify**: `editor.commands.insertContent({ type: 'attachmentInline', attrs: { ... } })` then `editor.getJSON()` contains the node with all attrs intact.

#### Task 2.2 — `insertAttachmentPlaceholder` command (or equivalent)

- **Behavior**: Insert an inline node at the current cursor with `uploadStatus: 'uploading'`, a new UUID `placeholderId`, `fileName` / `fileSize` / `fileType` from the `File`, `fileUrl` and `attachmentId` empty.
- **Verify**: After insert, document has exactly one new `attachmentInline` at the expected position; `placeholderId` is non-empty and unique per insert.

#### Task 2.3 — Helper to find node by `placeholderId`

- **Purpose**: After async upload resolves, locate the correct node to update (collab-safe vs naive position tracking).
- **Verify**: With two placeholders in the doc, updating by `placeholderId` changes only the matching node's attrs.

---

### Story 3 — Inline chip UI (uploading, success, error)

**As a** user,
**I want** a compact inline chip for uploading, completed, and failed attachments,
**So that** I can see upload state and download files without leaving the text flow.

#### Task 3.1 — Implement `AttachmentInlineView` (React node view)

- **File**: `packages/editor/src/components/attachment/AttachmentInlineView.tsx`.
- Render as a `<span>` chip (not a block `<div>`). Must not force a line break by itself.
- **Uploading**: `📎 filename.pdf ↻` — muted/gray, spinner icon on the right, not interactive.
- **Success**: `📎 filename.pdf` — full color, entire chip is clickable (`onClick` triggers download). Use `title` and `aria-label` including the filename.
- **Error**: `⚠ filename.pdf` — error-tinted, plus a small **Retry** action (if original `File` still in closure) and always a **Remove** action. Retry re-invokes the upload; Remove deletes the node.
- **Progress (best-effort)**: If the handler provides upload progress (e.g. via an `onProgress` callback or `XMLHttpRequest`), display an animated spinner or thin progress fill inside the chip. If not available, a static label is acceptable.
- **Error routing**:

  | Error condition | Toast | Inline error chip |
  | --- | --- | --- |
  | File too large (before insert) | yes | no |
  | MIME not allowed (before insert) | yes | no |
  | Network failure during upload | no | yes (Retry + Remove) |
  | Server `4xx` on upload | no | yes (Retry + Remove) |
  | Server `5xx` on upload | no | yes (Retry + Remove) |

- **Verify**: In editor-demo, trigger mock success/error paths; confirm all three chip states; inspect Download `aria-label` in devtools.

#### Task 3.2 — Download behavior

- If `downloadAttachment` hook is provided on the handler, delegate to it.
- Otherwise: `fetch(url, { credentials: 'include' })` → blob URL → trigger `<a download>` click → revoke URL.
- **Verify**: Against mock URL in editor-demo, clicking the success chip triggers a file save (or blob open). No console error.

#### Task 3.3 — `formatFileSize` utility

- **File**: `packages/editor/src/components/attachment/formatFileSize.ts` (may already exist from prior work — reuse or update).
- **Verify**: `0` → `"0 B"`, `1024` → `"1 KB"`, `1536000` → `"1.5 MB"`.

#### Task 3.4 — Chip styles

- **Files**: `packages/editor/src/styles/editor.css` or a colocated CSS module.
- The chip is `display: inline-flex`, `align-items: center`, `gap: 4px`, with a subtle border, rounded corners, small padding (`2px 6px`). Use Radix accent CSS variables for theming (plum accent).
- States: uploading — muted; success — full color, cursor pointer; error — error/red tint.
- **Verify**: Chip does not break to a new line mid-word on its own. Long filename truncates with ellipsis (`max-width`, `overflow: hidden`, `text-overflow: ellipsis`). Chip sits inline with surrounding text.

---

### Story 4 — `onAttachmentsChange` emission

**As a** consuming application developer,
**I want** the editor to notify me whenever the set of completed attachments in the document changes,
**So that** I can maintain my own attachment panel without parsing the doc JSON.

#### Task 4.1 — Derive and emit attachment list on doc change

- **Where**: In `AttachmentPasteDrop` (or a dedicated plugin), subscribe to ProseMirror's `update` transaction. After each transaction, walk the doc and collect all `attachmentInline` nodes with `uploadStatus === 'success'`, map them to `AttachmentRef[]`, and call `onAttachmentsChange?.(refs)` if the list has changed (shallow compare by `attachmentId` to avoid spurious calls).
- **Verify**: Insert a chip → upload succeeds → `onAttachmentsChange` fires with one entry. Delete the chip → fires with zero entries. Mid-upload node does not appear in the list.

---

### Story 5 — Slash command: File attachment

**As a** user,
**I want** to type `/file` (and related terms) and attach files from the picker,
**So that** I can upload without drag-drop.

#### Task 5.1 — Add **Media** slash group and move Image into it

- **File**: `packages/editor/src/extensions/slash-command/groups.ts`.
- Add a new group `{ name: 'media', title: 'Media', commands: [...] }`.
- **Move** the existing **Image** command from the current `format` group into **Media**.
- **Verify**: Open slash menu — **Media** section shows **Image** and **File attachment**; Image is gone from Format.

#### Task 5.2 — **File attachment** command implementation

- **Behavior**:
  - `shouldBeHidden`: return `true` when `!editor.isEditable` or when `attachmentHandler` is not configured.
  - **Action**: Create a hidden `<input type="file" multiple accept="<allowedMimeList>">`. On change, for each selected file enqueue one upload using the shared upload helper (Story 6). The inline chip is inserted at the current cursor position, inside the current paragraph.
- **Aliases**: `file`, `attachment`, `upload`, `pdf`, `zip`.
- **Icon**: paperclip.
- **Verify**: With handler + editable editor, selecting two files inserts two ordered inline chips at the cursor. With `editable: false`, command is hidden.

#### Task 5.3 — Keyboard / focus

- After the file picker closes (files chosen or cancelled), focus returns to the editor at the previous caret position. The hidden input must not trap focus or appear in the tab order.
- **Verify**: Manual — Tab/arrow through slash menu, activate File attachment, cancel picker. Editor remains focusable; caret is where the user left it.

---

### Story 6 — Paste, drop, and routing vs images

**As a** user,
**I want** to paste or drop non-image files into the editor,
**So that** attachments behave like other tools, without stealing image uploads.

#### Task 6.1 — Implement `AttachmentPasteDrop` extension

- **File**: `packages/editor/src/extensions/attachment-paste-drop.ts`.
- **handleDrop / handlePaste**: If `!editor.isEditable` or no `attachmentHandler`, return `false`. For each file: if `image/*`, return `false` (let `ImagePasteDrop` handle it). For all others: run client size check (Task 6.2); insert inline placeholder at drop/paste position; call `uploadAttachment`; on success update by `placeholderId`; on failure set `uploadStatus: 'error'`.
- Store handler options in `editor.storage.attachmentPasteDrop` for access by other components (slash command, node view).
- **Verify**: Drop a `.pdf` → inline chip (uploading → success). Drop a `.png` → image flow used, not attachment.

#### Task 6.2 — Client-side max size check

- **Behavior**: If `file.size > maxAttachmentBytes`, do **not** insert a placeholder. Call `onAttachmentRejected?.('too_large', file)`. The host app wires this to a toast.
- **Verify**: With `maxAttachmentBytes: 100`, dropping a 101-byte file produces no new node; callback fires with `'too_large'`.

#### Task 6.3 — Clipboard file paste

- Route non-image files from `clipboardData.files` the same as a drop at the current selection.
- **Verify**: Document manual QA steps in the PR.

#### Task 6.4 — Multiple files in one gesture

- Files are inserted in `Array` order; each has its own independent upload lifecycle.
- **Verify**: Drop three small files: three chips appear in order. Failing the middle upload leaves the first and third resolving correctly.

#### Task 6.5 — Register plugin and ordering

- **File**: `packages/editor/src/extensions/index.ts`.
- Register `AttachmentPasteDrop` after `ImagePasteDrop` so image routing is handled first.
- **Verify**: Single image drop → one image block. Mixed PDF + PNG drop → one inline attachment chip + one image block.

---

### Story 7 — Upload helper shared logic

**As a** developer,
**I want** shared upload-lifecycle logic (placeholder insert → upload → success/error update),
**So that** slash, paste, and drop all behave identically without duplicating code.

#### Task 7.1 — `startAttachmentUpload` helper

- **File**: `packages/editor/src/extensions/attachment-upload.ts` (may already exist from prior block-based work — adapt for inline node).
- **Behavior**:
  1. Insert an inline placeholder node at the given position.
  2. Call `attachmentHandler.uploadAttachment(file, { signal })`.
  3. On success: find node by `placeholderId`, replace attrs with `uploadStatus: 'success'` + server result.
  4. On failure: find node by `placeholderId`, set `uploadStatus: 'error'`, `errorMessage`.
  5. After any outcome: trigger `onAttachmentsChange` scan (Story 4).
- The node view's closure retains the original `File` reference for Retry.
- **Verify**: Full upload flow works end-to-end in the demo (Story 8).

---

### Story 8 — Read-only and exports

**As a** reader,
**I want** to download attachments when the document is view-only,
**So that** I can access files without editing.

#### Task 8.1 — Read-only editor behavior

- Paste/drop/slash insert all no-op when `!editable`. Completed chip's click-to-download remains usable when `fileUrl` is present.
- **Verify**: `editable: false` in demo: cannot insert new attachment via slash or drop. Existing chip download still works.

#### Task 8.2 — Export `AttachmentInline` and types from package entry

- **File**: `packages/editor/src/index.ts`.
- **Verify**: Consumer can import `AttachmentInline` and `AttachmentAPIHandler` from the editor package.

---

## Phase 2: Editor demo (`packages/editor-demo`)

### Story 9 — Mock attachment API

**As a** developer,
**I want** a mock upload that simulates delay, success, and failure,
**So that** the full UI can be reviewed before backend exists.

#### Task 9.1 — Create `mockAttachmentHandler.ts`

- Simulate latency (500–800 ms); return deterministic fake `attachmentId` and `url` (blob URL or `/mock/...`).
- Support a query flag (e.g. `?attachmentFail=1`) to force failure for the error state.
- **Verify**: Upload completes → chip shows success + is clickable. Failure mode → error chip with Retry; clicking Retry re-uploads (mock resolves).

#### Task 9.2 — Wire handler, limits, rejection toast, and `onAttachmentsChange` in `App.tsx`

- Pass `attachmentHandler`, `maxAttachmentBytes`, `onAttachmentRejected` (→ `console.warn` or simple alert), and `onAttachmentsChange` (→ `console.log` the list) into `<Editor>`.
- **Verify**: Run `npm run dev` in `packages/editor-demo`; execute slash `/file`, drag-drop, and clipboard paste scenarios from Stories 5–6. Oversized file shows a toast, not a broken chip. `onAttachmentsChange` log reflects current completed attachments.

#### Task 9.3 — Manual QA checklist (in PR description or demo README)

Minimum scenarios to confirm before merging Phase 2:

- [ ] Single PDF via slash command — chip appears, uploads, becomes clickable.
- [ ] Oversized file — toast, no chip inserted.
- [ ] Mixed PNG + PDF drag-drop — image block + inline chip.
- [ ] Error state (forced failure) — chip shows error + Retry + Remove.
- [ ] Retry from error state — upload retries and resolves to success chip.
- [ ] Remove from error state — node deleted cleanly.
- [ ] Two simultaneous uploads — both complete independently.
- [ ] `editable: false` — slash and drop disabled; existing chip click-to-download works.
- [ ] `onAttachmentsChange` log — reflects correct list as chips are added and removed.

---

## Phase 3: Backend

> **Stack**: Go + Chi router (`github.com/go-chi/chi/v5`), `pgx/v5` for Postgres, `go-chi/render` for JSON responses. Mirror the existing `server/media/` package structure. Auth is already applied at the route-mount level in `server/main.go` via `mw.CheckAuthentication()`.

---

### Story 10 — DB schema and storage config

#### Task 10.0 — Liquibase changeset: create `attachment` table

- **File**: `db/beskar/updates/attachments.xml` *(already created)*
- Four changeSets following the existing `space.xml` / `notifications.xml` pattern:

| ChangeSet ID | What it does |
| --- | --- |
| `1-create-attachment-table` | Creates `core.attachment` with `id UUID PK`, `page_id BIGINT`, `storage_path TEXT`, `file_name TEXT`, `file_size BIGINT`, `mime_type VARCHAR(255)`, `created_by TEXT`, `created_at TIMESTAMPTZ`, `deleted_at TIMESTAMPTZ` |
| `2-attachment-page-fkey` | FK `attachment.page_id → core.page.id` with `deleteCascade="true"` |
| `3-attachment-page-id-index` | Index on `page_id` for per-page queries and orphan cleanup scans |
| `4-grant-attachment-privileges` | `GRANT SELECT, INSERT, UPDATE, DELETE ON core.attachment TO ${app_user}` |

- Column notes:
  - `storage_path` — relative path on disk (e.g. `public/attachments/report-abc123de.pdf`).
  - `file_name` — sanitized display name for `Content-Disposition` and the chip.
  - `deleted_at` — soft-delete; `NULL` = active. Used by the orphan cleanup job.
  - `created_by` — Zitadel `sub` claim (TEXT, not UUID, to match Zitadel format).
- **Verify**: Run `liquibase update` against a local DB; `\d core.attachment` shows all columns; `\d+ core.attachment` shows the FK and index.

---

### Story 11 — Attachment service

#### Task 11.0 — Create package skeleton

- **New directory**: `server/attachments/`
- Sub-packages mirroring `server/media/`: `server/attachments/services/`, `server/attachments/controller/`
- Add a `go` module path entry if needed (it's the same module `github.com/durgakiran/beskar/attachments`).

#### Task 11.1 — Define config and allowlist

- **File**: `server/attachments/services/config.go`
- Constants / vars:

```go
var AllowedMimeTypes = map[string]bool{
    "application/pdf":                true,
    "application/zip":                true,
    "application/x-zip-compressed":   true,
    "application/vnd.ms-excel":       true,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
    "application/msword":             true,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
    "text/plain":                     true,
    "text/csv":                       true,
}

var DeniedMimeTypes = map[string]bool{
    "application/x-msdownload":   true,
    "application/x-executable":   true,
    "application/x-sh":           true,
    "application/x-bat":          true,
    "text/x-script.phyton":       true,
}

const MaxAttachmentBytes = 10 * 1024 * 1024 // 10 MB; override via env var ATTACHMENT_MAX_BYTES
```

- Read `ATTACHMENT_MAX_BYTES` from env at startup if set.
- **Verify**: Unit test: known allowed type → `true`; denied type → `false`.

#### Task 11.2 — Implement `attachmentService.go`

- **File**: `server/attachments/services/attachmentService.go`
- Mirrors `server/media/services/imageService.go` structure.
- `Attachment` struct:

```go
type Attachment struct {
    ID          string
    Name        string         // sanitized display name
    StoragePath string         // relative path written to disk
    MimeType    string
    FileSize    int64
    PageID      int64
    CreatedBy   string
    WData       multipart.File
}
```

- `sanitizeFileName(name string) string` — strips `../`, leading `/`, control chars; replaces spaces with `-`; appends random 8-char suffix before extension (same pattern as `generateRandomIdentifier` in image service).
- `(*Attachment).Save() error` — creates `public/attachments/` dir if absent, writes file, inserts DB row, sets `a.ID` and `a.StoragePath`.
- `GetAttachmentMeta(id string) (*Attachment, error)` — queries DB for metadata (without reading disk).
- `GetAttachmentBytes(storagePath string) ([]byte, error)` — reads disk.
- **DB queries** (raw `pgx/v5`): `INSERT INTO attachments ...`, `SELECT ... FROM attachments WHERE id=$1 AND deleted_at IS NULL`.
- **Verify**: Call `Save()` with a test `multipart.File` stub; confirm row in DB and file on disk. `GetAttachmentMeta()` returns correct struct.

---

### Story 12 — Upload and download routes

#### Task 12.1 — Implement `attachmentController.go`

- **File**: `server/attachments/controller/attachmentController.go`
- Two handlers + `Router()`:

**`uploadAttachment`** — `POST /api/v1/attachments/upload`

```
Form fields:
  file    multipart file  (r.FormFile("file"))
  pageId  string          (r.FormValue("pageId"))
```

1. Get authenticated user: `user, err := core.GetUserInfo(r.Context())` — 403 if missing.
2. Parse `pageId` (`strconv.ParseInt`).
3. `r.ParseMultipartForm(MaxAttachmentBytes + 1<<20)` — 10 MB + 1 MB overhead.
4. `r.FormFile("file")` — 400 if missing.
5. Reject if `header.Size > MaxAttachmentBytes` → 413 with `core.NewFailedResponse`.
6. Detect MIME: `http.DetectContentType(first512bytes)`; check against `AllowedMimeTypes` and `DeniedMimeTypes` → 415 if rejected.
7. Build `services.Attachment{..., PageID: pageId, CreatedBy: user.Id, WData: file}`.
8. `a.Save()` → 500 on error.
9. Respond `201` with:

```json
{
  "data": {
    "attachmentId": "<uuid>",
    "url": "/api/v1/attachments/<uuid>",
    "fileName": "<sanitized>",
    "fileSize": 12345,
    "mimeType": "application/pdf"
  },
  "status": "success"
}
```

**`downloadAttachment`** — `GET /api/v1/attachments/{attachmentId}`

1. Auth check (same as above).
2. `chi.URLParam(r, "attachmentId")`.
3. `services.GetAttachmentMeta(id)` → 404 if not found.
4. *(v1 access control)*: verify `meta.CreatedBy == user.Id` OR the requesting user has access to `meta.PageID`. For now, authenticated = allowed (same as image download).
5. `services.GetAttachmentBytes(meta.StoragePath)` → 500 on error.
6. Set headers:
   - `Content-Disposition: attachment; filename="<meta.Name>"`
   - `Content-Type: <meta.MimeType>`
   - `Content-Length: <meta.FileSize>`
7. `w.Write(data)`.

**`Router()`**:

```go
func Router() *chi.Mux {
    r := chi.NewRouter()
    r.Post("/upload", uploadAttachment)
    r.Get("/{attachmentId}", downloadAttachment)
    return r
}
```

- **Verify** (curl):
  - `curl -F "file=@test.pdf" -F "pageId=1" -H "Authorization: Bearer <token>" .../attachments/upload` → `201` JSON.
  - `curl -H "Authorization: Bearer <token>" .../attachments/<id>` → PDF bytes, correct headers, browser save dialog.
  - No auth → `403`.
  - Oversized file → `413`.
  - `.exe` file → `415`.

#### Task 12.2 — Register route in `server/main.go`

- **File**: `server/main.go`
- Add one line next to the existing media mount:

```go
r.Mount("/api/v1/attachments", mw.CheckAuthentication()(attachments.Router()))
```

- Import `attachments "github.com/durgakiran/beskar/attachments/controller"`.
- **Verify**: Go build passes. `POST /api/v1/attachments/upload` is reachable.

---

### Story 13 — Orphan cleanup

#### Task 13.0 — Document lifecycle policy

- **File**: `server/attachments/services/attachmentService.go`
- Add a comment block at the top of the file:

```go
// Lifecycle policy: blobs are NOT deleted when an inline chip is removed from a document.
// The editor fires onAttachmentsChange with the current list; the app does not call a delete
// endpoint. Orphan blobs (no matching page document referencing the attachmentId) are removed
// by the cleanup job (see Task 13.1). Undo safety: if a user removes a chip and Ctrl+Z restores
// it, the blob is still on disk.
```

#### Task 13.1 — Orphan cleanup job (Go routine or cron endpoint)

- **File**: `server/attachments/services/cleanupJob.go`
- Strategy for v1: a triggered HTTP endpoint (or a goroutine started at server startup with a ticker) that:
  1. Queries `attachments WHERE deleted_at IS NULL AND created_at < now() - interval '7 days'` (tunable).
  2. For each, checks if `attachmentId` appears in any page's document JSON content. The `pages` table stores document JSON — query `SELECT COUNT(*) FROM pages WHERE content::text LIKE '%' || id::text || '%'`. (A proper JSONB containment query is better for production; `LIKE` is acceptable for v1 given low volume.)
  3. If no references found, sets `deleted_at = now()` and removes the file from disk.
- Expose as `POST /api/v1/attachments/cleanup` (admin/internal only — add an admin-only middleware or restrict by IP in a follow-up).
- **Verify**: Manually insert an orphan row pointing to a non-existent attachment ID; run cleanup; confirm `deleted_at` is set and disk file is gone.

---

## Phase 4: App integration (`ui`)

> **Context**: The relevant file is `ui/app/core/editor/tiptap.tsx`. The `TipTap` component receives `pageId: string` and `id: number` (the numeric page ID). Auth tokens are managed by `ui/app/core/http/call.ts` (`post()` / `get()` add `Authorization: Bearer` header from `localStorage`). The API base is `process.env.NEXT_PUBLIC_IMAGE_SERVER_URL` (same server, different path). Follow the exact same pattern as `uploadImageData.ts` for the upload util.

---

### Story 14 — Upload utility

#### Task 14.1 — Create `uploadAttachmentData.ts`

- **File**: `ui/app/core/http/uploadAttachmentData.ts`
- Mirror `uploadImageData.ts` exactly, adapting for the attachment shape:

```typescript
import { post } from './call';

const baseUrl = process.env.NEXT_PUBLIC_IMAGE_SERVER_URL; // same server
const endpoint = '/api/v1/attachments/upload';

export interface AttachmentUploadResponse {
  attachmentId: string;
  url: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export async function uploadAttachmentData(
  file: File,
  pageId: number,
): Promise<AttachmentUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('pageId', String(pageId));
  const res = await post(baseUrl + endpoint, formData, { Accept: 'application/json' });
  // Go success shape: { data: { attachmentId, url, fileName, fileSize, mimeType }, status: "success" }
  return res.data.data as AttachmentUploadResponse;
}
```

- **Verify**: Call from browser console with a real token and `pageId=1`; confirm JSON response matches `AttachmentUploadResponse`.

---

### Story 15 — Wire `attachmentHandler` into the editor

#### Task 15.1 — Build `attachmentHandler` in `tiptap.tsx`

- **File**: `ui/app/core/editor/tiptap.tsx`
- Add import:

```typescript
import type { AttachmentAPIHandler, AttachmentRef } from '@durgakiran/editor';
import { uploadAttachmentData } from '../http/uploadAttachmentData';
```

- Inside `TipTap`, add (alongside `imageHandler`):

```typescript
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // keep in sync with server config.go

const attachmentHandler: AttachmentAPIHandler = useMemo(() => ({
  uploadAttachment: async (file, opts) => {
    const result = await uploadAttachmentData(file, id); // `id` is the numeric page ID prop
    return {
      attachmentId: result.attachmentId,
      url: `${baseUrl}/api/v1/attachments/${result.attachmentId}`,
      fileName: result.fileName,
      fileSize: result.fileSize,
      mimeType: result.mimeType,
    };
  },
  downloadAttachment: async ({ url, fileName }) => {
    const headers = new Headers({
      Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    });
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  },
}), [id]);
```

- Add `onAttachmentRejected` callback (wired to app toast system or `console.warn` as a start):

```typescript
const handleAttachmentRejected = useCallback((reason: 'too_large', file: File) => {
  // TODO: replace with app toast
  console.warn(`[attachment] Rejected (${reason}): ${file.name}`);
}, []);
```

- **Verify**: Build passes. `tsc --noEmit` in `ui/` shows no new errors.

#### Task 15.2 — Pass props to `<EditorBeskar>`

- **File**: `ui/app/core/editor/tiptap.tsx`
- Update both `<EditorBeskar>` calls (editable and read-only):

```tsx
<EditorBeskar
  imageHandler={imageHandler}
  attachmentHandler={attachmentHandler}
  maxAttachmentBytes={MAX_ATTACHMENT_BYTES}
  onAttachmentRejected={handleAttachmentRejected}
  onAttachmentsChange={(refs: AttachmentRef[]) => {
    // TODO: lift state up or call a prop to update the page's attachment panel
    console.log('[attachments in doc]', refs);
  }}
  extensions={editable ? collaborationExtensions() : []}
  editable={editable}
  ...
/>
```

- **Verify**: `/file` slash command appears in the editor when `attachmentHandler` is set. Uploading a real PDF produces a success chip. Clicking the chip triggers a browser save dialog (not a navigation).

---

### Story 16 — Attachment panel (consuming-app responsibility)

#### Task 16.1 — Add `AttachmentPanel` component

- **File**: `ui/app/core/editor/AttachmentPanel.tsx` (new file)
- The panel is **outside the editor** — rendered below the editor content area, not inside TipTap.
- Props: `attachments: AttachmentRef[]` (driven by `onAttachmentsChange`), `pageId: number`.
- Render a simple list of chips; each chip has the filename and a download icon (same credentialed fetch as in `downloadAttachment`). Show nothing (or a placeholder) when `attachments.length === 0`.
- **Verify**: Insert two attachments → panel shows two rows. Remove one from the document → panel updates to one row.

#### Task 16.2 — Lift `attachments` state up to the page component

- **File**: whichever parent renders `<TipTap>` (e.g. `ui/app/core/editor/` page component or the route page).
- Add `const [docAttachments, setDocAttachments] = useState<AttachmentRef[]>([])`.
- Pass `onAttachmentsChange={setDocAttachments}` to `<TipTap>` (thread it through as a prop).
- Render `<AttachmentPanel attachments={docAttachments} pageId={id} />` below the editor.
- **Verify**: State is stable on re-render; panel doesn't flicker.

---

## Suggested task order (dependencies)

1. **1.1 → 1.2** — types foundation.
2. **2.1 → 2.2 → 2.3** — inline node schema + collab helpers.
3. **3.1 → 3.2 → 3.3 → 3.4** — chip UI.
4. **7.1** — shared upload helper (depends on 2.1–2.3).
5. **4.1** — `onAttachmentsChange` emission.
6. **6.1 → 6.2 → 6.3 → 6.4 → 6.5** — paste/drop.
7. **5.1 → 5.2 → 5.3** — slash command.
8. **8.1 → 8.2** — read-only + exports.
9. **9.1 → 9.2 → 9.3** — demo (can run in parallel with backend).
10. **10.0** — DB schema (prerequisite for all backend).
11. **11.0 → 11.1 → 11.2** — attachment service.
12. **12.1 → 12.2** — routes + main.go wiring.
13. **13.0 → 13.1** — orphan cleanup.
14. **14.1** — upload utility in `ui`.
15. **15.1 → 15.2** — wire handler in `tiptap.tsx`.
16. **16.1 → 16.2** — attachment panel.

---

## What was changed from the block-based design

| Aspect | Block-based (previous) | Inline-based (current) |
| --- | --- | --- |
| Node type | `block`, full-width card | `inline`, chip within text |
| Node name | `attachmentBlock` | `attachmentInline` |
| Visual | Bordered card with MIME icon, filename, size, download button | Compact chip: `📎 filename.ext` |
| Click behavior | Download button on right of card | Click anywhere on success chip |
| Block drag-drop | Node participates in block drag | N/A — inline node, no block drag handle |
| Bottom panel | Would have been part of the editor | Consuming application's responsibility |
| `onAttachmentsChange` | Not present | New callback so app can drive its panel |
| Insertion logic | Replace empty paragraph or insert new block | Insert inline at cursor position |
