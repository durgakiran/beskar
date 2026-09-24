# Authentication design and delivery plan

> Active decision: keep OAuth login, token exchange and subsequent refresh in Go. The browser-managed alternative is abandoned. Configure the Go web client as confidential with `client_secret_basic` and retain PKCE.

Status: access-token validation, confidential-client code exchange and browser refresh and Redis session expiry/storage implemented locally. Date: 2026-09-23. Live Zitadel configuration and verification remain deployment work.

Scope: browser session lifecycle, desktop authentication defects, and shared application behavior discussed in the authentication review. This document does not change running authentication or Zitadel settings. Priority order follows the user decision: validate access tokens first, introduce browser refresh second, then complete the remaining lifecycle and desktop work.

## Decision

This section describes the target architecture. Current refresh uses encrypted Redis storage, deadline-capped TTLs, and shared refresh coordination. Synchronous provider revocation is implemented; POST/CSRF logout remains future work.

Keep Zitadel as the identity provider and authorization code + PKCE as the login protocol. Keep separate OIDC client registrations for browser and desktop. Share the authenticated-user contract, authorization checks, React state machine, and API error handling.

The Go browser client authenticates to the token endpoint using `ZITADEL_CLIENT_ID` and `ZITADEL_CLIENT_SECRET` via HTTP Basic while also sending the PKCE verifier. Desktop remains a public native client and must never receive this secret. This is the authorization-code grant, not the client-credentials grant. Zitadel issues tokens; Go exchanges the code and manages the resulting credentials.

Login and introspection share `ZITADEL_CLIENT_ID` and `ZITADEL_CLIENT_SECRET`. Keep the `KEY` used for session/state/PKCE cookie encryption separate; Compose maps `ZITADEL_SESSION_KEY` to `KEY`. Previously `ZITADEL_CLIENT_SECRET` was used only as `KEY`; follow the runbook migration before deployment. Configure Zitadel's web app authentication method as Basic / `client_secret_basic`, not `none`.

- Browser: same-origin SPA and backend; browser receives only an opaque HttpOnly session cookie. The backend owns OAuth credentials and the application session lifecycle.
- Desktop: system-browser login; native Go code owns tokens in the OS keychain and attaches access tokens to API requests. React calls a platform adapter, not a token getter.
- Backend: explicit cookie and bearer validation produce the same typed principal. Existing resource membership/permission checks still run. Successful authentication does not grant access to a workspace or document.
- Redis: shared browser sessions, expiration, revocation indexes, and atomic renewal coordination. Deployment templates already include Redis; authentication must require a healthy configured store instead of silently falling back to memory.
- OIDC library: retain a maintained library for discovery, signature validation, PKCE, code exchange, and token endpoint calls. Own the thin HTTP/session orchestration around it. Do not implement OAuth cryptography ourselves.

The installed `zitadel-go/v3@v3.3.0` high-level session API exposes only `Get` and `Set`; its default store is an unsynchronized map and its logout handler only clears the cookie. Merely plugging Redis into that interface will not implement the required lifecycle. Replace the high-level session handlers with application-owned handlers using the OIDC relying-party library, or select a verified SDK API that supports the same contract. Preserve existing login, registration, and invitation return destinations.

This browser/backend boundary follows the BFF architecture in [RFC 10017](https://www.rfc-editor.org/rfc/rfc10017.html). The native flow follows [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html).

## Session and API contract

Target policy (the current implementation uses configurable 30-minute idle and 8-hour absolute limits; other lifecycle items remain planned):

| Policy | Initial value / behavior |
| --- | --- |
| Browser idle limit | 30 minutes since meaningful authenticated activity |
| Browser absolute limit | 8 hours from application session creation; refresh never extends it |
| Browser cookie | `__Host-beskar_session`; Secure, HttpOnly, SameSite=Lax, Path=/, no Domain |
| Cookie lifetime | Session cookie initially; server deadlines remain authoritative even after browser session restore |
| Login transaction | Single-use, 5-minute deadline, state + nonce + PKCE, exact registered callback |
| Provider validation freshness | Every eligible cookie-authenticated API request in slice 1; any later cache requires an explicit revocation-delay decision |
| HTTP calls to identity provider | Request cancellation, finite timeouts, bounded retry/backoff for retryable operations |
| Stream revocation | Close within 30 seconds of known application revocation; provider changes also depend on delivery/freshness bounds |

Target behavior: polling, token renewal, session status reads, and socket keepalives must not perpetually renew idle time. The current implementation counts all successfully validated API requests as activity; separating user activity remains follow-up work. Editor mutations count as activity; local unsaved editing can send a throttled activity request while the user interacts. This is an inactivity measure, not proof of a human. Absolute expiry remains the hard limit. Preserve drafts and explain expiration before redirecting. New login may reuse Zitadel SSO; absolute application expiry does not by itself mean the user must re-enter a password. Fresh authentication for sensitive operations uses an explicit provider `max_age` policy.

Session record: hashed random session identifier; issuer, subject, application user ID, client ID, provider session ID when available; created/last-active/idle-deadline/absolute-deadline timestamps; validation timestamp; version; CSRF secret; encrypted OAuth credentials and their expiries. Store encryption keys outside Redis and support key versions. Do not persist bearer credentials in logs, URLs, browser storage, or UI state.

Use atomic create/read-and-touch/delete or revoke operations, with Redis TTL capped by the absolute deadline. Renewal writes must check the session version and existence: a refresh racing with logout must never recreate the session. Index sessions by issuer/client/subject and provider session ID for invalidation. Indexes and tombstones need bounded TTLs and cleanup. Redis persistence reduces restart disruption but is not a security guarantee: failover/backup restoration must not resurrect revoked sessions; bump a session namespace/epoch and require login if revocation durability is uncertain.

| Endpoint / result | Contract |
| --- | --- |
| `GET /auth/login`, `GET /auth/register`, `GET /auth/callback` | Library-backed OIDC flow with validated return paths and one-use transactions |
| `GET /api/v1/session` | User summary and authentication state; browser additionally receives a session-bound CSRF token and deadlines; never OAuth tokens; `Cache-Control: no-store` |
| `GET /api/v1/authenticated` | Compatibility status endpoint backed by the same validation; retain for signalserver during migration |
| `POST /auth/logout` | Browser CSRF-protected, idempotent server invalidation followed by cookie deletion; optional provider logout URL from trusted configuration |
| `GET /auth/logout` | Transitional confirmation page only; must not remain an unprotected mutating endpoint |
| `POST /auth/backchannel-logout` | Signed provider message validation, not browser-cookie authentication or browser CSRF |
| `401 AUTH_REQUIRED` | Missing, expired, or definitively revoked credentials; frontend may initiate login after preserving work |
| `403 FORBIDDEN` / `403 CSRF_FAILED` | Permission or request-integrity failure; do not loop through login |
| `503 AUTH_UNAVAILABLE` | Store/provider unavailable when required; fail closed for protected work, preserve credentials/drafts, show retry |

An explicit malformed/invalid Authorization header must not fall back to a cookie. Bearer access tokens need the configured API audience and allowed client policy, not just a trusted signature. ID-token audience is a client ID; API audience is a separate configuration concept. Resolve missing profile fields from the application profile or verified userinfo, rather than assuming access tokens contain email/name.

## Prioritized vertical slices

Each slice includes configuration, backend/native behavior, affected UI, automated acceptance coverage, operational signals, and rollout notes. Each must demonstrate its user outcome before it is considered complete.

### 1. P0 — Validate the browser session's access token before API access

**User outcome:** possession of a session cookie is no longer sufficient when its corresponding access token is expired, revoked, or intended for a different application.

**Deliver:** validate the stored access token through Zitadel introspection on every eligible cookie-authenticated API request. Enforce local expiry plus provider active status, issuer, browser client, API audience, subject binding, expiry and not-before. Request the project audience at login. Use the same confidential web client credentials for introspection, verified HTTPS, cancellation and a finite timeout. Invalid credentials return 401; provider failures return 503 without destroying the session. Update the auth guard to offer retry on outages and retain invitation return paths. Keep refresh out of this slice.

**Acceptance:** valid cookie/token reaches the handler; expired, inactive, wrong-subject/client/audience/issuer tokens do not; malformed responses, provider outage and invalid API credentials return 503; the frontend does not treat 503 as authenticated or redirect endlessly. Confirm the flow against the deployed Zitadel project before rollout.

**Rollout:** provision the confidential web application credentials and project audience first. Existing sessions may require a new login. Until slice 2 ships, access-token expiry requires another login. See [configuration and verification runbook](runbooks/browser-access-token-validation.md).

**Status:** implemented locally with controlled-provider and UI tests; live Zitadel configuration/verification remains a deployment step.

**Depends on:** none. This slice includes verified transport for introspection; the broader TLS cleanup remains slice 4.

### 2. P0 — Introduce server-side refresh for browser sessions

**Status:** implemented with shared encrypted Redis storage and refresh coordination; live deployment verification remains required.

**Delivered:** `offline_access`, confidential Basic refresh on access expiry, per-session serialization, saved refresh-token rotation, validation of the refreshed access token by introspection, preserved tokens on temporary errors, a three-second retry cooldown, and 401 on invalid_grant. Inactive unexpired tokens are never refreshed. Redis TTLs enforce configurable 30-minute idle and 8-hour absolute deadlines. Logout deletes shared state and cannot be undone by a completing refresh. Tokens remain server-side. Tests include concurrent SDK cookie requests, rotation, failure recovery and logout races.

**Rollout:** enable the Refresh Token grant in Zitadel and log in again. Configure all replicas with the same Redis database and session key. Existing in-memory sessions require a new login during migration. Synchronous provider revocation on logout is implemented in slice 3; outages require manual retry.

**Depends on:** slice 1; see the [runbook](runbooks/browser-access-token-validation.md).

### 3. P0 — A browser session survives deploys, expires, and actually ends on logout

**Status:** encrypted Redis storage, idle/absolute expiry, TTL cleanup, store-failure handling and cross-replica logout deletion implemented. Synchronous provider revocation is implemented; failure returns 503 and retains an authentication-blocked session for manual retry until its existing TTL expires. POST/CSRF logout and distinguishing user activity from polling remain unfinished. The current SDK cookie name is retained; do not mix old in-memory and new Redis replicas during rollout.

**User outcome:** users remain signed in across an application restart or replica change; idle/absolute expiry is enforced; signing out makes the old cookie unusable.

**Deliver:** replace the default SDK session lifecycle with the Redis-backed contract above; library-backed callback creates a new unpredictable session; authenticated requests enforce deadlines; explicit POST logout invalidates the record before reporting success and clears the cookie. Include the session endpoint, CSRF protection for logout, and minimal browser UI changes for logout, expiration, and 503 retry. Logout requires synchronous provider revocation and confirmed store deletion before reporting success. If Zitadel is unavailable, return 503 and retain the cookie and encrypted session for manual retry until its existing TTL expires, while blocking authentication and refresh. No background revocation jobs are used. Fix singleton initialization using `sync.Once` or an equivalent race-free initialization path.

**Acceptance:** sign in on replica A, use replica B, restart A, and remain authenticated; advance a fake clock past both deadlines and get 401; replay a copied cookie after logout on either replica and get 401; concurrent login/read/logout passes race testing; Redis failure gives 503 and no access; login/logout races cannot restore an invalidated session. Existing registration and invitation-return tests pass.

**Rollout:** deploy one new session-cookie name and Redis namespace; existing browser sessions require one new login. Drain old replicas and stop accepting the old cookie. Do not fall back to the old session validator on errors. Record session creation/expiry/revocation and store-failure metrics without secrets.

**Depends on:** slice 2; reuse its shared store and finish the application session lifecycle.

### 4. P0 — Browser and desktop sign in over verified HTTPS in every supported environment

**User outcome:** login, refresh, and protected media work with the intended certificates; an untrusted endpoint is rejected with a useful connection error.

**Deliver:** remove unconditional TLS bypasses from desktop authentication and proxy clients; require verification for server OIDC calls. Provide a documented trusted development CA path/system trust setup and valid certificate chains in deployment; validate issuer/API hostname matching. Add finite HTTP timeouts and context cancellation. Production configuration rejects verification bypasses. The browser must trust the development CA as well as Go.

**Acceptance:** complete browser and desktop login against a trusted development certificate and production-like chain; wrong hostname/untrusted certificate fails for exchange, refresh, and media; an unreachable provider times out rather than freezing logout or login. Verify the setup on each packaged desktop OS.

**Rollout:** distribute/trust the CA or install valid certificates before shipping verification enforcement. Include certificate troubleshooting in the desktop/deployment runbook.

**Depends on:** none; introspection already verifies TLS in slice 1.

### 5. P0 — Only intended application access tokens reach protected APIs

**Status:** bearer audience/client/lifetime validation and per-request introspection implemented, with a typed bearer identity and removal of legacy ID-token verification/Hasura claim definitions. Desktop API requests use access tokens and discover the API audience before login. Deployment must configure `ZITADEL_BEARER_CLIENT_IDS`; existing desktop grants require fresh login. Live provider verification and full cookie/bearer principal consolidation remain follow-up work.

**User outcome:** current desktop can access its permitted data; unrelated-client tokens and ID tokens cannot authenticate to the API; browser and desktop user search work.

**Deliver:** configure Zitadel's API audience and allowed clients; request that audience during desktop authorization and send `access_token`, not `id_token`. Extend slice 1's introspection policy to bearer access tokens with the desktop client allowlist; verify issuer, audience, expiry, and client restrictions. Cache provider metadata/keys safely and use request deadlines instead of discovering the provider on every request. Normalize cookie/bearer results into a typed principal and route `/api/v1/user` through authentication. Keep resource-level authorization intact. Remove unused Hasura claim definitions as part of this replacement.

**Acceptance:** desktop login then read/edit/search with proper permissions succeeds; ID token, wrong audience/client, expired token, and malformed header fail; browser cookies still work; a token plus an unrelated invitation query parameter selects the correct path; missing access-token profile claims do not prevent legitimate user resolution.

**Rollout:** coordinate desktop minimum-version enforcement and provider configuration. If an overlap is unavoidable, use an explicitly time-limited, exact-client legacy validator with telemetry; never retain `SkipClientIDCheck`. Final acceptance requires legacy ID-token support to be disabled.

**Depends on:** slice 4; integrate the common principal with slice 3.

### 6. P0 — Cross-site requests cannot mutate a browser user's workspace

**User outcome:** normal editor, upload, invite, account, and logout actions work; forged requests from another site cannot perform those actions.

**Deliver:** apply session-bound CSRF tokens and exact origin checks to all cookie-authenticated mutations, wiring every UI request helper and multipart upload. GET/HEAD routes must not mutate state. Keep browser traffic same-origin through the proxy and avoid wildcard credentialed CORS. Token-authenticated routes are exempt from cookie CSRF only after explicit bearer validation. OIDC callback and signed back-channel logout use their own protocol protections.

**Acceptance:** browser create/edit/upload/invite/logout succeed; missing/incorrect CSRF token and hostile origins fail without side effects; a sibling subdomain cannot bypass protection; bearer desktop operations work; registration/callback remain functional. Inventory all mutation routes, including legacy forms, before completion.

**Rollout:** ship clients sending CSRF tokens with enforcement in the same release; preserve a clear CSRF error distinct from expired login.

**Depends on:** slice 3; coordinate with slice 5.

### 7. P1 — Desktop remains usable through token expiry and temporary outages

**User outcome:** an active desktop session renews once, does not panic, and does not erase credentials merely because the network drops.

**Deliver:** one cancellable refresh worker per session; synchronized state; one typed refresh result shared by background and foreground callers; safe refresh-token rotation/keychain persistence; preserve the current refresh token when the protocol response legitimately omits a replacement. Use a session generation so a response arriving after logout cannot restore credentials. Distinguish invalid credentials from transient failures; retain still-valid access until expiry and show reconnect state afterward. Surface keychain failure instead of silently claiming persistence. Clear local state promptly on logout and report the bounded outcome of remote revocation.

**Acceptance:** concurrent requests at expiry cause one exchange and no panic; worker count remains bounded across repeated renewals; offline/5xx recovery preserves the session; invalid_grant requires login; logout during refresh cannot reauthenticate; restart restores the latest rotated token; race tests pass. An ambiguous response after a rotating refresh must not trigger an uncontrolled replay loop—recover through a new login when the provider cannot safely recover it.

**Rollout:** expose refresh attempts/outcomes and active-worker counts without token values.

**Depends on:** slices 4–5.

### 8. P1 — Provider sign-out revokes app sessions and active collaboration

**User outcome:** signing out through the provider or another SSO app ends the corresponding browser session here, including open editor streams.

**Deliver:** verify account-disable semantics with the deployed provider and add a supported user-status/event check if introspection alone does not cover them. Register and implement back-channel logout; validate signature, issuer, client audience, timestamps, event type, required subject/session identity, absence of nonce, and replay identity. Revoke only the sessions covered by the verified message. Publish application revocation notifications to API/SSE/WebSocket services and recheck authoritative state at least every 30 seconds to recover missed pub/sub messages. Associate connections with the verified principal/session; retain document authorization checks. Session termination tells the UI to preserve local edits and request sign-in.

**Acceptance:** signed provider logout invalidates the matching cookie across replicas and closes related connections within 30 seconds of application receipt; wrong-client/forged/replayed messages do not revoke unrelated sessions; pub/sub loss is recovered by periodic validation; an account-wide event affects only the intended subject. Browser idle and absolute expiry also terminate streams.

**Desktop boundary:** do not assume access tokens carry a provider `sid`. Use validated provider-session correlation where available; otherwise use access-token introspection implemented for the bearer path in slice 5. Use per-request introspection for desktop as well initially; any later cache must define a freshness bound. Open streams are checked at least every 30 seconds. Local desktop logout closes its streams immediately. Verify provider behavior rather than assuming revoking a refresh token invalidates every issued access token.

**Rollout:** verify discovery flags and back-channel delivery for the deployed Zitadel version, not only current documentation. Log event outcomes with non-secret identifiers.

**Depends on:** slices 1–3 and 5.

### 9. P1 — Desktop sign-in can succeed, cancel, and retry on every supported OS

**User outcome:** a user on Windows/macOS/Linux can launch sign-in, cancel it, and try again without restarting the app.

**Deliver:** replace Windows-only browser launching with the native cross-platform API; validate callback scheme/host/path; use state, nonce, PKCE, a deadline, and one active login transaction. Consume callbacks once, handle OAuth error/cancel responses, clean up callback state, and expose cancellation/retry in React. Validate ID tokens as login assertions; do not use them as API credentials. Verify packaging/deep-link registration and prefer platform-supported claimed redirects where practical.

**Acceptance:** packaged login round-trip on all supported OSs; denied consent, browser close, timeout, duplicate/stale callback, wrong state, and app shutdown leave a recoverable UI; simultaneous login attempts cannot overwrite each other's verifier.

**Depends on:** slices 4–5; coordinate native session ownership with slice 7.

### 10. P2 — Browser and desktop share one reliable authentication experience

**User outcome:** both clients show consistent loading, authenticated, reconnecting, and sign-in-required states, with correct return destinations and no lost editor work.

**Deliver:** one React AuthProvider/AuthGuard and an `AuthAdapter` with `getSession`, `login(returnTo)`, `logout`, and state subscription. Consolidate the API client; browser supplies cookies/CSRF, desktop calls a native transport that attaches tokens only to an exact allowlist of backend origins. Preserve Request method/body/headers and abort signals. Never attach credentials based on URL string prefixes. Handle 401, 403, and 503 separately; do not automatically replay non-idempotent writes after authentication. Broadcast browser logout across tabs and clear user-specific caches on account change; unsaved content must not be submitted under a different account. Remove obsolete token getters/global fetch interception once all consumers migrate.

**Acceptance:** identical browser/desktop scenarios for login, invite return, expiry, permission denial, provider outage, account switching, logout, and recovery; browser 500/503 never becomes an authenticated state; background requests cannot create redirect storms; no access token is returned to React; account switch cannot expose the previous user's cached documents.

**Depends on:** slices 1–3, 5–7, and 9. Earlier slices include their own minimal UI; this slice consolidates all consumers.

### 11. P2 — Media and collaboration work without reusable credentials in URLs

**User outcome:** authenticated images, attachments, and collaboration keep working on both platforms without leaking bearer tokens through URLs or logs.

**Deliver:** use same-origin cookie requests in the browser and the allowlisted native proxy for desktop media/streams. Where a transport cannot carry these credentials, issue short-lived, audience/resource-bound tickets; one-use tickets for connection establishment, appropriately bounded reusable tickets for media range requests. Tickets preserve existing resource authorization and cannot authenticate to general APIs. Remove legacy `?token=` credential handling after consumers migrate. Redact Authorization, cookies, OAuth callback queries, and tickets at app/proxy logs; authenticated responses must not become shared public cache entries.

**Acceptance:** browser/desktop image load, download/range, reconnect, and collaborative editing succeed; generic bearer tokens in URLs fail; expired or wrong-resource tickets fail; logging checks find no credentials; logout/expiry prevents reconnect and protected refetch, with active streams governed by slice 8.

**Depends on:** slices 5, 8, and 10.

## Delivery rules and migration checks

- Each slice ships with its own tests and canary evidence; testing, monitoring, and deployment are not deferred horizontal tasks.
- Use a controlled Zitadel tenant, two backend replicas, Redis, and an HTTPS test proxy for integration verification. Existing unit tests alone cannot prove cookie, certificate, rotation, or provider logout behavior.
- Keep fast deterministic fake-clock/race tests for session and refresh concurrency; use real provider tests for claims, logout, refresh rotation, and account-disable semantics.
- Update Compose examples, required secrets, redirect/client registrations, and runbooks with the feature that needs them. Do not put live credentials in this document or tests.
- Retain registration/invitation compatibility and `/api/v1/authenticated` until every dependent service migrates. Inventory editor, media, SSE, signalserver, and native proxy consumers.
- Version session records and coordinate cookie/token migrations. Rollback may force login, but must not resurrect revoked sessions or restore permissive validation.
- No separate frontend rewrite or SDK upgrade is a completion criterion. A slice is complete only when its stated end-to-end acceptance is demonstrated.

## Evidence and standards

Repository anchors: `server/core/auth.go`, `server/core/users.go`, `server/main.go`, `desktop/auth/service.go`, `desktop/main.go`, `ui/app/core/auth/`, `ui/app/core/http/`, `signalserver/main.go`, and `docker/templates/compose.*.yml.tmpl`. The SDK source inspected is the installed `github.com/zitadel/zitadel-go/v3@v3.3.0/pkg/authentication` implementation.

Server-enforced expiry and invalidation are grounded in [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). Timeout values above are proposed product defaults, not claims about existing configuration.

Token handling and rotation should follow [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html). Zitadel documents the [refresh grant](https://zitadel.com/docs/apis/openidoauth/endpoints), [offline access and API audience scopes](https://zitadel.com/docs/apis/openidoauth/scopes), and [token introspection](https://zitadel.com/docs/guides/integrate/token-introspection). An audience alone is insufficient application authorization; retain allowed-client and resource checks.

Provider logout integration follows the [OIDC Back-Channel Logout specification](https://openid.net/specs/openid-connect-backchannel-1_0.html) and [Zitadel's configuration guide](https://zitadel.com/docs/guides/integrate/back-channel-logout). Support and account-state propagation must still be checked against the deployed version.
