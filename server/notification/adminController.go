package notification

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type AdminController struct {
	pool   queryPool
	config Config
}

type queryPool interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func NewAdminController(config Config) *AdminController {
	return &AdminController{pool: core.GetPool(), config: config}
}

func (a *AdminController) Router() *chi.Mux {
	r := chi.NewRouter()
	r.Get("/messages", a.listMessages)
	r.Get("/messages/{messageId}", a.getMessage)
	r.Post("/messages/{messageId}/requeue", a.requeueMessage)
	return r
}

func (a *AdminController) ensureEnabled(w http.ResponseWriter, r *http.Request) bool {
	if !a.config.AdminEnabled || a.config.AdminToken == "" {
		core.SendFailedReponse(w, r, http.StatusNotFound, "email admin routes are disabled")
		return false
	}
	if r.Header.Get("X-Email-Admin-Token") != a.config.AdminToken {
		core.SendFailedReponse(w, r, http.StatusForbidden, "email admin access denied")
		return false
	}
	return true
}

func (a *AdminController) listMessages(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	status := r.URL.Query().Get("status")
	limit := 50
	if parsed, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && parsed > 0 && parsed <= 200 {
		limit = parsed
	}

	rows, err := a.pool.Query(r.Context(), listEmailMessages, status, limit)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "unable to list email messages")
		return
	}
	defer rows.Close()

	messages := []EmailMessageSummary{}
	for rows.Next() {
		summary, err := scanEmailMessageSummary(rows)
		if err != nil {
			core.SendFailedReponse(w, r, http.StatusInternalServerError, "unable to read email messages")
			return
		}
		summary.RecipientEmail = redactEmail(summary.RecipientEmail)
		messages = append(messages, summary)
	}
	if err := rows.Err(); err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "unable to list email messages")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, messages)
}

func (a *AdminController) getMessage(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "messageId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "invalid message id")
		return
	}

	summary, err := a.loadMessage(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			core.SendFailedReponse(w, r, http.StatusNotFound, "email message not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "unable to get email message")
		return
	}
	summary.RecipientEmail = redactEmail(summary.RecipientEmail)
	core.SendSuccessResponse(w, r, http.StatusOK, summary)
}

func (a *AdminController) requeueMessage(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "messageId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "invalid message id")
		return
	}

	var updated uuid.UUID
	err = a.pool.QueryRow(r.Context(), requeueEmailMessage, id).Scan(&updated)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			core.SendFailedReponse(w, r, http.StatusConflict, "email message cannot be requeued")
			return
		}
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "unable to requeue email message")
		return
	}
	summary, err := a.loadMessage(r.Context(), updated)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "unable to get requeued email message")
		return
	}
	summary.RecipientEmail = redactEmail(summary.RecipientEmail)
	core.SendSuccessResponse(w, r, http.StatusOK, summary)
}

func (a *AdminController) loadMessage(ctx context.Context, id uuid.UUID) (EmailMessageSummary, error) {
	summary, err := scanEmailMessageSummary(a.pool.QueryRow(ctx, getEmailMessageSummary, id))
	if err != nil {
		return summary, err
	}
	rows, err := a.pool.Query(ctx, listDeliveryAttempts, id)
	if err != nil {
		return summary, err
	}
	defer rows.Close()
	attempts := []EmailDeliveryAttempt{}
	for rows.Next() {
		var attempt EmailDeliveryAttempt
		if err := rows.Scan(
			&attempt.ID,
			&attempt.EmailMessageID,
			&attempt.AttemptNumber,
			&attempt.Provider,
			&attempt.Status,
			&attempt.StartedAt,
			&attempt.FinishedAt,
			&attempt.ProviderMessageID,
			&attempt.ErrorCode,
			&attempt.ErrorMessage,
		); err != nil {
			return summary, err
		}
		attempts = append(attempts, attempt)
	}
	if err := rows.Err(); err != nil {
		return summary, err
	}
	summary.DeliveryAttempts = attempts
	return summary, nil
}

func scanEmailMessageSummary(row pgx.Row) (EmailMessageSummary, error) {
	var summary EmailMessageSummary
	err := row.Scan(
		&summary.ID,
		&summary.MessageKey,
		&summary.Category,
		&summary.TemplateKey,
		&summary.RecipientUserID,
		&summary.RecipientEmail,
		&summary.Status,
		&summary.AttemptCount,
		&summary.NextAttemptAt,
		&summary.LastAttemptAt,
		&summary.SentAt,
		&summary.FailedAt,
		&summary.DeadLetteredAt,
		&summary.LastErrorCode,
		&summary.LastErrorMessage,
		&summary.CreatedAt,
		&summary.UpdatedAt,
	)
	return summary, err
}

func redactEmail(email string) string {
	normalized := NormalizeEmail(email)
	hash := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(hash[:])[:12]
}
