package notificationv2

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/durgakiran/beskar/notification"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BusinessProducer assigns a trusted application source and submits definitions
// through the same validation and idempotency contract as the HTTP API.
type BusinessProducer struct {
	pool   *pgxpool.Pool
	source string
}

func NewBusinessProducer(pool *pgxpool.Pool, source string) *BusinessProducer {
	return &BusinessProducer{pool, source}
}
func businessKey(event, mode, recipient string) string {
	sum := sha256.Sum256([]byte(event + "\x00" + mode + "\x00" + recipient))
	return hex.EncodeToString(sum[:])
}
func (b *BusinessProducer) Emit(ctx context.Context, req notification.EmitNotificationRequest) error {
	template, ok := businessTemplates[req.Type]
	if !ok {
		return fmt.Errorf("unsupported business notification topic")
	}
	if req.EventKey == "" || req.Actor.UserID == uuid.Nil {
		return fmt.Errorf("business event key and actor required")
	}
	vars := map[string]string{"title": req.Title, "body": req.Body, "target_type": req.Target.Type, "target_id": req.Target.ID, "space_id": "", "page_id": "", "actor_user_id": req.Actor.UserID.String(), "actor_name": req.Actor.Name, "href": "", "role": "", "space_name": "", "old_role": "", "new_role": "", "data_space_id": "", "token": "", "occurred_at": ""}
	if req.Target.SpaceID != nil {
		vars["space_id"] = req.Target.SpaceID.String()
	}
	if req.Target.PageID != nil {
		vars["page_id"] = strconv.FormatInt(*req.Target.PageID, 10)
	}
	for _, key := range []string{"href", "role", "space_name", "old_role", "new_role", "token"} {
		if v, ok := req.Data[key].(string); ok {
			vars[key] = v
		}
	}
	if v, ok := req.Data["space_id"].(string); ok {
		vars["data_space_id"] = v
	}
	if req.CreatedAt != nil {
		vars["occurred_at"] = req.CreatedAt.UTC().Format(time.RFC3339Nano)
	}
	if req.ExpiresAt != nil {
		return fmt.Errorf("business inbox expiry requires an explicit definition")
	}
	data, err := json.Marshal(vars)
	if err != nil {
		return err
	}
	tx, err := b.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollbackAudience(tx)
	var topic int16
	if err = tx.QueryRow(ctx, `SELECT id FROM notifications_v2.notification_topics WHERE code=$1 AND notification_type_id=1 AND active`, req.Type).Scan(&topic); err != nil {
		return fmt.Errorf("business notification topic unavailable: %w", err)
	}
	svc := NewService(b.pool).WithTx(tx)
	for _, r := range req.Recipients {
		if r.UserID == nil || *r.UserID == uuid.Nil {
			continue
		}
		if !req.ActorVisible && *r.UserID == req.Actor.UserID {
			continue
		}
		in := DefinitionInput{NotificationTypeID: 1, NotificationTopicID: topic, ModeID: 2, TemplateID: template, TemplateVersion: 1, MessageDetails: data, Priority: 50, ScheduleKind: "immediate", MisfirePolicy: "fire_once", CorrelationID: &req.EventKey, TargetUsers: []uuid.UUID{*r.UserID}}
		if _, _, err = svc.Create(ctx, Producer{Source: b.source, ActorID: req.Actor.UserID}, businessKey(req.EventKey, "in_app", r.UserID.String()), in); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func (b *BusinessProducer) EnqueueSpaceInviteEmail(ctx context.Context, req notification.EnqueueEmailRequest, actor uuid.UUID) error {
	if req.TemplateKey != notification.TemplateSpaceInviteCreated || req.MessageKey == "" {
		return fmt.Errorf("unsupported business email template or missing event key")
	}
	data, err := json.Marshal(req.TemplateData)
	if err != nil {
		return err
	}
	var topic int16
	if err = b.pool.QueryRow(ctx, `SELECT id FROM notifications_v2.notification_topics WHERE code='space_invite_created' AND notification_type_id=1 AND active`).Scan(&topic); err != nil {
		return err
	}
	in := DefinitionInput{NotificationTypeID: 1, NotificationTopicID: topic, ModeID: 1, TemplateID: businessEmailTemplate, TemplateVersion: 1, MessageDetails: data, Priority: 50, ScheduleKind: "immediate", MisfirePolicy: "fire_once", CorrelationID: &req.MessageKey}
	recipient := req.Recipient.Email
	if req.Recipient.UserID != nil && *req.Recipient.UserID != uuid.Nil {
		in.TargetUsers = []uuid.UUID{*req.Recipient.UserID}
		recipient = req.Recipient.UserID.String()
	} else {
		in.TargetEmails = []string{req.Recipient.Email}
	}
	if req.ScheduledAt != nil {
		in.ScheduleKind = "once"
		in.ScheduledAt = req.ScheduledAt
	}
	_, _, err = NewService(b.pool).Create(ctx, Producer{Source: b.source, ActorID: actor}, businessKey(req.MessageKey, "email", recipient), in)
	return err
}
