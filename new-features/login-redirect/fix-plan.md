# Login Redirect Back To Requested App URL

## Problem

When an unauthenticated user opens a deep app URL, for example:

```text
https://app.durgakiran.com/space/aded26dc-f200-43b8-b0c0-251ef06a2aa0/view/31
```

the current flow is:

```text
deep app URL -> /auth/login -> id.durgakiran.com login -> app home / space list
```

Expected flow:

```text
deep app URL -> /auth/login -> id.durgakiran.com login -> same deep app URL
```

The app should preserve the originally requested path, including query parameters, through the auth round trip. URL fragments cannot be preserved because browsers do not send `#fragment` values to the server.

## Current Flow

1. `https://app.durgakiran.com/...` is routed by nginx to the Next UI.
   - `docker/templates/nginx.https.conf.tmpl`
   - `location /` proxies to `http://ui:3000`.
   - `location /auth` proxies to `http://server:9095`.

2. Every UI page is wrapped by the root auth guard.
   - `ui/app/layout.tsx`
   - The layout renders `<SessionGuard>{children}</SessionGuard>`.

3. `SessionGuard` checks the current browser cookies by calling the Go API.
   - `ui/app/core/auth/sessionProvider.tsx`
   - It calls `${NEXT_PUBLIC_USER_SERVER_URL}/authenticated`.
   - In production this is `https://app.durgakiran.com/api/v1/authenticated`.

4. If the API returns `401`, `SessionGuard` redirects to a fixed URL:

```ts
redirect("/auth/login");
```

At this point the original `/space/.../view/31` path is dropped.

5. `/auth/login` is handled by the Go server.
   - `server/main.go` mounts `core.ZitadelAuthRouter()` under `/auth/`.
   - `server/core/auth.go` returns `ZitadelAuthenticator()` for `/auth/*`.

6. The Zitadel authenticator's default `/login` route starts auth with an empty requested URI.
   - The module code calls `a.Authenticate(w, req, "")`.
   - `Authenticate` encrypts `State{RequestedURI: requestedURI}`.
   - The callback later redirects to `state.RequestedURI`.

Because the requested URI is empty, the callback has no app destination to restore. The user lands on the default app entry point instead of the original document URL.

There is a second hardcoded home redirect in `ui/app/components/home.tsx`:

```ts
redirect("/space");
```

That is fine for the real app home page, but it must not be the fallback for a deep-link login.

## Root Cause

The app currently has no return URL contract between the Next UI guard and the Go auth handler.

The two places that lose the target URL are:

1. `ui/app/core/auth/sessionProvider.tsx`
   - Redirects unauthenticated users to `/auth/login`.
   - Does not append the originally requested path.

2. `server/core/auth.go`
   - Uses the third-party authenticator's default `/auth/login` route.
   - That route calls `Authenticate(..., "")`, so the encrypted OIDC state contains an empty `RequestedURI`.

## Recommended Fix

Introduce an explicit, relative-only return URL parameter:

```text
/auth/login?returnTo=/space/aded26dc-f200-43b8-b0c0-251ef06a2aa0/view/31
```

Then make the Go `/auth/login` handler read `returnTo`, validate it, and pass it into `ZitadelAuthenticator().Authenticate(w, r, returnTo)`.

This keeps the return URL in the existing encrypted OIDC state, which is already the mechanism used by the Zitadel Go SDK callback.

## Implementation Plan

### 1. Add a current request path header in Next middleware

Create `ui/middleware.ts`.

Server components do not reliably receive the full current route URL directly, so middleware should copy the current path and query into an internal request header before the app renders.

```ts
import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(
        "x-beskar-current-path",
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );

    return NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    });
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

Notes:

- Do not include the scheme or host here. The server should only accept relative app paths to avoid open redirects.
- The URL hash is unavailable to middleware because browsers do not send it in HTTP requests.

### 2. Update `SessionGuard` to pass `returnTo`

In `ui/app/core/auth/sessionProvider.tsx`, import `headers` and build the login URL from the middleware header.

Target behavior:

```ts
const headerStore = await headers();
const currentPath = headerStore.get("x-beskar-current-path") || "/";

if (res.status === 401) {
    const returnTo = currentPath.startsWith("/") ? currentPath : "/";
    redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
}
```

Also keep a loop guard so the app never redirects to auth with `returnTo=/auth/...`.
That path is proxied to the Go server in production, but the guard makes local/dev behavior safer.

Suggested helper shape:

```ts
function normalizeReturnTo(value: string | null) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) {
        return "/";
    }
    if (value === "/auth" || value.startsWith("/auth/")) {
        return "/";
    }
    return value;
}
```

Then:

```ts
const returnTo = normalizeReturnTo(headerStore.get("x-beskar-current-path"));
redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
```

### 3. Update `Home` to use the same login helper

`ui/app/components/home.tsx` currently redirects unauthenticated users to plain `/auth/login`.

For the root page this is less visible because the correct return target is `/`, and authenticated users already redirect from `/` to `/space`. Still, it should use the same helper to avoid two auth entry patterns.

For `/`, either of these is acceptable:

```text
/auth/login?returnTo=/
```

or:

```text
/auth/login?returnTo=/space
```

Recommended: use `/` as the preserved request URL, then let `Home` continue to redirect authenticated users to `/space`. This preserves the mental model that auth returns to the page the user requested.

### 4. Override the Go `/auth/login` route

In `server/core/auth.go`, add a dedicated login handler before the catch-all auth handler.

Target shape:

```go
func sanitizeAuthReturnTo(value string) string {
    value = strings.TrimSpace(value)
    if value == "" || strings.ContainsAny(value, "\\\r\n\t") {
        return "/"
    }
    if !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") {
        return "/"
    }

    path := value
    if idx := strings.IndexAny(path, "?#"); idx >= 0 {
        path = path[:idx]
    }
    lowerPath := strings.ToLower(path)
    if lowerPath == "/auth" || strings.HasPrefix(lowerPath, "/auth/") {
        return "/"
    }

    return value
}

func ZitadelLoginHandler() http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        returnTo := sanitizeAuthReturnTo(r.URL.Query().Get("returnTo"))
        ZitadelAuthenticator().Authenticate(w, r, returnTo)
    }
}
```

Then change `ZitadelAuthRouter`:

```go
func ZitadelAuthRouter() http.Handler {
    r := chi.NewRouter()
    r.Get("/register", ZitadelRegisterHandler())
    r.Get("/login", ZitadelLoginHandler())
    r.Handle("/*", ZitadelAuthenticator())
    return r
}
```

Why this works:

- `ZitadelAuthenticator().Authenticate` is public.
- It stores the requested URI in encrypted auth state.
- The existing callback already decrypts that state and redirects to `state.RequestedURI`.
- We keep the SDK's existing `/auth/callback` and `/auth/logout` handling.

### 5. Keep auth return URLs relative

Do not let arbitrary absolute URLs pass through `returnTo`.

Allowed:

```text
/space/aded26dc-f200-43b8-b0c0-251ef06a2aa0/view/31
/space/aded26dc-f200-43b8-b0c0-251ef06a2aa0/view/31?comment=abc
/user/notifications
```

Rejected and normalized to `/`:

```text
https://app.durgakiran.com/space/aded26dc-f200-43b8-b0c0-251ef06a2aa0/view/31
https://evil.example/path
//evil.example/path
/auth/login?returnTo=/space
/auth/callback
```

Same-origin absolute URLs are intentionally rejected as well. The UI sends only relative paths, so the server can keep one rule: accept values that begin with exactly one `/`, reject everything else.

## Expected Flow After Fix

Unauthenticated deep link:

```text
GET /space/aded26dc-f200-43b8-b0c0-251ef06a2aa0/view/31
Next SessionGuard -> 307 /auth/login?returnTo=%2Fspace%2Faded26dc-f200-43b8-b0c0-251ef06a2aa0%2Fview%2F31
Go /auth/login -> OIDC auth request with encrypted state.RequestedURI="/space/aded26dc-f200-43b8-b0c0-251ef06a2aa0/view/31"
Zitadel login -> /auth/callback
Go callback -> 302 /space/aded26dc-f200-43b8-b0c0-251ef06a2aa0/view/31
Next SessionGuard sees authenticated session -> renders requested document
```

Already authenticated deep link:

```text
GET /space/.../view/31
Next SessionGuard sees authenticated session -> renders requested document
```

Unauthenticated app root:

```text
GET /
Next/Home -> /auth/login?returnTo=%2F
Go callback -> /
Home sees authenticated profile -> /space
```

## Files To Change

Required:

- `ui/middleware.ts`
- `ui/app/core/auth/sessionProvider.tsx`
- `server/core/auth.go`

Recommended:

- `ui/app/components/home.tsx`

Optional cleanup after the fix is verified:

- `ui/app/components/login.tsx`
- `ui/app/core/auth/signin.ts`

Those files use `next-auth` APIs, but there is no Next route for `/auth/login` in the current UI app. Production `/auth/*` is proxied to the Go server, so these files appear stale or unused for the current login path. Do not rely on them for this redirect fix unless a separate route imports them.

## Test Plan

### Manual production-like test

1. Clear app and auth cookies for:
   - `app.durgakiran.com`
   - `id.durgakiran.com`

2. Open:

```text
https://app.durgakiran.com/space/aded26dc-f200-43b8-b0c0-251ef06a2aa0/view/31
```

3. Confirm the first app redirect is:

```text
https://app.durgakiran.com/auth/login?returnTo=%2Fspace%2Faded26dc-f200-43b8-b0c0-251ef06a2aa0%2Fview%2F31
```

4. Complete login at `id.durgakiran.com`.

5. Confirm the final URL is:

```text
https://app.durgakiran.com/space/aded26dc-f200-43b8-b0c0-251ef06a2aa0/view/31
```

6. Confirm the document content renders and the URL is not replaced by `/` or `/space`.

### Query string test

Open a URL with a query string:

```text
https://app.durgakiran.com/space/aded26dc-f200-43b8-b0c0-251ef06a2aa0/view/31?comment=thread-123
```

Expected final URL:

```text
https://app.durgakiran.com/space/aded26dc-f200-43b8-b0c0-251ef06a2aa0/view/31?comment=thread-123
```

### Authenticated test

While already logged in, open the same deep link in a new tab.

Expected:

- No trip to `/auth/login`.
- URL remains the requested deep link.

### Open redirect test

Open:

```text
https://app.durgakiran.com/auth/login?returnTo=https%3A%2F%2Fevil.example%2F
```

After login, expected redirect:

```text
https://app.durgakiran.com/
```

or the chosen safe fallback, not `evil.example`.

Also test:

```text
https://app.durgakiran.com/auth/login?returnTo=%2F%2Fevil.example%2F
https://app.durgakiran.com/auth/login?returnTo=%2Fauth%2Flogin
```

Both should normalize to the safe fallback.

## Regression Risks

- If middleware is configured too broadly, it can affect static assets. Use the matcher exclusion for `_next/static`, `_next/image`, and `favicon.ico`.
- If `returnTo` accepts arbitrary absolute URLs, it creates an open redirect vulnerability. Keep the Go sanitizer strict.
- If the Go handler is registered after `r.Handle("/*", ZitadelAuthenticator())`, the default SDK login route may still win. Register `r.Get("/login", ZitadelLoginHandler())` before the catch-all.
- If the UI passes the full origin in `returnTo`, it may fail across local, Docker, and production hostnames. Prefer relative paths.
- URL fragments such as `#comment-1` cannot be restored server-side. If fragment restoration becomes necessary, it must be captured client-side before redirect.

## Acceptance Criteria

- Unauthenticated users who start at any protected app path return to that exact path after login.
- Query parameters survive the login round trip.
- Already authenticated users are not redirected away from their requested path.
- Invalid or external `returnTo` values do not redirect outside the app origin.
- Direct `/auth/login` still works and falls back to `/` or `/space`.
- Root `/` behavior remains unchanged for authenticated users: `/` redirects to `/space`.
