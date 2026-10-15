package editor

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/durgakiran/beskar/notificationv2"
	"github.com/durgakiran/beskar/space"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func mentionNodes(ids ...string) NodeData {
	nodes := NodeData{}
	for _, id := range ids {
		nodes.Content = append(nodes.Content, ContentNode{Type: "mention", Attributes: map[string]interface{}{"id": id}})
	}
	return nodes
}

func TestNewPublishedMentionIDs(t *testing.T) {
	actor, old, added := uuid.New(), uuid.New(), uuid.New()
	nodes := mentionNodes(actor.String(), strings.ToUpper(old.String()), added.String(), added.String(), "invalid", uuid.Nil.String())
	nodes.Content = append(nodes.Content, ContentNode{Type: "paragraph", Attributes: map[string]interface{}{"id": uuid.NewString()}}, ContentNode{Type: "mention", Attributes: map[string]interface{}{"id": 42}})
	if got := newPublishedMentionIDs(nodes, []string{old.String(), "invalid"}, actor); !reflect.DeepEqual(got, []uuid.UUID{added}) {
		t.Fatalf("new mentions=%v", got)
	}
	if got := newPublishedMentionIDs(mentionNodes(added.String()), []string{added.String()}, actor); len(got) != 0 {
		t.Fatalf("unchanged publication notified: %v", got)
	}
	if got := newPublishedMentionIDs(mentionNodes(added.String()), nil, actor); len(got) != 1 {
		t.Fatal("mention removed in a published version must notify when re-added")
	}
}

func TestQueuePublishedMentionNotifications(t *testing.T) {
	actor, allowed, denied, outsider := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	doc := InputDocument{Document: Document{Id: 123, SpaceId: uuid.New(), OwnerId: actor, Title: "Plan"}, MentionActorName: "Alice", Nodes: mentionNodes(allowed.String(), denied.String(), actor.String())}
	for _, scenario := range []string{"success", "resolve failure", "permission failure", "queue failure", "unchanged"} {
		t.Run(scenario, func(t *testing.T) {
			queued, resolved := false, false
			deps := mentionNotificationDependencies{
				resolve: func(_ context.Context, s, a uuid.UUID, ids []uuid.UUID) ([]space.MentionUserDetails, error) {
					resolved = true
					if s != doc.SpaceId || a != actor || len(ids) != 2 {
						t.Fatal("incorrect space or actor scope")
					}
					if scenario == "resolve failure" {
						return nil, errors.New("directory unavailable")
					}
					return []space.MentionUserDetails{{MentionUser: space.MentionUser{ID: allowed.String()}}, {MentionUser: space.MentionUser{ID: denied.String()}}, {MentionUser: space.MentionUser{ID: outsider.String()}}, {MentionUser: space.MentionUser{ID: allowed.String()}}}, nil
				},
				canView: func(id uuid.UUID, page int64) (bool, error) {
					if page != doc.Id {
						t.Fatal("incorrect page")
					}
					if scenario == "permission failure" {
						return false, errors.New("authorization unavailable")
					}
					return id == allowed, nil
				},
				queue: func(_ context.Context, _ pgx.Tx, event notificationv2.DocumentMentionEvent, ids []uuid.UUID) error {
					queued = true
					if !reflect.DeepEqual(ids, []uuid.UUID{allowed}) || event.ActorID != actor || event.ActorName != "Alice" || event.PageID != 123 || event.SpaceID != doc.SpaceId || event.EventKey != "document-mention:123:456" {
						t.Fatalf("incorrect event: %+v %v", event, ids)
					}
					if scenario == "queue failure" {
						return errors.New("outbox unavailable")
					}
					return nil
				},
			}
			var previous []string
			if scenario == "unchanged" {
				previous = []string{allowed.String(), denied.String()}
			}
			err := queuePublishedMentionNotifications(context.Background(), nil, doc, 456, previous, deps)
			wantError := strings.Contains(scenario, "failure")
			if (err != nil) != wantError {
				t.Fatalf("error=%v", err)
			}
			if scenario == "success" && !queued {
				t.Fatal("missing notification")
			}
			if scenario == "unchanged" && (resolved || queued) {
				t.Fatal("unchanged mentions must not use directory or queue")
			}
		})
	}
}
