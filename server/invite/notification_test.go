package invite

import (
	"testing"

	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/notification"
	"github.com/google/uuid"
)

func TestBuildSpaceInviteCreatedEmailRequestForUnknownRecipient(t *testing.T) {
	req, err := buildSpaceInviteCreatedEmailRequest(
		notification.Config{AppBaseURL: "https://app.example.com"},
		Invite{
			Entity:   "space",
			EntityId: uuid.NewString(),
			Email:    "invitee@example.com",
			Role:     "member",
		},
		"abc123",
		"Roadmap",
		core.UserInfo{Name: "Kiran", Email: "kiran@example.com"},
	)
	if err != nil {
		t.Fatalf("expected request build to succeed: %v", err)
	}
	if req.MessageKey != "space_invite_created:abc123" {
		t.Fatalf("unexpected message key: %q", req.MessageKey)
	}
	if req.Category != "space_invite" {
		t.Fatalf("unexpected category: %q", req.Category)
	}
	if req.TemplateKey != notification.TemplateSpaceInviteCreated {
		t.Fatalf("unexpected template key: %q", req.TemplateKey)
	}
	if req.Recipient.UserID != nil {
		t.Fatal("expected unknown recipient to have nil user id")
	}
	if req.Recipient.Email != "invitee@example.com" {
		t.Fatalf("unexpected recipient email: %q", req.Recipient.Email)
	}
	if req.TemplateData["accept_url"] != "https://app.example.com/invite/action?token=abc123&decision=accept" {
		t.Fatalf("unexpected accept url: %q", req.TemplateData["accept_url"])
	}
	if req.TemplateData["reject_url"] != "https://app.example.com/invite/action?token=abc123&decision=reject" {
		t.Fatalf("unexpected reject url: %q", req.TemplateData["reject_url"])
	}
}

func TestBuildSpaceInviteCreatedEmailRequestForKnownRecipient(t *testing.T) {
	userID := uuid.New()
	req, err := buildSpaceInviteCreatedEmailRequest(
		notification.Config{AppBaseURL: "https://app.example.com"},
		Invite{
			UserId: userID,
			Entity: "space",
			Email:  "invitee@example.com",
			Role:   "admin",
		},
		"abc123",
		"Roadmap",
		core.UserInfo{Email: "kiran@example.com"},
	)
	if err != nil {
		t.Fatalf("expected request build to succeed: %v", err)
	}
	if req.Recipient.UserID == nil {
		t.Fatal("expected known recipient user id")
	}
	if *req.Recipient.UserID != userID {
		t.Fatalf("unexpected recipient user id: %s", req.Recipient.UserID.String())
	}
	if req.TemplateData["sender_name"] != "kiran@example.com" {
		t.Fatalf("unexpected sender fallback: %q", req.TemplateData["sender_name"])
	}
	if req.TemplateData["role"] != "admin" {
		t.Fatalf("unexpected role: %q", req.TemplateData["role"])
	}
}

func TestBuildInviteActionURLFallsBackToRelativeAppPath(t *testing.T) {
	got := buildInviteActionURL("/", "abc 123", "accept")
	want := "/invite/action?token=abc+123&decision=accept"
	if got != want {
		t.Fatalf("unexpected url: got %q want %q", got, want)
	}
}

func TestBuildInviteActionURLRejectsUnknownDecision(t *testing.T) {
	got := buildInviteActionURL("https://app.example.com", "abc123", "maybe")
	if got != "" {
		t.Fatalf("expected empty url for unknown decision, got %q", got)
	}
}
