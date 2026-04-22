package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
}

func NewService() *Service {
	return &Service{pool: core.GetPool()}
}

func NewServiceWithPool(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) EnqueueEmail(ctx context.Context, req EnqueueEmailRequest) (uuid.UUID, error) {
	req, err := validateEnqueueRequest(req)
	if err != nil {
		return uuid.Nil, err
	}

	payload, err := json.Marshal(req.TemplateData)
	if err != nil {
		return uuid.Nil, fmt.Errorf("marshal template data: %w", err)
	}

	scheduledAt := time.Now()
	if req.ScheduledAt != nil {
		scheduledAt = *req.ScheduledAt
	}

	var recipientUserID any
	if req.Recipient.UserID != nil {
		recipientUserID = *req.Recipient.UserID
	}

	var id uuid.UUID
	err = s.pool.QueryRow(ctx, insertEmailMessage,
		req.MessageKey,
		req.Category,
		req.TemplateKey,
		recipientUserID,
		req.Recipient.Email,
		req.Recipient.Name,
		string(payload),
		req.Priority,
		StatusPending,
		scheduledAt,
	).Scan(&id)
	if err != nil {
		return uuid.Nil, err
	}

	return id, nil
}
