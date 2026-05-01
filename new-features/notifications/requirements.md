# Requirements: Notifications

Notification work is split into two separate requirements so the backend can build the reusable delivery engine first and decide product triggers later.

## Documents

| Requirement | File | Purpose |
|---|---|---|
| Email notification engine | `req-email-notification-engine.md` | Build the reusable email queue, templates, retry/dead-letter handling, SMTP/provider adapter, and operational visibility. This document does not define product triggers. |
| Trigger integration | `req-trigger-integration.md` | Define how domain actions such as invites, membership changes, comments, or mentions should call the engine. This is intentionally separate because many triggers are not implemented yet or may not be needed in V1. |
| Invite email action UI flow | `plan-invite-email-action-flow.md` | Plan the app-based accept/reject flow for invite emails so email links open UI first instead of mutating invite state through direct API calls. |

## Recommended Build Order

1. Build the email notification engine.
2. Integrate one V1 trigger, preferably space invite email.
3. Add more triggers only when the product flow is implemented and the notification has clear user value.

## V1 Boundary

V1 should focus on a reliable backend email engine:

- Durable email queue.
- SMTP/provider configuration.
- Template rendering.
- Unknown-recipient email support.
- Retry and dead-letter handling.
- Idempotency.
- Observability and requeue tooling.

Product trigger selection is handled in `req-trigger-integration.md`.
