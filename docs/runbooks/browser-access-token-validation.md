# Browser access-token validation

This is the active server-based implementation. Go owns the authorization-code exchange; the browser uses a session cookie. See the [delivery plan](../authentication-design-and-delivery-plan.md).

This change validates the access token stored in the browser's server-side OIDC session before authenticated API handlers run. Expired access tokens are now refreshed server-side; desktop bearer-token validation remains unchanged.

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

- Middleware runs after the SDK resolves the cookie to its session. Anonymous requests still reach existing handlers, so deliberately public routes remain public.
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

Shared durable session storage, explicit provider token revocation on logout, CSRF protection, desktop token handling, and already-open stream lifetime remain unfinished. A provider logout or account disablement is detected only if Zitadel reports the access token inactive; this change does not claim broader event propagation. A 401 during an already-open editor operation is blocked by the backend but still uses that caller's existing error handling; shared draft-preserving reauthentication remains in the plan.

## Troubleshooting a 503 after login

A JSON `503 AUTH_UNAVAILABLE` means introspection failed or returned a null response. Look for `browser token introspection HTTP failure` (upstream status), `browser token introspection transport failed` (TLS, DNS, timeout, network), and `browser token introspection failed` (allowlisted OAuth error code or response error category). These diagnostics omit tokens, credentials, URLs and provider response bodies. An upstream `401` / `invalid_client` requires checking the deployed confidential client's credentials and introspection authentication settings; a successful code exchange alone does not prove introspection works.

The SDK warning `no session found for cookie` is a separate session lookup failure, not an introspection error. The SDK creates UUID session IDs; unreadable IDs suggest an old cookie decrypted with a different encryption key. After migrating `KEY` / `ZITADEL_SESSION_KEY`, clear the application cookie or use a private window and sign in again. Keep the encryption key stable. Restarts lose the current in-memory sessions; multiple replicas also need shared session storage (sticky routing is only a temporary mitigation). A matching session is required before introspection is attempted.

## Server-side refresh

The Go server uses the same confidential client Basic credentials for `POST /oauth/v2/token` with `grant_type=refresh_token`. Tokens never go to browser JavaScript. Refresh occurs on the first request after access expiry, not in a background worker. A per-session lock serializes refresh and validation; other sessions proceed independently. A rotated refresh token is saved before introspection, so an introspection outage cannot lose it. If a response omits a replacement refresh token, the existing one is retained. Refreshed ID tokens are not consumed as identity assertions; the original validated identity is retained and the new access token must introspect to the same subject, issuer, client and audience.

`invalid_grant` invalidates the local session and returns 401. Provider/configuration/network failures return 503 and retain credentials, with a three-second per-session refresh retry cooldown. There is no automatic HTTP retry. If a response is lost after the provider consumed a rotating token, a subsequent invalid_grant requires a new login. A browser disconnect does not cancel the bounded (10-second) refresh operation, allowing completed rotation to be saved.

The replacement store is concurrency-safe but still process-local. It enforces a **30-minute idle timeout** and **8-hour absolute timeout**; refresh does not extend the absolute deadline. Only successfully validated API activity advances idle time. A minute-based cleanup removes expired sessions. Logout removes the local entry and cannot be undone by an in-flight refresh. It still redirects through the SDK to provider logout; explicit remote token revocation is separate work. Provider-side logout is not guaranteed to revoke refresh tokens.

Deploy with one Go replica for now; restarts require users to log in again. Multi-replica deployment requires shared storage and distributed refresh coordination. Tests cover simultaneous cookie requests, rotation persistence, omitted refresh tokens, transient recovery, invalid grants, session deadlines, cancellation, and logout during refresh. Real Zitadel verification remains a deployment step.
