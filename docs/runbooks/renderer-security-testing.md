# Renderer security and regression testing (SEC-09)

The shared editor and production Vite outputs apply to web and desktop. Development Vite HMR intentionally does not receive the production policy; run the built fixture below to test enforcement.

## Implemented protections

- Production HTML receives CSP before executable content; Cloudflare `_headers` also supplies CSP and frame-ancestor protection. Nginx app locations add frame-ancestor, referrer, MIME and framing headers; the identity-provider virtual host is unchanged.
- Scripts are limited to packaged/same-origin resources. Inline scripts, event attributes, ordinary string evaluation, objects, base URLs and arbitrary frames are blocked. WebAssembly compilation remains allowed. React/Radix/styled-components require inline **styles**, which remain an explicit exception. Workers and attachment object URLs remain supported.
- API/signaling origins derive from the existing build configuration. Third-party iframe and metadata origins are explicit allowlists. Images may use HTTPS, data URLs and blob URLs. Adding an embed provider requires updating both the provider registry and CSP.
- Embeds require exact HTTPS provider hosts, no credentials and no custom ports. Both node views rebuild destinations from `src` every render, including persisted JSON and remote CRDT updates. Stored `embedUrl`/`provider` values cannot choose a different iframe destination. Exported block links are validated too. Frames remain sandboxed and cannot navigate the top-level application. Provider frames may receive only the page origin through `strict-origin-when-cross-origin`; no document path or loopback capability is sent.
- HTML code previews use DOMPurify's HTML-only profile, remove active/navigation markup, and retain their opaque sandbox and no-script/no-network CSP. External-link chips validate persisted destinations before opening or requesting metadata. React escapes labels; the editor schema and existing link/KaTeX rules remain in place.
- The desktop asset middleware intersects the static policy with this process's exact loopback port. No bridge path/capability appears in the policy. Bridge requests require the exact listener Host, capability path and native Origin; cookies/referrers/forwarded identity are stripped, redirects rejected, and responses cannot set cookies, execute as documents or enter caches. The capability is still privileged authenticated access; CSP does not make arbitrary code in the trusted renderer safe.
- Desktop link clicks and `window.open` go through the system browser with scheme/credential/loopback checks. On macOS, a native WKNavigationDelegate guard also rejects foreign top-level navigation, redirects and new-window requests before commit. It preserves Wails' existing lifecycle delegate. It attaches when the bundled runtime becomes ready and closes the app if attachment fails.

## Repeatable local browser fixture

Build the workspace editor first so Vite uses the changed shared code:

```sh
npm --prefix packages/editor run build
npm --prefix ui run test:security:build
npm --prefix ui run test:security:serve
```

Open `http://localhost:4179/`. This loopback-only server uses synthetic assets and a fixture signaling hub, with no credentials or backend proxy. The build includes the real editor, production CSP and real `DocumentRealtimeRelay`. The normal production build does not include this fixture page. Stop the server after testing.

Click **Run policy and transport checks**. Expect passing results for inline-script rejection, attachment fetch, worker startup, WebAssembly and two independent Yjs sessions exchanging updates in both directions over a real WebSocket. The intentional script probe produces an expected CSP console error. Edit the document, inspect the image, verify the passive HTML preview, and inspect the allowed embed. The forged provider URL must never become a frame; the valid source with a forged saved destination must use Excalidraw instead.

Run regression suites and both production builds:

```sh
npm --prefix packages/editor test
npm --prefix ui test
(cd desktop && go test -race ./...)
(cd desktop && go test -race -tags beskar_dev ./...)
npm --prefix ui run build
npm --prefix ui run build:desktop
```

Rebuild/copy the desktop UI before building the native binary. Use only the development build/tag for local self-signed services. Keychain may request approval after an ad-hoc development signature changes; do not relax credential ACLs to avoid that prompt.

## Observed acceptance and remaining release gates

Local verification began 2026-11-03 and continued 2026-11-04 (Asia/Kolkata):

- UI: 428 tests passed; editor: 77 tests passed. Native race suites include exact-host/redirect/credential isolation, per-process CSP and the actual Foundation URL predicate used by the macOS navigation guard.
- The production-policy browser fixture blocked an injected inline script and passed attachment/worker/WASM/WebSocket-Yjs checks. Its editor accepted edits and rendered the image and sanitized HTML preview.
- Rebuilt macOS development app restored its session after user-approved Keychain access, loaded QA page 141 and its image/comments/attachment, and exchanged edits immediately in both directions with the deployed web client. New synthetic PNG and text-attachment uploads completed; the PNG appeared immediately in web. Synthetic smoke fixtures remain on this QA page. Attachment download produced the expected 64-byte synthetic text in `/private/tmp/beskar-sec09-attachment.txt`.
- A spoofed `https://evil.example/framer.com/` embed was rejected in the desktop UI. Excalidraw loaded its actual drawing UI inside the sandbox.
- **YouTube playback restored on macOS and verified on web.** The macOS player is an isolated WKWebView with a fresh configuration, no Wails bindings or Beskar authentication, and a non-persistent website data store. It sends the installed bundle's public identity as its HTTP Referer, following [YouTube's documented native-player requirements](https://developers.google.com/youtube/terms/required-minimum-functionality#embedded-player-api-client-identity). The editor passes only an 11-character video ID and bounded viewport geometry. Native navigation is restricted, camera/microphone capture is denied, and cleanup pauses playback and closes fullscreen presentations. CSP and web iframe sandbox restrictions remain intact.
- Native inline playback reached the end of the 3:33 test video. The final installed build played the restored embed, entered fullscreen, returned to inline playback, and retained the embed after save and restart. Opening an insert menu hid the native view; closing it restored the same player. Leaving edit mode removed the old view, and the saved document view loaded a fresh playable instance. The native view pool is limited to eight instances per application browser.
- The production-CSP web fixture played the same video past 3:25 at `http://localhost:4179/`. A numeric-loopback origin returned a provider unavailable message during this test, so use the hostname URL for manual playback acceptance. Existing policy, attachment, worker, WASM and independent-session WebSocket checks also passed. Other providers may impose their own sharing/login/frame restrictions; they were not all exhaustively tested.
- The final installed macOS binary reopened the saved QA content and synchronized a temporary title change to web and the restored title back to desktop.
- The deployed web bundle was **not deployed by this work**. Cross-client live tests used the rebuilt desktop and the existing deployed web client. The changed web bundle/editor was tested locally; deploy it with the updated Nginx/Cloudflare headers, then repeat authenticated web uploads/downloads and cross-client tests.
- Windows/Linux native before-navigation and YouTube identity integrations are still outstanding. Shared CSP, URL validation, link handling and bridge checks apply there, but the native guard currently targets macOS only. Do not mark SEC-09 fully accepted on those platforms without implementing/testing the equivalent native gate and testing installed binaries.
- SEC-06 and SEC-08 remain separately deferred; these changes do not implement room authorization or invalidate existing upgraded sockets on logout.
