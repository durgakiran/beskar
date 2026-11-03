# Teddox Desktop Application

This is the desktop client for the application, built using [Wails v3](https://wails.io/) and React. It wraps the core UI and provides native OS integrations, deep linking, and a dedicated proxy middleware for authenticated API requests.

Before distributing a production build, follow the [production-readiness guideline](../docs/runbooks/desktop-production-readiness.md). The current development build has documented token, callback, transport and collaboration-authorization blockers.

## Prerequisites

Before building or running the desktop application, ensure you have the following installed on your machine:

1. **Go** (1.20 or later) - [Download](https://go.dev/dl/)
2. **Node.js** (v18 or later) & **npm** - [Download](https://nodejs.org/)
3. **Wails v3 CLI** - Installed via Go:
   ```bash
   go install github.com/wailsapp/wails/v3/cmd/wails3@latest
   ```
4. **C Compiler** (gcc) and standard build tools required by Wails (e.g., Mingw-w64 on Windows, Xcode command line tools on macOS, build-essential on Linux).

## Build Configurations & Environment Variables

The desktop application is designed to be environment-agnostic. Hardcoded URLs are avoided. Instead, we inject environment-specific URLs at build-time using Go's `ldflags`.

The configuration variables exposed for injection are located in the `beskar/desktop/config` package:
- `DefaultServerURL`: The main API backend URL. (Default: `https://app.durgakiran.com`)
- `DefaultZitadelURL`: The Zitadel Authentication server URL. (Default: `https://id.durgakiran.com`)
- `DefaultClientID`: The OAuth Client ID used for authentication. (Default: `377926419071631362`)

### Example: Injecting Dev Configuration

To override the production defaults and target your development environment, pass the `-ldflags` parameter to the Wails CLI (or raw `go build` command):

```bash
wails3 build -ldflags "-X 'beskar/desktop/config.DefaultServerURL=https://dev.durgakiran.com' -X 'beskar/desktop/config.DefaultZitadelURL=https://id-dev.durgakiran.com' -X 'beskar/desktop/config.DefaultClientID=YOUR_DEV_CLIENT_ID'"
```

## Running in Development Mode

To run the application in live development mode (which enables hot-reloading for the frontend UI):

1. **Start the Frontend Dev Server**: 
   Open a terminal in the `ui` directory and run:
   ```bash
   npm run dev:desktop
   ```
2. **Start the Wails Dev Server**: 
   Open another terminal in the `desktop` directory and run:
   ```bash
   wails3 dev -config ./build/config.yml -port 9245
   ```
   *Note: You can also pass `-ldflags` to `wails3 dev` if you need to target a staging backend during development.*

## Local development with self-signed HTTPS certificates

Normal builds always verify certificate chains and hostnames, even when
`BESKAR_DEV_ALLOW_SELF_SIGNED=1` is set at runtime. Only binaries explicitly
compiled with `-tags beskar_dev` include the development TLS exception; those
binaries also verify TLS unless the variable is exactly `1`.

Run from `desktop` after building the desktop UI and copying `ui/dist` into
`desktop/ui/dist`:

```bash
BESKAR_DEV_ALLOW_SELF_SIGNED=1 go run -tags beskar_dev .
# Equivalent native development target:
BESKAR_DEV_ALLOW_SELF_SIGNED=1 make dev-native

# Explicit development artifact:
go build -tags beskar_dev -o bin/teddox-dev .
BESKAR_DEV_ALLOW_SELF_SIGNED=1 bin/teddox-dev

# Production artifact: exclude custom build tags, including ambient GOFLAGS tags.
go build -tags '' -o bin/teddox-production .
# Equivalent explicit production target:
make build-production
```

The development exception disables certificate-chain and hostname verification
for native requests. It does not alter browser, WebView or OS trust settings.
Prefer a trusted local development CA. The Windows WebView uses normal security
settings in every build; no certificate-ignore or web-security-disable flags
are supplied by the application.

`make test-tls` runs the certificate/hostname policy matrix in both build modes.
Release builds and packaging must exclude `beskar_dev`; inspect artifact tags
with `go version -m PATH_TO_BINARY`. Repeat invalid-chain and wrong-hostname
checks against signed installed artifacts on each supported platform. The
existing Wails packaging-task gaps remain tracked as REL-01; the direct native
commands above do not depend on those missing task files.

The desktop process starts its own loopback HTTP/WebSocket bridge on a random
port. API requests, draft saves, signaling, and live document updates use this
bridge; backend tokens and TLS handling stay in Go. No separate local signaling
server is needed. The listener accepts native origins and a per-run random path,
and closes when the app exits.

Attachment downloads from document controls and comment links use a native
save dialog. Go downloads the authenticated attachment from the configured
backend, enforces the 10 MB attachment limit, and writes only after a destination
is selected. Cancelling does not create a file.

## Building and Packaging for Production

### macOS development bundle without the Wails CLI

After building the desktop UI, run from `desktop`:

```bash
mkdir -p ui/dist bin/Teddox.app/Contents/MacOS
cp -R ../ui/dist/. ui/dist/
go build -tags beskar_dev -o bin/Teddox.app/Contents/MacOS/teddox .
cp macos/Info.plist bin/Teddox.app/Contents/Info.plist
codesign --force --deep --sign - bin/Teddox.app
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$PWD/bin/Teddox.app"
BESKAR_DEV_ALLOW_SELF_SIGNED=1 bin/Teddox.app/Contents/MacOS/teddox
```

The bundle declares the `teddox://` URL scheme. Registration lets the browser
return the login callback to this app. Keep the desktop process running during
login because the PKCE verifier belongs to that process; after a restart, start
a new login rather than reusing an old callback URL.

To package the application into a standalone executable (e.g., `.exe` for Windows, `.app` for macOS):

1. Make sure your UI frontend dependencies are installed and the editor package is properly built.
2. Run the Wails build command in the `desktop` directory, passing your production (or staging) `-ldflags`:

```bash
wails3 build -ldflags "-X 'beskar/desktop/config.DefaultServerURL=https://app.durgakiran.com' -X 'beskar/desktop/config.DefaultZitadelURL=https://id.durgakiran.com' -X 'beskar/desktop/config.DefaultClientID=377926419071631362'"
```

### Build Outputs
The compiled binaries and installers will be generated inside the `desktop/bin/` directory.

> **Note on Cross-Compilation:** Wails relies on CGO to bind to native OS webviews. Therefore, to build a Windows `.exe`, you must build on Windows. To build a macOS `.app`, you must build on a Mac. Cross-compilation is generally not supported out-of-the-box without specialized docker containers (like xgo).

## Authentication binding boundary

`auth.Manager` owns credentials, provider configuration, callbacks and native token access. Never register it with Wails or embed it in a bound service. `auth.UIAuthService` exposes `Login`, `Logout`, `IsAuthenticated` and the nonsecret `GetStatus` reader; native transports receive the manager directly. `services_test.go` checks the actual Wails registry, including rejection of the old sensitive method IDs.

Regenerate bindings using the pinned Wails version from the `desktop` directory:

```sh
go run github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-alpha2.117 generate bindings -ts -i -noevents -d ../ui/wailsjs .
```

The generator cleans its output directory by default. Review the generated diff and run `go test ./...` and the desktop UI build after changes.

Login attempts have a five-minute deadline and fresh random state plus an S256 PKCE verifier. The native manager validates the exact callback URI, matching state and a single code or provider error; each callback is consumed once. Unrelated and stale callbacks leave the current attempt intact. `UIAuthService.Login` receives a Wails-injected context: the UI's **Cancel sign-in** action cancels its promise and native request without exposing another auth method. Logout and shutdown also cancel pending login. See `auth/login_test.go` for the negative callback and cancellation cases.

Session token access and keychain writes/deletes are synchronized. Each restored or newly logged-in session owns one cancellable refresh worker. Renewal is single-flight per session generation and rechecks freshness before contacting the provider. A refresh preserves an omitted replacement refresh token, persists rotation before adopting it, and never creates another worker. Logout clears local state and saved credentials before provider revocation; late login/refresh results cannot commit into a newer session. App shutdown cancels the session context. `auth/session_test.go` covers concurrency, rotation, outages, persistence ordering and stale-result rejection using synthetic credentials. SEC-04 adds provider deadlines, redirect rejection and durable replay prevention for uncertain refresh outcomes.

Provider discovery, token, revocation and userinfo requests have a 15-second maximum budget and reject all HTTP redirects. Server/issuer configuration must be HTTPS origins without userinfo, path prefixes, queries or fragments; provider credential requests use fixed native endpoint paths. Refresh writes `refresh_pending` into the keychain before transmitting the token. A lost/invalid response, timeout, unexpected redirect or interrupted refresh ends renewal and requires a fresh login; restart never retries a pending credential. Only a recognized explicit temporary OAuth rejection allows a retry, with 30-second backoff. This conservative behavior can require sign-in even if the provider never received the interrupted request.

`GetStatus` exposes only a code, a locally controlled message, sign-in/local-sign-out flags and a revocation outcome. The UI reads this at startup and on `auth:status`, so errors raised before subscription or by a background worker remain visible. Logout clears local credentials first and attempts access/refresh revocation within one shared 15-second budget; failed deletion or unconfirmed revocation is reported without provider bodies, tokens or raw operating-system errors.
