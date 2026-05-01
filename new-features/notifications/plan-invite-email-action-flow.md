# Plan: Invite Email Accept/Reject UI Flow

## Problem

Space invite emails currently render accept and reject links as direct API calls:

- `/api/v1/invite/user/accept?token=...`
- `/api/v1/invite/user/reject?token=...`

That breaks email flow because browser/email clients open those URLs outside the app shell. The request can miss auth/session context, returns API JSON instead of user-facing UI, and can be triggered by link scanners. Accept/reject must start from an app URL, preserve login return path, show invite context, then call the backend only after user confirmation.

## Current Code

Backend invite email link construction:

- `server/invite/notification.go`
  - `spaceInviteAcceptPath = "/api/v1/invite/user/accept"`
  - `spaceInviteRejectPath = "/api/v1/invite/user/reject"`
  - `buildSpaceInviteCreatedEmailRequest(...)` injects `accept_url` and `reject_url`.

Backend invite action endpoints:

- `server/invite/invite.go`
  - `GET /api/v1/invite/user/accept`
  - `GET /api/v1/invite/user/reject`
  - `GET /api/v1/invite/user/invites`

Frontend invite action UI already exists only inside notifications feed:

- `ui/app/user/notifications/page.tsx`
- `ui/app/components/settings/notification.tsx`

Existing auth return path support:

- `ui/app/core/auth/sessionProvider.tsx`
- `ui/app/core/auth/returnTo.ts`
- `ui/middleware.ts`

## Target Flow

Email links should point to app routes, not API routes:

```text
Accept: {EMAIL_APP_BASE_URL}/invite/action?token={token}&decision=accept
Reject: {EMAIL_APP_BASE_URL}/invite/action?token={token}&decision=reject
```

Flow:

1. Recipient clicks email button.
2. Browser opens Next.js route `/invite/action?token=...&decision=...`.
3. `SessionGuard` checks session.
4. If user is logged out, app redirects to `/auth/login?returnTo=/invite/action?...`.
5. After login/signup, app returns to same invite action route.
6. Page loads invite details for current authenticated user and token.
7. Page shows target space, sender, role, pending/resolved state, and preselected action.
8. User confirms accept or reject.
9. UI calls backend decision API with token and decision.
10. UI shows result and routes user to useful destination:
    - Accepted: show success and "Open space" link to `/space/{spaceId}`.
    - Rejected: show success and "Back to notifications" link to `/user/notifications`.

Important rule: opening email link must never mutate invite state. Mutation happens only after app confirmation.

## Backend Plan

### 1. Change Email URLs To App Route

Update `server/invite/notification.go`:

- Replace API paths with app path:
  - `spaceInviteActionPath = "/invite/action"`
- Build URLs with both token and decision:
  - `decision=accept`
  - `decision=reject`
- Keep using `notification.Config.AppBaseURL` / `EMAIL_APP_BASE_URL`.
- Keep URL query escaping.

Suggested helper shape:

```go
func buildInviteActionURL(appBaseURL string, token string, decision string) string
```

Rules:

- If `EMAIL_APP_BASE_URL=https://app.example.com`, output absolute app URL.
- If app base is empty or `/`, output relative app path.
- Only allow decisions `accept` and `reject`.
- Do not log full tokenized URL.

Update tests:

- `server/invite/notification_test.go`
  - expected accept URL becomes `https://app.example.com/invite/action?token=abc123&decision=accept`
  - expected reject URL becomes `https://app.example.com/invite/action?token=abc123&decision=reject`
  - relative fallback becomes `/invite/action?token=abc+123&decision=accept`

### 2. Add Invite Detail Endpoint

Add authenticated endpoint:

```http
GET /api/v1/invite/user/details?token={token}
```

Purpose:

- UI landing page needs one invite by token, not full notifications list.
- Response must be scoped to current authenticated user's email.
- Token alone must not disclose invite data to wrong account.

Handler behavior:

1. Read current user from `core.GetUserInfo(ctx)`.
2. Validate non-empty token.
3. Query `notifications.invites` by `token`.
4. If `email_id` does not match current user's email case-insensitively, return `403` or `404`.
5. Return invite context:

```json
{
  "entity": "space",
  "entityId": "...",
  "senderId": "...",
  "senderName": "...",
  "name": "Roadmap",
  "role": "member",
  "token": "...",
  "status": null,
  "createdAt": "..."
}
```

Resolved state:

- If invite exists for this email and status is `accepted`, return `200` with status `accepted`.
- If invite exists for this email and status is `rejected`, return `200` with status `rejected`.
- If invite is removed/deleted and no row exists, return `404`.

Security:

- Wrong-user access should not reveal recipient email.
- Do not include `email_id` unless UI explicitly needs it. It does not for V1.
- Do not include permission details beyond action result.

### 3. Add POST Decision Endpoint

Add authenticated endpoint:

```http
POST /api/v1/invite/user/decision
Content-Type: application/json

{
  "token": "...",
  "decision": "accept"
}
```

Accepted decision values:

- `accept`
- `reject`

Implementation:

- Reuse `processInvitation(userId, emailId, token, STATUS_ACCEPTED|STATUS_REJECTED)`.
- Keep current email matching behavior.
- Return updated status and optional redirect target:

```json
{
  "status": "accepted",
  "entity": "space",
  "entityId": "..."
}
```

Why add POST:

- GET should not mutate state.
- Email clients and scanners may prefetch GET links.
- UI can use same decision endpoint from notifications page and email landing page.

Compatibility:

- Keep existing `GET /user/accept` and `GET /user/reject` for current UI until frontend migration is done.
- Mark them as legacy internally.
- After all callers move to POST, remove or block legacy GET mutators in a later cleanup.

### 4. Improve Invite Decision Errors

Current `processInvitation` often maps failures to generic unauthorized/invalid input. Email landing page needs clear states.

Add typed errors or response mapping for:

- Missing token: `400`.
- Invite not found for current user email: `404`.
- Already accepted/rejected: `409` or `200` detail state, depending endpoint.
- Permission server failure while accepting: `502` or `500`.
- Space archived: `403` if archive policy should block acceptance.

Do not expose whether token exists for another email.

## Frontend Plan

### 1. Add Invite Action Route

Create:

- `ui/app/invite/action/page.tsx`
- Optional client component: `ui/app/components/invite/InviteActionPage.tsx`

Route input:

- `token`: required.
- `decision`: optional, allowed `accept` or `reject`.

States:

- Loading invite details.
- Invalid/missing token.
- Wrong account or unavailable invite.
- Pending invite with accept/reject controls.
- Already accepted.
- Already rejected/declined.
- Decision submitting.
- Decision success.
- Decision failure.

Behavior:

- On load, call `GET invite/user/details?token=...`.
- If `decision=accept`, render accept as primary selected action.
- If `decision=reject`, render decline confirmation state.
- Do not auto-submit on page load.
- Submit only when user clicks final button.

### 2. Share Existing Invite Card Logic

Current notification card already handles accept/reject:

- `ui/app/components/settings/notification.tsx`

Refactor enough to avoid duplicate action code:

- Extract shared invite action card, for example:
  - `ui/app/components/invite/InviteDecisionCard.tsx`
- Use it from:
  - `/user/notifications`
  - `/invite/action`

Shared props:

```ts
type InviteDecision = "accept" | "reject";

interface InviteDecisionCardProps {
  invite: Invite;
  initialDecision?: InviteDecision;
  compact?: boolean;
  onResolved: (result: InviteDecisionResult) => void;
}
```

Keep UI copy specific:

- Notifications feed: compact action item.
- Email landing page: focused decision screen with space/sender/role and result CTA.

### 3. Move Frontend Mutations To POST

Add or extend HTTP hook support:

- Use `usePost` for `invite/user/decision`.
- Existing notifications component should stop calling `useGet("invite/user/accept")` and `useGet("invite/user/reject")`.

Decision submit:

```ts
post("invite/user/decision", {
  token: invite.token,
  decision: selectedDecision,
})
```

On success:

- Remove invite from feed or refetch.
- Email landing page shows success panel.

On error:

- Show inline error with retry.
- Preserve current decision selection.

### 4. Auth And Return Path

Existing `SessionGuard` and `returnTo` logic should handle logged-out email clicks if auth flow returns to `returnTo`.

Verify:

- `/invite/action?token=...&decision=accept` redirects to `/auth/login?returnTo=%2Finvite%2Faction...`.
- After login/signup, user lands back on `/invite/action?...`.
- Query params survive the full auth redirect.

If signup/login currently redirects to `/space` unconditionally, update login callback to honor sanitized `returnTo`.

Wrong account state:

- If authenticated email does not match invite `email_id`, show:
  - "This invitation was sent to a different email address."
  - Sign out / switch account action.
- Do not show target recipient email unless backend deliberately returns masked email for same-token owner. V1 can omit.

### 5. UX Requirements

Email landing page should be focused, not marketing/hero.

Content:

- Sender avatar/initial.
- "{senderName} invited you to join {spaceName}".
- Role badge.
- Created date if available.
- Accept button.
- Decline button with confirmation.
- Open notifications link.

Result states:

- Accepted:
  - "Invitation accepted."
  - Primary CTA: "Open space".
- Rejected:
  - "Invitation declined."
  - Primary CTA: "Back to notifications".
- Already accepted:
  - "You already accepted this invitation."
  - CTA: "Open space".
- Already rejected:
  - "You already declined this invitation."
  - CTA: "Back to notifications".

## Email Template Plan

Keep template key:

- `space_invite_created`

Keep required fields:

- `space_name`
- `sender_name`
- `role`
- `accept_url`
- `reject_url`
- `app_url`

Only URL values change:

- `accept_url`: app landing route with `decision=accept`.
- `reject_url`: app landing route with `decision=reject`.

Copy can stay mostly unchanged, but buttons now open app UI. No need to explain this in email.

## Data Model

No schema change required for V1.

Existing `notifications.invites` has enough data:

- `sender_id`
- `token`
- `user_id`
- `entity`
- `entity_id`
- `email_id`
- `role`
- `status`
- `created_at`
- `updated_at`

Possible later improvement:

- Add invite expiry (`expires_at`) if product wants token lifetime control.
- Add audit fields for decision IP/user agent if compliance needs it.

## Security Notes

- Email links must never point to mutating API routes.
- App route GET must be read-only.
- Decision mutation must be POST.
- Backend must require authenticated user.
- Backend must match current authenticated email to invite `email_id`.
- Wrong-account responses must avoid leaking recipient data.
- Tokenized links must not be logged.
- Link scanners opening email URLs must not accept/reject invites.
- `returnTo` must keep accepting only relative app paths to avoid open redirects.

## Rollout Steps

1. Add backend invite details endpoint.
2. Add backend POST decision endpoint.
3. Add frontend `/invite/action` page.
4. Extract/shared invite decision card if needed.
5. Migrate notifications feed from legacy GET accept/reject to POST decision endpoint.
6. Change email URL builder to app route.
7. Update backend URL tests.
8. Add frontend tests for email action route.
9. Send one local invite email and verify links manually.
10. Keep legacy GET endpoints for one release, then remove or disable.

## Tests

Backend unit tests:

- URL builder outputs app accept/reject URLs.
- URL builder escapes token.
- URL builder rejects unknown decision.
- Details endpoint returns pending invite for matching email.
- Details endpoint returns resolved invite state for matching email.
- Details endpoint hides invite from wrong email.
- POST decision accepts pending invite.
- POST decision rejects pending invite.
- POST decision rejects invalid decision.
- POST decision handles already resolved invite.

Frontend tests:

- `/invite/action` missing token shows invalid link state.
- Pending accept link loads invite details and preselects accept.
- Pending reject link loads invite details and asks for decline confirmation.
- Accept success shows open-space CTA.
- Reject success shows notifications CTA.
- Already accepted invite shows resolved state.
- Wrong account shows switch-account state.

End-to-end tests:

- Logged-out user clicks accept email link, logs in, returns to invite page, confirms, gains space access.
- Logged-out user clicks reject email link, logs in, returns to invite page, confirms, invite disappears.
- Email link opened by scanner does not change invite status.
- User signed in with different email cannot accept invite.

## Acceptance Criteria

- New invite emails contain app URLs, not `/api/v1/invite/user/accept` or `/api/v1/invite/user/reject`.
- Clicking accept/reject from email opens Beskar UI.
- Logged-out recipient can authenticate and return to same invite action page.
- Invite action page shows invite details before any mutation.
- Accept/reject succeeds from email flow for matching authenticated email.
- Reject path asks for confirmation before mutation.
- Wrong-account user cannot resolve invite.
- Existing `/user/notifications` accept/reject continues working after migration.
- Link scanners cannot mutate invite status by opening email URLs.
