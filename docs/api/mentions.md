# Space-scoped mention APIs

Base path: `/api/v1/space/{spaceId}/mentions/users`. Both endpoints use the
existing browser-session or bearer authentication and standard success/error
envelopes. Interactive documentation is available at `/api/docs`.

## Search

`GET /api/v1/space/{spaceId}/mentions/users?query=alex&limit=10&offset=0`

```json
{
  "status": "success",
  "data": {
    "users": [
      {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "label": "Alex Morgan",
        "email": "alex@example.com",
        "avatarUrl": null
      }
    ],
    "hasMore": false
  }
}
```

- `query`: optional, trimmed, at most 200 Unicode characters. Case-insensitive
  substring matching on the displayed label or email; full names with spaces work.
- Empty query lists current members alphabetically. Equal labels are ordered by
  Beskar user UUID for deterministic pagination.
- `limit`: defaults to 10; positive integers above 50 are clamped to 50.
- `offset`: defaults to 0; nonnegative uint64. Beyond the end returns
  `{"users":[],"hasMore":false}`.
- Invalid UUIDs, malformed query encoding, invalid numeric values and repeated
  query/limit/offset parameters return `400`.
- Membership, account status and search filtering happen before pagination.

## Resolve / hover details

`GET /api/v1/space/{spaceId}/mentions/users/{userId}`

```json
{
  "status": "success",
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "label": "Alex Morgan",
    "email": "alex@example.com",
    "avatarUrl": null,
    "spaceRole": "editor"
  }
}
```

IDs in requests and responses are Beskar user UUIDs. Roles are `owner`, `admin`,
`editor`, `commenter`, or `viewer`; the stored `commentor` alias is normalized.
Labels fall back from display name to given/family name, then email. Avatar URLs
are nullable and limited to absolute HTTP(S) URLs without embedded credentials.
The editor package uses these fields for its hover card through the optional
`mentionHandler.getUserDetails` callback, including in read-only documents.

## Access and unavailable users

Callers must be authenticated, have space view permission and remain current
space members. This permits viewers/read-only documents to resolve mentions.
Only active human members with usable profile fields qualify. Zitadel v2 can
omit the redundant nested `human.userId`; human profile/email fields identify
a human account instead. Owners are included; pending invites,
non-member accounts, deleted/inactive/locked accounts, service accounts and
profiles without a usable name or email are excluded. Missing directory mappings
and missing profiles are treated as unavailable, without returning raw IDs as
fallback names. Deleted spaces are unavailable; archived spaces remain readable.

| HTTP status | Meaning |
| --- | --- |
| `400` | Invalid parameters. |
| `401` | Authentication required. |
| `403` | Space access denied or caller membership removed. |
| `404` | Space unavailable, or target is unavailable/outside this space. |
| `503` | Membership, ID mapping or user directory lookup failed. |

Target lookup uses the same `404` for non-members, missing and inactive accounts.
Provider errors are not exposed to the client. Directory failures return `503`
rather than an empty successful result or a partial member list. Membership/profile
retrieval respects request cancellation and a 15-second deadline. Permission
checks use the existing server permission client.

Responses include `Cache-Control: private, no-store`. If the application uses an
in-memory cache, key it by caller/session + space ID + user ID, use a short TTL,
and clear it on sign-out, space switching and known membership changes.

## Editor integration

The application adapter is `ui/app/core/http/mentionApiHandler.ts`.
`TipTap` memoizes it by space ID and supplies it to both editable and read-only
`Editor` instances. Editor instances are keyed by space, page, and mode so a
schema/handler from a previous context cannot be retained. Requests use the
application fetch transport with browser cookies or the desktop bearer
interceptor, configured API base URLs, and `cache: no-store`.


Bind the current space into the application's handler. Map search `data.users`
to `searchUsers`, and detail `data` to `resolveUser`. Map only a detail `404` to
`null`; propagate other failures. The same detail endpoint supplies the optional
`getUserDetails` hover callback. No authentication or application routes belong
inside the reusable editor package.

Keep only `{ id, label }` in persisted mention nodes. Display stored labels when a
user cannot be resolved. A mention does not grant document access or send a
notification. These read APIs do not validate mention IDs in document writes;
that requires separate integration with the document save/publish path.

## Implementation notes

Membership comes from current space relationship tuples, following continuation
tokens and combining duplicate roles by precedence. Only those Beskar IDs are
mapped to directory IDs. Profile retrieval uses bounded ID batches and follows
all provider pages, avoiding the legacy member-list lookup's ten-profile cap.
No database migration or new configuration is needed. Existing Permify,
PostgreSQL and Zitadel credentials must be available.

The provider field contract is described in the
[Zitadel Search Users API](https://zitadel.com/docs/reference/api/user/zitadel.user.v2.UserService.ListUsers).

## Notifications on publication

Publishing a document or publishing an update queues email and in-app notifications
for users newly mentioned compared with the previous **published** version.
Draft autosaves never queue notifications or change that baseline. Repeated
mentions of the same user produce one notification per channel per publication;
unchanged mentions and self mentions are skipped. Removing a mention in a
published version and adding it again in a later publication notifies again.

Recipients must still be active human members of the document's space and have
page view permission. IDs are resolved through the space membership directory;
client labels and email addresses are never used as notification destinations.
The actor comes from authentication. Both notifications link to
`/space/{spaceId}/view/{pageId}`, including read-only document views.

The server locks the space and page before reading the published baseline.
Notification definitions and document content commit in the same transaction.
A directory/permission/outbox failure rolls the publication back so it can be
retried. Concurrent or repeated publication requests cannot notify for unchanged
mentions. Delivery is asynchronous through notification v2; existing preferences,
quiet hours, email verification, suppression and retry policies apply. The worker
rechecks the page's space, deletion state and recipient access before either
channel is delivered; revoked access suppresses the queued notification.

Deployment requires the `notifications_document_mentions.xml` migration (included
in `db/beskar/update.xml`), enabled v2 scheduler, expander and both delivery loops,
an event route for email and in-app, configured SMTP provider, and the shared
destination hash key. Set `EMAIL_APP_BASE_URL` (or `PUBLIC_BASE_URL`) to the public
application URL for email links. Enable `NOTIFICATION_V2_SCHEDULER_ENABLED`,
`NOTIFICATION_V2_EXPANDER_ENABLED`, `NOTIFICATION_V2_DELIVERY_EMAIL_ENABLED`,
`NOTIFICATION_V2_DELIVERY_IN_APP_ENABLED`, and `NOTIFICATION_V2_RECOVERY_ENABLED`.
Bind `NOTIFICATION_V2_SMTP_PROVIDER_ID` to the email route provider and configure
`NOTIFICATION_V2_DESTINATION_HASH_KEY` with a shared base64 secret containing at
least 32 decoded bytes. Topic `document_mention` is ID 20 with immutable version-1
templates for both channels.

Verification uses `go test ./editor ./space ./notificationv2 ./notification ./core`.
Set `EDITOR_MENTIONS_TEST_DSN` to an isolated `editor_mentions_test` PostgreSQL
database to exercise published/draft baselines and concurrent publication locks.
Set `NOTIFICATION_V2_TEST_DSN` to an isolated `notification_v2_test` PostgreSQL
database, with Liquibase on PATH, to apply notification migrations and exercise
queue → scheduler → audience expansion → email/in-app delivery. Those opt-in tests
create/drop their fixtures and must only target disposable databases. The email
transport is a test double; they do not send real email.
