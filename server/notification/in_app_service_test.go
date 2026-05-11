package notification

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestValidateEmitNotificationRequestDefaultsData(t *testing.T) {
	recipientID := uuid.New()
	req, err := validateEmitNotificationRequest(EmitNotificationRequest{
		EventKey: "space_member_added:space:user",
		Type:     NotificationTypeSpaceMemberAdded,
		Category: NotificationCategorySpaceMembership,
		Recipients: []NotificationRecipient{{
			UserID: &recipientID,
		}},
		Target: NotificationTarget{
			Type: NotificationTargetSpace,
			ID:   uuid.NewString(),
		},
		Title: "You were added to a space",
	})
	if err != nil {
		t.Fatalf("expected request to validate: %v", err)
	}
	if req.Data == nil {
		t.Fatal("expected data map to be defaulted")
	}
}

func TestValidateEmitNotificationRequestRejectsMissingRequiredFields(t *testing.T) {
	_, err := validateEmitNotificationRequest(EmitNotificationRequest{})
	if err == nil {
		t.Fatal("expected missing fields error")
	}
}

func TestNormalizeNotificationFilter(t *testing.T) {
	cases := map[string]string{
		"":                "all",
		"all":             "all",
		"unread":          "unread",
		"action":          "action_required",
		"action_required": "action_required",
		"unknown":         "all",
	}
	for input, expected := range cases {
		if got := normalizeNotificationFilter(input); got != expected {
			t.Fatalf("normalizeNotificationFilter(%q) = %q, want %q", input, got, expected)
		}
	}
}

func TestNotificationCursorRoundTrip(t *testing.T) {
	createdAt := time.Date(2026, 5, 11, 10, 20, 30, 123, time.UTC)
	id := uuid.New()
	cursor := encodeNotificationCursor(createdAt, id)
	gotCreatedAt, gotID, err := decodeNotificationCursor(cursor)
	if err != nil {
		t.Fatalf("expected cursor to decode: %v", err)
	}
	if !gotCreatedAt.Equal(createdAt) {
		t.Fatalf("createdAt = %s, want %s", gotCreatedAt, createdAt)
	}
	if gotID != id {
		t.Fatalf("id = %s, want %s", gotID, id)
	}
}
