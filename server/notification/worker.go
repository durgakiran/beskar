package notification

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type Worker struct {
	pool      *pgxpool.Pool
	config    Config
	templates *TemplateRegistry
	provider  EmailProvider
	logger    *zap.Logger
}

func NewWorker(config Config) *Worker {
	provider := EmailProvider(disabledProvider{})
	if config.NotificationsEnabled && config.Provider == "smtp" {
		provider = NewSMTPProvider(config)
	}
	return NewWorkerWithDependencies(core.GetPool(), config, NewTemplateRegistry(), provider, core.Logger)
}

func NewWorkerWithDependencies(pool *pgxpool.Pool, config Config, templates *TemplateRegistry, provider EmailProvider, logger *zap.Logger) *Worker {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Worker{
		pool:      pool,
		config:    config,
		templates: templates,
		provider:  provider,
		logger:    logger,
	}
}

func (w *Worker) Start(ctx context.Context) {
	if !w.config.WorkerEnabled {
		return
	}
	interval := w.config.WorkerPollInterval
	if interval <= 0 {
		interval = 10 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		default:
			w.ProcessBatch(ctx)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (w *Worker) ProcessBatch(ctx context.Context) {
	batchSize := w.config.WorkerBatchSize
	if batchSize <= 0 {
		batchSize = 25
	}
	messages, err := w.claimDueMessages(ctx, batchSize)
	if err != nil {
		w.logger.Error("email worker claim failed", zap.Error(err))
		return
	}
	for _, message := range messages {
		if err := w.processMessage(ctx, message); err != nil {
			w.logger.Error("email worker process failed", zap.String("message_key", message.MessageKey), zap.Error(err))
		}
	}
}

func (w *Worker) claimDueMessages(ctx context.Context, limit int) ([]EmailMessage, error) {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, claimDueEmailMessages, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := make([]EmailMessage, 0)
	for rows.Next() {
		message, err := scanEmailMessage(rows)
		if err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return messages, nil
}

func (w *Worker) processMessage(ctx context.Context, message EmailMessage) error {
	if !w.config.NotificationsEnabled {
		return w.markSkipped(ctx, message.ID, "email_disabled", "email notifications are disabled")
	}

	suppressed, err := w.isSuppressed(ctx, message.RecipientEmail)
	if err != nil {
		return err
	}
	if suppressed {
		return w.markSuppressed(ctx, message.ID, "email_suppressed", "recipient email is suppressed")
	}

	enabled, err := w.preferenceEnabled(ctx, message)
	if err != nil {
		return err
	}
	if !enabled {
		return w.markSuppressed(ctx, message.ID, "preference_disabled", "recipient email preference is disabled")
	}

	rendered, err := w.templates.Render(message.TemplateKey, message.TemplateData)
	if err != nil {
		return w.markFailed(ctx, message, 0, "template_render_failed", providerErrorMessage(err))
	}
	if err := w.updateRendered(ctx, message.ID, rendered); err != nil {
		return err
	}

	attemptNumber := message.AttemptCount + 1
	attemptID, err := w.createAttempt(ctx, message.ID, attemptNumber)
	if err != nil {
		return err
	}

	outbound := OutboundEmail{
		FromAddress: w.config.FromAddress,
		FromName:    w.config.FromName,
		ToAddress:   message.RecipientEmail,
		Subject:     rendered.Subject,
		TextBody:    rendered.Text,
		HTMLBody:    rendered.HTML,
	}
	if message.RecipientName != nil {
		outbound.ToName = *message.RecipientName
	}

	result, err := w.provider.Send(ctx, outbound)
	if err == nil {
		if finishErr := w.finishAttempt(ctx, attemptID, StatusSent, result.MessageID, "", ""); finishErr != nil {
			return finishErr
		}
		return w.markSent(ctx, message.ID, attemptNumber, w.provider.Name(), result.MessageID)
	}

	code := providerErrorCode(err)
	messageText := providerErrorMessage(err)
	if finishErr := w.finishAttempt(ctx, attemptID, StatusFailed, "", code, messageText); finishErr != nil {
		return finishErr
	}

	if providerErrorKind(err) == ProviderErrorPermanent {
		return w.markFailed(ctx, message, attemptNumber, code, messageText)
	}
	if attemptNumber >= w.maxAttempts() {
		return w.markDeadLettered(ctx, message, attemptNumber, code, messageText)
	}
	nextAttempt := time.Now().Add(retryDelay(attemptNumber, w.config.RetryInitialDelay, w.config.RetryMaxDelay))
	return w.markRetrying(ctx, message.ID, attemptNumber, nextAttempt, w.provider.Name(), code, messageText)
}

func scanEmailMessage(row pgx.Row) (EmailMessage, error) {
	var message EmailMessage
	var templateData []byte
	err := row.Scan(
		&message.ID,
		&message.MessageKey,
		&message.Category,
		&message.TemplateKey,
		&message.TemplateVersion,
		&message.RecipientUserID,
		&message.RecipientEmail,
		&message.RecipientName,
		&message.Subject,
		&message.TextBody,
		&message.HTMLBody,
		&templateData,
		&message.Priority,
		&message.Status,
		&message.AttemptCount,
		&message.ScheduledAt,
		&message.NextAttemptAt,
		&message.LastAttemptAt,
		&message.SentAt,
		&message.FailedAt,
		&message.DeadLetteredAt,
		&message.Provider,
		&message.ProviderMessageID,
		&message.LastErrorCode,
		&message.LastErrorMessage,
		&message.CreatedAt,
		&message.UpdatedAt,
	)
	if err != nil {
		return message, err
	}
	message.TemplateData = map[string]any{}
	if len(templateData) > 0 {
		if err := json.Unmarshal(templateData, &message.TemplateData); err != nil {
			return message, err
		}
	}
	return message, nil
}

func (w *Worker) isSuppressed(ctx context.Context, email string) (bool, error) {
	var suppressed bool
	err := w.pool.QueryRow(ctx, checkEmailSuppression, NormalizeEmail(email)).Scan(&suppressed)
	return suppressed, err
}

func (w *Worker) preferenceEnabled(ctx context.Context, message EmailMessage) (bool, error) {
	if message.RecipientUserID == nil {
		return true, nil
	}
	var enabled bool
	err := w.pool.QueryRow(ctx, checkEmailPreference, *message.RecipientUserID, message.Category).Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil
	}
	return enabled, err
}

func (w *Worker) updateRendered(ctx context.Context, id uuid.UUID, rendered RenderedEmail) error {
	_, err := w.pool.Exec(ctx, updateRenderedEmailMessage, id, rendered.Subject, rendered.Text, rendered.HTML)
	return err
}

func (w *Worker) createAttempt(ctx context.Context, messageID uuid.UUID, attemptNumber int) (uuid.UUID, error) {
	var attemptID uuid.UUID
	err := w.pool.QueryRow(ctx, insertDeliveryAttempt, messageID, attemptNumber, w.provider.Name()).Scan(&attemptID)
	return attemptID, err
}

func (w *Worker) finishAttempt(ctx context.Context, attemptID uuid.UUID, status string, providerMessageID string, code string, message string) error {
	_, err := w.pool.Exec(ctx, finishDeliveryAttempt, attemptID, status, nullString(providerMessageID), nullString(code), nullString(message))
	return err
}

func (w *Worker) markSent(ctx context.Context, id uuid.UUID, attemptNumber int, provider string, providerMessageID string) error {
	_, err := w.pool.Exec(ctx, markEmailSent, id, attemptNumber, provider, providerMessageID)
	return err
}

func (w *Worker) markRetrying(ctx context.Context, id uuid.UUID, attemptNumber int, nextAttempt time.Time, provider string, code string, message string) error {
	_, err := w.pool.Exec(ctx, markEmailRetrying, id, attemptNumber, nextAttempt, provider, code, message)
	return err
}

func (w *Worker) markFailed(ctx context.Context, message EmailMessage, attemptNumber int, code string, messageText string) error {
	if attemptNumber == 0 {
		attemptNumber = message.AttemptCount
	}
	_, err := w.pool.Exec(ctx, markEmailFailed, message.ID, attemptNumber, w.provider.Name(), code, messageText)
	return err
}

func (w *Worker) markDeadLettered(ctx context.Context, message EmailMessage, attemptNumber int, code string, messageText string) error {
	_, err := w.pool.Exec(ctx, markEmailDeadLettered, message.ID, attemptNumber, w.provider.Name(), code, messageText)
	return err
}

func (w *Worker) markSuppressed(ctx context.Context, id uuid.UUID, code string, message string) error {
	_, err := w.pool.Exec(ctx, markEmailSuppressed, id, code, message)
	return err
}

func (w *Worker) markSkipped(ctx context.Context, id uuid.UUID, code string, message string) error {
	_, err := w.pool.Exec(ctx, markEmailSkipped, id, code, message)
	return err
}

func (w *Worker) maxAttempts() int {
	if w.config.MaxAttempts <= 0 {
		return 10
	}
	return w.config.MaxAttempts
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
