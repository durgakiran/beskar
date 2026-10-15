package notificationv2

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// Error describes a validation, authorization, or lifecycle error for HTTP and Go callers.
type Error struct {
	Status  int
	Message string
}

type apiError = Error

func (e *Error) Error() string      { return e.Message }
func invalid(message string) error  { return &apiError{http.StatusUnprocessableEntity, message} }
func conflict(message string) error { return &apiError{http.StatusConflict, message} }

var notFound = &apiError{http.StatusNotFound, "notification definition not found"}

type Producer struct {
	Source  string
	ActorID uuid.UUID
}

type DefinitionInput struct {
	NotificationTopicID int16           `json:"notification_topic_id"`
	CorrelationID       *string         `json:"correlation_id"`
	NotificationTypeID  int16           `json:"notification_type_id"`
	ModeID              int16           `json:"mode_id"`
	TemplateID          uuid.UUID       `json:"template_id"`
	TemplateVersion     int             `json:"template_version"`
	MessageDetails      json.RawMessage `json:"message_details"`
	Priority            int16           `json:"priority"`
	ScheduleKind        string          `json:"schedule_kind"`
	ScheduledAt         *time.Time      `json:"scheduled_at"`
	CronExpression      *string         `json:"cron_expression"`
	Timezone            string          `json:"timezone"`
	StartsAt            *time.Time      `json:"starts_at"`
	EndsAt              *time.Time      `json:"ends_at"`
	MisfirePolicy       string          `json:"misfire_policy"`
	DeliveryTTLSeconds  *int            `json:"delivery_ttl_seconds"`
	TargetUsers         []uuid.UUID     `json:"target_users"`
	TargetSegments      []uuid.UUID     `json:"target_segments"`
	TargetEmails        []string        `json:"target_emails"`
}

type Definition struct {
	DefinitionInput
	ID             uuid.UUID  `json:"id"`
	SourceService  string     `json:"source_service"`
	IdempotencyKey string     `json:"idempotency_key"`
	RequestHash    string     `json:"-"`
	NextRunAt      *time.Time `json:"next_run_at"`
	Status         string     `json:"status"`
	Revision       int64      `json:"revision"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	CreatedBy      uuid.UUID  `json:"created_by"`
	UpdatedBy      uuid.UUID  `json:"updated_by"`
	DeletedAt      *time.Time `json:"deleted_at"`
}

type ListResult struct {
	Items      []Definition `json:"items"`
	NextCursor string       `json:"next_cursor,omitempty"`
}
