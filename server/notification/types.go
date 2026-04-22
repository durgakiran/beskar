package notification

import (
	"context"
	"time"

	"github.com/google/uuid"
)

const (
	StatusPending      = "pending"
	StatusProcessing   = "processing"
	StatusRetrying     = "retrying"
	StatusSent         = "sent"
	StatusFailed       = "failed"
	StatusDeadLettered = "dead_lettered"
	StatusSuppressed   = "suppressed"
	StatusSkipped      = "skipped"

	PriorityNormal = "normal"
)

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

type EmailMessage struct {
	ID                uuid.UUID
	MessageKey        string
	Category          string
	TemplateKey       string
	TemplateVersion   *string
	RecipientUserID   *uuid.UUID
	RecipientEmail    string
	RecipientName     *string
	Subject           *string
	TextBody          *string
	HTMLBody          *string
	TemplateData      map[string]any
	Priority          string
	Status            string
	AttemptCount      int
	ScheduledAt       time.Time
	NextAttemptAt     time.Time
	LastAttemptAt     *time.Time
	SentAt            *time.Time
	FailedAt          *time.Time
	DeadLetteredAt    *time.Time
	Provider          *string
	ProviderMessageID *string
	LastErrorCode     *string
	LastErrorMessage  *string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type EmailDeliveryAttempt struct {
	ID                uuid.UUID  `json:"id"`
	EmailMessageID    uuid.UUID  `json:"emailMessageId"`
	AttemptNumber     int        `json:"attemptNumber"`
	Provider          string     `json:"provider"`
	Status            string     `json:"status"`
	StartedAt         time.Time  `json:"startedAt"`
	FinishedAt        *time.Time `json:"finishedAt,omitempty"`
	ProviderMessageID *string    `json:"providerMessageId,omitempty"`
	ErrorCode         *string    `json:"errorCode,omitempty"`
	ErrorMessage      *string    `json:"errorMessage,omitempty"`
}

type EmailMessageSummary struct {
	ID               uuid.UUID              `json:"id"`
	MessageKey       string                 `json:"messageKey"`
	Category         string                 `json:"category"`
	TemplateKey      string                 `json:"templateKey"`
	RecipientUserID  *uuid.UUID             `json:"recipientUserId,omitempty"`
	RecipientEmail   string                 `json:"recipientEmail"`
	Status           string                 `json:"status"`
	AttemptCount     int                    `json:"attemptCount"`
	NextAttemptAt    time.Time              `json:"nextAttemptAt"`
	LastAttemptAt    *time.Time             `json:"lastAttemptAt,omitempty"`
	SentAt           *time.Time             `json:"sentAt,omitempty"`
	FailedAt         *time.Time             `json:"failedAt,omitempty"`
	DeadLetteredAt   *time.Time             `json:"deadLetteredAt,omitempty"`
	LastErrorCode    *string                `json:"lastErrorCode,omitempty"`
	LastErrorMessage *string                `json:"lastErrorMessage,omitempty"`
	CreatedAt        time.Time              `json:"createdAt"`
	UpdatedAt        time.Time              `json:"updatedAt"`
	DeliveryAttempts []EmailDeliveryAttempt `json:"deliveryAttempts,omitempty"`
}
