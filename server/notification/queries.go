package notification

const (
	insertEmailMessage = `INSERT INTO notifications.email_messages (
		message_key,
		category,
		template_key,
		recipient_user_id,
		recipient_email,
		recipient_name,
		template_data,
		priority,
		status,
		scheduled_at,
		next_attempt_at,
		created_at,
		updated_at
	) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $10, now(), now())
	ON CONFLICT (message_key) DO UPDATE SET message_key = EXCLUDED.message_key
	RETURNING id`

	claimDueEmailMessages = `WITH due AS (
		SELECT id
		FROM notifications.email_messages
		WHERE status IN ('pending', 'retrying')
			AND next_attempt_at <= now()
		ORDER BY priority DESC, next_attempt_at ASC, created_at ASC
		LIMIT $1
		FOR UPDATE SKIP LOCKED
	)
	UPDATE notifications.email_messages m
	SET status = 'processing', updated_at = now()
	FROM due
	WHERE m.id = due.id
	RETURNING
		m.id, m.message_key, m.category, m.template_key, m.template_version,
		m.recipient_user_id, m.recipient_email, m.recipient_name,
		m.subject, m.text_body, m.html_body, m.template_data,
		m.priority, m.status, m.attempt_count, m.scheduled_at, m.next_attempt_at,
		m.last_attempt_at, m.sent_at, m.failed_at, m.dead_lettered_at,
		m.provider, m.provider_message_id, m.last_error_code, m.last_error_message,
		m.created_at, m.updated_at`

	updateRenderedEmailMessage = `UPDATE notifications.email_messages
	SET subject = $2, text_body = $3, html_body = $4, updated_at = now()
	WHERE id = $1`

	checkEmailSuppression = `SELECT EXISTS (
		SELECT 1 FROM notifications.email_suppressions WHERE email = $1
	)`

	checkEmailPreference = `SELECT enabled
		FROM notifications.email_preferences
		WHERE recipient_user_id = $1 AND category = $2`

	insertDeliveryAttempt = `INSERT INTO notifications.email_delivery_attempts (
		email_message_id, attempt_number, provider, status, started_at
	) VALUES ($1, $2, $3, 'processing', now())
	RETURNING id`

	finishDeliveryAttempt = `UPDATE notifications.email_delivery_attempts
	SET status = $2,
		finished_at = now(),
		provider_message_id = $3,
		error_code = $4,
		error_message = $5
	WHERE id = $1`

	markEmailSent = `UPDATE notifications.email_messages
	SET status = 'sent',
		attempt_count = $2,
		last_attempt_at = now(),
		sent_at = now(),
		provider = $3,
		provider_message_id = $4,
		last_error_code = NULL,
		last_error_message = NULL,
		updated_at = now()
	WHERE id = $1`

	markEmailRetrying = `UPDATE notifications.email_messages
	SET status = 'retrying',
		attempt_count = $2,
		next_attempt_at = $3,
		last_attempt_at = now(),
		provider = $4,
		last_error_code = $5,
		last_error_message = $6,
		updated_at = now()
	WHERE id = $1`

	markEmailFailed = `UPDATE notifications.email_messages
	SET status = 'failed',
		attempt_count = $2,
		last_attempt_at = now(),
		failed_at = now(),
		provider = $3,
		last_error_code = $4,
		last_error_message = $5,
		updated_at = now()
	WHERE id = $1`

	markEmailDeadLettered = `UPDATE notifications.email_messages
	SET status = 'dead_lettered',
		attempt_count = $2,
		last_attempt_at = now(),
		dead_lettered_at = now(),
		provider = $3,
		last_error_code = $4,
		last_error_message = $5,
		updated_at = now()
	WHERE id = $1`

	markEmailSuppressed = `UPDATE notifications.email_messages
	SET status = 'suppressed',
		last_error_code = $2,
		last_error_message = $3,
		updated_at = now()
	WHERE id = $1`

	markEmailSkipped = `UPDATE notifications.email_messages
	SET status = 'skipped',
		last_error_code = $2,
		last_error_message = $3,
		updated_at = now()
	WHERE id = $1`

	listEmailMessages = `SELECT
		id, message_key, category, template_key, recipient_user_id, recipient_email,
		status, attempt_count, next_attempt_at, last_attempt_at, sent_at, failed_at,
		dead_lettered_at, last_error_code, last_error_message, created_at, updated_at
	FROM notifications.email_messages
	WHERE ($1 = '' OR status = $1)
	ORDER BY created_at DESC
	LIMIT $2`

	getEmailMessageSummary = `SELECT
		id, message_key, category, template_key, recipient_user_id, recipient_email,
		status, attempt_count, next_attempt_at, last_attempt_at, sent_at, failed_at,
		dead_lettered_at, last_error_code, last_error_message, created_at, updated_at
	FROM notifications.email_messages
	WHERE id = $1`

	listDeliveryAttempts = `SELECT
		id, email_message_id, attempt_number, provider, status, started_at, finished_at,
		provider_message_id, error_code, error_message
	FROM notifications.email_delivery_attempts
	WHERE email_message_id = $1
	ORDER BY attempt_number DESC`

	requeueEmailMessage = `UPDATE notifications.email_messages
	SET status = 'pending',
		next_attempt_at = now(),
		dead_lettered_at = NULL,
		failed_at = NULL,
		updated_at = now()
	WHERE id = $1 AND status IN ('failed', 'dead_lettered')
	RETURNING id`
)
