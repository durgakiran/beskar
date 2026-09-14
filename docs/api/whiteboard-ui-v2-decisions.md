# Whiteboard v2 UI integration decisions

These choices follow the request to use recommended defaults and record alternatives for later review.

| Decision | Selected behavior and reason | Other options |
| --- | --- | --- |
| Adoption | New whiteboards use v2. Shared metadata chooses the v1 or v2 editor for existing boards. Avoids converting legacy content implicitly. | Migrate all legacy boards; a separate migration needs validation and rollback. |
| Collaboration | Keep existing Yjs/WebRTC collaboration in a v2-specific room. Hydrate verified server state before joining. | Replace signaling with an authenticated server relay; larger transport change. |
| Missed peer updates | Replay server state on reconnect/focus and every 10 seconds, caching the immutable base snapshot. Apply only complete, verified replays. | Add incremental server events or a since-sequence API. Current replay APIs paginate from the snapshot, so long histories increase polling cost. |
| Persistence | Reuse projection verification and IndexedDB recovery; send Yjs differences from acknowledged state, with stable request bytes and UUID keys for retries. | Upload full state on every edit; conflicts with incremental API limits and adds traffic. |
| Recovery ordering | Persist monotonically increasing local generations across reloads and merge retained CRDT records during hydration. | Restart counters per mount; older records can incorrectly outrank new edits. |
| Recovery isolation | Scope recovery by API origin, board, actor and browser tab. Local recovery failure prevents opening an unsafe editing session. | Allow editing without local recovery and a warning; users could lose offline work. |
| Titles | Authoritative checkpoint metadata, ordered by server sequence. Pending rename metadata is retained locally. Awareness carries only a hint to refresh authoritative title. | Put titles in Yjs; conflicts with the selected backend contract. |
| Publishing | Flush changes and rename, replay the server boundary, verify that the rendered projection matches it, generate PNG, then publish that sequence. Retry changed projections up to three times. Keep the same draft after publication. | Render on server; adds package/runtime cost. Publish local preview without verifying unseen collaborator checkpoints; could mismatch content. |
| Ambiguous publication | Retain the exact sequence, PNG and idempotency key in the mounted editor; the next publish action retries that operation. Later edits remain draft changes. | New key on every click; can create duplicate versions after a lost response. Persist large preview payloads across reloads in IndexedDB as future enhancement. |
| Lifecycle recovery | Poll access/lifecycle with draft synchronization, pause on denial, and retry retained checkpoints once access is restored. | Require reload after every archive or transient session failure. |
| Navigation | Fully published boards open the preview; boards with a newer checkpoint open their draft for editors. | Always open editors for editable boards, loading canvas packages unnecessarily. |
| Version history UI | Open a dialog from the published view or editor; paginate history and fetch selected version metadata. Display immutable PNG previews without loading a historical canvas. | Separate version pages with an interactive canvas; adds routing and package cost. |
| Restore confirmation | Capture the draft head before confirmation. Concurrent edits require fresh review; uncertain results retain the exact request/key while the dialog remains mounted, including closing and reopening it. | Automatically retry with a newer head; could overwrite unseen edits. Persist retry state across browser reloads as a future improvement. |
| Deletion UI | Use the v2 endpoint from the existing Delete action, keep errors visible in the confirmation, and navigate after a successful 204. Child pages must be moved or deleted first. | Recursive deletion or trash; broader retention and page-tree changes. |
| Viewing | Render the immutable published PNG without mounting Glideboard. Lazy-load editing and legacy historical canvas routes. | Interactive read-only canvas; adds package cost. |
| Assets | No v1 raster storage adapter on v2 boards. Glideboard requires a host adapter for raster import; self-contained vector content remains supported. | Wire legacy uploads into v2 temporarily; retention and snapshot association were explicitly deferred. |
| Large updates | A single incremental checkpoint over 1 MiB fails visibly with local recovery retained. Never slice Yjs bytes arbitrarily. | Add a server upload/compaction protocol or split original CRDT transactions into bounded batches. |
| Permissions | API permission checks gate loading and saving. Failed permission/lifecycle checks during periodic synchronization disconnect collaboration and pause editing. | Authenticated collaboration transport with immediate revocation; a separate transport enhancement. |

The existing WebRTC signaling transport is unchanged; it is not an authorization service. This integration does not claim immediate peer-level revocation. Server content and write APIs enforce current permissions.

## Validation

Automated tests cover verified snapshot replay, incomplete replay rejection, immutable checkpoint retries, large sequence preservation, deletion replay, v2 creation retries, existing durability behavior, and the shared view shell. See [verification results](whiteboard-ui-v2-testing.md).
