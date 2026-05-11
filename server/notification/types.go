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

const (
	ChannelInApp = "in_app"

	NotificationTypeSpaceInviteCreated        = "space_invite_created"
	NotificationTypeSpaceInviteAccepted       = "space_invite_accepted"
	NotificationTypeSpaceInviteDeclined       = "space_invite_declined"
	NotificationTypeSpaceMemberAdded          = "space_member_added"
	NotificationTypeSpaceMemberRemoved        = "space_member_removed"
	NotificationTypeSpaceMemberRoleChanged    = "space_member_role_changed"
	NotificationTypeSpaceOwnershipTransferred = "space_ownership_transferred"
	NotificationTypeSpaceArchived             = "space_archived"
	NotificationTypeSpaceUnarchived           = "space_unarchived"
	NotificationTypeSpaceDeleted              = "space_deleted"

	NotificationCategorySpaceInvite     = "space_invite"
	NotificationCategorySpaceMembership = "space_membership"
	NotificationCategorySpaceSecurity   = "space_security"
	NotificationCategorySpaceLifecycle  = "space_lifecycle"

	NotificationTargetInvite  = "invite"
	NotificationTargetSpace   = "space"
	NotificationTargetAccount = "account"
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

type NotificationActor struct {
	UserID uuid.UUID `json:"userId"`
	Name   string    `json:"name"`
	Email  string    `json:"email,omitempty"`
}

type NotificationTarget struct {
	Type    string     `json:"type"`
	ID      string     `json:"id"`
	SpaceID *uuid.UUID `json:"spaceId,omitempty"`
	PageID  *int64     `json:"pageId,omitempty"`
}

type NotificationRecipient struct {
	UserID *uuid.UUID `json:"userId,omitempty"`
	Email  string     `json:"email,omitempty"`
	Name   string     `json:"name,omitempty"`
}

type NotificationAction struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Method string `json:"method"`
	URL    string `json:"url"`
}

type EmitNotificationRequest struct {
	EventKey       string                  `json:"eventKey"`
	Type           string                  `json:"type"`
	Category       string                  `json:"category"`
	Actor          NotificationActor       `json:"actor"`
	Recipients     []NotificationRecipient `json:"recipients"`
	Target         NotificationTarget      `json:"target"`
	Title          string                  `json:"title"`
	Body           string                  `json:"body"`
	Data           map[string]any          `json:"data"`
	Actions        []NotificationAction    `json:"actions"`
	Channels       []string                `json:"channels"`
	ActionRequired bool                    `json:"actionRequired"`
	ActorVisible   bool                    `json:"actorVisible"`
	CreatedAt      *time.Time              `json:"createdAt"`
	ExpiresAt      *time.Time              `json:"expiresAt"`
}

type NotificationEvent struct {
	ID          uuid.UUID          `json:"id"`
	EventKey    string             `json:"eventKey"`
	Type        string             `json:"type"`
	Category    string             `json:"category"`
	ActorUserID *uuid.UUID         `json:"actorUserId,omitempty"`
	Target      NotificationTarget `json:"target"`
	Data        map[string]any     `json:"data"`
	CreatedAt   time.Time          `json:"createdAt"`
}

type InAppNotification struct {
	ID             uuid.UUID            `json:"id"`
	Type           string               `json:"type"`
	Category       string               `json:"category"`
	Title          string               `json:"title"`
	Body           string               `json:"body,omitempty"`
	Actor          *NotificationActor   `json:"actor,omitempty"`
	Target         NotificationTarget   `json:"target"`
	ActionRequired bool                 `json:"actionRequired"`
	Actions        []NotificationAction `json:"actions"`
	Data           map[string]any       `json:"data"`
	ReadAt         *time.Time           `json:"readAt,omitempty"`
	DismissedAt    *time.Time           `json:"dismissedAt,omitempty"`
	ResolvedAt     *time.Time           `json:"resolvedAt,omitempty"`
	ExpiresAt      *time.Time           `json:"expiresAt,omitempty"`
	CreatedAt      time.Time            `json:"createdAt"`
	UpdatedAt      time.Time            `json:"updatedAt"`
}

type NotificationFeedResponse struct {
	Items      []InAppNotification `json:"items"`
	NextCursor string              `json:"nextCursor,omitempty"`
}

type NotificationUnreadCount struct {
	Total          int `json:"total"`
	Unread         int `json:"unread"`
	ActionRequired int `json:"actionRequired"`
}

type MarkNotificationsReadRequest struct {
	NotificationIDs []uuid.UUID `json:"notificationIds"`
}

type MarkAllNotificationsReadRequest struct {
	Category *string `json:"category"`
}
