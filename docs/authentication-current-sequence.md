# Current Go-managed authentication sequence

Reflects the local implementation as of 2026-09-21, after adding confidential-client authentication and browser access-token introspection. Live Zitadel configuration has not been verified. Browser refresh and synchronous logout token revocation are implemented locally; POST/CSRF logout remains unfinished.

All values below are dummy values. `Basic <base64(...)>` describes header construction, not a literal valid header. OAuth client ID/secret components are form-URL-encoded before concatenation and Base64 encoding. Query parameters are shown on separate lines for readability but form one URL. Discovery and signing-key fetches are omitted from the main diagrams; the OIDC SDK performs them.

## Participants and credentials

| Item | Example | Purpose |
| --- | --- | --- |
| Application origin | `https://app.example.com` | Browser SPA and Go routes behind the same origin |
| Zitadel issuer | `https://id.example.com` | Authorization, token, userinfo and introspection endpoints |
| Web client ID / secret | `web-client-123` / `web-secret-dummy` | Go authenticates code exchange and introspection |
| API audience | `project-789` | Zitadel project ID requested in the authorization scope |
| Session encryption key | `KEY` | Encrypts state/PKCE/session cookies; never sent to Zitadel |

## Login

```mermaid
sequenceDiagram
    participant Browser
    participant GoServer
    participant Zitadel
    participant RedisStore
    Browser->>GoServer: GET /api/v1/authenticated without session
    GoServer-->>Browser: 401
    Browser->>GoServer: GET /auth/login?returnTo=/space/demo
    GoServer->>GoServer: Generate state and PKCE verifier/challenge
    GoServer-->>Browser: 302 authorization URL + state/pkce cookies
    Browser->>Zitadel: GET /oauth/v2/authorize
    Zitadel-->>Browser: Hosted login and consent as required
    Browser->>Zitadel: Complete authentication
    Zitadel-->>Browser: 302 /auth/callback?code=...&state=...
    Browser->>GoServer: GET callback with state/pkce cookies
    GoServer->>GoServer: Check state and recover verifier
    GoServer->>Zitadel: POST /oauth/v2/token, Basic web credentials + code/verifier
    Zitadel-->>GoServer: 200 access_token, id_token, expires_in
    GoServer->>GoServer: SDK validates ID token
    GoServer->>Zitadel: GET /oidc/v1/userinfo, Bearer access token
    Zitadel-->>GoServer: 200 user identity
    GoServer->>RedisStore: Store userinfo/tokens under generated session ID
    GoServer-->>Browser: Session cookie + 302 /space/demo
```

### 1. Begin login

```http
GET /auth/login?returnTo=%2Fspace%2Fdemo HTTP/1.1
Host: app.example.com
```

Go generates a verifier, computes `BASE64URL(SHA256(verifier))`, and returns:

```http
HTTP/1.1 302 Found
Set-Cookie: state=protected-state-cookie; Path=/; Secure; HttpOnly; SameSite=Lax
Set-Cookie: pkce=protected-verifier-cookie; Path=/; Secure; HttpOnly; SameSite=Lax
Location: https://id.example.com/oauth/v2/authorize?client_id=web-client-123&response_type=code&redirect_uri=https%3A%2F%2Fapp.example.com%2Fauth%2Fcallback&scope=openid%20profile%20email%20offline_access%20urn%3Azitadel%3Aiam%3Aorg%3Aproject%3Aid%3Aproject-789%3Aaud&state=encrypted-return-state&code_challenge=dummy-S256-challenge&code_challenge_method=S256
```

The protected state cookie encodes the same state value carried in the URL; their literal strings differ. An optional registration-organization scope is also included when configured. Neither the verifier nor the web client secret appears in the authorization URL. `offline_access` is requested to obtain server-held refresh tokens.

### 2. Return to Go after Zitadel login

```http
HTTP/1.1 302 Found
Location: https://app.example.com/auth/callback?code=code-dummy-abc&state=encrypted-return-state
```

The browser follows that redirect and supplies its app-origin cookies:

```http
GET /auth/callback?code=code-dummy-abc&state=encrypted-return-state HTTP/1.1
Host: app.example.com
Cookie: state=protected-state-cookie; pkce=protected-verifier-cookie
```

The SDK compares the returned state with the protected cookie, reads the verifier, and clears the transaction cookies.

### 3. Go exchanges the code with Zitadel

```http
POST /oauth/v2/token HTTP/1.1
Host: id.example.com
Authorization: Basic <base64(web-client-123:web-secret-dummy)>
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=code-dummy-abc&redirect_uri=https%3A%2F%2Fapp.example.com%2Fauth%2Fcallback&code_verifier=dummy-verifier-at-least-43-characters-long-123456789
```

Zitadel checks the client credentials, authorization code, redirect URI, and PKCE binding. The verifier must hash to the challenge used in step 1; the placeholders above are illustrative, not a matching cryptographic test vector.

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "access_token": "access-token-dummy-xyz",
  "refresh_token": "refresh-old-dummy",
  "token_type": "Bearer",
  "expires_in": 3600,
  "id_token": "eyJhbGciOiJSUzI1NiJ9.dummy-claims.dummy-signature"
}
```

The refresh token is issued when the Refresh Token grant is enabled and `offline_access` is granted. The SDK validates the ID token against the issuer and browser client using the provider's signing keys.

### 4. Go obtains identity and creates the app session

```http
GET /oidc/v1/userinfo HTTP/1.1
Host: id.example.com
Authorization: Bearer access-token-dummy-xyz
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"sub":"user-101","name":"Demo User","preferred_username":"demo","email":"demo@example.com","email_verified":true}
```

Go stores authenticated-encrypted userinfo and tokens in Redis with a TTL capped by idle and absolute expiry. The browser receives only the encrypted session ID:

```http
HTTP/1.1 302 Found
Set-Cookie: zitadel.session=encrypted-session-id-dummy; Path=/; Secure; HttpOnly; SameSite=Lax
Location: /space/demo
```

The SDK also clears the temporary transaction cookies. The session cookie does not contain the access token, refresh token, or client secret. React cannot read these HttpOnly cookies.

## Cookie-authenticated API request and introspection

```mermaid
sequenceDiagram
    participant Browser
    participant GoServer
    participant RedisStore
    participant Zitadel
    participant AppDatabase
    Browser->>GoServer: GET /api/v1/authenticated + session cookie
    GoServer->>RedisStore: Decrypt cookie and look up session ID
    RedisStore-->>GoServer: Stored userinfo, access token and refresh token
    GoServer->>GoServer: Check session deadlines and stored credentials
    opt Access token expired
        GoServer->>Zitadel: POST /oauth/v2/token, Basic web credentials, grant_type=refresh_token
        Zitadel-->>GoServer: New access token and rotated refresh token
        GoServer->>RedisStore: Atomically save replacement credentials
    end
    GoServer->>Zitadel: POST /oauth/v2/introspect, Basic web credentials + token
    Zitadel-->>GoServer: active status and token claims
    GoServer->>GoServer: Check active, issuer, client, audience, subject and times
    GoServer->>AppDatabase: Resolve application user from verified subject
    AppDatabase-->>GoServer: Application user ID
    GoServer-->>Browser: 200 authenticated, or 401 / 503 on validation failure
```

### 5. Browser supplies the app cookie

```http
GET /api/v1/authenticated HTTP/1.1
Host: app.example.com
Cookie: zitadel.session=encrypted-session-id-dummy
```

### 6. Go checks the stored token with Zitadel

```http
POST /oauth/v2/introspect HTTP/1.1
Host: id.example.com
Authorization: Basic <base64(web-client-123:web-secret-dummy)>
Content-Type: application/x-www-form-urlencoded

token=access-token-dummy-xyz
```

Example response, assuming illustrative current Unix time `2000000000`:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "active": true,
  "iss": "https://id.example.com",
  "sub": "user-101",
  "client_id": "web-client-123",
  "aud": ["project-789"],
  "token_type": "Bearer",
  "iat": 2000000000,
  "nbf": 2000000000,
  "exp": 2000003600
}
```

The Basic credentials identify our confidential web application, using the same `ZITADEL_CLIENT_ID` and `ZITADEL_CLIENT_SECRET` as code exchange. The returned `client_id` must match that application.

### 7. Go responds to the browser

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"data":null,"status":"success"}
```

For protected data endpoints, resource permission checks follow authentication before data is returned.

| Situation | Go behavior |
| --- | --- |
| Expired access token with refresh token | Refresh, save rotation, then introspect |
| Missing/rejected refresh token or expired app session | 401; new login required |
| Provider returns `{"active":false}` | 401 |
| Issuer/client/audience/subject/timestamps mismatch | 401 |
| Provider unreachable, malformed response, rate limit, or invalid client credentials | 503; preserve session and show retry UI |

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Cache-Control: no-store

{"status":"FAILED","error":{"code":401,"message":"AUTH_REQUIRED"}}
```

```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/json
Cache-Control: no-store

{"status":"FAILED","error":{"code":503,"message":"AUTH_UNAVAILABLE"}}
```

There is no positive introspection cache: each otherwise eligible cookie-authenticated API request checks with Zitadel. Introspection has a 10-second timeout and does not follow redirects. Login/callback/logout routes are outside this middleware. Refresh now runs on demand at expiry. Sessions default to configurable 30-minute idle and 8-hour absolute limits, and logout deletes the shared Redis session before responding. Logout synchronously revokes refresh/access tokens before deleting the session. Provider failure returns 503 and retains the cookie and encrypted record for manual retry; an ending-session marker blocks authentication and refresh. There is no background revocation job.

Implementation: `server/core/auth.go`, `server/core/browser_access_token.go`, `server/main.go`, `server/auth/auth.go`, and the installed Zitadel SDK. See the [deployment runbook](runbooks/browser-access-token-validation.md) for the required confidential-client and introspection settings.

### Refresh request (server to Zitadel)

```http
POST /oauth/v2/token HTTP/1.1
Host: id.example.com
Authorization: Basic <base64(web-client-123:web-secret-dummy)>
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=refresh-old-dummy
```

```json
{"access_token":"access-new-dummy","refresh_token":"refresh-new-dummy","token_type":"Bearer","expires_in":3600}
```

Go saves the replacement credentials, then introspects `access-new-dummy` before continuing the original browser request. The browser still sends only its session cookie.
