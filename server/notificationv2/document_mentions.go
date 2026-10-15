package notificationv2

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const DocumentMentionTopic = "document_mention"

var documentMentionEmailTemplate = uuid.MustParse("355875f4-59fd-4a41-a3ad-ac9bd2acda26")
var documentMentionInAppTemplate = uuid.MustParse("a1a899bf-9006-4fb8-a2f7-2a994f660206")

type DocumentMentionEvent struct {
	EventKey      string
	ActorID       uuid.UUID
	ActorName     string
	SpaceID       uuid.UUID
	PageID        int64
	DocumentTitle string
}

// QueueDocumentMention is the publication's transactional outbox: both channel
// definitions commit with the document, or none of them do. Delivery is async.
func QueueDocumentMention(ctx context.Context, tx pgx.Tx, event DocumentMentionEvent, recipients []uuid.UUID) error {
	if tx == nil {
		return fmt.Errorf("document mention transaction required")
	}
	if event.EventKey == "" || event.ActorID == uuid.Nil || event.SpaceID == uuid.Nil || event.PageID < 1 {
		return fmt.Errorf("invalid document mention event")
	}
	href := fmt.Sprintf("/space/%s/view/%d", event.SpaceID, event.PageID)
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("EMAIL_APP_BASE_URL")), "/")
	if base == "" {
		base = strings.TrimRight(strings.TrimSpace(os.Getenv("PUBLIC_BASE_URL")), "/")
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("valid EMAIL_APP_BASE_URL or PUBLIC_BASE_URL required for document mentions")
	}
	vars := map[string]string{"actor_user_id": event.ActorID.String(), "actor_name": event.ActorName, "space_id": event.SpaceID.String(), "page_id": fmt.Sprint(event.PageID), "document_title": event.DocumentTitle, "href": href, "url": base + href}
	data, err := json.Marshal(vars)
	if err != nil {
		return err
	}
	service := NewService(nil).WithTx(tx)
	// A caller-owned savepoint also makes the pair atomic when reused elsewhere.
	pair, err := tx.Begin(ctx)
	if err != nil {
		return err
	}
	defer pair.Rollback(ctx)
	service = service.WithTx(pair)
	seen := make(map[uuid.UUID]bool)
	for _, recipient := range recipients {
		if recipient == uuid.Nil || recipient == event.ActorID || seen[recipient] {
			continue
		}
		seen[recipient] = true
		for _, channel := range []struct {
			mode     int16
			code     string
			template uuid.UUID
		}{{1, "email", documentMentionEmailTemplate}, {2, "in_app", documentMentionInAppTemplate}} {
			input := DefinitionInput{NotificationTypeID: 1, NotificationTopicID: 20, ModeID: channel.mode, TemplateID: channel.template, TemplateVersion: 1, MessageDetails: data, Priority: 50, ScheduleKind: "immediate", MisfirePolicy: "fire_once", CorrelationID: &event.EventKey, TargetUsers: []uuid.UUID{recipient}}
			if _, _, err = service.Create(ctx, Producer{Source: "beskar.document", ActorID: event.ActorID}, businessKey(event.EventKey, channel.code, recipient.String()), input); err != nil {
				return err
			}
		}
	}
	return pair.Commit(ctx)
}

// Recheck queued notifications against current access so a later membership
// removal or deleted document cannot disclose its title through either channel.
func (w *DeliveryWorker) canDeliverDocumentMention(ctx context.Context, tx pgx.Tx, d deliveryRecord) (bool, error) {
	var data struct {
		SpaceID string `json:"space_id"`
		PageID  string `json:"page_id"`
	}
	if err := json.Unmarshal(d.MessageDetails, &data); err != nil {
		return false, nil
	}
	space, err := uuid.Parse(data.SpaceID)
	if err != nil || space == uuid.Nil || d.UserID == uuid.Nil {
		return false, nil
	}
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM core.page p JOIN core.space s ON s.id=p.space_id WHERE p.id::text=$1 AND p.space_id=$2 AND s.deleted_at IS NULL)`, data.PageID, space).Scan(&exists); err != nil {
		return false, err
	}
	if !exists {
		return false, nil
	}
	for _, entity := range []struct{ kind, id string }{{"space", space.String()}, {"page", data.PageID}} {
		allowed, err := core.CheckPermission(entity.kind, entity.id, "user", d.UserID.String(), "view")
		if err != nil {
			return false, err
		}
		if !allowed {
			return false, nil
		}
	}
	return true, nil
}
