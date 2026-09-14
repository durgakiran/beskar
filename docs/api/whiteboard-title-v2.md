# Whiteboard v2 title changes

Rename a board with its existing checkpoint API:

`POST /api/v2/editor/space/{spaceId}/whiteboard/{pageId}/checkpoint`

```json
{
  "updateEncoding": "yjs-update-v1",
  "update": "AAA=",
  "title": "Architecture diagram"
}
```

`AAA=` is an empty Yjs update (`00 00`), suitable for a title-only checkpoint.
A drawing update and title change can also be submitted together. Include the
usual UUID `Idempotency-Key`. Edit permission is required.

`title` is optional. Omission preserves the existing title. When supplied it must
be a string; null, blank, null characters, and more than 255 Unicode characters
are rejected with 400. Surrounding whitespace is trimmed. Keep the normalized
title and Yjs bytes with the same key for retries. Changing either under an
accepted key returns 409 `IDEMPOTENCY_KEY_REUSED`.

A rename receives a normal checkpoint sequence. Its title is stored in
`whiteboard.whiteboard_title_update`, keyed by the owning page and that exact
sequence. The update, title and draft-head advancement commit together. Concurrent
renames are ordered by the server checkpoint sequence; the last accepted rename
wins. Retrying an older rename returns its original receipt without reverting
the current title.

Titles are authoritative checkpoint metadata, not a field extracted from Yjs.
This avoids reconstructing the entire board for each save. Clients must stop
using `glideboard-meta.title` as the authoritative title. Such legacy embedded
values are preserved in document bytes but ignored by title projection and
publication. Existing snapshots keep their captured title; this migration does
not reconstruct historical Yjs-only renames.

## Reading titles

- Draft manifests include top-level `title` at the captured `headSequence`.
  `baseSnapshot.title` still describes the older base snapshot.
- Draft update pages include optional `title` on the checkpoint that changed it.
  Apply title metadata in sequence order alongside Yjs replay, or use the
  manifest title when opening the captured draft.
- Publish selects the last title change through the requested sequence, falling
  back to its base snapshot title. Later renames do not change existing versions.
- Shared page lists, breadcrumbs, and inline-link metadata show the draft title
  only when the caller has edit permission. Other readers see the published title.
  Unpublished v2 boards are omitted from non-editor page listings.
- View-document breadcrumbs use published titles. Legacy document and v1
  whiteboard title resolution remains unchanged.

Apply `whiteboard_titles.xml` through the main Liquibase changelog before
starting the updated server. The migration uses native XML for its table, keys,
and rollback; only the length CHECK and grants use SQL, following existing style.
The FK prevents pruning title-bearing checkpoint rows before a retention policy
preserves the required title history and retry receipts.
