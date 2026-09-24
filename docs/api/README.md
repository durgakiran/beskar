# Interactive API documentation

After rebuilding/restarting the Go server and reloading the nginx configuration, open `/api/docs` on your Beskar instance. `/api/openapi.json` serves the downloadable OpenAPI 3.1 specification. Both are embedded into the server binary; there is no separate documentation service or frontend build.

## Try a request

1. Click **Sign in** to complete the existing Zitadel browser flow and return to the docs. Use the browser-session authentication option; the HttpOnly cookie is sent automatically. Alternatively choose **BearerToken** and paste a valid Zitadel JWT without the `Bearer` prefix. The existing backend uses an OIDC ID-token verifier, so an arbitrary/opaque access token will not work.
2. Try **Check authentication** (`GET /api/v1/authenticated`).
3. Open **Create a whiteboard**, enter a real space UUID and a fresh `Idempotency-Key` UUID (for example, generate one with `crypto.randomUUID()` in browser developer tools), and edit the JSON body. The user needs `edit_page` permission in that space, plus `edit` permission on a supplied parent.
4. Send the request. It creates real data. Retain the same key and body when retrying; use a new key for a new creation.

Login, registration, logout and callback are browser redirect flows, not JSON token endpoints. Sending login, registration or logout from the console opens browser navigation; login returns to `/api/docs`. Callback requests must be completed by Zitadel. If an API request redirects because a session expired, the console asks you to sign in and retry rather than following a cross-origin login redirect or replaying a write. Use the navigation links for login/registration/logout; callback parameters are managed by Zitadel. Session cookies normally require HTTPS. Bearer requests take precedence over cookie sessions.

Whiteboard creation, incremental checkpoints, and draft retrieval are implemented under v2. See [creation](whiteboard-create-v2.md), [checkpointing](whiteboard-checkpoint-v2.md), and [draft manifests, snapshot downloads, and update pages](whiteboard-draft-v2.md) for their contracts. See [publishing and previews](whiteboard-publish-v2.md), [title updates](whiteboard-title-v2.md), and [shared page listing and navigation](page-navigation.md).

See [version history, restore, and deletion](whiteboard-history-v2.md) for the remaining lifecycle APIs.

See [independent asset uploads and authenticated downloads](whiteboard-assets-v2.md)
for whiteboard-owned raster storage, commit/status/cancel, and published asset access.

See [UI integration decisions and alternatives](whiteboard-ui-v2-decisions.md) for v2 editor adoption.

See [v1 → v2 migration on editor open](whiteboard-migration-v1-to-v2.md) for the implemented flow, verified asset copying, deployment, and verification.

## Maintain the docs

Edit `server/apidocs/openapi.json` alongside API changes. Keep operation IDs stable and update schemas, examples, security and errors to match handlers. Run `go test ./apidocs ./editor ./auth ./core .` from `server/` with the Go version required by `go.work`. Run `node --test server/apidocs/console.test.cjs` from the repository root to verify browser navigation, session redirects and request preservation. The documentation tests check public serving, local schema references and operation IDs; existing controller tests verify runtime behavior.

`server/apidocs/index.html` loads a pinned Scalar 1.68.0 browser bundle from jsDelivr (internet access required). API requests go directly to the current origin, with no Scalar proxy. Credentials are not persisted by Scalar. The spec and docs routes are public, while API authorization remains unchanged. The nginx configuration and both deployment templates forward `/api/` to the Go server.
