package editor

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/notificationv2"
	"github.com/durgakiran/beskar/space"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Serialize publications of a page before reading the last published mention
// set. Draft rows never contribute to the notification baseline.
func lockPublishedMentionBaseline(ctx context.Context, tx pgx.Tx, pageID int64, spaceID uuid.UUID) ([]string, error) {
	// Match the existing content writers' space-before-page lock order.
	var archived, deleted bool
	if err := tx.QueryRow(ctx, whiteboardV2LockSpace, spaceID).Scan(&archived, &deleted); err != nil {
		return nil, err
	}
	if archived || deleted {
		return nil, fmt.Errorf("cannot publish in an archived or deleted space")
	}
	var locked int64
	if err := tx.QueryRow(ctx, `SELECT p.id FROM core.page p JOIN core.space s ON s.id=p.space_id
 WHERE p.id=$1 AND p.space_id=$2 AND s.deleted_at IS NULL AND s.archived_at IS NULL FOR UPDATE OF p`, pageID, spaceID).Scan(&locked); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `SELECT c.attrs->>'id' FROM core.content c WHERE c.type='mention' AND c.attrs->>'id' IS NOT NULL
 AND c.doc_id=(SELECT doc_id FROM core.page_doc_map WHERE page_id=$1 AND draft=0 ORDER BY version DESC,doc_id DESC LIMIT 1)`, pageID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func newPublishedMentionIDs(nodes NodeData, previous []string, actor uuid.UUID) []uuid.UUID {
	existing := make(map[uuid.UUID]bool)
	for _, raw := range previous {
		if id, err := uuid.Parse(raw); err == nil {
			existing[id] = true
		}
	}
	existing[actor] = true
	existing[uuid.Nil] = true
	ids := make([]uuid.UUID, 0)
	for _, node := range nodes.Content {
		if node.Type != "mention" {
			continue
		}
		raw, ok := node.Attributes["id"].(string)
		if !ok {
			continue
		}
		id, err := uuid.Parse(raw)
		if err != nil || existing[id] {
			continue
		}
		existing[id] = true
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i].String() < ids[j].String() })
	return ids
}

type mentionNotificationDependencies struct {
	resolve func(context.Context, uuid.UUID, uuid.UUID, []uuid.UUID) ([]space.MentionUserDetails, error)
	canView func(uuid.UUID, int64) (bool, error)
	queue   func(context.Context, pgx.Tx, notificationv2.DocumentMentionEvent, []uuid.UUID) error
}

func defaultMentionDependencies() mentionNotificationDependencies {
	return mentionNotificationDependencies{
		resolve: space.ResolveMentionRecipients,
		canView: func(user uuid.UUID, page int64) (bool, error) {
			return core.CheckPermission("page", strconv.FormatInt(page, 10), "user", user.String(), core.PAGE_VIEW)
		},
		queue: notificationv2.QueueDocumentMention,
	}
}

func queuePublishedMentionNotifications(ctx context.Context, tx pgx.Tx, document InputDocument, publishedDocID int64, previous []string, deps mentionNotificationDependencies) error {
	ids := newPublishedMentionIDs(document.Nodes, previous, document.OwnerId)
	if len(ids) == 0 {
		return nil
	}
	lookupCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	users, err := deps.resolve(lookupCtx, document.SpaceId, document.OwnerId, ids)
	if err != nil {
		return fmt.Errorf("resolve document mention recipients: %w", err)
	}
	requested := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		requested[id] = true
	}
	recipients := make([]uuid.UUID, 0, len(users))
	for _, user := range users {
		id, err := uuid.Parse(user.ID)
		if err != nil || !requested[id] {
			continue
		}
		allowed, err := deps.canView(id, document.Id)
		if err != nil {
			return fmt.Errorf("check document mention access: %w", err)
		}
		if !allowed {
			continue
		}
		recipients = append(recipients, id)
		delete(requested, id)
	}
	if len(recipients) == 0 {
		return nil
	}
	name := strings.TrimSpace(document.MentionActorName)
	if name == "" {
		name = "Someone"
	}
	event := notificationv2.DocumentMentionEvent{
		EventKey: fmt.Sprintf("document-mention:%d:%d", document.Id, publishedDocID),
		ActorID:  document.OwnerId, ActorName: name, SpaceID: document.SpaceId, PageID: document.Id, DocumentTitle: document.Title,
	}
	return deps.queue(ctx, tx, event, recipients)
}
