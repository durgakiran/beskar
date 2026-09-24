# Browser access-token validation

This is the active server-based implementation. Go owns the authorization-code exchange; the browser uses a session cookie. See the [delivery plan](../authentication-design-and-delivery-plan.md).

This change validates the access token stored in the browser's server-side OIDC session before authenticated API handlers run. Expired browser access tokens are refreshed server-side. Bearer access tokens now use the same per-request introspection policy with an explicit client allowlist.

## Required Zitadel configuration

1. Configure the browser OIDC application as a confidential web client with Basic / `client_secret_basic` authentication. Set `ZITADEL_CLIENT_ID` and `ZITADEL_CLIENT_SECRET` to its credentials. Go uses this same pair for code exchange and introspection; a separate API application is no longer required by this implementation. PKCE remains enabled. Keep the secret out of desktop and JavaScript.
2. Set `ZITADEL_API_AUDIENCE` to the application's Zitadel project ID (not a client ID).
3. Ensure `ISSUER_URL` is the exact HTTPS issuer used in token responses. Compose maps it from `ZITADEL_ISSUER`.

`KEY` is a separate random 32-byte value used to encrypt session/state/PKCE cookies. Compose now maps it from `ZITADEL_SESSION_KEY`. It is not an OAuth client secret.

**Credential-name migration:** rename backend `CLIENT_ID` / `CLIENT_SECRET` to `ZITADEL_CLIENT_ID` / `ZITADEL_CLIENT_SECRET` and remove `ZITADEL_INTROSPECTION_CLIENT_ID` / `ZITADEL_INTROSPECTION_CLIENT_SECRET`. Legacy names are not read. Validate login and introspection against your Zitadel instance before rollout.

**Session-key migration:** previous Compose templates mapped `ZITADEL_CLIENT_SECRET` to `KEY` and sent no client secret to the token endpoint. Preserve that previous encryption value as `ZITADEL_SESSION_KEY` if retaining cookie compatibility, or intentionally rotate to a new random 32-byte key and require a new login. Then set `ZITADEL_CLIENT_SECRET` to the actual confidential web application's secret from Zitadel. Update the app's authentication method before deploying. Do not assume the old variable contained a usable OAuth secret.

The code exchange now uses an HTTP Basic Authorization header for the browser client credentials and a form containing `grant_type=authorization_code`, `code`, `redirect_uri`, and `code_verifier`. Authentication failure does not retry as a public client. Discovery/code exchange use verified TLS, cancellation and a 10-second HTTP timeout. The browser authorization URL does not contain the client secret.

The browser authorization request now includes `urn:zitadel:iam:org:project:id:{projectID}:aud`. Existing sessions without the intended audience may need a new login. `offline_access` is now requested. Enable the **Refresh Token** grant on the confidential Web application in Zitadel, then sign in again to receive a refresh token. Existing sessions without one require login when access expires.

See [Zitadel client authentication for token and introspection endpoints](https://zitadel.com/docs/apis/openidoauth/authn-methods) and [audience scopes](https://zitadel.com/docs/apis/openidoauth/scopes).

## Request behavior

- Middleware resolves the cookie directly against Redis and supplies the SDK-compatible auth context to handlers. Requests without a cookie still reach existing handlers, so deliberately public routes remain public. A stale cookie returns 401; Redis errors return 503.
- A session must contain userinfo, a Bearer access token, and a future token expiry. Missing data is rejected locally; expired access tokens are renewed when a refresh token is available.
- Every otherwise eligible cookie-authenticated API request POSTs the stored access token to Zitadel's `/oauth/v2/introspect`. There is no positive-result cache and no automatic retry.
- The response must report an active Bearer token, matching issuer, browser client ID, session subject and configured API audience, a future `exp`, and no future `nbf`.
- Invalid/inactive tokens, expired sessions, and missing or rejected refresh credentials return **401 AUTH_REQUIRED**. The auth guard preserves the requested return destination.
- Provider/network/credential/configuration-response errors return **503 AUTH_UNAVAILABLE**, without exposing provider diagnostics or deleting the session. The guard shows a retry state instead of treating a server error as authentication success.
- The server refuses to start with missing required configuration. Calls have a 10-second timeout, respect request cancellation, verify TLS, and do not follow redirects.
- `/auth/login`, `/auth/callback`, and `/auth/logout` are outside this API check so login recovery and logout remain available with expired tokens.
- `/api/v1/user` now uses the authentication chain, matching other protected routers.

## Rollout and verification

Provision the confidential web client credentials and trusted certificate chain before deploying. Update the deployment env file, regenerate Compose, and deploy backend plus the auth-guard change. No live provider settings or production credentials are changed by this implementation.

Use a test account: sign in, call `/api/v1/authenticated`, and access a protected document. Revoke that session's access token through Zitadel and confirm the next request returns 401. Repeat with a short access-token lifetime and confirm a refresh grant occurs followed by introspection, without a new login. Interrupt introspection or use invalid client credentials and confirm 503 plus retry UI, without a login loop. Restore service and retry while the token remains valid. Check registration and invitation return paths.

Tests use a controlled HTTPS introspection server; real-provider checks are required to confirm the deployed project's audience and client settings. More provider traffic and up to the provider timeout per request are intentional tradeoffs in this first step. Capacity-test before broad rollout; any later cache must explicitly define its revocation delay.

## Remaining work

CSRF protection, desktop token handling, and already-open stream lifetime remain unfinished. Browser logout now explicitly revokes provider tokens synchronously. A provider logout or account disablement is detected only if Zitadel reports the access token inactive; this change does not claim broader event propagation. A 401 during an already-open editor operation is blocked by the backend but still uses that caller's existing error handling; shared draft-preserving reauthentication remains in the plan.

## Troubleshooting a 503 after login

A JSON `503 AUTH_UNAVAILABLE` can mean session storage, refresh, or introspection failed. `browser session validation unavailable` identifies a Redis/storage failure. Look for `browser token introspection HTTP failure` (upstream status), `browser token introspection transport failed` (TLS, DNS, timeout, network), and `browser token introspection failed` (allowlisted OAuth error code or response error category). These diagnostics omit tokens, credentials, URLs and provider response bodies. An upstream `401` / `invalid_client` requires checking the deployed confidential client's credentials and introspection authentication settings; a successful code exchange alone does not prove introspection works.

The SDK warning `no session found for cookie` is a separate session lookup failure, not an introspection error. The SDK creates UUID session IDs; unreadable IDs suggest an old cookie decrypted with a different encryption key. After migrating `KEY` / `ZITADEL_SESSION_KEY`, clear the application cookie or use a private window and sign in again. Keep the encryption key stable. Sessions now survive Go restarts and replica changes through shared Redis. Changing the encryption key invalidates existing encrypted sessions. A matching session is required before introspection is attempted.

## Server-side refresh

The Go server uses the same confidential client Basic credentials for `POST /oauth/v2/token` with `grant_type=refresh_token`. Tokens never go to browser JavaScript. Refresh occurs on the first request after access expiry, not in a background worker. A Redis per-session lease serializes refresh and validation across replicas; other sessions proceed independently. A rotated refresh token is saved before introspection, so an introspection outage cannot lose it. If a response omits a replacement refresh token, the existing one is retained. Refreshed ID tokens are not consumed as identity assertions; the original validated identity is retained and the new access token must introspect to the same subject, issuer, client and audience.

`invalid_grant` invalidates the local session and returns 401. Provider/configuration/network failures return 503 and retain credentials, with a three-second per-session refresh retry cooldown. There is no automatic HTTP retry. An ambiguous lost/malformed refresh response leaves a persisted refresh-in-progress marker; the next request requires a new login instead of replaying a potentially consumed credential. A browser disconnect does not cancel the bounded (10-second) refresh operation, allowing completed rotation to be saved.

Sessions are stored in Redis with authenticated AES-256-GCM encryption. The data key is derived with a separate purpose label from the existing 32-byte `KEY` (Compose: `ZITADEL_SESSION_KEY`). Random nonces and session-key binding prevent ciphertext substitution. Tokens, userinfo, original verified ID-token claims, refresh state, and session deadlines are encrypted; Redis key names hash the session ID.

## Redis configuration and expiry

- Required: `REDIS_ADDR` (`redis://` or `rediss://` URL), or `REDIS_HOST` with `REDIS_PORT` (default 6379), `REDIS_USERNAME` and `REDIS_PASSWORD` as needed. `REDIS_ADDR` takes precedence. Use `rediss://` for TLS when connecting over an untrusted network.
- `BROWSER_SESSION_IDLE_TIMEOUT=30m`: resets on successfully validated API activity, including polling. Distinguishing user activity from polling remains separate work.
- `BROWSER_SESSION_ABSOLUTE_TIMEOUT=8h`: measured from login; refresh and requests cannot extend it.
- TTL is the smaller remaining idle/absolute duration. Redis deletes expired records automatically; no application cleanup worker or full-key scans are needed. Both limits are also checked before using the session.
- All Go replicas must use the same Redis database, 32-byte session encryption key, issuer/client configuration and timeout settings. Synchronize server clocks.
- Startup validates configuration and Redis connectivity. API requests return 503 on storage failures; there is no in-memory fallback. The SDK callback fails if it cannot persist its new session.

## Shared refresh and logout guarantees

A 30-second lease uses a random owner value and owner-checked release. Every update atomically checks both lease ownership and the previous encrypted record. A refresh-in-progress marker is saved before calling Zitadel. A worker crash or lost lease cannot cause a second replica to replay that refresh token; recovery requires a fresh login when the outcome is uncertain. A refreshed token is saved before introspection. Writes cannot recreate a missing, expired or logged-out session.

Logout acquires the same per-session Redis lease as refresh, persists a `logging_out` marker, and synchronously revokes the latest refresh and access tokens through Zitadel's `/oauth/v2/revoke` endpoint with confidential-client Basic authentication. Both calls share a 10-second deadline and reject redirects. Only confirmed revocation followed by Redis deletion releases the cookie-clear/provider redirect response. A provider or storage failure returns 503 with no redirect or cookie clearing. The encrypted session remains available for manual logout retry until its existing TTL expires; the marker blocks API authentication and refresh even after partial revocation or a backend restart. No jobs or automatic retries are scheduled, and abandoned attempts do not guarantee provider revocation. Already-authorized handlers can finish. POST/CSRF logout remains separate work. Bearer requests now introspect on every request, enforcing provider-reported revocation. Deploy all replicas together so every replica recognizes the marker.

## Redis rollout and verification

Existing in-memory sessions cannot migrate: drain old replicas, deploy the Redis-backed version, and sign in once again. Keep Redis persistence enabled and its data volume intact; the Compose templates already enable AOF and a persistent volume. A Go restart does not lose sessions. Redis data loss/restoring an old snapshot is a separate recovery event: invalidate existing sessions by rotating the application session key across replicas before resuming traffic. This implementation targets a shared Redis primary; asynchronous Redis failover is not a guarantee against lost refresh or logout writes (see [Redis locking guarantees](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)).

Verify login on replica A, authenticated requests on B, a Go restart, short idle/absolute TTL expiry, concurrent refresh, and logout/replay on either replica. Interrupt Redis and confirm 503 instead of access or a silent login loop. Local integration tests launch isolated real Redis processes and HTTPS provider fixtures to cover encryption, cross-replica rotation, lease loss, logout races, expiry, and outages. Live deployment verification remains necessary.

Refresh-token diagnostics: `browser login session stored` logs `refresh_token_present`. `browser token refresh response received` logs `refresh_token_received` (present in the provider response), `refresh_token_present` (available after SDK fallback), and `refresh_token_rotated` (different from the previous token). If renewal is needed but no refresh token is stored, `browser token refresh unavailable` logs `missing_refresh_token`. Both login and refresh events include `access_token_expires_at` as a UTC RFC3339 timestamp (`unknown` if absent). Refresh-token expiry is not returned in the stored token response, so it is not inferred. Only booleans, timestamps and categories are logged, never token values.


## Bearer access-token validation and desktop rollout

- Required server configuration: `ZITADEL_BEARER_CLIENT_IDS`, a comma-separated allowlist of OAuth client IDs (include the native desktop client). Empty entries and wildcards are rejected at startup. Browser credentials still use only `ZITADEL_CLIENT_ID`; they do not implicitly authorize browser-client tokens on the bearer path.
- Both paths use the configured HTTPS issuer, `ZITADEL_API_AUDIENCE`, and confidential web-client credentials for introspection. Register permitted desktop clients in the intended project and grant access to that API audience. No per-request discovery or positive introspection cache is used.
- Bearer validation requires `active=true`, a nonempty subject, exact issuer, allowed `client_id`, matching API audience, Bearer token type, future expiry, and no future `nbf`. Provider rejection of an ID token or revoked token results in 401; provider/network/malformed-response failures return 503 without authorization. Introspection shares a 10-second request deadline and does not follow redirects.
- Explicit Authorization headers (including empty, duplicate, malformed, or rejected credentials) do not fall back to cookies. Legacy media GET/HEAD query credentials go through the same policy. Removing tokens from URLs remains separate work.
- Desktop `GetAccessToken` now returns the access token. Before new login, the desktop fetches `/.well-known/beskar` from its configured HTTPS backend, verifies the returned issuer matches its configured Zitadel URL, and adds the returned `api_audience` project scope to authorization. Discovery must use trusted TLS and cannot redirect. Update backend/configuration and desktop together; existing desktop grants need a fresh login. No secret is included in discovery.
- Resource permissions still apply after authentication. Profile fields come from the validated introspection response; identity lookup uses the subject. Existing desktop login-callback security, refresh concurrency and transport defects remain separate work.

Verify against the deployed provider: log in with the updated desktop, read/edit permitted resources, revoke its access token, then repeat the same API request and expect 401. Verify wrong-client/project credentials fail and a provider outage gives 503. Local tests use a controlled HTTPS provider; they do not substitute for this deployment check. Provider claims follow [Zitadel's introspection contract](https://zitadel.com/docs/guides/integrate/token-introspection/basic-auth).
