# Teddox production alpha — backend readiness

Date: 10 November 2026. Follow this checklist before distributing the dedicated macOS alpha. These are deployment instructions, not a record that production has been changed. Apple signing/notarization, SEC-06 and SEC-08 remain deferred for alpha as agreed in the [release plan](macos-release-plan.md).

## 1. Fix the production configuration contract

| Purpose | Value |
| --- | --- |
| Public app and API origin | `https://app.teddox.com` |
| Zitadel issuer | `https://id.teddox.com` (confirmed) |
| API discovery | `https://app.teddox.com/.well-known/beskar` |
| Native callback | `teddox://callback` |
| Browser callback | `https://app.teddox.com/auth/callback` |
| Signaling | `wss://app.teddox.com/ws` |
| Downloads | Proposed `https://downloads.teddox.com` on Cloudflare R2 |
| Native client ID | Obtain from the production Zitadel native application; still required |
| API audience | Discovery currently advertises production project ID `369228883939033096`; confirm against the intended project |

Do not use a development client ID or infer an audience from an app/client ID. Do not rename the alpha bundle ID: `com.durgakiran.beskar.alpha` is a stable application identifier, not the backend hostname.

Read-only public checks on 10 November found:

- `https://id.teddox.com/.well-known/openid-configuration`: HTTP 200 over verified HTTPS; issuer is exactly `https://id.teddox.com`. Authorization, token, keys, userinfo and revocation URLs match the paths used by desktop auth; S256 and refresh-token grants are advertised. This does not verify any particular client registration.
- `https://app.teddox.com/.well-known/beskar`: HTTP 200 JSON over verified HTTPS, with `zitadel_url` equal to `https://id.teddox.com` and `api_audience` equal to `369228883939033096`. Public discovery passes this check. The earlier 404 was for the apex `teddox.com`, which is not the application/API origin.
- `https://app.teddox.com/api/v1/authenticated` without credentials: HTTP 401. This confirms API routing and unauthenticated rejection, not successful native-client validation.

## 2. Prepare the production host and data services

1. Choose the reviewed backend revision to deploy; it must contain `/.well-known/beskar`, current bearer-client validation and the matching media/collaboration APIs. Keep local uncommitted cleanup work out of the release unless deliberately reviewed.
2. Check `df -h` and `docker system df`. Resolve build-disk exhaustion before deployment. Preserve database volumes; increasing Docker disk capacity or cleaning expendable build cache is separate from deleting application data.
3. Verify a recoverable database backup, persistent upload/object storage and rollback images. Restore/test a copy if this is a new host. Do not change PostgreSQL major version, image family or volume paths as an incidental alpha setup step.
4. Prepare production Postgres, Redis and Permify, using production secrets and service accounts. Restrict them to the internal service network.
5. Use the env-driven production workflow in `docker/scripts`, not the legacy `docker/app/app.yml` development workflow. Copy `docker/env/deploy.env.example` to an ignored deployment env file, such as `docker/env/teddox-alpha.env`, and fill every required secret from the deployment secret store. Never commit that file or package its contents in the desktop app.

## 3. Configure DNS, TLS and Cloudflare path routing

Keep the UI hosted on Cloudflare. Ensure these requests reach the backend instead of the static SPA:

| Public path | Destination |
| --- | --- |
| `/.well-known/beskar` | Go API server, port 9095 internally |
| `/auth/*` | Go server browser login/callback/logout routes |
| `/api/*` | Go server APIs, including media, attachments and page-event streams |
| `/ws` | Signal server, port 8080 internally, with WebSocket upgrade |
| UI routes/assets | Existing Cloudflare UI Worker/static deployment |
| All `id.teddox.com` identity paths | Production Zitadel through its configured proxy |

1. Configure the origin proxy/server names for `app.teddox.com` and `id.teddox.com`. Use a separate origin hostname or origin-routing mechanism behind Cloudflare if needed; do not point a proxy fetch back to the same UI Worker and create a loop.
2. Ensure frontend Worker/custom-domain rules do not swallow discovery, auth or API paths. An HTML page with HTTP 200 is not successful API discovery. The repository Nginx templates already define these backend locations, but Cloudflare must send the requests to that proxy.
3. Keep the public client-facing certificate trusted and hostname-correct. With Cloudflare proxying, use **Full (strict)** to the origin. Cloudflare Origin CA certificates work on that edge-to-origin connection, but are not general desktop/browser trust certificates for direct-origin traffic. Backend containers also need trusted HTTPS when calling the public issuer. Do not use `INSECURE_SKIP_VERIFY=true` or the desktop development bypass. [Cloudflare TLS modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/), [Origin CA](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/).
4. Forward authorization headers intact. Preserve browser cookies, Host/public HTTPS information and WebSocket upgrade headers. Disable buffering/timeouts that break SSE. Do not cache authenticated APIs/auth callbacks or replace errors with an SPA fallback.
5. Ensure Cloudflare Access/challenges do not replace native discovery/API/token responses with browser-only login/challenge pages. Keep authentication enforced by the API; do not broadly disable WAF protection.
6. For web compatibility, inspect the deployed HTTPS proxy cookie policy. The current `nginx.https.conf.tmpl` contains `proxy_cookie_flags ~ nosecure SameSite=Lax`, which removes Secure from cookies. Correct this to preserve/enforce Secure for the production HTTPS routes before browser acceptance; verify actual `Set-Cookie` flags. This checklist does not modify the template.

## 4. Create/verify the production OAuth applications

In the existing production Zitadel instance/project:

1. Create or verify a **native/public** application for Teddox Alpha. Use Authorization Code with **S256 PKCE**, token endpoint authentication **none**, and exact redirect `teddox://callback`. Permit the refresh-token grant for the requested `offline_access` scope. If custom-scheme redirects need an explicit provider setting, enable only that supported native redirect setting; this does not authorize HTTP issuer/token endpoints.
2. Record the native **client ID** for `ALPHA_CLIENT_ID` and `ZITADEL_BEARER_CLIENT_IDS`. There is no native client secret. Desktop already supplies state, nonce, PKCE and the project audience scope.
3. Keep the browser application separate: a **confidential** client with its own ID/secret, callback `https://app.teddox.com/auth/callback` and the server's Basic client-authentication method. Its ID/secret populate `ZITADEL_CLIENT_ID` and `ZITADEL_CLIENT_SECRET` on the backend only.
4. Record the production **project ID** as `ZITADEL_API_AUDIENCE`. Both browser and native access tokens need this API audience. Ensure the confidential backend client has the production permissions needed for the provider's token introspection; a valid native login alone does not prove API validation will succeed.
5. Configure alpha test-user access/project grants and application user provisioning. Verify the same intended subject maps to an application account and test-space membership. Do not assume users/data from the development instance exist in production.
6. Keep the confirmed issuer stable. Do not change a running development identity database's issuer/domain merely to reuse IDs; use the existing production instance and require fresh production login.

Reference: [Zitadel application types and redirect configuration](https://zitadel.com/docs/guides/manage/console/applications-overview).

## 5. Set backend deployment variables

Fill the ignored env file from step 2. The nonsecret domain/auth settings below supplement the database, storage and secret values required by the full example:

```dotenv
COMPOSE_PROJECT_NAME=beskar-teddox-alpha
TLS_ENABLED=true
APP_DOMAIN=app.teddox.com
AUTH_DOMAIN=id.teddox.com
PUBLIC_BASE_URL=https://app.teddox.com
AUTH_PUBLIC_URL=https://id.teddox.com
BESKAR_SERVER_URL=https://app.teddox.com
ZITADEL_ISSUER_URL=https://id.teddox.com
ZITADEL_EXTERNALDOMAIN=id.teddox.com
ZITADEL_EXTERNALSECURE=true
INSECURE_SKIP_VERIFY=false
CORS_ALLOWED_ORIGINS=https://app.teddox.com
PROXY_DOMAIN_ALIASES_ENABLED=false

ZITADEL_CLIENT_ID=<production-confidential-browser-client-id>
ZITADEL_CLIENT_SECRET=<server-only-secret>
ZITADEL_API_AUDIENCE=369228883939033096
ZITADEL_BEARER_CLIENT_IDS=<production-native-alpha-client-id>
ZITADEL_SESSION_KEY=<stable-random-32-byte-session-key>
ZITADEL_USER_PAT=<server-only-production-service-credential>
ZITADEL_REGISTRATION_ORG_ID=<production-org-id-if-required>
```

Replace every placeholder before use; do not paste this block into a live shell. If other native clients are already supported, retain their explicitly approved IDs in the comma-separated bearer allowlist; never use `*`. Preserve established production session/encryption keys during an upgrade rather than silently replacing them.

The compose templates translate these names into runtime settings:

| Deployment env | Go server runtime env |
| --- | --- |
| `ZITADEL_ISSUER_URL` | `ISSUER_URL` |
| `BESKAR_SERVER_URL` | `SERVER_URL` |
| `ZITADEL_SESSION_KEY` | `KEY` |
| `ZITADEL_USER_PAT` | `SERVER_PAT` |

`AUTH_SERVER_URL=http://server:9095` belongs to the internal signalserver configuration; the compose template supplies it. It is not the Zitadel issuer. Signaling forwards the native bearer header to `/api/v1/authenticated` for validation.

For uploads, configure the production `STORAGE_S3_*` values or the supported persistent filesystem backend intentionally. The S3 endpoint/credentials are server-only; do not copy a development bucket/key or point the desktop app directly at a private bucket. Ensure storage permissions, quota and attachment authorization work for the test account. Keep destructive cleanup/optional notification workers disabled until separately validated.

## 6. Align the existing Cloudflare web UI configuration

Use an ignored UI deployment env file based on `docker/env/ui-cloudflare.env.example`:

```dotenv
UI_PUBLIC_BASE_URL=https://app.teddox.com
NEXT_PUBLIC_USER_SERVER_URL=https://app.teddox.com/api/v1
NEXT_PUBLIC_API_URL=https://app.teddox.com/api/v1
NEXT_PUBLIC_API_BASE_URL=https://app.teddox.com/api/v1
NEXT_PUBLIC_IMAGE_SERVER_URL=https://app.teddox.com/api/v1
NEXT_PUBLIC_SIGNALING_URL=wss://app.teddox.com/ws
```

Set the corresponding `NEXT_PUBLIC_*` values in the backend deployment env too if building its UI container. Update `NEXTAUTH_URL=https://app.teddox.com` where that deployment uses it. Retain the actual Cloudflare account ID/Worker name for the production UI; do not invent or overwrite an existing Worker identity.

The static build reads `NEXT_PUBLIC_*` inputs and compiles them into Vite assets; the desktop API base is supplied by the native alpha configuration. Do not blindly create unrelated `VITE_*` secrets. Browser session/CSRF protections remain required; desktop native bearer requests do not need browser cookies. Add only actual browser origins to CORS rather than `*` or a changing desktop loopback address.

## 7. Render, inspect and deploy on the production host

After backup, secret completion and deployment approval, run from the repository root on the intended host:

```bash
./docker/scripts/render-configs.sh --env docker/env/teddox-alpha.env
./docker/scripts/validate-config.sh --env docker/env/teddox-alpha.env
./docker/scripts/deploy.sh --env docker/env/teddox-alpha.env
```

Review the generated configuration privately before deployment; it contains secrets. `deploy.sh` starts Postgres/Redis, runs the `db-init` schema job, then builds/starts application services. It is a real deployment with database writes, not a dry run. On an existing production stack, retain its compose project/network/data mounts instead of using the example project name to accidentally create a second stack. The repository generates into `docker/.generated`; serialize environments using the same checkout.

Check service status and sanitized logs for successful database migrations, Redis/Permify connectivity, issuer discovery, token introspection setup and object storage readiness. Do not paste full resolved compose/env output into tickets or chats. Then deploy the UI through the existing Cloudflare procedure if its public configuration changed:

```bash
./docker/scripts/deploy-ui-cloudflare.sh --env docker/env/<production-ui-file>.env
```

## 8. Prove public discovery and authentication behavior

Run without `-k`, insecure flags or redirects:

```bash
curl --fail --silent --show-error https://app.teddox.com/.well-known/beskar
curl --fail --silent --show-error https://id.teddox.com/.well-known/openid-configuration
curl --silent --show-error -o /dev/null -w '%{http_code}\n' \
  https://app.teddox.com/api/v1/authenticated
```

Required results:

1. API discovery is HTTP 200 JSON with exactly `zitadel_url: https://id.teddox.com` and the expected nonempty production project ID as `api_audience`. No 301/302, 404, HTML fallback or challenge. Desktop provider requests reject redirects.
2. OIDC discovery advertises the exact issuer and expected HTTPS token/keys/userinfo/revocation endpoints. It must work from the Mac **and the backend container network**, with normal certificate validation.
3. Unauthenticated `/api/v1/authenticated` returns an authentication failure (normally 401), not a login-page redirect, 200 SPA or data. Invalid bearer credentials also fail. A deployed authentication bootstrap can reject missing browser-origin context; inspect that case rather than accepting an unrelated 403 as proof of valid-token behavior.
4. Perform a normal web login with a disposable production test account; confirm browser callback, Secure/HttpOnly session cookies, session bootstrap and CSRF-protected writes. Wrong-origin/absent-CSRF browser writes fail while normal writes succeed.

Do not put bearer tokens in command-line examples, URLs, screenshots or logs. Use the desktop/native auth flow to verify valid-token behavior in the next steps.

## 9. Build a new production alpha package

On the matching-architecture Mac, after prerequisites in the [desktop README](../../desktop/README.md):

```bash
cd desktop
cp alpha.env.example alpha.env
# Edit alpha.env: production native client ID, new version/build, public origins.
bash scripts/package-mac-alpha.sh --env alpha.env --check
bash scripts/package-mac-alpha.sh --env alpha.env
```

The API/issuer defaults now point to Teddox. Build rejects a missing native client ID; no development ID is used as a fallback. The ID is public and may be supplied at build time; no native secret is accepted. If alpha.3 has already been used, choose a new version/build. Verify `build-info.txt` shows the approved domains, client, revision and architecture. Use a reviewed clean checkout for distributable artifacts.

`alpha.env` is ignored by Git and accepts only the public settings listed in the
example. It is parsed literally, never executed or copied into the package. Do
not pass the backend deployment env file. Environment-only invocation remains
supported; explicit values in `--env` take precedence over inherited variables.

The previous local alpha.2 DMG targets development domains and cannot be changed by setting environment variables after build. Replace it with the newly built package. Alpha reapplies its compiled API/issuer/client configuration on startup so stale local alpha configuration cannot retain the earlier endpoints; credential contexts still prevent old-origin tokens being reused. Users sign in again. Development and stable builds keep their existing defaults.

## 10. Run installed alpha acceptance, then publish downloads

1. Install from the new DMG, confirm **Teddox Alpha**/icon, and start from a clean alpha profile/test account. Check macOS URL-scheme selection when the development app is also installed; browser callbacks must reach the same process that started login. Ad-hoc/Gatekeeper behavior remains the separately documented alpha limitation.
2. Sign in through `id.teddox.com`. Confirm discovery → browser authorization → `teddox://callback` → token exchange → `/api/v1/authenticated` → spaces/documents succeeds. If token exchange succeeds but the API returns 401, check production issuer, project audience, native-client allowlist and server introspection configuration before changing desktop security.
3. Open a disposable production test space/document. Test editing/save/reload, images, attachment uploads/downloads, comments/resolve/reopen, PDF export and YouTube. Investigate the previously observed broken QA image separately; its presence in development is not a production pass.
4. Test web↔alpha edits/comments and alpha↔alpha synchronization. Verify `/ws` receives 101 on an authorized upgrade, native Authorization is forwarded, and page-event SSE stays connected without buffering. Unauthenticated signaling fails. Deferred SEC-06/SEC-08 remain known limitations; passing same-account collaboration does not establish room isolation or immediate revocation.
5. Test logout/login, app restart, offline recovery, sleep/wake and one package upgrade with synthetic accounts/content. Check that credentials remain in native Keychain and absent from frontend/storage/log output.
6. Once results pass, upload the exact verified DMG/checksum/metadata to the alpha R2 channel. Use the proposed `downloads.teddox.com` or another approved Teddox download hostname, verify downloaded bytes, then publish UI links. Do not publish the old development-domain DMG as production alpha.

Backend-ready means discovery, provider configuration, native bearer validation, browser auth, storage and long-lived transport routing all pass against `app.teddox.com`, with the production native client ID recorded. No deployment or readiness claim is made merely by updating these defaults.
