# Desktop smoke test — 10 November 2026

Tested the installed `desktop/bin/Teddox Development.app` on this Mac. Source HEAD: `7c22cba`; no rebuild performed during this test. Development configuration points to `https://app.durgakiran.com` and `https://id.durgakiran.com`. This is a smoke test, not production release certification.

## Results

| Check | Observed result |
| --- | --- |
| Launch | Passed: desktop window and sign-in UI load |
| Sign-in under default launch | Failed at API audience discovery before browser authorization |
| API diagnosis | Strict HTTPS verification rejects the backend's self-signed certificate. The public `/.well-known/beskar` endpoint responds HTTP 200 with issuer/audience metadata when using the previously authorized development TLS exception |
| Development sign-in | Passed after relaunch with `BESKAR_DEV_ALLOW_SELF_SIGNED=1`: browser login succeeds, callback reaches desktop and workspace opens |
| Spaces/documents | Passed: space list, Engineering document and existing media/comments QA page load |
| Editing/undo | Passed: inserted a synthetic marker into QA text, observed it in editor, undid it and verified original text after leaving/reopening editor |
| Comments | Passed: existing thread/reply visible; resolve removes thread from Open, Resolved retains it, unresolve restores it to Open |
| Attachment download | Passed: comment attachment saves through native save dialog; `/private/tmp/teddox-desktop-smoke-2026-11-10.txt` contains the expected 64-byte synthetic test text |
| Images | Partial failure: first blue QA image renders; another inline image shows a broken-image placeholder in editor. Image accessibility labels alone do not establish successful rendering. Cause not diagnosed |
| YouTube | Playback in document view advances and Pause is available. In editor, a fallback appeared after undo; reopening editor and bringing embed into view loaded the native YouTube player again. Intermittent lifecycle issue remains possible; no root cause established |

QA page: **Desktop media and comments QA 2026-11-03**, page 141, space `aded26dc-f200-43b8-b0c0-251ef06a2aa0`.

## Boundaries and cleanup

- Temporary text was undone; the original comment thread was reopened. No Update/publish operation was performed. The app remains signed in on the QA document in view mode.
- No source fixes were made. Relaunch changed only the development process environment; production TLS policy remains unchanged.
- This run did not verify new image/file uploads, PDF export, fullscreen video, a saved/published edit, process-restart recovery, cross-client collaboration, token expiry/revocation or permission isolation.
- The backend certificate is a local development setup issue. Broken-image rendering and the transient editor embed fallback need separate investigation before claiming all media workflows pass.
