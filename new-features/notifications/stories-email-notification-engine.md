# Stories And Tasks: Email Notification Engine

## Scope

This document breaks `req-email-notification-engine.md` into implementation stories. It covers the reusable backend email engine only:

- Email queue schema.
- Internal Go API.
- Template rendering.
- SMTP provider.
- Worker processing.
- Retry and dead-letter handling.
- Operator/debug endpoints.
- Configuration and tests.

It does not implement product triggers. Trigger integration is covered in `req-trigger-integration.md`.

## Implementation Order

| Phase | Story | Outcome |
|---|---|---|
| 1 | Database schema | Queue, attempts, preferences, and suppressions tables exist. |
| 2 | Core package contract | Backend code can enqueue idempotent email jobs. |
| 3 | Templates | Engine can render safe text/HTML templates. |
| 4 | SMTP provider | Engine can send through a provider abstraction. |
| 5 | Worker | Pending messages are claimed and processed asynchronously. |
| 6 | Retry and dead letter | Transient failures retry; exhausted jobs become dead-lettered. |
| 7 | Admin/debug APIs | Operators can inspect and requeue failed jobs. |
| 8 | Configuration/docs/tests | Environment config, test coverage, and docs are complete. |

## Story 1: Add Email Notification Schema

As a backend developer, I need durable tables for queued emails and delivery attempts so email delivery can survive restarts and provider failures.

### Detailed Changes

Add a new Liquibase changeset file:

- `db/beskar/updates/email_notifications.xml`

Update root changelog:

- `db/beskar/update.xml`
  - Include `updates/email_notifications.xml` after `updates/notifications.xml`.

Create tables:

- `notifications.email_messages`
- `notifications.email_delivery_attempts`
- `notifications.email_preferences`
- `notifications.email_suppressions`

Add indexes:

- `idx_email_messages_worker_lookup` on `(status, next_attempt_at, priority)`.
- `idx_email_messages_recipient_user_created_at` on `(recipient_user_id, created_at DESC)`.
- `idx_email_messages_recipient_email_created_at` on `(recipient_email, created_at DESC)`.
- `idx_email_delivery_attempts_message_attempt` on `(email_message_id, attempt_number DESC)`.

Add grants for `${app_user}`:

- `SELECT`, `INSERT`, `UPDATE`, `DELETE` on all new tables.
- Any sequence privileges if needed.

### Acceptance Criteria

- Liquibase creates all four tables in the `notifications` schema.
- `message_key` is unique.
- `recipient_user_id` is nullable.
- `recipient_email` is required.
- App user can read/write the new tables.

### Tests / Verification

- Run the database migration in local dev.
- Verify table definitions with `information_schema`.
- Verify duplicate `message_key` is rejected by the database.

## Story 2: Add Notification Package And Types

As backend code, I need a small internal API to enqueue emails without knowing how delivery works.

### Detailed Changes

Create package:

- `server/notification/`

Add files:

- `server/notification/types.go`
- `server/notification/service.go`
- `server/notification/queries.go`
- `server/notification/validations.go`

Types:

```go
type EmailRecipient struct {
    UserID *uuid.UUID
    Email  string
    Name   string
}

type EnqueueEmailRequest struct {
    MessageKey   string
    Category     string
    TemplateKey  string
    Recipient    EmailRecipient
    TemplateData map[string]any
    Priority     string
    ScheduledAt  *time.Time
}

type EmailEngine interface {
    EnqueueEmail(ctx context.Context, req EnqueueEmailRequest) (uuid.UUID, error)
}
```

Validation:

- `message_key` required.
- `category` required.
- `template_key` required.
- `recipient.email` required and normalized.
- `priority` defaults to `normal`.
- `scheduled_at` defaults to `now()`.
- `template_data` defaults to empty object.

Service behavior:

- Insert into `notifications.email_messages`.
- Use `ON CONFLICT (message_key) DO UPDATE` or equivalent to return the existing id.
- Do not call SMTP, identity APIs, or permission APIs.

### Acceptance Criteria

- `EnqueueEmail` creates one pending message.
- Calling `EnqueueEmail` twice with the same `message_key` returns the same message id.
- Unknown recipients are accepted with `recipient_user_id = NULL`.
- Invalid email input is rejected before DB insert.

### Tests / Verification

Add tests:

- `server/notification/service_test.go`

Test cases:

- Enqueue known user recipient.
- Enqueue unknown email recipient.
- Duplicate message key idempotency.
- Missing message key.
- Invalid email.
- Default priority and scheduled time.

## Story 3: Add Template Registry And Renderer

As the engine, I need to render safe email content from code-defined templates.

### Detailed Changes

Add files:

- `server/notification/templates.go`
- `server/notification/template_space_invite.go`
- `server/notification/templates_test.go`

Template interface:

```go
type EmailTemplate interface {
    Key() string
    RequiredFields() []string
    Render(data map[string]any) (RenderedEmail, error)
}

type RenderedEmail struct {
    Subject string
    Text    string
    HTML    string
}
```

Initial template:

- `space_invite_created`

Required data fields:

- `space_name`
- `sender_name`
- `role`
- `accept_url`
- `reject_url`
- `app_url`

Rendering rules:

- Escape user-provided HTML.
- Return an error for missing required fields.
- Produce both text and HTML.
- Keep copy concise and product-neutral.
- Do not log tokenized URLs.

### Acceptance Criteria

- Template registry returns `space_invite_created`.
- Missing required fields fail rendering.
- HTML output escapes unsafe input.
- Text output has no HTML tags.

### Tests / Verification

Test cases:

- Successful render.
- Missing field.
- HTML escaping with malicious space or sender name.
- URLs are included in rendered output but not logged by renderer tests.

## Story 4: Add SMTP Provider Abstraction

As the engine, I need provider-specific email sending behind an interface so SMTP can be replaced later.

### Detailed Changes

Add files:

- `server/notification/provider.go`
- `server/notification/provider_smtp.go`
- `server/notification/config.go`

Provider interface:

```go
type EmailProvider interface {
    Name() string
    Send(ctx context.Context, msg OutboundEmail) (ProviderResult, error)
}
```

Types:

- `OutboundEmail`
- `ProviderResult`
- `ProviderError`

Provider error classification:

- `transient`
- `permanent`

SMTP config:

- `EMAIL_NOTIFICATIONS_ENABLED`
- `EMAIL_PROVIDER`
- `EMAIL_FROM_ADDRESS`
- `EMAIL_FROM_NAME`
- `EMAIL_APP_BASE_URL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `SMTP_USE_TLS`
- `SMTP_TIMEOUT_SECONDS`

Implementation notes:

- Use `github.com/wneessen/go-mail` for SMTP and MIME generation instead of `net/smtp`; `net/smtp` is frozen and does not provide higher-level multipart message support.
- Pin `go-mail` to `v0.6.2` while the backend remains on Go 1.23.x. Newer `go-mail` releases require Go 1.24+.
- Never log credentials.
- Add timeout handling.

### Acceptance Criteria

- SMTP provider builds an RFC-compatible message with text and HTML parts.
- Provider returns transient errors for timeout/network failures.
- Provider returns permanent errors for invalid recipient/provider permanent failures when detectable.
- Disabled email config prevents provider calls.

### Tests / Verification

Test with a fake provider:

- Successful send.
- Transient failure.
- Permanent failure.

For SMTP formatting:

- Unit test message construction without contacting a real SMTP server.

## Story 5: Add Email Worker Claim And Processing Loop

As the backend, I need an asynchronous worker that claims pending emails and sends them without blocking request handlers.

### Detailed Changes

Add files:

- `server/notification/worker.go`
- `server/notification/backoff.go`

Worker responsibilities:

- Poll for due messages.
- Claim with row locking, using `FOR UPDATE SKIP LOCKED`.
- Set status to `processing`.
- Render template.
- Check suppression.
- Check known-user email preference.
- Create `email_delivery_attempts` row.
- Call provider.
- Mark final state.

Worker configuration:

- poll interval
- batch size
- max attempts
- retry delay settings

Suggested env vars:

```env
EMAIL_WORKER_ENABLED=true
EMAIL_WORKER_POLL_INTERVAL_SECONDS=10
EMAIL_WORKER_BATCH_SIZE=25
EMAIL_MAX_ATTEMPTS=10
EMAIL_RETRY_INITIAL_SECONDS=30
EMAIL_RETRY_MAX_SECONDS=21600
```

Server integration:

- `server/main.go`
  - Initialize notification config.
  - Start worker only when `EMAIL_WORKER_ENABLED=true`.
  - Stop worker on context cancellation if graceful shutdown is added.

### Acceptance Criteria

- Worker claims only pending/retrying messages whose `next_attempt_at <= now()`.
- Multiple workers do not claim the same message.
- Successful send marks message `sent`.
- Attempt history is recorded.
- Worker does not start when disabled.

### Tests / Verification

Unit tests with fake provider:

- Pending message is sent.
- Future scheduled message is skipped.
- Two workers do not double-send the same message.
- Suppressed message is marked `suppressed`.
- Disabled email mode skips provider call.

## Story 6: Implement Retry And Dead-Letter Behavior

As an operator, I need failed email delivery to retry automatically and then become inspectable when exhausted.

### Detailed Changes

Backoff:

- Add exponential backoff with jitter in `server/notification/backoff.go`.
- Use configured max attempts and max delay.

Status transitions:

| Current | Condition | Next |
|---|---|---|
| `processing` | provider success | `sent` |
| `processing` | transient failure and attempts remain | `retrying` |
| `processing` | permanent failure | `failed` |
| `processing` | transient failure and max attempts reached | `dead_lettered` |
| `dead_lettered` | operator requeue | `pending` |

Persist:

- `attempt_count`
- `next_attempt_at`
- `last_attempt_at`
- `failed_at`
- `dead_lettered_at`
- `last_error_code`
- `last_error_message`

### Acceptance Criteria

- Transient failures retry with increasing delay.
- Max attempts mark the message `dead_lettered`.
- Permanent failures mark the message `failed`.
- Error details are redacted and stored.
- Dead-lettered messages are not retried until requeued.

### Tests / Verification

Test cases:

- First transient failure schedules retry.
- Retry delay does not exceed max.
- Exhausted transient failure becomes dead-lettered.
- Permanent provider error becomes failed.
- Backoff jitter stays in expected range.

## Story 7: Add Operator Debug And Requeue API

As an operator, I need to inspect failed email jobs and requeue them without direct database edits.

### Detailed Changes

Create an authenticated admin router:

- `server/notification/adminController.go`

Routes:

```http
GET  /api/v1/admin/email/messages?status=dead_lettered
GET  /api/v1/admin/email/messages/{messageId}
POST /api/v1/admin/email/messages/{messageId}/requeue
```

Server integration:

- `server/main.go`
  - Mount admin router behind authentication.

Authorization:

- V1 can restrict to an environment flag or a simple admin check if the app has one.
- If no admin role exists yet, document that routes stay disabled until an operator auth rule is defined.

Response data:

- message id
- message key
- category
- template key
- recipient user id if present
- redacted recipient email
- status
- attempt count
- timestamps
- last error code/message
- delivery attempts

Requeue behavior:

- Only `failed` and `dead_lettered` messages can be requeued.
- Set `status = 'pending'`.
- Clear `dead_lettered_at`.
- Set `next_attempt_at = now()`.
- Do not change `message_key`.
- Do not duplicate the row.

### Acceptance Criteria

- Operator can list dead-lettered messages.
- Operator can inspect one message with attempts.
- Requeue changes status back to `pending`.
- Requeue is idempotent and does not duplicate message rows.
- Non-operator users cannot access these routes.

### Tests / Verification

Add controller tests if current test setup supports HTTP handlers:

- List dead-lettered messages.
- Requeue dead-lettered message.
- Reject requeue of sent message.
- Unauthorized access is forbidden.

## Story 8: Add Configuration To Env And Deployment Docs

As deployer, I need all email engine settings documented and available in local and deploy env examples.

### Detailed Changes

Update env files:

- `server/.env.example`
- `.env.example`
- `docker/env/deploy.env.example`
- Optionally `docker/env/dev.env` with disabled defaults only.

Recommended defaults:

```env
EMAIL_NOTIFICATIONS_ENABLED=false
EMAIL_WORKER_ENABLED=false
EMAIL_ADMIN_ENABLED=false
EMAIL_ADMIN_TOKEN=
EMAIL_PROVIDER=smtp
EMAIL_FROM_ADDRESS=
EMAIL_FROM_NAME=Beskar
EMAIL_APP_BASE_URL=
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_USE_TLS=true
SMTP_TIMEOUT_SECONDS=10
EMAIL_WORKER_POLL_INTERVAL_SECONDS=10
EMAIL_WORKER_BATCH_SIZE=25
EMAIL_MAX_ATTEMPTS=10
EMAIL_RETRY_INITIAL_SECONDS=30
EMAIL_RETRY_MAX_SECONDS=21600
```

Update docs:

- `docker/README.md`
  - Add deployment notes for SMTP config.
  - Explain disabled-by-default behavior.

### Acceptance Criteria

- Email engine is disabled by default in examples.
- Deploy env example lists all required SMTP fields.
- Docs explain how to enable worker and provider.
- No real secrets are committed.

## Story 9: Add Engine Tests And Test Utilities

As a maintainer, I need focused tests that prove the engine is safe before product triggers use it.

### Detailed Changes

Add test helpers:

- fake provider
- test template
- helper to insert email messages
- helper to query message state

Recommended test files:

- `server/notification/service_test.go`
- `server/notification/templates_test.go`
- `server/notification/worker_test.go`
- `server/notification/backoff_test.go`
- `server/notification/adminController_test.go`

### Coverage Targets

| Area | Required Tests |
|---|---|
| Enqueue | known recipient, unknown recipient, duplicate key, validation errors |
| Templates | success, missing fields, escaping |
| Worker | send success, suppression, preference disabled, disabled provider |
| Retry | transient retry, max attempts, permanent failure |
| Admin | list, inspect, requeue, authorization |

### Acceptance Criteria

- `go test ./...` passes from `server/`.
- Tests do not contact a real SMTP server.
- Tests do not require external identity or permission services.

## Story 10: Integrate First Producer In A Separate Trigger Story

As the product, I need at least one real flow to use the engine, but that work should stay outside the engine implementation.

### Detailed Changes

Do not implement trigger code in this story file. Use:

- `req-trigger-integration.md`

First recommended trigger:

- Space invite created.

Reason:

- Existing invite flow already has `notifications.invites.email_id`.
- Unknown users require email to join.
- The trigger can validate the engine without committing to comments, mentions, page updates, or other future flows.

### Acceptance Criteria

- Engine can be merged and tested without any product trigger.
- Trigger integration can be reviewed independently.

## Implementation Checklist

- [ ] Add `email_notifications.xml` Liquibase changeset.
- [ ] Include new changeset in `db/beskar/update.xml`.
- [ ] Create `server/notification` package.
- [ ] Implement `EnqueueEmail`.
- [ ] Add template registry and `space_invite_created` template.
- [ ] Add provider abstraction and SMTP provider.
- [ ] Add worker claim/send loop.
- [ ] Add retry, backoff, and dead-letter transitions.
- [ ] Add suppression and known-user preference checks.
- [ ] Add operator debug/requeue routes or document why disabled.
- [ ] Add env vars and deployment docs.
- [ ] Add unit tests with fake provider.
- [ ] Run `go test ./...` in `server/`.

## Risks And Decisions

| Risk / Decision | Recommendation |
|---|---|
| SMTP library choice | Use `github.com/wneessen/go-mail` rather than `net/smtp`; pin `v0.6.2` until the backend toolchain moves to Go 1.24+. |
| Admin authorization | Use `EMAIL_ADMIN_TOKEN` for V1 operator access, then replace it with a proper app-admin role when available. |
| In-app notifications | Keep out of this engine. Add later as a separate notification feed requirement. |
| Preferences for unknown emails | Use suppressions only. User preferences require a known `recipient_user_id`. |
| Provider failure classification | Keep conservative defaults: network/timeout/429/5xx are transient; validation/recipient permanent failures are failed. |
| Worker startup in tests | Worker should be injectable and manually tickable so tests do not rely on sleeps. |
