# Whiteboard v2 publication

All paths are relative to `/api/v2/editor`. Requests require the existing
session authentication. Published reads require page `view`; publishing requires
page `edit`. Page/space membership and deleted-space checks are enforced in SQL.
Archived spaces remain readable; new publications are rejected.

## Publish

`POST /space/{spaceId}/whiteboard/{pageId}/publish`

Headers: `Content-Type: application/json`, `Idempotency-Key: <UUID>`.

```json
{
  "sequence": "103",
  "preview": {"contentType": "image/png", "data": "<base64 PNG bytes>"}
}
```

`sequence` is required, a canonical nonnegative int64 decimal **string**, including
`"0"`. Checkpoint all required updates first, then publish the acknowledged sequence.
Newer checkpoints may exist: the publication includes only the requested boundary.
The body limit is 6 MiB. Unknown fields and trailing JSON are rejected.

The service locks space, board/page, and draft in that order, reconstructs the
nearest snapshot plus a contiguous update tail through the requested sequence,
and materializes a complete Yjs update-v1 snapshot. It inserts the snapshot,
an immutable `whiteboard_version`, its validated PNG preview, and updates
`whiteboard.published_version_id` in one transaction. It leaves the draft intact.
Existing snapshots at the requested boundary are reused. Each new publish key
creates a new version, including deliberate republication of an older boundary.

Retries use the same key, sequence, and preview payload. Keys are scoped to page and publisher;
retries return the original version **without changing the current pointer**.
Reusing a key for another sequence or different normalized PNG returns 409. A committed receipt can be read
again after archival; authentication, permissions, and space membership still apply.

## Get published whiteboard

`GET /space/{spaceId}/whiteboard/{pageId}/published`

Both APIs return HTTP 200 with the existing success envelope and this `data`:

```json
{
  "pageId": 42,
  "spaceId": "11111111-1111-4111-8111-111111111111",
  "versionId": "22222222-2222-4222-8222-222222222222",
  "versionNumber": "4",
  "publishedBy": "33333333-3333-4333-8333-333333333333",
  "publishedAt": "2026-09-13T10:00:00Z",
  "snapshot": {
    "id": "44444444-4444-4444-8444-444444444444",
    "throughSequence": "103",
    "title": "Board",
    "updateEncoding": "yjs-update-v1",
    "downloadUrl": "/api/v2/editor/space/11111111-1111-4111-8111-111111111111/whiteboard/42/published/22222222-2222-4222-8222-222222222222/content",
    "byteLength": 512,
    "stateDigest": "sha256:..."
  },
  "preview": {
    "url": "/api/v2/editor/space/11111111-1111-4111-8111-111111111111/whiteboard/42/published/22222222-2222-4222-8222-222222222222/preview",
    "contentType": "image/png",
    "byteLength": 1024,
    "digest": "sha256:...",
    "width": 1024,
    "height": 768
  }
}
```

Use `GET` or `HEAD` on `snapshot.downloadUrl` for the encoded snapshot. Downloads
support one byte range and digest ETags. They are bound to an immutable published
version, so a concurrent publish cannot mix snapshot bytes with the manifest.
Historical published URLs remain accessible with current view permission; they
cannot retrieve unpublished snapshots. Responses use `Cache-Control: no-store`.
No draft replay lease is required. Snapshot download routes reject query parameters. The published manifest accepts only a single `preview=true` or `preview=false` query parameter.

Publication validates live raster asset records against this board's committed
asset catalog and atomically records a complete snapshot asset manifest. Invalid
or uncommitted references reject publication. Published image reads require
membership in that exact manifest. Responses continue to omit `assetHashes`;
the server derives dependencies from Yjs state. See [asset APIs](whiteboard-assets-v2.md).

## Preview generation and image-only reads

The editor generates the preview; the API does not render the diagram on the
server. PNG is required for every new publish request. `preview.data` is base64
without a data URL prefix. SVG uploads are not accepted in this pass.
The server fully decodes and re-encodes the PNG before storing it, with a 4 MiB
encoded limit, 4096 pixels per dimension, and 8 million pixels total.
Preview bytes are stored in `whiteboard.whiteboard_version_preview`, atomically
with the version and publication pointer. This is separate from document assets.

`GET /space/{spaceId}/whiteboard/{pageId}/published?preview=true` returns **raw
PNG bytes** (`Content-Type: image/png`), with no JSON envelope or Yjs data.
Without the flag, or with `preview=false`, the endpoint returns the manifest.
The manifest's version-specific `preview.url` serves that immutable version's PNG.
Both image routes support HEAD, one byte range, and digest ETags, require view
permission, and use `Cache-Control: no-store`. Existing versions created before
preview support have `preview: null`; image requests return 404
`WHITEBOARD_PREVIEW_NOT_FOUND`. New publish requests without a PNG return 400.

Glideboard exports a browser helper:

```ts
import { createPublishPreview } from '@durgakiran/glideboard';

// Complete active edits and capture the state you will checkpoint.
await board.settleActiveEdit('commit');
const target = await board.captureProjectionTarget();
const preview = await createPublishPreview(board, { target });
// Checkpoint that same captured state and use its acknowledged sequence.
const body = { sequence: acknowledgedSequence, preview };
// POST body with a fresh Idempotency-Key. Retain body + key for retries.
```

The helper uses the existing portable SVG exporter, then rasterizes in the
browser to PNG with a white background and maximum dimension of 2048 pixels.
It accepts `shapeIds` for selected-diagram previews. Export rejects a changed
projection; restart capture/checkpoint/preview if that happens. Do not use a
sequence from an unrelated or subsequently changed document state. The server
validates PNG structure but cannot verify that its pixels match the sequence.

For cookie-authenticated same-origin embeds:

```html
<img src="/api/v2/editor/space/SPACE_ID/whiteboard/PAGE_ID/published?preview=true"
     alt="Published diagram" />
```

No whiteboard packages are needed on the viewing page. For bearer-only clients,
fetch the image with the Authorization header and use a local Blob URL.

## Errors

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_PREVIEW` | Missing, malformed, unsupported, or oversized PNG |
| 404 | `WHITEBOARD_PREVIEW_NOT_FOUND` | Older published version has no preview |
| 400 | `INVALID_REQUEST` | Invalid IDs, sequence, JSON, query, or idempotency key |
| 401 | `UNAUTHENTICATED` | Sign in required |
| 403 | `WHITEBOARD_FORBIDDEN` | Missing edit/view permission |
| 404 | `WHITEBOARD_NOT_FOUND` | Board/version not in the requested live space |
| 404 | `WHITEBOARD_NOT_PUBLISHED` | Board exists but has no publication |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Key previously used with another sequence |
| 409 | `SPACE_ARCHIVED` | New publication in an archived space |
| 409 | `PUBLISH_SEQUENCE_UNAVAILABLE` | Future boundary or unavailable history |
| 409 | `PUBLISH_STATE_INVALID` | Causal gaps, corrupt replay, invalid title, unsupported subdocuments |
| 409 | `ASSET_INVALID_REFERENCE` / `ASSET_NOT_READY` | Invalid asset reference or missing committed board-owned raster |
| 413 | `REQUEST_TOO_LARGE` / `PUBLISH_TOO_LARGE` | Request/replay limit exceeded |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | JSON required |
| 503 | `WHITEBOARD_PUBLISH_BUSY` | Lock timeout; retry the same key after one second |
| 500 | `WHITEBOARD_PUBLICATION_FAILED` | Runtime/database failure; retry publishing with the same key |

## Runtime and deployment

Apply `whiteboard_publication.xml`, `whiteboard_previews.xml`, and `whiteboard_assets_v2.xml` via the normal Liquibase changelog before
starting the updated server. The migrations add versions, PNG previews, and
same-board foreign keys. No existing v1 data is migrated.

Yjs 13.6.27 is pinned in `server/whiteboard-runtime/package-lock.json`. Docker
server builds install the runtime. For a host-run server:

```sh
npm ci --prefix server/whiteboard-runtime --omit=dev
cd server
# Run the server with Node.js available on PATH.
```

The default runtime directory is `whiteboard-runtime` relative to the server's
working directory; override with `WHITEBOARD_YJS_RUNTIME_DIR` (absolute path).
Each publish subprocess has a 20-second deadline and 256 MiB V8 heap cap.
Replay input and output state are limited to 32 MiB, and a replay tail to 10,000
updates. Larger histories need compaction or a future asynchronous publisher.
Title edits use the checkpoint `title` field, ordered at the same sequence as
the Yjs update. Publication selects title metadata through the requested sequence,
falling back to the base snapshot title. `glideboard-meta.title` is no longer
authoritative. See [title changes](whiteboard-title-v2.md).

## Verification

```sh
npm test --prefix server/whiteboard-runtime
cd server
GOWORK=off go test ./editor ./media/services
WHITEBOARD_PUBLISH_TEST_DSN='postgres://postgres@127.0.0.1:55440/whiteboard_publish_test?sslmode=disable' GOWORK=off go test ./editor -run TestPublishV2Postgres -count=1
```

The integration test requires Node, installed runtime dependencies, Liquibase,
and an explicitly disposable database named `whiteboard_publish_test`. It drops
and recreates the `core` and `whiteboard` schemas in that database, applies the
actual creation/update/publication/preview migrations, and tests historical boundaries,
concurrent retries, transaction rollback, immutable downloads, and archived reads.
It also verifies asset reference validation, committed catalog ownership and
snapshot manifests, preview reads, and rejection of preview changes on an
idempotent retry.
