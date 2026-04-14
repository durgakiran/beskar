# Specification: Generic File Attachments

## Product requirement

Users can upload non-image files (PDFs, ZIPs, spreadsheets) by drag-and-dropping them into the editor or via a specific slash command `/file`. Uploaded files are stored **independently of the document** — the document only holds a lightweight inline reference. A separate UI panel (owned by the consuming application) lists all files attached to the page.

**Scope clarification**

- **Images and videos** continue to use the existing image (and any video) flows. Drag-drop and paste must **not** route `image/*` or existing video MIME types through the attachment flow unless product explicitly decides otherwise; mixed drops should apply each file to the correct handler.
- **Clipboard paste** of files (when the browser exposes `clipboardData.files`) should behave like a single-file drop at the current selection, for parity with drag-drop.
- **Multiple files** in one drop or file-picker selection: insert one inline chip per file, in stable order, each with its own upload lifecycle.

## Technical approach

- **TipTap extension**: Create an `AttachmentInline` inline node extension (not a block). The node sits within the text flow like a mention or emoji — `inline: true`, `atom: true`, `group: 'inline'`. It carries attributes for display and download: `attachmentId`, `fileUrl`, `fileName`, `fileSize`, `fileType` (MIME), `placeholderId` (for collab-safe replacement during async upload), `uploadStatus` (`'uploading' | 'success' | 'error'`), and optional `errorMessage`.
- **Document reference only**: The document JSON stores only the inline reference (a chip with `attachmentId`). The blob, metadata, and access rules live entirely on the server. Removing the chip from the document does not automatically delete the server blob — the consuming application (or a backend job) manages blob lifecycle.
- **Editor integration**: Introduce an `**AttachmentAPIHandler`** (alongside the existing `ImageAPIHandler`) with `uploadAttachment(file, options) => Promise<AttachmentUploadResult>` and optional download/URL hooks, mirroring the existing image handler pattern.
- **Backend**: Validate allowed MIME types and extensions, enforce max size, stream to durable storage, return id + metadata. Reject dangerous types explicitly.

## Security and access

- **Download authorization**: Fetching or downloading the file must respect the same access rules as the document (authenticated, authorized user). Prefer short-lived or signed URLs if blobs are served from object storage.
- **Filename safety**: Sanitize `Content-Disposition` and stored display names to avoid path traversal and control-character issues.
- **Optional (later)**: Virus scanning or enterprise policy hooks — call out as out-of-scope for v1 unless required.

## Persistence and lifecycle

- **Storage is independent**: Files live on the server regardless of the document state. The app panel (not the editor) is the source of truth for which files are attached to a page.
- **Removal from document**: Deleting the inline chip removes only the reference from the doc text. Whether the server blob is deleted depends on the application's lifecycle policy (see Backend section). The editor does not make a server call on chip removal unless the app has wired a `deleteAttachment` hook.
- **Failed upload**: If the user removes an error-state chip, no server object should remain (upload never completed). The chip removal is purely local.
- **Retry**: The error-state chip holds a reference to the original client `File` in the node view's closure and reuses it on Retry. If the reference is unavailable (e.g. after page reload), show Remove only.

## Corner cases and edge handling

- **Upload failures**: Error-state chip shows a **Retry** action (and always **Remove**) rather than permanently broken.
- **Size limits**: Client-side check before insert; reject files over the configured max and notify via toast. Do not insert a placeholder that will inevitably fail.
- **Network loss / tab close**: Upload in-flight on navigate → abort best-effort; no requirement to resume partial uploads in v1.
- **Collaboration**: Placeholder nodes carry a **client-generated placeholder id** so concurrent edits can target the correct chip when replacing the placeholder with final attrs — consistent with collaborative image upload patterns.
- **Read-only / non-editable editor**: Disable insert via slash and drag-drop. Clicking a success chip triggers a download.

## UI design and layout

- **Slash menu**: Under the **Media** category, add a **File attachment** item with a paperclip icon; triggering it opens the native file picker (support **multiple** selection). Search aliases: `file`, `attachment`, `upload`, `pdf`, `zip`.
- **Inline chip**: The attachment renders as a compact chip/badge inside the text flow. It does not take the full editor width. It is selectable as a unit (like an inline atom node).

  | State         | Visual                                                                                                          |
  | ------------- | --------------------------------------------------------------------------------------------------------------- |
  | **Uploading** | `📎 report.pdf ↻` — grayed out, spinner on the right, not clickable                                             |
  | **Success**   | `📎 report.pdf` — full color, entire chip is clickable and triggers download                                    |
  | **Error**     | `⚠ report.pdf` — error tint, with a small **Retry** and **Remove** affordance (e.g. on hover or always visible) |

- **Download behavior**: Clicking a success chip calls the `downloadAttachment` hook if provided, otherwise does a credentialed `fetch` + blob-URL download. The chip should have `title` or `aria-label` containing the filename.
- **Upload progress**: If technically feasible (i.e. the handler supports `onProgress`), display an animated spinner or thin progress indicator within the chip. If not feasible, a static "Uploading…" label is acceptable.
- **Keyboard and focus**: Slash command flow must be operable without pointer devices once the menu is open; focus management for the hidden file input should not trap focus.

## Consuming application responsibilities

The editor package is **not responsible** for displaying a list of attached files. The consuming application owns that concern. The editor exposes one hook to support it:

- `**onAttachmentsChange?: (attachments: AttachmentRef[]) => void`** — Called whenever the set of *successfully uploaded* attachments present in the document changes. `AttachmentRef` is `{ attachmentId, fileName, fileSize, fileType, fileUrl }`. The app uses this to sync its own attachment panel without needing to parse the document JSON.

The app is free to display attachments in any order, filter by type, paginate, etc. The editor only reports what is currently referenced in the doc.

## API and config

- Document the **allowlist** (or denylist) of MIME types / extensions and the **max upload size** in one config surface shared by client validation and server enforcement. The native file picker `accept` attribute reflects the same list as a UX hint (not a security gate).
- `**AttachmentUploadResult*`* shape: `{ attachmentId, url, mimeType, fileName, fileSize }`.
- **Error routing** — which errors go to a toast vs an inline chip error:

  | Error condition                                    | Toast | Inline error chip    |
  | -------------------------------------------------- | ----- | -------------------- |
  | File too large (client-side, before insert)        | yes   | no                   |
  | MIME type not allowed (client-side, before insert) | yes   | no                   |
  | Network failure / server error during upload       | no    | yes (Retry + Remove) |
  | Server `4xx` on upload (e.g. validation failed)    | no    | yes (Retry + Remove) |
  | Server `5xx` on upload                             | no    | yes (Retry + Remove) |

- **Retry**: node view holds original `File` reference in closure; reuses on Retry. If unavailable, Remove only.
- **Remove on error**: always present, not optional. Deletes the chip node — no server call needed since upload never completed.
- **Download headers**: `Content-Disposition: attachment; filename="<sanitized-name>"` + correct `Content-Type`.
- **Upload cancellation**: `uploadAttachment` should accept an optional `AbortSignal` so the editor can abort in-flight requests. Decide whether this is v1 or deferred; document explicitly.
- `**pageId`**: Should be bound into the handler closure at construction (`createAttachmentHandler(pageId)`) rather than passed per-call, keeping the `uploadAttachment` signature clean.

## `AttachmentAPIHandler` interface


| Member                                | Required | Purpose                                                                                               |
| ------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `uploadAttachment(file, { signal? })` | **Yes**  | POST the file; return `AttachmentUploadResult`. Reject on failure.                                    |
| `getAttachmentUrl?(url)`              | Optional | Rewrite a stored URL (CDN, signed URL refresh) before display or download.                            |
| `downloadAttachment?(params)`         | Optional | App-owned download (auth headers, blob save). Falls back to credentialed fetch + blob save if absent. |
| `deleteAttachment?(attachmentId)`     | Optional | Needed only if lifecycle policy is "immediate delete on chip removal". Omit if policy is job-based.   |


## Out of scope (explicit)

- Inline preview of PDF/spreadsheet content inside the editor chip.
- Attachment library / reuse of the same upload across multiple pages without re-upload.
- The attachment bottom panel UI — that is the consuming application's responsibility.

