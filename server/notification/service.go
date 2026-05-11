package notification

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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

func (s *Service) Emit(ctx context.Context, req EmitNotificationRequest) error {
	req, err := validateEmitNotificationRequest(req)
	if err != nil {
		return err
	}

	createdAt := time.Now()
	if req.CreatedAt != nil {
		createdAt = *req.CreatedAt
	}

	eventData := cloneMap(req.Data)
	if req.Actor.Name != "" {
		eventData["actor_name"] = req.Actor.Name
	}

	eventPayload, err := json.Marshal(eventData)
	if err != nil {
		return fmt.Errorf("marshal notification event data: %w", err)
	}
	actionPayload, err := json.Marshal(req.Actions)
	if err != nil {
		return fmt.Errorf("marshal notification actions: %w", err)
	}
	rowPayload, err := json.Marshal(req.Data)
	if err != nil {
		return fmt.Errorf("marshal notification data: %w", err)
	}

	var actorUserID any
	if req.Actor.UserID != uuid.Nil {
		actorUserID = req.Actor.UserID
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var eventID uuid.UUID
	if err := tx.QueryRow(ctx, upsertNotificationEvent,
		req.EventKey,
		req.Type,
		req.Category,
		actorUserID,
		req.Target.Type,
		req.Target.ID,
		req.Target.SpaceID,
		req.Target.PageID,
		string(eventPayload),
		createdAt,
	).Scan(&eventID); err != nil {
		return err
	}

	for _, recipient := range req.Recipients {
		if recipient.UserID == nil {
			continue
		}
		if !req.ActorVisible && req.Actor.UserID != uuid.Nil && *recipient.UserID == req.Actor.UserID {
			continue
		}
		if _, err := tx.Exec(ctx, insertInAppNotification,
			eventID,
			*recipient.UserID,
			req.Type,
			req.Category,
			req.Title,
			req.Body,
			req.Target.Type,
			req.Target.ID,
			req.Target.SpaceID,
			req.Target.PageID,
			req.ActionRequired,
			string(actionPayload),
			string(rowPayload),
			req.ExpiresAt,
			createdAt,
		); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (s *Service) ResolveByEventKey(ctx context.Context, eventKey string, recipientUserID *uuid.UUID) error {
	eventKey = strings.TrimSpace(eventKey)
	if eventKey == "" {
		return errors.New("event key is required")
	}
	var recipient any
	if recipientUserID != nil {
		recipient = *recipientUserID
	}
	_, err := s.pool.Exec(ctx, resolveInAppNotificationByEventKey, eventKey, recipient)
	return err
}

func (s *Service) ListInAppNotifications(ctx context.Context, userID uuid.UUID, filter string, cursor string, limit int) (NotificationFeedResponse, error) {
	filter = normalizeNotificationFilter(filter)
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	var cursorCreatedAt any
	var cursorID any
	if strings.TrimSpace(cursor) != "" {
		createdAt, id, err := decodeNotificationCursor(cursor)
		if err != nil {
			return NotificationFeedResponse{}, err
		}
		cursorCreatedAt = createdAt
		cursorID = id
	}

	rows, err := s.pool.Query(ctx, listInAppNotifications, userID, filter, cursorCreatedAt, cursorID, limit+1)
	if err != nil {
		return NotificationFeedResponse{}, err
	}
	defer rows.Close()

	items := make([]InAppNotification, 0, limit)
	for rows.Next() {
		item, err := scanInAppNotification(rows)
		if err != nil {
			return NotificationFeedResponse{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return NotificationFeedResponse{}, err
	}

	resp := NotificationFeedResponse{Items: items}
	if len(resp.Items) > limit {
		next := resp.Items[limit-1]
		resp.NextCursor = encodeNotificationCursor(next.CreatedAt, next.ID)
		resp.Items = resp.Items[:limit]
	}
	return resp, nil
}

func (s *Service) CountInAppNotifications(ctx context.Context, userID uuid.UUID) (NotificationUnreadCount, error) {
	var count NotificationUnreadCount
	var total int64
	var unread int64
	var actionRequired int64
	err := s.pool.QueryRow(ctx, countInAppNotifications, userID).Scan(&total, &unread, &actionRequired)
	count.Total = int(total)
	count.Unread = int(unread)
	count.ActionRequired = int(actionRequired)
	return count, err
}

func (s *Service) MarkInAppNotificationsRead(ctx context.Context, userID uuid.UUID, ids []uuid.UUID) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := s.pool.Exec(ctx, markInAppNotificationsRead, userID, ids)
	return err
}

func (s *Service) MarkAllInAppNotificationsRead(ctx context.Context, userID uuid.UUID, category string) error {
	_, err := s.pool.Exec(ctx, markAllInAppNotificationsRead, userID, strings.TrimSpace(category))
	return err
}

func (s *Service) DismissInAppNotification(ctx context.Context, userID uuid.UUID, id uuid.UUID) error {
	var dismissed uuid.UUID
	err := s.pool.QueryRow(ctx, dismissInAppNotification, id, userID).Scan(&dismissed)
	if errors.Is(err, pgx.ErrNoRows) {
		return pgx.ErrNoRows
	}
	return err
}

func validateEmitNotificationRequest(req EmitNotificationRequest) (EmitNotificationRequest, error) {
	req.EventKey = strings.TrimSpace(req.EventKey)
	req.Type = strings.TrimSpace(req.Type)
	req.Category = strings.TrimSpace(req.Category)
	req.Target.Type = strings.TrimSpace(req.Target.Type)
	req.Target.ID = strings.TrimSpace(req.Target.ID)
	req.Title = strings.TrimSpace(req.Title)
	if req.EventKey == "" {
		return req, errors.New("event key is required")
	}
	if req.Type == "" {
		return req, errors.New("notification type is required")
	}
	if req.Category == "" {
		return req, errors.New("notification category is required")
	}
	if req.Target.Type == "" || req.Target.ID == "" {
		return req, errors.New("notification target is required")
	}
	if req.Title == "" {
		return req, errors.New("notification title is required")
	}
	if len(req.Recipients) == 0 {
		return req, errors.New("notification recipients are required")
	}
	if req.Data == nil {
		req.Data = map[string]any{}
	}
	return req, nil
}

func normalizeNotificationFilter(filter string) string {
	switch strings.TrimSpace(strings.ToLower(filter)) {
	case "unread":
		return "unread"
	case "action_required", "action":
		return "action_required"
	default:
		return "all"
	}
}

func cloneMap(data map[string]any) map[string]any {
	out := make(map[string]any, len(data))
	for key, value := range data {
		out[key] = value
	}
	return out
}

func encodeNotificationCursor(createdAt time.Time, id uuid.UUID) string {
	raw := strconv.FormatInt(createdAt.UTC().UnixNano(), 10) + "|" + id.String()
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeNotificationCursor(cursor string) (time.Time, uuid.UUID, error) {
	data, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(cursor))
	if err != nil {
		return time.Time{}, uuid.Nil, errors.New("invalid cursor")
	}
	parts := strings.Split(string(data), "|")
	if len(parts) != 2 {
		return time.Time{}, uuid.Nil, errors.New("invalid cursor")
	}
	nanos, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return time.Time{}, uuid.Nil, errors.New("invalid cursor")
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return time.Time{}, uuid.Nil, errors.New("invalid cursor")
	}
	return time.Unix(0, nanos).UTC(), id, nil
}

func scanInAppNotification(row pgx.Row) (InAppNotification, error) {
	var item InAppNotification
	var actorUserID *uuid.UUID
	var eventDataBytes []byte
	var target NotificationTarget
	var actionsBytes []byte
	var dataBytes []byte
	err := row.Scan(
		&item.ID,
		&item.Type,
		&item.Category,
		&item.Title,
		&item.Body,
		&actorUserID,
		&eventDataBytes,
		&target.Type,
		&target.ID,
		&target.SpaceID,
		&target.PageID,
		&item.ActionRequired,
		&actionsBytes,
		&dataBytes,
		&item.ReadAt,
		&item.DismissedAt,
		&item.ResolvedAt,
		&item.ExpiresAt,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return item, err
	}
	item.Target = target
	item.Actions = []NotificationAction{}
	if len(actionsBytes) > 0 {
		if err := json.Unmarshal(actionsBytes, &item.Actions); err != nil {
			return item, err
		}
	}
	item.Data = map[string]any{}
	if len(dataBytes) > 0 {
		if err := json.Unmarshal(dataBytes, &item.Data); err != nil {
			return item, err
		}
	}
	eventData := map[string]any{}
	if len(eventDataBytes) > 0 {
		if err := json.Unmarshal(eventDataBytes, &eventData); err != nil {
			return item, err
		}
	}
	if actorUserID != nil {
		item.Actor = &NotificationActor{UserID: *actorUserID}
		if name, ok := eventData["actor_name"].(string); ok {
			item.Actor.Name = name
		}
	}
	return item, nil
}
