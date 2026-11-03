# Beskar desktop production-readiness guideline

Review date: 3 November 2026. Scope: Wails desktop, shared React UI, Zitadel login, native HTTP/WebSocket transport, and collaboration with the web app.

**Release decision: development validation only; not ready for production distribution.** The working collaboration and download flows do not establish token isolation, tenant isolation, safe refresh, or secure installation. The unresolved release blockers below remain implementation work. SEC-01 through SEC-04 have since been remediated in the desktop source; this does not change the live Zitadel configuration or server deployment.

## 1. Verification evidence and limits

Reviewed baseline: Git commit `04a08d7`, plus the uncommitted desktop/UI changes from this development session. The running desktop is the locally rebuilt, ad-hoc-signed `desktop/bin/Teddox.app`, using the explicit self-signed-certificate development option. The browser uses the existing deployment at `https://app.durgakiran.com`.

Test document: **Desktop media and comments QA 2026-11-03**, page 141 in the existing testing space. Only synthetic text/files were used. The temporary verification edits were undone; the QA image, attachment, and original test thread remain available for inspection.

| Check | Evidence | Result / boundary |
| --- | --- | --- |
| Web document loading | Brave loaded the QA title, image, attachment and comment thread | Passed for this document and signed-in account |
| Web to desktop editing | A marked browser edit appeared in the desktop without reloading | Passed |
| Desktop to web editing | A marked desktop edit appeared in Brave without reloading | Passed |
| Undo synchronization | Each client undid its own verification edit; both converged to the original QA contents | Passed |
| Live comments | Web resolve reached desktop; desktop reopen reached web | Passed |
| Resolved-thread retention | Rebuilt desktop retained the resolved thread; deployed web showed an empty Resolved tab | Web deployment still needs the shared `includeResolved=true` fix |
| Web reload | Reloaded the QA browser document after undoing the edits; original text, image, attachment and open thread reappeared without either verification marker | Passed for the tested draft |
| Desktop image/PDF/files | Earlier tests in this same session uploaded/rendered a PNG, retained comments/reply attachment across restart, rendered an exported PDF containing the image, and saved comment and document attachments with exact byte matches | Passed for small synthetic fixtures; not a file-format or size matrix |
| Browser file download | Clicked the browser download control; no matching file was observed in Downloads. The browser tool prohibited access to the internal download-status page | Inconclusive; do not count as passed or bypass the tool restriction |
| Local web build | `npx vite build --outDir /private/tmp/beskar-web-verification` from `ui` | Passed; output not deployed. Bundle-size warnings remain |
| Frontend regression tests | 71 tests across transport, downloads, API auth handling, comments, collaboration lifecycle, relay, draft sessions and PDF image handling | Passed |
| Go regression tests | `go test ./...` in both `desktop` and `signalserver` | Passed; existing tests do not establish room authorization or refresh-race safety |

These were two clients using the same account, on one macOS machine and development network. Separate-user permissions, other tenants, WAN/NAT combinations, network partition recovery, token expiry/revocation during a session, clean installation, upgrades, Windows and Linux remain unverified. The initial cross-client checks did not deliberately revoke or log out either session; the SEC-01 follow-up below separately exercised desktop logout and login. No cross-tenant exploit was attempted.

### SEC-01 remediation verification (3 November 2026)

- Regenerated auth bindings with the pinned Wails generator. Only `Login`, `Logout` and `IsAuthenticated` are exported to the renderer; the native manager is absent from the registered services.
- `go test ./...` in `desktop` passed, including the real Wails registry checks for forbidden method names and legacy IDs, facade delegation and shared native session ownership.
- All 401 UI tests passed; `npm run build:desktop` and the native Go build passed. Existing bundle-size and macOS linker-version warnings remain.
- Rebuilt and locally ad-hoc-signed `Teddox.app` restored the existing session and loaded page 141. Desktop **Sign out** reached the sign-in screen; **Sign In** completed through the existing Brave provider session, the native callback returned successfully, and page 141 reloaded with its image, attachment and comment thread. The final app remains signed in. This checks the development macOS flow, not token lifecycle races or production packaging.

### SEC-02 remediation verification (3 November 2026)

- Desktop `go test ./...` and `go test -race ./auth` passed. Negative cases exercise callback URI/parameter validation, state mismatch, old attempts, replay, provider denial/error, timeout, cancellation/shutdown and concurrent login rejection. A token-endpoint fixture confirms cancellation interrupts the HTTP exchange.
- All 406 UI tests passed, including cancel/retry, unmount cancellation, timeout/denial messages and successful authentication. The pinned Wails generator produces the same three-method JavaScript API; a real registry call confirms context injection needs no renderer argument.
- Desktop UI and native builds passed. In the rebuilt macOS app, Sign out reached the login screen; Sign In exposed **Cancel sign-in**, which returned to Sign In. A fresh attempt completed through the existing Brave identity session and its **Open Teddox.app** prompt, then loaded page 141 with the image, attachment and comment thread. The app remains signed in. Provider-denial and five-minute-expiry behavior were tested with fixtures, not forced against the live provider.
- Remaining refresh/session races, provider transport hardening, credential partitioning and production packaging remain covered by the unresolved findings below.

### SEC-03 remediation verification (3 November 2026)

- Desktop `go test -race ./...` passed across the full module, including the existing Wails binding and login transaction checks. Session fixtures cover shared concurrent renewal, worker ownership, omission/rotation persistence, malformed responses, expired-token rejection, temporary outages, short token lifetimes, definitive `invalid_grant`, failed rotation persistence, deletion errors, keychain write/logout ordering and old refresh/login results after logout or account replacement. Fixtures use synthetic tokens and in-memory credential storage.
- Startup now passes an app-lifetime context cancelled by Wails `OnShutdown`. The session worker and in-flight renewal stop on logout, replacement or app shutdown. Generation checks also reject late responses even if a test transport ignores cancellation.
- The native build passed, and regenerated auth bindings are unchanged. The rebuilt, locally ad-hoc-signed macOS app restored the existing session and loaded page 141. Sign out reached the login screen; restarting remained signed out. A fresh login through Brave's existing test account and **Open Teddox.app** prompt returned to the document, image, attachment and comment thread. The app remains signed in.
- Refresh rotation, omission and concurrency were verified with deterministic provider fixtures; live provider expiry/rotation was not forced. The SEC-04 follow-up addresses finite provider deadlines, redirect restrictions and ambiguous outcomes. Credential partitioning and final installer evidence remain unresolved release work.

### SEC-04 remediation verification (3 November 2026)

- Desktop `go test -race ./... -timeout 60s` passed. Isolated HTTPS/provider fixtures cover all redirect status codes (301/302/303/307/308) for discovery, token, revocation and userinfo requests; invalid origins; stalled headers/bodies; a bounded shared logout budget; sanitized errors; storage load/save/delete failures; and delayed/concurrent revocation outcomes.
- Durable-renewal tests verify a keychain pending marker is saved before transmission, no request is sent if that write fails, uncertain credentials are never replayed after failed deletion/restart, shutdown preserves the uncertainty marker, successful renewal clears it, and explicit temporary OAuth rejections restore the prior credential with a 30-second backoff. This deliberately trades availability for safety when a request's outcome is uncertain; even a request that never reached the provider can require fresh sign-in.
- All 411 UI tests passed. Status notice tests cover startup errors raised before subscription, background renewal failure, temporary rejection while the workspace remains usable, unconfirmed provider revocation and stale status-response ordering. The Wails registry test permits only `Login`, `Logout`, `IsAuthenticated` and `GetStatus`, with a five-field nonsecret status allowlist; sensitive native methods and old IDs remain absent.
- Desktop UI and native builds passed. The rebuilt, locally ad-hoc-signed macOS app restored the existing session and loaded page 141. Sign out reached the sign-in screen; a fresh Brave login and **Open Teddox.app** prompt returned to the document, image, attachment and comment thread. The app remains signed in. No provider/storage failures were deliberately induced against the user's live account or keychain; those branches were verified with synthetic fixtures.
- `refresh_pending` is backward-compatible for completed credentials, but older app versions do not enforce an interrupted-renewal marker. Before rolling back to such a version, remove the pending credential and require a fresh login; do not reuse an uncertain refresh token. Remaining certificate/build policy, credential partitioning, tenant/room authorization and installer gates below still block production distribution.

### SEC-05 source remediation verification (3 November 2026)

- Removed the Windows WebView certificate-ignore and web-security-disable arguments. The normal `!beskar_dev` TLS implementation returns a constant verification policy and does not read `BESKAR_DEV_ALLOW_SELF_SIGNED`. Only the separate `beskar_dev` file includes that opt-in. Normal transport construction also overrides an inherited `InsecureSkipVerify` setting while preserving configured CA roots.
- Both full desktop race suites passed: `go test -race -tags '' ./... -timeout 60s` and `go test -race -tags beskar_dev ./... -timeout 60s`. The TLS matrix verifies trusted chains, unknown authorities and trusted chains with mismatched hostnames for unset, `0`, `true` and `1` environment values. The normal build rejects both invalid cases even with `1`; development permits them only with `1`. Proxy, WebSocket and attachment fixtures now trust their test CA explicitly and pass under production verification.
- Both native artifacts built successfully. `go version -m` showed no custom tags on the production artifact and `beskar_dev` on development. The locally ad-hoc-signed development bundle, started with the explicit opt-in, restored the session and loaded page 141 with its image, attachment and comment thread. The app remains running in development mode.
- Added direct `make build-production`, `make build-dev`, `make dev-native` and `make test-tls` commands. Production builds explicitly clear custom tags with `-tags ''`; the development tag must never enter a release artifact. Existing Wails packaging task gaps remain REL-01 work.
- This is source/build verification on macOS, not final installer certification. Invalid-chain/hostname behavior must still be verified in signed installed artifacts on macOS, Windows and Linux, including Windows WebView behavior. SEC-05 therefore retains its installer-validation gate.

### SEC-07 isolation/migration verification (3 November 2026)

- Both full desktop race suites passed in production and `beskar_dev` modes. Scoped-store fixtures cover app ID, environment, signing authority, issuer, client, API and exact-subject isolation; metadata/selector substitution; account selection/logout; stale selection deletion; interrupted-refresh protection; failed migration cleanup; and restoration without any cross-context token request. Legacy retirement is asserted to delete without reading the old token value.
- Real RSA-signed ID-token fixtures verify issuer, audience/authorized party, expiry, issued-at, nonce, signature and access-token-hash rejection, plus matching UserInfo and account-preserving refresh. A verified code exchange writes a scoped record, which restores after restart. Existing login/session and Wails registry regressions still pass, and regenerated auth bindings are unchanged.
- All 413 UI tests passed, including migration/context-mismatch notices. The macOS-only native integration test created, updated, read and deleted a randomly named synthetic Keychain entry; it never inspected existing application or legacy credentials. Both native artifacts built successfully. Production signing configuration is fail-closed and covered without accessing a user's Keychain.
- Live macOS migration was tested in **Teddox Development**, bundle ID `com.durgakiran.beskar.dev`, at `desktop/bin/Teddox Development.app`. The old CLI-created entry needed its deletion-only compatibility path; after that update, the app displayed **Credential storage has been upgraded. Sign in again; the previous shared credentials were removed.** A fresh browser login completed signed ID-token/nonce and UserInfo validation, loaded page 141 with media/comments, and restored after a restart. Scoped Sign out then remained signed out after another restart; a final fresh login loaded the same QA document. The app remains signed in. No token values were printed or manually read for verification.
- Development and production now use separate app names/IDs, configuration directories and credential contexts. Shared configuration is not auto-imported. Quit older app versions during upgrade so they cannot recreate the retired global slot. The current prototype callback scheme is still shared; concurrent dev/prod installers need distinct registered redirects/client configuration before distribution.
- macOS new-item ACLs trust the actual calling app through Security.framework. Production storage additionally requires the expected Team ID and signed identifier. Ad-hoc development success does not establish signed-upgrade ACL behavior or Windows/Linux app-level isolation; those remain signed-platform release gates. Windows Credential Manager/Linux Secret Service currently retain OS-user protection plus logical namespaces, not an asserted per-app security boundary.

## 2. Release blockers from the current code

These are source-review findings, not claims that a live exploit was demonstrated. Each unresolved finding needs an implementation and a negative regression test before release; SEC-01 through SEC-04 record their completed remediations.

| ID | Finding and source | Required outcome |
| --- | --- | --- |
| SEC-01 — fixed | The original Wails-bound `AuthService` exposed token access, initialization and callback ingestion. The [native manager](../../desktop/auth/manager.go) now stays unbound; the [UI facade](../../desktop/auth/service.go) exposes `Login`, `Logout`, `IsAuthenticated` and the nonsecret `GetStatus` reader | Implemented in the [actual service list](../../desktop/services.go), with regenerated frontend bindings. The [Wails registry regression test](../../desktop/services_test.go) rejects sensitive method names and legacy IDs, and verifies the four allowed calls and the status-field allowlist. Keep this boundary when adding methods; removing JS wrappers alone is insufficient |
| SEC-02 — fixed | [Login transactions](../../desktop/auth/login.go) now use a fresh random state and S256 PKCE verifier, a five-minute deadline and one pending attempt. Only the exact `teddox://callback` redirect with matching state is accepted; callbacks are consumed once before token exchange | [Regression tests](../../desktop/auth/login_test.go) cover malformed/mismatched/stale/replayed callbacks, denial, timeout, concurrent attempts and cancellation, including cancellation of a token request. The UI can cancel the native Wails call; logout and app shutdown also cancel pending login. PKCE is retained |
| SEC-03 — fixed | [Native session ownership](../../desktop/auth/manager.go) now uses synchronized token state, one cancellable worker per login/restoration and generation-scoped single-flight renewal. Refresh updates the current session without spawning workers or emitting login events | [Lifecycle race tests](../../desktop/auth/session_test.go) cover rotation/omission persistence, concurrent renewal, stale results after logout/account replacement, shutdown and storage ordering. Missing replacement refresh tokens retain the prior token; persistence failure invalidates the session. Short-lived tokens use an adaptive refresh lead. SEC-04 adds bounded provider requests and durable handling of ambiguous network outcomes |
| SEC-04 — fixed | [Provider policy](../../desktop/auth/provider.go) enforces a 15-second limit, HTTPS origin validation, fixed endpoint paths, redirect rejection and bounded response parsing. [Session handling](../../desktop/auth/manager.go) writes a keychain pending marker before renewal; uncertain outcomes and interrupted refreshes require a fresh login instead of replaying an old token | [Provider regression tests](../../desktop/auth/provider_test.go) cover deadlines, redirects, invalid destinations, lost responses, crash/restart, persistence failures and logout outcomes. Only explicit temporary OAuth rejection responses are retried, with backoff. [Nonsecret status](../../desktop/auth/status.go) and the desktop auth notice surface startup/background storage errors and distinguish local logout from provider-confirmed revocation |
| SEC-05 — source fixed; installer validation pending | [`main.go`](../../desktop/main.go) no longer supplies Windows certificate-ignore/web-security-disable flags. [Production TLS policy](../../desktop/config/transport_tls_production.go) always verifies certificates; only the explicit [beskar_dev build](../../desktop/config/transport_tls_development.go) includes the runtime development exception | [Certificate policy tests](../../desktop/config/transport_test.go) exercise trusted/untrusted chains and wrong hostnames under every environment setting in both build modes. Production artifacts must exclude `beskar_dev`. Repeat the negative checks in signed installed macOS/Windows/Linux artifacts; this machine cannot establish the final Windows installer/WebView behavior |
| SEC-06 | [`signalserver/main.go`](../../signalserver/main.go) validates the connection's session, then accepts client-selected subscribe/publish topics without checking the user's permission for each room; publish does not require prior subscription | Bind a verified user to the connection and authorize every room action against its space/page. Deny cross-tenant reads and writes, including direct publish without subscription |
| SEC-07 — source/macOS migration implemented; signed-platform validation pending | [Versioned scoped storage](../../desktop/auth/keychain.go) binds tokens to app/build identity, environment, signing authority, issuer, client, API and verified subject. [Account verification](../../desktop/auth/identity.go) validates the ID token and matching UserInfo. [Native macOS Keychain access](../../desktop/auth/keychain_darwin.go) uses caller ACLs and checks the configured production signing identity | [Isolation/migration tests](../../desktop/auth/keychain_test.go) reject cross-context records before token transmission, preserve unrelated accounts, retire the legacy slot without reading it, and retain pending-refresh protection. Production macOS signing/upgrade ACLs and Windows/Linux package access controls still require signed-artifact verification; namespace separation alone is not an OS app-access boundary |
| SEC-08 | The [native transport](../../desktop/transport/service.go) checks authentication at the WebSocket handshake. Existing upgraded connections are not explicitly invalidated by desktop logout/account switch; the signaling server also authenticates at connection establishment | Close active transports on logout/account change and enforce expiry/revocation/permission changes server-side for long-lived connections |
| SEC-09 | No CSP is declared in [`index.desktop.html`](../../ui/index.desktop.html); privileged IPC accompanies remotely supplied document content. The [loopback capability](../../desktop/transport/service.go) is exposed to the renderer as its transport URL | Add tested CSP, sanitize content, isolate embeds, restrict top-level navigation, and treat the local capability as a sensitive authenticated API capability |
| REL-01 | Packaging task files referenced by [`Taskfile.yml`](../../desktop/Taskfile.yml) are missing; current signing is ad hoc; per-environment clients/redirects and signed-platform credential controls still need deployment validation | Provide reproducible signed installers, correct environment-specific configuration, automatic URL-scheme registration, and clean-machine installation evidence |

## 3. Token-security target design

### Trust boundaries

The renderer is not a secret store. A malicious document, compromised renderer dependency, unsafe embed or XSS must not be able to retrieve OAuth credentials or reconfigure the identity provider. OS keychain storage protects credentials at rest; it does not prevent a running app from leaking them through its bindings. A compromised OS/root account is outside this application's isolation guarantee and must not be described as protected by keychain storage alone.

Keep the existing direction: Go supplies bearer headers to HTTPS APIs/WebSocket handshakes, and the web renderer receives document data rather than OAuth tokens. SEC-01 removed the raw-token binding and its registry regression guards that boundary.

### Storage and exposure rules

1. Put login/token management in an unbound native component. Expose only nonsecret status, login/logout actions and minimal display identity through a separate UI service. Audit the runtime binding registry, not just TypeScript imports. No UI-callable `GetAccessToken`, `GetRefreshToken`, credential setter, provider-endpoint setter or raw callback handler.
2. Prefer access tokens in native memory and the minimum renewal credential in the OS credential store. Persisting access/ID tokens needs a documented reason; the current ID token is not needed for bearer API authorization. Do not start using it for identity without full OIDC validation.
3. Use macOS Keychain, Windows Credential Manager and a supported Linux Secret Service implementation. Check locked/denied/unavailable behavior on each platform. No silent plaintext fallback. If persistence is unavailable, show an explicit session-only/re-login outcome.
4. Namespace entries by environment, issuer and client; use an account identifier for multi-account support. Development and production must not read each other's refresh tokens. Reconfiguration/account switch must invalidate the old native session before switching targets.
5. Treat keychain write/delete failures as real outcomes. The pinned macOS keyring implementation sends secrets through stdin rather than command arguments, but limits its generated command to 4096 bytes. The current combined JSON record may exceed that limit; add realistic-size storage tests and do not ignore `SaveTokens` errors. Do not inspect or print a user's real keychain contents to test this.
6. Never place tokens in browser storage, IndexedDB, config JSON, URLs, command-line arguments, logs, telemetry or support bundles. The loopback capability URL also grants API access: redact it, rotate it per process and do not place it in persisted document content.

### Login and callback transaction

SEC-02 implements explicit callback correlation and bounded login attempts. Properly enforced, transaction-specific PKCE can itself provide CSRF protection when provider support is assured; absence of `state` alone was not proof of an exploitable login-CSRF vulnerability. Using `state` here lets the desktop reject unrelated responses before attempting token exchange. See [RFC 9700 section 4.7.1](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.7.1).

Use the system browser, a public Native client, Authorization Code flow and S256 PKCE. Do not ship a client secret in the executable. Bind each login to a cryptographically random state, verifier, expected issuer/client, exact callback and deadline. Atomically consume it once. Reject unsolicited/malformed/wrong-state/expired/replayed callbacks and surface provider denial without leaving the UI waiting forever.

The current generic `teddox://callback` is a development registration. For production, migrate to a scheme derived from a domain the publisher controls, for example `com.durgakiran.beskar:/oauth/callback`, or evaluate an app-claimed HTTPS or short-lived loopback OAuth callback. A URI-scheme migration requires coordinated Zitadel, route-parser and OS-package changes. The existing loopback API bridge is not an OAuth callback listener. Native-app redirect and PKCE guidance is covered by [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html).

### Refresh and logout lifecycle

- Own exactly one cancellable refresh worker per session. Protect the current token set with synchronization, and use a session generation so a late refresh result cannot recreate a logged-out or switched session. Recheck freshness inside the single-flight operation.
- Validate successful token responses before adopting them. Preserve the previous refresh token when a legitimate response omits a replacement; persist a rotated credential before acknowledging renewal. Never silently continue with a token whose durable rotation state is unknown.
- Distinguish definitive `invalid_grant`, explicit temporary rejection and uncertain network/provider outcomes. Persist a pending-renewal marker before transmitting a refresh token; uncertain/interrupted outcomes require a new login and must remain blocked across restart. Only an explicit recognized temporary OAuth rejection permits clearing the marker and retrying with backoff.
- Expired credentials must not be forwarded. An explicit temporary OAuth rejection preserves the renewal credential and permits a backed-off retry. An uncertain response ends renewal, clears local credentials when possible and requires a fresh login; the durable pending marker prevents replay if deletion fails or the app restarts.
- Use bounded timeouts and contexts for discovery, token, userinfo and revocation calls; reject redirects and unexpected issuer endpoints. Cancel workers on shutdown/logout. Set a finite login deadline independently of the app lifetime.
- On logout, immediately cut off local API/WS use, close active sockets, cancel the worker, clear memory and remove the credential entry with checked error handling. Attempt provider revocation with a bounded request and distinguish local logout from confirmed server revocation. Never log a revocation payload or retain a plaintext retry token.
- Require refresh-token replay detection through rotation or sender constraints for the public desktop client. Consider DPoP only if the provider and API implement and validate it end to end; it does not replace room permissions or renderer isolation. See the OAuth security guidance in [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html).

### Zitadel and backend configuration

Keep separate web and native client registrations per environment. Configure exact callbacks, the intended API audience, least-required scopes and public-client authentication without a secret. Check native-client refresh behavior in the deployed Zitadel version; set risk-based access lifetime and refresh idle/absolute expiry and verify them, rather than assuming defaults. [Zitadel application settings](https://zitadel.com/docs/guides/manage/console/applications-overview) and [token-lifetime settings](https://help.zitadel.com/configure-oidc-token-lifetimes-in-zitadel) describe those controls.

Preserve the backend's issuer/audience/client allowlist, active-token/expiry checks and distinction between access and ID tokens. Resource permissions must be enforced after authentication. Keep browser tokens server-side, with the existing encrypted session-store design reviewed separately; an HttpOnly browser cookie must not become a desktop token-export mechanism. Follow the existing [browser/access-token runbook](browser-access-token-validation.md) for its rollout and remaining limitations.

## 4. Native transport and collaboration hardening

The random-port loopback bridge currently uses a 256-bit per-process capability path, loopback-only binding, native-origin checks, native bearer injection and restricted route families. These are useful controls, but the capability authorizes a broad backend API surface. It is sensitive even though it is not an OAuth token.

Before release:

- Validate the request Host against the actual bound loopback endpoint, reject unexpected origins and paths, and document why opaque `null` origins are needed by WebKit. Test hostile sites, sandboxed/opaque origins, guessed capabilities, DNS-rebinding-style Host values and other local processes with isolated fixtures. An origin check is not local-process authentication.
- Keep backend destinations native and immutable during a session. Reject query/userinfo/fragment-bearing endpoint configuration; do not let renderer input choose arbitrary upstream URLs. Never forward auth to third-party embeds/downloads.
- Minimize proxied routes/methods, strip untrusted forwarded headers, and prevent unwanted upstream cookies or authentication-debug headers from reaching the renderer. Preserve multipart bodies, cancellation and SSE streaming. Test both the loopback bridge and the older asset/media proxy so neither becomes a bypass.
- Bound request bodies, uploads, concurrent connections and idle handshakes without buffering indefinite event streams. Avoid credential/capability values in error URLs and proxy access logs.
- Keep upstream TLS verification mandatory. Use a trusted development CA for realistic preproduction testing; never carry browser warning bypasses, relaxed WebView flags or development TLS settings into release builds.
- Authenticate WebSocket connections, then separately authorize subscribe, publish and leadership actions for a canonical page/space/user. Room-name knowledge is not authorization. Validate message shape/size/rate and disconnect sessions when credentials or resource access are revoked. Authentication at handshake alone is insufficient for a long-lived session.
- Keep desktop WebSocket credentials in native headers. Remove legacy query-token paths where possible; otherwise isolate and redact them with an explicit migration deadline. Never add OAuth tokens to the browser's WebSocket URLs to work around header limitations.
- Make logout/account switch terminate active local and upstream sockets, including hijacked connections; do not rely on `http.Server.Close` alone. Rejoining a room must reauthorize it. Test viewers, editors, revoked members and other tenants, not only two sessions for the same user.

## 5. Renderer, local data and file safety

Serve the privileged UI from bundled assets. Open ordinary external links in the system browser and block remote top-level navigation from inheriting Wails IPC. Isolate embedded content without native bindings. Add a tested CSP with narrowly scoped script/connect/frame/image sources; account for the random loopback port and WebKit origin behavior. Bundle fonts/assets instead of depending on arbitrary remote resources. Test HTML/SVG/paste/import sanitization against the actual runtime build.

Local draft/recovery data is user content, not a credential store. Define account/tenant partitioning, retention, migration and logout cleanup; decide whether sensitive deployments require encryption at rest. An offline draft must never be synchronized into another user's account after a switch.

Retain the attachment safeguards: native save dialogs, configured-backend-only attachment paths, resource permission checks, bounded download size, atomic writes and no file creation on cancel/failure. Do not auto-open or execute downloaded files. Add malformed-file, MIME mismatch, dangerous-name, overwrite, full-disk, permission-denied and platform-quarantine checks. PDF export and file previews must not fetch authenticated resources from arbitrary hosts or execute active attachment content.

## 6. Packaging, updates and operations

| Area | Release requirement | Evidence to retain |
| --- | --- | --- |
| Build | Restore version-controlled platform task files; pin Go/Node/npm/Wails and lock dependencies; build shared web and desktop outputs separately; scan dependencies and produce an SBOM | Build logs, resolved versions, artifact hashes, SBOM and scan disposition |
| macOS | Use a stable bundle identity and automatic URL-scheme registration. Developer ID-sign with hardened runtime and secure timestamp; notarize and staple. Current ad-hoc signing is development-only | Clean-machine Gatekeeper launch, callback, keychain, upgrade and uninstall tests; signing/notarization verification |
| Windows | Sign executable/installer; remove WebView security overrides; verify runtime prerequisites, callback registration and Credential Manager behavior | Supported Windows architecture/version installation and upgrade evidence |
| Linux | Package required WebKit/Secret Service dependencies, desktop entry and scheme association; fail explicitly when secure credential storage is unavailable | Supported distribution/desktop session evidence |
| Updates | Use authenticated signed update metadata/artifacts, verification before installation, safe interruption recovery and an explicit anti-downgrade policy | Tampered-update rejection, interrupted-update and rollback drills |
| Configuration | Separate dev/stage/prod client IDs, issuers, servers, package identities and credential namespaces. No client secrets in frontend/build artifacts | Automated release-config checks and artifact inspection |
| Observability | Record nonsecret status categories, timings and correlation IDs. Redact tokens, callback queries, local capabilities, cookies, document bodies and unnecessary identity data | Redaction tests for logs, crash reports and support bundles |
| Support | Define supported OS versions, API compatibility, recovery/export behavior, incident response and credential revocation procedures | Operator runbooks, support ownership and release notes |

Apple's requirements for distribution signing and notarization are documented in [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution). Windows credential-storage guidance is in [Handling Passwords](https://learn.microsoft.com/en-us/windows/win32/secbp/handling-passwords). The exact framework/runtime versions must be reviewed at release time; a pinned alpha dependency is not evidence of production suitability.

## 7. Required release test gates

| Gate | Minimum acceptance evidence |
| --- | --- |
| Token isolation | Runtime IPC cannot return credentials or reconfigure the provider; renderer/storage/log/support-bundle scans contain no tokens; dev credentials cannot be reused by prod |
| Callback | Wrong/missing state, unsolicited callback, replay, denial, concurrent login, stale callback, process restart and timeout all terminate safely; valid login completes once |
| Refresh | Concurrent API calls cause one refresh; omitted/rotated refresh-token cases pass; denied/oversize/locked keychain cases are visible; outage and ambiguous responses do not replay or erase credentials unsafely |
| Logout | Delayed refresh cannot restore a session; local APIs and existing WS/SSE streams stop; confirmed provider revocation rejects replay; offline/provider-failure outcomes are explicit |
| Resource isolation | Two users with different roles, two tenants and revoked membership cannot read/publish unauthorized room data or access attachments. Direct publish without subscription is denied |
| Transport | Invalid certificates/hostnames fail in the installed production artifact even with the development environment variable set. Malicious origins/Host values and arbitrary destinations are denied |
| Collaboration | Web-web, web-desktop and desktop-desktop edits/undo converge; comments/media synchronize; packet loss, network partition, sleep/wake and process crash recovery do not lose edits or cross account boundaries |
| Web regression | Deploy the shared resolved-thread fix, then verify resolved history/reopen, uploads, downloads and published views in supported browsers; existing deployment success does not prove a local source fix is deployed |
| Files | Inline/comment downloads, previews, image upload, PDF export, cancellation, retry, maximum sizes and denied access pass on each supported OS |
| Distribution | Clean install and upgrade work without manual terminal registration or security-warning bypasses; signature/notarization/update verification passes |

Run isolated fake-provider/auth fixtures for destructive or replay scenarios. Use named disposable accounts/tenants for deployed permission tests. Do not export users' live credentials or probe other tenants to obtain evidence.

Suggested local commands, from the repository root:

```bash
cd desktop
go test ./...
go test -race ./...
```

```bash
cd signalserver
go test ./...
go test -race ./...
```

```bash
cd ui
npm test
npm run build:desktop
npx vite build --outDir /private/tmp/beskar-web-release-check
```

Race tests and the full frontend suite are required release gates, not tests claimed as run by this review. Also run the backend's isolated browser/bearer/session tests described in its runbook. Save actual results against the exact commit and installed artifacts; passing current unit tests does not waive a missing negative security test.

## 8. Delivery order and sign-off

1. Security/backend owners retain the deferred SEC-06 authorization gate, fix SEC-08, finish SEC-05/SEC-07 signed-platform validation and retain the SEC-01 binding, SEC-02 login transaction, SEC-03 session lifecycle and SEC-04 provider/storage failure regressions, including per-room authorization and token lifecycle tests. No external distribution before these gates pass.
2. Desktop/UI owners complete SEC-09, configuration separation, secure storage behavior and file/renderer isolation. Keep the development and production trust settings separate during this work.
3. Release owners restore reproducible packaging, signed updates and clean-machine installer evidence. Deploy the shared web fixes and verify both client versions against the same backend contract.
4. Run the complete cross-client, role/tenant, expiry/revocation, recovery and platform matrix. Record remaining limitations explicitly.
5. Approve an internal canary only with assigned security/release owners, artifact hashes and a tested rollback/revocation plan. Expand distribution after reviewing canary errors and security evidence.

Current assessment: the tested development workflows are functional, but neither the current desktop authentication surface nor the current signaling authorization is approved for production. Documentation and functional tests alone do not resolve these blockers.
