# Beskar Desktop App — Engineering Plan (Wails v3)

## Overview

Build a native desktop application for Beskar using **Wails v3** (Go + React). The desktop app will connect to the existing self-hosted backend infrastructure (Go API server, Zitadel, Permify, Redis, PostgreSQL, signaling server) rather than bundling those services. The app is essentially a **rich client** — same React UI, but running inside a native WebView with a Go host process that handles OS-level concerns (auth flow, OS keychain, deep links, tray, auto-update).

---

## Infrastructure & Service Map (from compose template)

| Service | Role | Desktop Impact |
|---|---|---|
| `postgres` | Primary DB | Remote — no change |
| `redis` | Session / real-time state | Remote — no change |
| `zitadel` | Identity provider (OIDC) | **Auth flow must change** for desktop |
| `guard` (Permify) | Authorization | Remote — no change |
| `server` (Go / Chi) | REST API `:9095` | Connect via configured base URL |
| `signalserver` | WebSocket / WebRTC signaling `:8080` | Connect via configured URL |
| `ui` (React/Vite) | Frontend | **Embedded** in Wails app |
| `launchsite` | Marketing site | Separate — not included |
| `proxy` (Nginx) | TLS termination | Not needed for desktop |

---

## Current Auth Architecture (Web)

The web app today uses a **server-side OIDC code flow** brokered by the Go server:

```
Browser → /auth/login (Go server)
        → Zitadel authorization endpoint
        → /auth/callback (Go server, exchanges code, stores session cookie)
        → Redirects browser back with session cookie set
```

- `AuthGuard.tsx` calls `/api/v1/authenticated` to check cookie-based session
- Logout hits `/auth/logout` on the Go server
- Go server uses `zitadel-go` SDK with `PKCEAuthentication` + cookie-based session storage (`httphelper.NewCookieHandler`)

---

## Key Architecture Decisions for Desktop

### 1. Auth Strategy: Native PKCE with Custom URL Scheme

Browser-based cookie sessions do not translate to a desktop app. The Go host process in Wails takes over the auth role.

**Flow:**
```
Wails App (Go host)
  → Opens system browser to: Zitadel /authorize?...&redirect_uri=beskar://callback&code_challenge=...
  → User authenticates in browser
  → Zitadel redirects to: beskar://callback?code=...
  → OS routes custom URL to Wails app
  → Go host catches the URL via ApplicationLaunchedWithURL event
  → Go host exchanges code + PKCE verifier for tokens (access_token, refresh_token, id_token)
  → Tokens stored in OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
  → Access token injected as Bearer header for all API calls
```

**Why this approach:**
- No Go server changes needed for the core OIDC flow (Zitadel already supports PKCE natively)
- Tokens stored securely in OS keychain, not in Go server cookies
- Works offline / without Nginx proxy
- Go server API endpoints already accept Bearer tokens (see `AuthMiddleWare` in `core/auth.go`)

> [!IMPORTANT]
> **Zitadel PKCE Native App Setup Required:** A new Zitadel application of type "Native" must be registered with `beskar://callback` as the redirect URI. This is separate from the existing web app client. The existing `CLIENT_ID` / web flow should remain untouched.

---

## Token Lifecycle

### Recommended Token Lifetimes

| Token | Web App | Desktop App | Rationale |
|---|---|---|---|
| **Access token** | **15 min** | **15 min** | Same — verified by same `AuthMiddleWare`. Short window limits revocation lag. |
| **Refresh token** | **7 days** (sliding) | **30 days** (absolute) | Desktop users may not open the app daily; longer lifetime avoids forced re-login. |
| **Session cookie** | **7 days** | N/A | Matches refresh token lifetime. Sliding — resets on each active session. |
| **ID token** | 15 min | 15 min | Only used at login to populate user claims. |

Configure these in Zitadel separately per application (web app client vs. native desktop client) so they can be tuned independently.

> [!WARNING]
> The current Zitadel SDK default session store is `InMemorySessions` — **an in-memory Go map explicitly marked as unsuitable for production** in the SDK source. All web sessions are lost on every server restart and are not shared across multiple server instances. This must be replaced with Redis before launch.

### Web: Redis-backed Session Store

Implement a `RedisSessions[T]` that satisfies the SDK's `Sessions[T]` interface. Sessions stored with TTL matching the refresh token lifetime (7 days).

```go
// server/core/sessions.go
type RedisSessions[T authentication.Ctx] struct {
    client *redis.Client
    ttl    time.Duration  // 7 days
}

func (s *RedisSessions[T]) Get(id string) (T, error) {
    data, err := s.client.Get(ctx, "session:"+id).Bytes()
    // deserialize T from JSON/gob
}

func (s *RedisSessions[T]) Set(id string, session T) error {
    data, _ := serialize(session)
    return s.client.Set(ctx, "session:"+id, data, s.ttl).Err()
}
```

Pass to `ZitadelAuthenticator` via `authentication.WithSessionStore(redisSessions)`.

### Web: Access Token Refresh Within Sessions

The SDK's `IsAuthenticated` simply retrieves what was stored at login — it does not refresh expired access tokens. Wrap it with a refresh check:

```go
// server/core/auth.go
func CheckAndRefreshIfNeeded(a *Authenticator, sessions Sessions, req *http.Request) (T, error) {
    session, err := a.IsAuthenticated(req)
    if err != nil { return nil, err }

    // Proactively refresh if access token expires within 5 minutes
    if session.Tokens.Expiry.Before(time.Now().Add(5 * time.Minute)) {
        newSession, err := refreshWebSession(session) // calls Zitadel token endpoint
        if err != nil {
            return nil, err // force re-login
        }
        sessionID := getSessionIDFromCookie(req)
        sessions.Set(sessionID, newSession)  // update Redis
        return newSession, nil
    }
    return session, nil
}
```

### Desktop: Token Refresh Loop

```go
// desktop/auth/service.go
func (s *AuthService) startRefreshLoop(ctx context.Context) {
    for {
        expiry := s.tokenExpiry() // read from keychain
        sleepUntil := expiry.Add(-5 * time.Minute)
        select {
        case <-time.After(time.Until(sleepUntil)):
            if err := s.refresh(); err != nil {
                s.emitLogout() // refresh token expired → force re-login
                return
            }
        case <-ctx.Done():
            return
        }
    }
}
```

**Concurrent refresh guard** — if multiple requests fire while a refresh is in flight, only one goroutine executes the refresh; others wait:

```go
var refreshGroup singleflight.Group

func (s *AuthService) GetAccessToken() string {
    if !s.isExpired() { return s.cachedToken }
    result, _, _ := refreshGroup.Do("refresh", func() (any, error) {
        return s.doRefresh()
    })
    return result.(string)
}
```

### Desktop: App Startup Token Recovery

```
App starts:
  1. Read tokens from OS keychain
  2. No tokens found        → show login
  3. access_token valid     → proceed, start refresh loop
  4. access_token expired,
     refresh_token valid    → refresh immediately → proceed, start refresh loop
  5. refresh_token expired
     or refresh fails       → clear keychain → show login
```

### Desktop: Logout with Active Revocation

Clearing the keychain is not enough — tokens must be actively revoked at Zitadel:

```go
func (s *AuthService) Logout() error {
    // 1. Revoke both tokens at Zitadel
    s.revoke(s.accessToken)   // POST /oauth/v2/revoke
    s.revoke(s.refreshToken)  // POST /oauth/v2/revoke
    // 2. Clear OS keychain
    keychain.Clear()
    // 3. Notify React
    s.emitLogout()
}
```

## Open Questions

> [!NOTE]
> ~~**Q1: Server instance connectivity**~~ — **Resolved.** Single self-hosted instance behind a proxy with one base URL. The desktop app connects to one configured server URL. No multi-account or multi-instance support needed. The `desktop/config/store.go` simply persists this single URL.

> [!NOTE]
> ~~**Q2: Offline mode**~~ — **Resolved. Out of scope for now.** The app is always-online. Show a clear "cannot reach server" error screen when the server is unreachable. Architecture note: avoid choices that would make offline support hard to add later (e.g., keep API calls isolated in the asset handler so a local cache layer can be inserted there in future).

> [!NOTE]
> ~~**Q3: Go server CORS**~~ — **Resolved.** The Wails Asset Handler makes outbound requests as a Go `http.Client` — the WebView origin is never sent to the remote server, so CORS is not triggered for API calls. Only the Wails WebView origins need to be added to `CORS_ALLOWED_ORIGINS` for any direct WebView→server calls (e.g., WebSocket for signaling).

> [!NOTE]
> ~~**Q4: Zitadel registration endpoint**~~ — **Resolved. Desktop app is login-only.** New accounts are created via the web app. The desktop app has no "Register" button or flow. The `AuthGuard.desktop.tsx` only triggers `AuthService.Login()` — no registration path needed. The existing `/auth/register` server endpoint is web-only and untouched.

> [!NOTE]
> ~~**Q5: Target platforms**~~ — **Resolved. All three platforms, Linux release deferred.** Build and test for macOS, Windows, and Linux from day one. Ship macOS + Windows at launch. Linux build is maintained in CI but not released until ready (WebKitGTK compatibility validated, packaging finalized).

---

## Proposed Changes

### Component 1: New Desktop App Package (`/desktop`)

A new top-level directory `desktop/` in the monorepo. The Wails v3 app lives here, embedding the React UI as a static asset.

#### [NEW] `desktop/main.go`
Entry point. Creates the Wails application, registers services, creates the main window.

```go
app := application.New(application.Options{
    Name: "Beskar",
    Assets: application.AssetOptions{
        FS:      embeddedAssets,      // embedded React build
        Handler: assetHandler,
    },
    Services: []application.Service{
        application.NewService(&AuthService{}),
        application.NewService(&APIProxyService{}),
    },
    Plugins: application.Plugins{
        singleinstance.NewPlugin(),
    },
})
```

#### [NEW] `desktop/auth/service.go`
Wails service exposing auth methods to React via Go-JS bindings.

Methods exposed:
- `Login()` — opens system browser with PKCE challenge, returns when callback received
- `Logout()` — clears keychain tokens, optionally revokes at Zitadel
- `GetAccessToken() string` — returns current access token (auto-refreshes if expired)
- `IsAuthenticated() bool`
- `GetUserInfo() UserInfo`

#### [NEW] `desktop/auth/pkce.go`
PKCE flow implementation:
- Code verifier / challenge generation (SHA-256)
- State parameter with encryption (reuse existing `KEY` from server or derive new secret)
- Token exchange with Zitadel token endpoint
- Token refresh loop (background goroutine)

#### [NEW] `desktop/auth/keychain.go`
OS keychain abstraction using `zalando/go-keyring` or `99designs/keyring`:
- Store: `access_token`, `refresh_token`, `id_token`, expiry
- Load on startup
- Clear on logout

#### [NEW] `desktop/api/proxy.go`
**Recommendation:** All API calls from the React UI go through a Go-side proxy (Wails service or embedded HTTP listener on `localhost:PORT`). This eliminates CORS issues entirely.

Alternative: Add `wails://` or `localhost:34115` to server `CORS_ALLOWED_ORIGINS`. The proxy approach is cleaner.

#### [NEW] `desktop/protocol/handler.go`
Custom URL scheme registration (`beskar://`) and callback parsing. Hooks into Wails `OnApplicationLaunchWithURL`.

---

### Component 2: React UI Adaptations (`/ui`)

The web app's entry point and routing are **left completely unchanged**. The desktop app gets its own separate entry point so both targets can coexist in the same `ui/` codebase without impacting each other.

#### Strategy: Dual Vite Entry Point

```
ui/
  src/
    main.tsx              ← web entry (unchanged: BrowserRouter)
    main.desktop.tsx      ← desktop entry (new: HashRouter)
  app/
    App.tsx               ← web route tree (unchanged)
    App.desktop.tsx       ← desktop route tree (new, wraps same pages in HashRouter)
    core/
      desktop/            ← new: desktop-only utilities
```

Vite is configured with two build inputs: one for web (`index.html`) and one for desktop (`index.desktop.html`). The `wails.json` points at the desktop build output. The web Docker build continues using the existing `index.html` entry — zero impact.

#### [NEW] `ui/src/main.desktop.tsx`
Desktop-specific entry point. Uses `HashRouter` (required — Wails serves files from a local asset store, no server to handle history-mode URLs).

```tsx
import { HashRouter, Routes, Route } from 'react-router-dom';
import AppDesktop from '../app/App.desktop';
// ... same React/Radix providers as main.tsx

ReactDOM.createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <AppDesktop />
  </HashRouter>
);
```

#### [NEW] `ui/app/App.desktop.tsx`
Desktop-specific route tree. Mirrors [App.tsx](file:///Users/kiran/projects/beskar/ui/src/App.tsx) but:
- Uses desktop `AuthGuard` (Wails bindings instead of cookie fetch)
- Omits the `AuthRedirect` page (no server-side redirect needed)
- All route paths identical — switching between web and desktop is seamless for the user

#### [NEW] `ui/index.desktop.html`
Separate HTML entry file pointing to `main.desktop.tsx`.

#### [MODIFY] [vite.config.ts](file:///Users/kiran/projects/beskar/ui/vite.config.ts)
Add a second build input for the desktop bundle:

```ts
build: {
  rollupOptions: {
    input: {
      main:    'index.html',          // web build (unchanged)
      desktop: 'index.desktop.html', // desktop build
    },
  },
},
```

In dev mode, Wails points at `http://localhost:5173/index.desktop.html` so hot reload works normally.

#### [NEW] `ui/app/core/desktop/` directory
- `isDesktop.ts` — runtime detection: `export const isDesktop = Boolean((window as any).__WAILS__)`
- `events.ts` — Wails event subscriptions (auth state changes pushed from Go → React)

#### [NEW] `ui/app/core/auth/AuthGuard.desktop.tsx`
Desktop version of `AuthGuard`. Instead of hitting `/api/v1/authenticated` (cookie check), it:
- Calls Wails binding `AuthService.IsAuthenticated()`
- If not authenticated, calls `AuthService.Login()` → opens system browser PKCE flow
- Listens for Wails `auth:ready` event from Go to know when login completes

```tsx
import { IsAuthenticated, Login } from '../../../wailsjs/go/auth/AuthService';
import { Events } from '@wailsio/runtime';
```

The **original** [AuthGuard.tsx](file:///Users/kiran/projects/beskar/ui/app/core/auth/AuthGuard.tsx) is **not modified**.

#### [MODIFY] [useKeycloak.ts](file:///Users/kiran/projects/beskar/ui/app/core/auth/useKeycloak.ts)
Add `useDesktopLogout()` export that calls `AuthService.Logout()` binding. Existing `useLogout` untouched.

#### [NEW] `ui/app/core/http/desktopClient.ts`
HTTP client for desktop. Prepends Bearer token from `AuthService.GetAccessToken()` to all requests plus the configured server base URL. This replaces the Vite proxy (which only works in dev and is not available inside the Wails app).

---

### Component 3: Go Server Changes (`/server`)

> [!IMPORTANT]
> **Correction from initial plan:** `AuthMiddleWare` in `core/auth.go` is **dead code** — it is never mounted on any route in `main.go`. The server **exclusively** uses cookie-based sessions today. Bearer token support must be actively added.

Three changes are needed, all in the server. The web app cookie path is completely untouched.

#### [NEW] `server/core/identity.go`

This is the key change. A single `ExtractUser` function normalises identity out of context, regardless of which auth path ran. All handlers call this instead of reading from context directly.

```go
package core

// UserIdentity is the single, unified representation of an authenticated user,
// regardless of whether they authenticated via cookie session or Bearer JWT.
type UserIdentity struct {
    UserID string
    Email  string
    Roles  []string
}

// ExtractUser reads the authenticated user from context.
// It tries the Zitadel cookie session path first, then falls back to the Bearer token path.
// All handlers should call this instead of reading ctx values directly.
func ExtractUser(ctx context.Context) (UserIdentity, bool) {
    // Cookie/session path (web app)
    if authCtx := authentication.Context[*openid.UserInfoContext[
        *zoidc.IDTokenClaims, *zoidc.UserInfo,
    ]](ctx); authCtx != nil && authCtx.IsAuthenticated() {
        return UserIdentity{
            UserID: authCtx.UserInfo.Subject,
            Email:  authCtx.UserInfo.Email,
        }, true
    }
    // Bearer token path (desktop app)
    if claims, ok := ctx.Value("claims").(Claims); ok && claims.Claims.UserId != "" {
        return UserIdentity{
            UserID: claims.Claims.UserId,
            Email:  claims.Email,
            Roles:  claims.Claims.AllowedRoles,
        }, true
    }
    return UserIdentity{}, false
}
```

#### [MODIFY] `server/main.go` — mount Bearer token fallback

Wrap protected routes so they accept *either* a valid session cookie *or* a valid Bearer JWT. Web app requests hit the cookie path and are completely unaffected.

```go
// Replace: mw.CheckAuthentication()(someRouter())
// With:    authChain(mw)(someRouter())

func authChain(mw *authentication.Interceptor[...]) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        // Cookie session check (runs first — zero cost for web app)
        cookiePath := mw.CheckAuthentication()(next)
        // Bearer token fallback (only runs if no valid cookie session found)
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            if _, err := core.ZitadelAuthenticator().IsAuthenticated(r); err == nil {
                cookiePath.ServeHTTP(w, r) // cookie path
                return
            }
            core.AuthMiddleWare(next).ServeHTTP(w, r) // Bearer path
        })
    }
}
```

#### [MODIFY] `server/auth/auth.go` — update `/api/v1/authenticated`

The `authenticated` handler currently only checks `authentication.IsAuthenticated(ctx)` which only works for the cookie path. Update to use `core.ExtractUser`:

```go
func authenticated(w http.ResponseWriter, r *http.Request) {
    if _, ok := core.ExtractUser(r.Context()); ok {
        render.Status(r, http.StatusOK)
        render.Render(w, r, core.NewSucessResponse(core.SUCCESS, nil))
        return
    }
    render.Status(r, http.StatusUnauthorized)
    render.Render(w, r, core.NewFailedResponse(401, core.FAILURE, core.FAILURE, "Not authenticated"))
}
```

#### Handler audit: replace direct `ctx.Value("claims")` reads

Search all handlers for `ctx.Value("claims")` and `r.Context().Value("claims")` and replace with `core.ExtractUser(ctx)`. This is a **grep-and-replace** refactor — the number of call sites determines the effort.

#### [MODIFY] `server/core/url.go` (or wherever CORS origins are loaded)

Add Wails WebView origins to `CORS_ALLOWED_ORIGINS`:
- macOS/Linux: `wails://wails`
- Windows: `http://wails.localhost`

These should be added to the environment config, not hardcoded.

---

### Component 4: Build System & CI

No Taskfile. Build is driven by **npm scripts** (frontend) and **`go build` / `wails3` CLI** (desktop host), consistent with how the rest of the project works today.

#### [MODIFY] `ui/package.json` — add desktop scripts

```json
"scripts": {
  "dev":             "vite",
  "build":           "vite build",
  "build:desktop":   "vite build --config vite.config.ts --mode desktop",
  "dev:desktop":     "vite --config vite.config.ts --mode desktop",
  ...
}
```

Wails' dev server can be pointed at `http://localhost:5173` (Vite running `npm run dev:desktop`) so hot reload works during development.

#### [NEW] `desktop/wails.json`
Wails v3 project config. Points the frontend at the `ui/` directory and uses npm scripts:

```json
{
  "name": "Beskar",
  "outputfilename": "beskar",
  "frontend": {
    "dir": "../ui",
    "devCommand": "npm run dev:desktop",
    "buildCommand": "npm run build:desktop",
    "buildDir": "dist"
  },
  "platforms": ["darwin/amd64", "darwin/arm64", "windows/amd64", "linux/amd64"]
}
```

#### [NEW] `desktop/Makefile`
Simple make targets for building the desktop app — consistent with the Go ecosystem, no extra tooling required:

```makefile
.PHONY: dev build-mac build-win build-linux

dev:
	wails3 dev

build-mac:
	wails3 build -platform darwin/universal

build-win:
	wails3 build -platform windows/amd64

build-linux:
	wails3 build -platform linux/amd64
```

#### [NEW] `.github/workflows/desktop.yml`
GitHub Actions matrix build for macOS (arm64/amd64), Windows, Linux. Code-signing for macOS (notarization) and Windows.

---

### Component 5: First-Run Experience & Configuration

#### [NEW] `desktop/config/store.go`
Persistent user preferences stored in OS-appropriate location (`~/Library/Application Support/Beskar/` on macOS):
- `server_url` — the Beskar server base URL (e.g., `https://app.yourcompany.com`)
- `zitadel_url` — Zitadel instance URL
- `client_id` — Desktop client ID from Zitadel

#### [NEW] `desktop/onboarding/` 
First-run React page (separate Wails window or route):
1. Enter server URL
2. Auto-discover Zitadel URL from server's `/.well-known/` endpoint (or manual entry)
3. Click "Login" → launches PKCE flow

---

## Issues & Task Breakdown

### Phase 1: Foundation (Week 1–2)

- [ ] **ENV-1**: Register a new "Native" application in Zitadel with `beskar://callback` redirect URI and PKCE enabled; set access token lifetime to **15 min**, refresh token lifetime to **30 days**
- [ ] **ENV-2**: Update Zitadel web app client token lifetimes: access token **15 min**, refresh token **7 days** (sliding)
- [ ] **INFRA-1**: Initialize Wails v3 project in `desktop/` with React UI embedded
- [ ] **INFRA-2**: Add `build:desktop` / `dev:desktop` npm scripts to `ui/package.json`; add `desktop/Makefile` with `dev`, `build-mac`, `build-win`, `build-linux` targets
- [ ] **AUTH-1**: Implement PKCE code verifier/challenge generator in Go (`desktop/auth/pkce.go`)
- [ ] **AUTH-2**: Implement custom URL scheme handler for `beskar://` (`desktop/protocol/handler.go`)
- [ ] **AUTH-3**: Implement OS keychain storage for tokens — `access_token`, `refresh_token`, `id_token`, expiry (`desktop/auth/keychain.go`)
- [ ] **AUTH-4**: Implement `AuthService` with `Login`, `Logout` (with Zitadel revocation), `GetAccessToken`, `IsAuthenticated`, `GetUserInfo` methods
- [ ] **AUTH-5**: Implement proactive token refresh loop with `singleflight.Group` concurrency guard — refresh when < 5 min from expiry, emit `auth:logout` event if refresh token is rejected
- [ ] **AUTH-6**: Implement app startup token recovery — read keychain on launch, refresh if access token expired, show login if refresh token expired
- [ ] **AUTH-7**: Implement logout with active revocation — call Zitadel `/oauth/v2/revoke` for both access and refresh tokens before clearing keychain

### Phase 2: UI Integration (Week 2–3)

- [ ] **UI-1**: Create `ui/index.desktop.html` and `ui/src/main.desktop.tsx` (desktop entry point with `HashRouter`)
- [ ] **UI-2**: Add second Vite build input in `vite.config.ts` for `index.desktop.html` — verify web build still works identically
- [ ] **UI-3**: Create `ui/app/App.desktop.tsx` mirroring the web route tree, minus web-only pages (`AuthRedirect`)
- [ ] **UI-4**: Create `ui/app/core/desktop/isDesktop.ts` and `events.ts`
- [ ] **UI-5**: Create `ui/app/core/auth/AuthGuard.desktop.tsx` using Wails bindings (`IsAuthenticated`, `Login`, `auth:ready` event)
- [ ] **UI-6**: Add `useDesktopLogout()` to `useKeycloak.ts` calling `AuthService.Logout()` (existing hook untouched)
- [ ] **UI-7**: Create `desktopClient.ts` that attaches Bearer token to all API requests
- [ ] **UI-8**: Wire Wails events for auth state changes (Go → React) in `events.ts`
- [ ] **UI-9**: Smoke-test web build after all UI changes — assert no regressions to `main.tsx` / `App.tsx` / `AuthGuard.tsx`

### Phase 3: Server Hardening (Week 3)

- [ ] **SRV-1**: Create `server/core/identity.go` with `UserIdentity` struct and `ExtractUser(ctx)` function
- [ ] **SRV-2**: Audit all handlers — grep for `ctx.Value("claims")` and `r.Context().Value("claims")`, replace with `core.ExtractUser(ctx)`. Track count before starting.
- [ ] **SRV-3**: Add `authChain` combinator to `server/main.go` — mounts `AuthMiddleWare` as Bearer fallback on all protected routes. Verify web app cookie path still works.
- [ ] **SRV-4**: Update `authenticated` handler in `server/auth/auth.go` to use `core.ExtractUser`
- [ ] **SRV-5**: Add Wails WebView origins (`wails://wails`, `http://wails.localhost`) to `CORS_ALLOWED_ORIGINS` config
- [ ] **SRV-6**: Implement `RedisSessions[T]` in `server/core/sessions.go` satisfying the Zitadel SDK `Sessions[T]` interface — serialise/deserialise session to Redis with 7-day TTL
- [ ] **SRV-7**: Replace `InMemorySessions` with `RedisSessions` in `ZitadelAuthenticator` initialisation — verify sessions survive server restart
- [ ] **SRV-8**: Implement access token refresh wrapper (`CheckAndRefreshIfNeeded`) — check expiry on every authenticated request, refresh via Zitadel token endpoint if < 5 min remaining, update Redis session
- [ ] **SRV-9**: Set session cookie `MaxAge` / `Expires` to 7 days to align with refresh token lifetime
- [ ] **SRV-10**: Integration test — login, wait for access token to expire (or manually set short lifetime in test), verify next request transparently refreshes and succeeds without re-login

### Phase 4: Connectivity (Week 3–4)

- [ ] **NET-1**: Implement Wails Asset Handler in `desktop/main.go` — intercepts all fetch calls from the WebView, forwards to configured server URL with `Authorization: Bearer <token>`. No localhost port opened.
- [ ] **NET-2**: WebSocket / signaling connection — test `signalserver` connectivity from desktop (WebRTC/WS should work natively)
- [ ] **NET-3**: Server configuration store (`desktop/config/store.go`) — persist server URL, client ID
- [ ] **NET-4**: First-run onboarding UI — server URL entry, auto-discovery, initial login

### Phase 4: Platform Polish (Week 4–5)

- [ ] **PLAT-1**: System tray icon with quick actions (Open, Logout, Quit)
- [ ] **PLAT-2**: Native notifications (document updates, mentions, invites)
- [ ] **PLAT-3**: Single instance enforcement (focus existing window if app already running)
- [ ] **PLAT-4**: Deep link handling (`beskar://open/space/123/page/456`)
- [ ] **PLAT-5**: File drag-and-drop for media uploads (pass file paths to Go, upload via server)
- [ ] **PLAT-6**: Auto-updater (check GitHub Releases or self-hosted update server)

### Phase 5: Build & Distribution (Week 5–6)

- [ ] **BUILD-1**: macOS `.app` bundle with universal binary (arm64 + amd64) — **launch target**
- [ ] **BUILD-2**: macOS code signing + notarization (Apple Developer account required) — **launch target**
- [ ] **BUILD-3**: Windows `.exe` + NSIS installer — **launch target**
- [ ] **BUILD-4**: Windows code signing (EV certificate) — **launch target**
- [ ] **BUILD-5**: Linux AppImage + `.deb` package — **build + test in CI, release deferred**
- [ ] **BUILD-6**: CI/CD pipeline (GitHub Actions matrix build — all three platforms run on every PR; Linux artifact stored but not published to release)
- [ ] **BUILD-7**: Auto-update manifest and delta releases (macOS + Windows only at launch)

---

## Verification Plan

### Automated Tests
- Unit tests for `auth/pkce.go` (code generation, verifier/challenge roundtrip)
- Unit tests for `config/store.go` (read/write/defaults)
- Go binding tests for `AuthService` (mock Zitadel token endpoint)

### Manual Verification
- Full PKCE login flow on macOS (Safari opens, returns to app, token stored in Keychain)
- Full PKCE login flow on Windows
- Full PKCE login flow on Linux
- Token refresh (set short expiry, verify background refresh keeps session alive)
- Logout clears keychain, React reflects unauthenticated state
- All existing routes load correctly via `HashRouter` in the desktop build
- **Web app regression**: run the web build and verify routes, auth redirect, and `returnTo` flow all work identically to before
- Document editor (WebSocket, collaboration) works from desktop
- File upload (media/attachments) works from desktop
- Deep link opens correct page within app

---

## Technical Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Wails v3 is in Alpha | Medium | Pin a specific alpha tag; test all target platforms before committing |
| OS keychain library compatibility | Medium | Use battle-tested `99designs/keyring` which supports all three platforms |
| WebRTC from WebView (signaling) | Medium | Test early; Wails WebView uses system webview (WKWebView/WebView2/WebKitGTK) which supports WebRTC |
| Zitadel native app redirect URI | Low | Standard OIDC native app pattern; well-documented |
| Dual entry point divergence | Low | `App.desktop.tsx` duplicates the route tree — mitigate by extracting shared route config into a `routes.ts` constant both files consume |
| Handler audit scope unknown | Medium | Grep `ctx.Value("claims")` before starting SRV-2 to size the effort; if > 20 call sites consider a codemod script |
| CORS on Go server | Low | Wails Asset Handler makes outbound requests as a Go HTTP client — WebView origin is never sent to the server, so CORS is not triggered for API calls |
