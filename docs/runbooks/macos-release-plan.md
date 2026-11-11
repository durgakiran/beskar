# Teddox macOS release plan

Prepared: 10 November 2026. Scope: the existing Wails desktop app on Mac computers. This is an implementation and release checklist; no Apple or Cloudflare resources have been provisioned by writing it.

## Distribution decision

Alpha decisions, 10 November 2026: defer Apple Developer ID signing/notarization, SEC-06 room authorization and SEC-08 long-lived connection invalidation for the initial alpha. These items do not block alpha packaging or the tester release. Use the alpha workflow below. The numbered stable-release checklist remains the target for subsequent production distribution.

For stable distribution, distribute outside the Mac App Store as a Developer ID signed, notarized DMG. Store packages in Cloudflare R2 and link to them from the existing Cloudflare-hosted UI. Users install and upgrade manually by dragging Teddox into Applications. Automatic installation of updates is a separate project.

## Initial alpha workflow — Apple signing deferred

1. **Build an isolated alpha.** Use the dedicated `beskar_alpha` build: **Teddox Alpha**, bundle ID `com.durgakiran.beskar.alpha`. Configuration is stored under `Beskar/alpha/config.json`; credentials use `com.durgakiran.beskar.alpha.credentials.v2` with the existing issuer/client/API/subject scoping. Alpha and development tags cannot be combined. Use a version such as `0.1.0-alpha.1` and an increasing build number.
2. **Preserve credential protections.** The production build continues to require a verified production signing team. Alpha explicitly supports ad-hoc signing with native Keychain storage and a separate alpha namespace; it does not import dev/production credentials or configuration. PKCE, state/nonce validation, bounded provider requests, refresh rotation and the narrow native UI facade remain in place. Test rebuild/upgrade Keychain prompts; fresh login may be necessary when ad-hoc signatures change. Migration to signed production requires fresh login; local draft migration is separate work.
3. **Package and verify.** Complete [Teddox alpha backend readiness](teddox-alpha-backend-readiness.md), then export the production native `ALPHA_CLIENT_ID`. From `desktop`, run `ALPHA_VERSION=0.1.0-alpha.3 ALPHA_BUILD=3 make package-mac-alpha` with `NPM_TOKEN` exported for the private GitHub packages. API and issuer defaults are `https://app.teddox.com` and `https://id.teddox.com`; the development client ID is not a fallback. The script rebuilds the desktop UI, creates and ad-hoc signs a versioned alpha app, and emits the architecture-labelled DMG, `SHA256SUMS`, and build metadata under `desktop/bin/alpha/<version>/<architecture>/`. It builds only on a matching-architecture Mac, rejects existing version outputs and sets a minimum macOS of 15.0 (older versions are unverified). Verify bundle integrity, icon, callback, login, documents, media and installation on another Mac. Ad-hoc signing does not establish a trusted publisher or provide notarization. Alpha always verifies TLS, even if `BESKAR_DEV_ALLOW_SELF_SIGNED=1`; the development bypass is excluded. Do not weaken alpha TLS to reuse the local development setup.
4. **Publish a GitHub prerelease.** Attach the versioned DMG, checksum and build metadata to a desktop release tag that points to the recorded source commit. Follow the [GitHub publication commands](../../desktop/README.md#publishing-alpha-packages-to-github). When downloads move to Cloudflare R2, use the bucket setup in steps 8–9 and the [R2 publisher](../../desktop/README.md#publishing-alpha-packages-to-cloudflare-r2-after-migration).
5. **Document tester installation.** Explain that macOS may block the download because Apple has not verified its publisher/notarized it. Testers must make their own explicit decision about any macOS opening exception. Do not disable Gatekeeper globally, silently remove quarantine, or describe the alpha as Apple-verified. Retain the normal drag-to-Applications installation and manual replacement for upgrades.
6. **Run a limited pilot.** SEC-06 and SEC-08 are deferred alpha findings by explicit release decision, not alpha release blockers or completed fixes. Tell testers that signaling room actions do not yet enforce per-room permission checks, and that existing connections may remain active after logout/account switch or access changes. Use disposable test accounts/workspaces and synthetic content for the pilot; do not claim tenant isolation or immediate connection revocation has been verified. Record other smoke-test gaps, restore test edits and retain the last usable alpha artifact for recovery. These deferrals do not change unrelated security requirements.

Alpha completion: verified ad-hoc-signed DMG, successful clean-Mac tester installation and login, published alpha metadata/downloads, known-issue notes including SEC-06/SEC-08, and a manual recovery path. Apple certificate acquisition, Developer ID signing, notarization, stapling, production signing/Keychain validation, SEC-06 and SEC-08 remain open stable-release tasks. No packaging, code-security settings or Cloudflare deployment was changed by this plan update.

### Why production credential access requires signing

SEC-07 added an application-level check in [keychain_darwin.go](../../desktop/auth/keychain_darwin.go). Before native credential Get/Set/Delete operations, the production build validates its running code signature and checks that its bundle ID and Apple signing Team ID match the expected Teddox identity. A missing or mismatched identity blocks credential access.

This binds our credential-storage code to the intended publisher and application. macOS Keychain access controls provide an additional, separate boundary. This check does not protect against every compromise of an already authorized running app or a compromised operating system.

The Team ID requirement is **our production application policy**, not a requirement imposed by Keychain itself. It is separate from notarization: the credential check validates signing identity, while notarization concerns Apple's distribution assessment. Postponing notarization alone would not bypass the production signing check.

For this alpha, `beskar_alpha` uses a separate alpha identity and credential namespace and skips that production signing-identity check. Keychain storage and its OS access controls remain in use. Keep this policy isolated from production; do not remove the production check to make an ad-hoc production build work. Alpha uses the strict TLS policy and does not include the opt-in development exception. That exception remains exclusive to `beskar_dev`.

### Alpha build commands and acceptance

```bash
cd desktop
cp alpha.env.example alpha.env
# Set ALPHA_CLIENT_ID, version/build and public origins in alpha.env.
bash scripts/package-mac-alpha.sh --env alpha.env --check
bash scripts/package-mac-alpha.sh --env alpha.env
```

`build-alpha` compiles only the native binary using existing embedded UI. The packaging command runs `npm ci` for the UI and editor PDF build in an isolated directory, rebuilds the workers and WASM, and controls its Go tags; do not run concurrent packaging jobs against the same checkout's generated UI directory. `ALPHA_CLIENT_ID` is mandatory and must come from production Zitadel. Optional `ALPHA_API_ORIGIN` and `ALPHA_ISSUER_ORIGIN` override the Teddox defaults when packaging; no OAuth client secret is accepted. Alpha applies its compiled origins/client at startup, replacing stale saved alpha values. No development or production tokens are imported. `build-info.txt` records whether the source tree was dirty; release candidates must be built from a reviewed clean revision with lockfile dependencies. The earlier alpha.2 verification package targets development services and must not be distributed as the Teddox production alpha.

The repeatable env-file workflow uses `desktop/alpha.env.example` and an ignored
`desktop/alpha.env`. Only public alpha keys are accepted; the file is parsed as
literal values, not executed or bundled. File values override inherited inputs.
`--check` validates without building. `ALPHA_ENV_FILE=alpha.env make package-mac-alpha`
is equivalent to the direct packaging script when run from `desktop`. Never use
the backend deployment env file as desktop build input.

Run the full desktop tests under default, `beskar_dev`, and `beskar_alpha` tags. The alpha TLS suite must reject untrusted chains and wrong hostnames with every development environment setting. Verify config/credential namespace separation and rejection of mixed tags. The opt-in native Keychain test uses only randomly named synthetic entries. Keep clean-Mac installation, Gatekeeper behavior, trusted-backend login, callback and upgrade tests as distribution gates; passing unit tests does not complete them. All variants currently share `teddox://callback`, so test installed-app selection when development, alpha and production coexist.

### Implementation verification — 10 November 2026

- Implemented `beskar_alpha`, alpha config/credential namespaces, strict TLS selection, mutually exclusive alpha/dev tags, alpha plist, native build target and `scripts/package-mac-alpha.sh`. Production signing checks remain unchanged.
- Full race suites passed under default, `beskar_dev` and `beskar_alpha` tags. The final alpha rerun also passed the fresh embedded-asset serving regression. Invalid-chain/hostname cases reject the development bypass in alpha; mixed alpha/dev tags fail compilation as intended.
- The alpha native Keychain synthetic create/read/update/delete test passed without accessing existing app credential records. Credential-context tests check environment separation; signed production migration remains a future acceptance gate.
- Built and mounted `desktop/bin/alpha/0.1.0-alpha.2/arm64/Teddox-0.1.0-alpha.2-macos-arm64.dmg` on this Apple Silicon Mac. Ad-hoc signature, alpha bundle ID, version/build, callback scheme, icon reference, macOS 15.0 minimum, DMG integrity and embedded `beskar_alpha` build tag were verified. The app launched to the sign-in screen with no imported session.
- Initial packaging exposed the pinned Wails requirement for an `index.html` discovery entry. Packaging now copies the fresh desktop entry to both `index.desktop.html` and `index.html`; it never substitutes the web entry. The initial failed alpha.1 package was moved out of `bin/alpha` and is not a release candidate.
- Live alpha login rejects the self-signed backend during discovery. A trusted backend certificate/CA is required before signed-in alpha acceptance can pass; no TLS exception was added.
- These are local verification artifacts from a dirty workspace, not published releases. Intel, clean-machine/quarantined installation, trusted-backend alpha login/callback, alpha upgrades and alpha-to-production local draft handling remain unverified. Cloudflare upload/download integration has not been provisioned or deployed.

Stable-release flow (after the alpha deferrals are completed):

```text
Reviewed source revision → macOS build → sign → notarize → staple
  → clean-machine acceptance → Cloudflare R2 → existing UI download page
```

The existing UI is deployed as Worker static assets by [deploy-ui-cloudflare.sh](../../docker/scripts/deploy-ui-cloudflare.sh), using [wrangler.jsonc](../../docker/cloudflare/wrangler.jsonc). Keep that deployment separate from binary publication. R2 custom domains support Cloudflare caching and production download URLs; `r2.dev` is intended for development. See [Cloudflare public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/).

Use two initial artifacts: `Teddox-<version>-macos-arm64.dmg` for Apple Silicon and `Teddox-<version>-macos-amd64.dmg` for Intel. Intel support is conditional on a successful native build and acceptance run; do not advertise an untested architecture. A universal app can follow once both slices and native dependencies are validated. Establish the minimum macOS version from the pinned Wails/WebKit/native requirements and tests; the current linker warnings are not evidence of compatibility with older macOS versions.

## Step 1 — Resolve release blockers

This is the stable-production gate. SEC-06 and SEC-08 below are explicitly deferred for alpha as recorded above; they remain unresolved implementation work.

Owner: application and backend maintainers. Output: a dated release decision with evidence linked to the chosen source revision.

- [ ] Review [desktop production readiness](desktop-production-readiness.md) and [renderer security testing](renderer-security-testing.md) against the current source and deployed backend.
- [ ] Resolve SEC-06 room authorization, or deploy and verify its replacement. A planned migration away from WebRTC does not resolve authorization on the currently deployed signaling service. Authorize subscribe, publish and other room actions for the verified user and resource.
- [ ] Resolve SEC-08: logout/account switch closes active transports; servers enforce expiry, revocation and permission changes on long-lived connections. This remains parked implementation work, not completed release evidence.
- [ ] Complete installed macOS validation for SEC-05, SEC-07 and SEC-09: mandatory TLS verification, production signing/Keychain isolation, CSP, navigation and isolated YouTube playback.
- [ ] Check other unresolved transport, draft/account partitioning and file-safety gates in the readiness runbook. Keep token and local capability values out of logs and support bundles.
- [ ] Review the pinned Wails alpha dependency and record an explicit release suitability decision; upgrading it requires regression testing.

Do not promote a public stable release while these security gates remain unresolved. Packaging work and isolated internal testing can proceed independently.

## Step 2 — Fix production identity and supported configuration

Owner: application maintainer. Output: a checked-in release configuration and supported Mac matrix.

- [ ] Retain production name `Teddox`, bundle ID `com.durgakiran.beskar`, executable `teddox`, and the existing `teddox://` callback scheme. Keep development identity and credentials separate.
- [ ] Choose the initial version, for example `0.1.0`, and a monotonically increasing build number. Populate `CFBundleShortVersionString`, `CFBundleVersion` and `LSMinimumSystemVersion` in the packaged production plist. The source plist currently has build number `1` and no marketing version/minimum OS entry.
- [ ] Confirm the production HTTPS API origin, issuer and dedicated native public-client ID. Configure Authorization Code + S256 PKCE, exact `teddox://callback` redirect, supported scopes and refresh-token rotation in Zitadel. Never package an OAuth client secret.
- [ ] Set `config.ReleaseTeamID` at build time to the Apple signing team's ID. This is a public identifier required by the existing native signing/credential boundary, not a secret.
- [ ] Verify the production app uses valid public/trusted certificates. Build without `beskar_dev`, clear inherited build flags, and reject release inputs containing development TLS/WebView overrides.
- [ ] Decide whether production accepts user-configured server origins; test the shipped configuration behavior, including persisted configuration, rather than assuming linker defaults overwrite an existing profile.

## Step 3 — Prepare Apple signing and notarization

**Deferred for alpha; required before the stable production release.** Follow the alpha workflow above for the initial tester packages.

Owner: Apple Developer account administrator and release operator. Output: working signing/notarization access on a controlled Mac runner.

1. Obtain Apple Developer Program access and a **Developer ID Application** certificate and private key for the production team.
2. Install a supported, recorded Xcode toolchain with `codesign`, `xcrun notarytool`, `xcrun stapler`, `hdiutil` and `ditto`.
3. Store signing and notarization credentials in the release secret store. Use an isolated temporary signing keychain on CI, import only for the release job, and clean up when the job ends.
4. Configure a notarization credential profile or supported App Store Connect API credentials. Keep keys/passwords out of source, command output and artifacts.
5. Determine the minimum necessary entitlements for Wails, WKWebView and the isolated player. Enable hardened runtime; do not blanket-disable library validation or add debugger entitlements to make signing pass.

Apple documents Developer ID signing and notarization in [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) and the container workflow in [Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution).

## Step 4 — Implement a reproducible macOS release build

Owner: build maintainer. Output: a production packaging script/target that fails on incomplete inputs.

1. Add a dedicated macOS release target, for example `desktop/scripts/release-macos.sh` and `make package-mac-production`. These are proposed deliverables; they do not exist yet. Repair or bypass the missing `desktop/build/...` task files referenced by `Taskfile.yml`; do not assume `wails3 build` currently packages correctly.
2. Run from a clean checkout of one reviewed revision on a Mac runner. Pin exact Node/npm, Go, Xcode/SDK and Wails versions; use committed npm locks and `go.sum`. Current starting points are Node 22, Go 1.25.0 and Wails `v3.0.0-alpha2.117`; record the exact patch/toolchain selected for release.
3. Install frontend dependencies with `npm ci`. Supply any private-package read token through the build secret mechanism, never a `VITE_*` variable or copied npm config.
4. Choose one editor/package source strategy: locked registry packages or workspace packages built from the same revision. `ui/vite.config.ts` selects workspace editor output when present; eliminate stale `packages/*/dist` so the result cannot depend on leftover local builds. Build required PDF assets and the desktop UI with `npm --prefix ui run build:desktop`.
5. Copy only the completed desktop output into `desktop/ui/dist` in a fresh build directory. Confirm `index.desktop.html`, workers, WASM, fonts and player assets are present. Never embed a web-mode build or a frontend development-server URL.
6. Build native `darwin/arm64` and `darwin/amd64` executables with CGO and a matching macOS toolchain. Prefer matching architecture runners; cross-building is acceptable only after validating every native dependency and testing on real target hardware. Pass `-tags ''` explicitly and set the approved `ReleaseTeamID`, API origin, issuer and client ID through release linker inputs.
7. Assemble `Teddox.app/Contents/MacOS/teddox`, the versioned production `Info.plist`, and `Contents/Resources/teddox.icns`. Embed the existing runtime PNG via Go as implemented in `main.go`. Add any required privacy declarations based on actual APIs used.
8. Inspect the bundle before signing: architecture (`file`/`lipo -info`), linked libraries (`otool -L`), version/minimum OS, URL scheme, icon, production identity and dependency inventory. Include required redistributable components and licenses; exclude development configuration and credentials.

The existing `make package-mac-dev` is explicitly development-only and ad-hoc signed. Do not publish its output as a production release.

## Step 5 — Run source and build checks

Owner: application maintainer. Output: saved results tied to the release revision and toolchain.

- [ ] Run desktop `go test -race -tags '' ./...` and `go test -race -tags beskar_dev ./...`; run relevant backend/signaling suites for security fixes included in this release.
- [ ] Run UI tests, editor tests and the desktop frontend build. Run the existing renderer/CSP smoke checks documented in the security testing runbook.
- [ ] Scan dependencies and generate a software bill of materials; record dispositions for findings rather than treating a scanner exit code as the entire security review.
- [ ] Check native binding allowlists and packaged frontend/storage/log output for accidental credentials and loopback capability disclosure using synthetic fixtures.
- [ ] Check that release scripts reject a missing Team ID, wrong certificate, development tag, unexpected configuration and incomplete UI output.

These checks complement the installed-artifact tests in step 7; they do not replace them.

## Step 6 — Sign, notarize and package each architecture

**Stable-release workflow.** For alpha, use ad-hoc signing and packaging as specified above; skip Apple notarization and stapling, and record the resulting trust limitations.

Owner: release operator. Output: final signed, stapled DMGs and notarization receipts.

1. Sign nested executable code, if any, from the inside out; then sign `Teddox.app` with the production Developer ID Application identity, secure timestamp and hardened runtime. Do not use ad-hoc signing or recursive `--deep` signing as a substitute for identifying nested code.
2. Verify the app's signature, team, bundle ID and entitlements. For example, `codesign --verify --deep --strict --verbose=2 Teddox.app` verifies recursively; inspect `codesign -dv --verbose=4` separately for identity.
3. Create a notarization ZIP with `ditto -c -k --keepParent Teddox.app Teddox-notarization.zip`. Submit it with `xcrun notarytool submit ... --keychain-profile <profile> --wait`. Require **Accepted**; inspect and resolve rejection logs.
4. Staple and validate the ticket on `Teddox.app`. A ZIP cannot carry a stapled ticket; this temporary ZIP is not the public download.
5. Create the versioned architecture-specific DMG containing the stapled app and an Applications shortcut. Sign the DMG with Developer ID Application, submit the DMG for notarization, then staple and validate it too. This two-stage workflow retains an app ticket when users copy the app out of its container.
6. Verify the final DMG and copied app with `codesign`, `stapler validate` and Gatekeeper assessment (`spctl --assess --type execute --verbose=4` for the app). Include the appropriate disk-image assessment in the release script.
7. Compute SHA-256, size and build metadata only after all stapling and packaging changes are complete. Preserve final artifacts, receipts and sanitized build logs. Any subsequent modification requires signing/notarization again.

## Step 7 — Accept the exact downloadable artifacts

Owner: QA. Output: a pass/fail matrix for each supported architecture and macOS version.

Test the final DMGs on a clean Mac/user profile without development configuration or credentials. Include the oldest supported macOS and a current supported version, Apple Silicon and Intel if both are advertised. Download through a browser so quarantine/Gatekeeper behavior is exercised; do not remove quarantine or bypass security warnings.

- [ ] Mount DMG, drag into Applications, eject, launch; confirm Teddox icon/name and valid signature. No terminal-based URL-scheme registration should be required.
- [ ] Browser sign-in returns through `teddox://callback` to the installed production app, including cold-start behavior. If no active login transaction survives, show a safe retry rather than accepting an unsolicited code. Check behavior when the development app is also installed because both declare the scheme.
- [ ] Keychain access works under the production signing team; dev and production credentials remain isolated. Test signed upgrade, locked/unavailable Keychain and account switch. Do not migrate development tokens into production.
- [ ] Invalid-chain and wrong-hostname HTTPS fixtures fail even with `BESKAR_DEV_ALLOW_SELF_SIGNED=1`; valid certificates work. Use disposable test configurations/accounts.
- [ ] Login cancellation, expired sessions, refresh rotation, ambiguous refresh failure, logout and revocation behave safely, including already-open collaboration sockets.
- [ ] Documents, edits, undo, comments/resolved threads, images, attachment upload/download, PDF export, embeds and YouTube playback/fullscreen work in the installed app.
- [ ] Web↔desktop and desktop↔desktop collaboration converge across different accounts/roles; denied rooms and revoked membership stay denied. Exercise reconnect, offline recovery and sleep/wake.
- [ ] CSP and native navigation prevent remote content from acquiring native bindings. External links open safely in the browser.
- [ ] Upgrade from the prior supported signed version preserves intended drafts/configuration and Keychain access; safe recovery does not resubmit an uncertain rotating refresh token. First release: test replacement/reinstall and keep the upgrade case pending until a prior production version exists.

## Step 8 — Provision Cloudflare package hosting

Owner: Cloudflare administrator. Output: a dedicated download endpoint with least-privilege publishing access.

1. Create `teddox-releases` for public production downloads. Keep unsigned candidates in a separate private staging bucket; public buckets must contain distributable artifacts only.
2. Attach an approved custom domain, proposed `downloads.teddox.com`, with HTTPS. This name is a proposal, not an existing verified resource. Disable the bucket's `r2.dev` endpoint.
3. Configure cache rules for versioned download objects and confirm the actual file sizes fit the account's cache limits. An uncached R2 download must still work; cache eligibility is not a prerequisite for integrity.
4. Use a bucket-scoped **Object Read & Write** S3 credential for the CI uploader, with no account/bucket administration privileges. Keep provisioning credentials separate. These scoped object permissions apply to the S3 API; do not reuse them with Wrangler's REST operations. See [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/) and [S3 setup](https://developers.cloudflare.com/r2/get-started/s3/).
5. Public clients receive read-only HTTPS links. Never ship Cloudflare credentials in the app or UI. Public binary downloads need no Teddox OAuth tokens or cookies.
6. If the UI fetches cross-origin release JSON, allow only the necessary UI origins and GET/HEAD through R2 CORS, without credentials. A normal download link needs no CORS permission. Adjust the web `connect-src` only if metadata fetching requires it; do not broaden desktop CSP for ordinary browser downloads.

Object layout (example version):

```text
releases/0.1.0/macos/Teddox-0.1.0-macos-arm64.dmg
releases/0.1.0/macos/Teddox-0.1.0-macos-amd64.dmg
releases/0.1.0/SHA256SUMS
releases/0.1.0/release.json
channels/stable.json
```

`release.json` records version, build, source commit, supported macOS versions, architecture, exact URL, size, SHA-256 and release notes. `stable.json` points to the approved version. Neither is an instruction to execute downloaded code in this first release.

Set DMG MIME type to `application/x-apple-diskimage` and `Content-Disposition: attachment` with its filename. Use `public, max-age=31536000, immutable` for versioned objects, and a cache bypass/`no-store` policy for the mutable channel pointer. Configure edge rules to respect that distinction. Never overwrite a published version key. R2 supports object HTTP metadata; see [uploading objects](https://developers.cloudflare.com/r2/objects/upload-objects/).

## Step 9 — Upload privately, verify publicly, then promote

Owner: release operator. Output: approved stable downloads linked from the UI.

1. Upload final artifacts and metadata to private staging using the scoped S3 uploader. Verify a read-back hash and retain acceptance evidence for those exact bytes.
2. After release approval, copy/upload only approved files to new versioned keys in the public bucket. Fail if those keys already exist. Configure write protection/retention for released artifacts where appropriate; the uploader's write permission alone does not guarantee immutability.
3. Fetch each public HTTPS URL and verify the response is the DMG, not an HTML fallback/challenge. Compare final size and SHA-256; check headers, interrupted/resumed downloads and browser behavior. Test signature/Gatekeeper from the public download too.
4. Publish the stable pointer **last**, after every referenced object is present and verified. Keep the previous pointer and record who promoted which revision.
5. Add a macOS download page/button to the existing UI showing version, minimum macOS, release notes, installation steps and separate **Apple Silicon**/**Intel** links. Let users select architecture; avoid relying only on browser architecture detection.
6. Deploy the UI through its existing Cloudflare process. It must link to R2 objects; the SPA fallback must not handle download paths. The current UI deploy script clears API-token variables and uses local Wrangler OAuth, so implement CI binary publication as a separate S3 job rather than assuming that script supports it.
7. Start with a limited pilot, review installation/auth/collaboration results, then promote stable broadly. Use a private bucket plus authenticated Worker if a beta needs access control; an unlisted public URL is not access control.

## Step 10 — Operate, update and recover

Owner: release/support maintainer. Output: release log, incident procedure and retention policy.

- [ ] First-release upgrades remain manual: notify users, link to the new notarized DMG, ask them to quit Teddox and replace the app in Applications. Avoid promising an updater that has not been implemented.
- [ ] Before automatic updates, implement a separate signed-metadata and artifact-verification design with a pinned update trust key, expiry/replay and downgrade protection, team/bundle verification, interrupted-install recovery and key rotation. HTTPS and a checksum downloaded beside a binary are not independent protection against a compromised publisher.
- [ ] Monitor download failures and nonsecret app/auth error categories. Do not collect tokens, callback query strings, loopback capabilities or document contents in release telemetry.
- [ ] For a bad release, stop promotion, revert the stable pointer/UI to the last known-safe compatible release, and invalidate any cached channel metadata. Do not mutate versioned artifacts. For compromised artifacts, disable their distribution and purge cached copies as part of incident response.
- [ ] Prefer a fixed higher-version release for already-installed clients. An older app may not understand newer drafts or pending-refresh markers; test rollback compatibility and require fresh login when credential replay safety is uncertain.
- [ ] Retain at least the current and previous supported final artifacts, checksums, notarization receipts, toolchain/build records and release notes in protected storage; keep an independent recovery copy and test restoring publication.

## Implementation order and completion criteria

| Order | Deliverable | Complete when |
| --- | --- | --- |
| 1 | Security/backend gates and supported Mac matrix | Unresolved gates have passing evidence and release owner sign-off |
| 2 | Apple signing + production OAuth configuration | Production identity and credential isolation verified |
| 3 | Reproducible macOS packaging script | Clean builds produce correctly versioned production bundles |
| 4 | Signing/notarization pipeline | Final DMGs are accepted, stapled and Gatekeeper-tested |
| 5 | Private staging + R2 custom domain + uploader | Permissions, hashes, headers and download behavior verified |
| 6 | Installed-artifact QA | All advertised architectures/OS versions pass step 7 |
| 7 | UI download page + stable promotion | Public URLs contain the approved bytes and pilot passes |
| 8 | Operations/rollback drill | Previous safe release can be restored without credential replay |

For the immediate alpha, follow the alpha workflow above and prepare Cloudflare hosting in parallel. Resume the numbered stable-release checklist, including Apple signing, before production promotion. Hosting a package does not make the app production-ready. Commit/push of this plan, provisioning, certificate purchase, deployment and public release are separate actions from drafting it.
