# Document mentions integration verification

Verified on 2026-10-15 against the local Docker development application.

## Integration

- `ui/app/core/http/mentionApiHandler.ts` binds the current space into search,
  mention resolution, and hover detail requests. It uses the configured API base
  and application fetch transport, including browser cookies / desktop bearer
  interception. Hover AbortSignals are forwarded to fetch.
- Only detail `404` responses become unavailable users. Authentication failures,
  temporary directory failures, invalid payloads, and profile ID mismatches reject.
- Search/resolution expose only `{ id, label }` to insertion. Live email, avatar,
  and space role are used only for hover details.
- No profile cache is shared across spaces or sessions. Responses and requests
  use no-store semantics.
- `TipTap` supplies the handler in edit and view modes, memoizes it by space ID,
  and keys editor instances by space, document, and mode.

## Live provider regression fixed

The initial real search returned no candidates despite current space membership.
The development Zitadel v2 response includes root `userId` and `state`, with
`human.profile` and `human.email`, but omits nested `human.userId`.
The old active-human guard incorrectly excluded those profiles. `User.IsActiveHuman`
now checks active state and usable human profile/email fields. Machine accounts
and unknown/inactive states remain excluded. A regression test uses the observed
v2 response structure and a machine-account result.

## Automated checks

- UI adapter, document integration, and published view tests: 11 pass.
- Server `go test ./space ./core ./apidocs`: passes, including the real response
  shape, known out-of-space users, membership pagination, and upstream failures.
- Production UI build: passes.
- Linux ARM64 API build: passes, matching the cached development image.
- Whitespace/diff checks: pass.

## Real application verification

Isolated document in the existing editor regression space:
[**Mentions — end-to-end verification 2026-10-15**](https://app.durgakiran.com/space/c95e8d8e-091a-457a-ac3a-c6043a1773ca/view/137).
Existing documents were not edited. No other users were added or notified.

Verified through Chromium and the real authenticated APIs, without browser mocks:

1. Typed `@Durga` in the actual document editor. Search returned the sole member
   of the current test space. Enter inserted a mention with the server-provided
   Beskar UUID and label.
2. Hovering in edit mode displayed live name, email, initials and Owner role.
3. Published through the normal Update action. The mention survived the Yjs,
   worker, storage, and published rendering flow.
4. Reloaded the published document from the server. The mention still rendered.
5. Keyboard focus and hover in read-only mode fetched the space-scoped detail
   endpoint and displayed the profile. Escape dismissed the card.
6. Compared complete editor JSON before and after profile interaction and attempted
   typing in read-only mode: unchanged. No mention search requests were sent.
7. Current-space search returned exactly its one member. A synthetic non-member
   UUID returned `404`; an unauthorized synthetic space returned `403`; an isolated
   unauthenticated context returned `401`. Successful directory responses used
   `Cache-Control: private, no-store`.

The live negative checks used synthetic UUIDs. Known existing users from another
space are covered by automated tests; no other private member directory was read.

Screenshots:

- `output/playwright/document-mentions-edit.png`
- `output/playwright/document-mentions-published.png`

## Development deployment

Followed `docs/how-to-test-app.md` for the local domain, test-account login, and
service selection. Both app and identity-provider domains resolve to loopback
in `/etc/hosts`. The isolated QA browser accepted the development TLS certificate;
no application or system TLS settings were changed.

The normal Docker compose rebuild could not resolve Docker Hub base-image metadata
because the registry request timed out. To complete verification, built the UI and
API locally, then created derivative images from the already cached development
images with only `/app/dist` and `/usr/local/bin/server` replaced:

- `beskar-dev-ui:document-mentions`
- `beskar-dev-server:document-mentions`

Those images run in the existing `beskar-dev` UI/API services via temporary
`/tmp/document-mentions-compose.yml`. Infrastructure, database volumes, and other
services were preserved. The configured local editor dist was used; no npm package
was published. The normal source Dockerfiles were not changed.

Expected browser errors from deliberately requested `403`/`404` endpoints and
transient collaboration warnings during API recreation were distinguished from
mention failures. A clean published-page reload had no browser errors before
negative checks.
