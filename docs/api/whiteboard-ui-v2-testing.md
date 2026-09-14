# Whiteboard v2 UI verification — 2026-09-14

## Status

Integration and live authenticated browser testing are complete. The user explicitly approved the account in `docs/how-to-test-app.md`; tests ran against the rebuilt local Docker services and actual PostgreSQL APIs in headed Chrome through Playwright.

Dedicated test space: `V2 integration QA 2026-09-14` (`af9c1648-2563-411c-a13c-336353e55c59`). Existing spaces were not modified. Review the [published board](https://app.durgakiran.com/space/af9c1648-2563-411c-a13c-336353e55c59/view/125).

## Verified

- UI production builds passed; development UI and Go API containers were rebuilt.
- Normal Liquibase db-init completed, including the publication, preview and title XML changesets.
- UI Vitest suite: 83 tests passed across 8 files, including new creation retry and preview tests.
- Go editor/core tests passed.
- `TestPublishV2Postgres` passed against a disposable PostgreSQL database with actual migrations, publication/preview operations, navigation queries and the new shared-view metadata query. The disposable database was removed afterward.
- TypeScript checking found no errors in the newly introduced v2 components or adapter/replay modules. Repository-wide type checking still fails on existing invite/settings code and the legacy editor's `Response` type usage.
- `git diff --check` passed.

## Browser tests using synthetic API fixtures

Executed in headed Chrome through Playwright against the rebuilt UI. API requests were intercepted with synthetic data; no live user data was created or changed. These tests exercise real DOM, canvas rendering, Yjs, browser PNG generation, BroadcastChannel collaboration, and IndexedDB.

| Scenario | Result |
| --- | --- |
| Open an empty v2 board | Editor loads and drawing tools become available without an online peer |
| Draw a rectangle | Shape appears and checkpoint status reaches Saved |
| Rename | Header title updates and metadata checkpoint is submitted |
| Publish | Fixed projection produces a PNG request and reports success |
| Open a second tab | Saved shape/title hydrate; both tabs report two active editor sessions |
| Edit from second tab | Both visible documents converge on two shapes |
| Delete from second tab | Both documents converge on one shape |
| Reload after deletion | Deleted shape stays deleted |
| Fail all checkpoint requests, then add a shape | Editor reports a save error and retains local recovery |
| Reload while save requests still fail | Unsaved-changes prompt appears; after acceptance, IndexedDB restores both shapes |
| Restore checkpoint connectivity and reload again | Save retries succeed; both shapes remain after replay |

Screenshot: `output/playwright/v2-fixture-two-tabs.png`.

The fixture has no authenticated cookie, so its WebSocket upgrade was rejected as expected. Two-tab collaboration here uses the existing BroadcastChannel path. This does **not** verify authenticated WebRTC between independent browser contexts.

## Live browser tests

| Scenario | Result |
| --- | --- |
| Create a space and v2 whiteboard through UI | New board opens and saves through v2 APIs |
| Empty board publication | Server accepts editor-generated PNG |
| Independent authenticated browser contexts | WebRTC and ICE connected; separate storage/BroadcastChannel contexts |
| Draw while HTTP draft replay is blocked in both contexts | Peer receives the shape over WebRTC; open data channel reports received messages |
| Simultaneous width and height edits | Both contexts converge on both field changes |
| Offline addition concurrent with online deletion | Reconnect merges surviving shapes, deleted shape does not return, reload preserves result |
| Checkpoint committed but response dropped | Retry uses identical bytes/key and receives the same server sequence |
| Rename | Peer receives authoritative title; listing and published preview use the title |
| Concurrent publish | Both succeed at the same fixed sequence with consistent PNG content |
| Publication committed but response dropped | Retry returns original version with identical payload/key; does not replace a newer peer publication |
| Edit after publish request was captured | Published sequence remains fixed; newer edit remains draft |
| Published view in fresh context | PNG renders; no Glideboard, WhiteboardEditor or CanvasTextEditor chunks requested |
| Anonymous draft/preview requests | Both return 401 |
| Archive and unarchive | Both active editors become read-only and disable publication; editing resumes after restoration |
| Active session loses cookies | Editor pauses and disables publication; restored session can reopen |
| Failed checkpoints across repeated reloads | Recovered the affected edit, added another edit during the outage, reloaded again, restored saving, and reloaded from the server: all five shapes remained |
| Page listing and Close navigation | Newer draft reports `draft=1`; after publication it reports `draft=0`, and Close opens the PNG view |
| Inline thumbnail metadata | Shared inline-link API supplies the preview URL; fetching it returns 200 with `image/png` |
| Unpublished board view | Board 126 displays the unpublished message without mounting the editor |

Screenshots: `output/playwright/v2-live-published-preview.png` and `output/playwright/v2-live-final-preview.png`.

### Fixes discovered during live testing

- Successful synchronization clears transient synchronization errors and resumes collaboration after access is restored. Retained checkpoints retry after an archive is lifted.
- Page listings distinguish fully published boards from newer drafts, so navigation can use the lightweight preview.
- IndexedDB storage generations continue above the retained maximum across coordinator mounts. Hydration applies all retained CRDT records, recovering updates written by older clients with restarted generation counters.

### Scope

Collaboration used two independent Chrome contexts on one machine with the approved account. This verifies actual WebRTC, concurrent editing and reconnect behavior; it does not certify cross-device NAT traversal or member-role changes between different accounts. Authorization expiry and archival were tested against real APIs. Immediate peer-level authorization revocation remains outside the existing signaling protocol. Asset upload/retention integration remains deferred as requested.

## Environment maintenance

Docker ran out of space while initializing the disposable test database. Unused reproducible build cache cleanup reclaimed 1.77 GB; application data volumes were preserved. Database verification used a bounded memory-backed disposable PostgreSQL instance.

## History, restore, and deletion UI — 2026-09-14

Version history is available from both the published view and editor. Selecting a version fetches its metadata and immutable PNG. Restore requires confirmation; deletion uses the v2 API through the existing Delete action.

Automated coverage includes paginated history, version selection, view-only behavior, empty history, loading retries, cancelled restoration, exact retry bytes/key after uncertain restoration, head conflicts, deletion failure/retry, and page-level v2 deletion routing. All 83 UI tests pass. Production build passes; TypeScript retains only the previously documented unrelated errors.

Live Chrome tests used isolated board 128 and child board 129 in the existing QA space. Both test boards were deleted through the UI after verification; board 125 was left unchanged.

| Scenario | Result |
| --- | --- |
| Open published view and select an older version | Correct metadata and PNG; no Glideboard/WhiteboardEditor/CanvasTextEditor chunks loaded |
| Cancel restore confirmation | No restore request sent |
| Another editor changes draft after confirmation opens | Conflict shown; fresh review and confirmation required |
| Restore commits but response is dropped | Retry uses identical body/key, including after closing and reopening history |
| Successful restore with two other editors open | All three editors load the original one-shape version; history is also accessible from the editor |
| Delete a parent with a child | Server error shown in dialog; parent retained |
| Unpublished child history | Empty-history message shown |
| Cancel deletion | Board remains available |
| Delete commits but response is dropped | Dialog retains error; retry succeeds with 204 and navigates to space |
| Other editor remains open during deletion | Editor pauses; page listing excludes deleted boards |
| Narrow 390px viewport | History dialog fits within 358px with no horizontal overflow |

Screenshot: `output/playwright/v2-history-ui.png`. History pagination also passed in Chrome using real publications with the initial server page limited to two records through a test interception: Load older versions expanded the list from two to seven. The final build produced no console warnings or errors in this check. Existing permission and archive API checks remain covered by the earlier integration pass. History restore/deletion retries are retained while the component remains mounted, not across a full browser reload.
