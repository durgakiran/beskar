package notification

import (
	"testing"

	"github.com/google/uuid"
)

func TestValidateEnqueueRequestAllowsUnknownRecipient(t *testing.T) {
	req, err := validateEnqueueRequest(EnqueueEmailRequest{
		MessageKey:  "space_invite_created:token",
		Category:    "space_invite",
		TemplateKey: TemplateSpaceInviteCreated,
		Recipient: EmailRecipient{
			Email: " USER@Example.COM ",
		},
	})
	if err != nil {
		t.Fatalf("expected request to validate: %v", err)
	}
	if req.Recipient.Email != "user@example.com" {
		t.Fatalf("expected normalized email, got %q", req.Recipient.Email)
	}
	if req.Priority != PriorityNormal {
		t.Fatalf("expected default priority %q, got %q", PriorityNormal, req.Priority)
	}
}

func TestValidateEnqueueRequestAllowsKnownRecipient(t *testing.T) {
	id := uuid.New()
	_, err := validateEnqueueRequest(EnqueueEmailRequest{
		MessageKey:  "known",
		Category:    "space_invite",
		TemplateKey: TemplateSpaceInviteCreated,
		Recipient: EmailRecipient{
			UserID: &id,
			Email:  "user@example.com",
		},
	})
	if err != nil {
		t.Fatalf("expected known recipient to validate: %v", err)
	}
}

func TestValidateEnqueueRequestRejectsInvalidEmail(t *testing.T) {
	_, err := validateEnqueueRequest(EnqueueEmailRequest{
		MessageKey:  "bad",
		Category:    "space_invite",
		TemplateKey: TemplateSpaceInviteCreated,
		Recipient: EmailRecipient{
			Email: "not-an-email",
		},
	})
	if err == nil {
		t.Fatal("expected invalid email error")
	}
}

func TestValidateEnqueueRequestRejectsMissingMessageKey(t *testing.T) {
	_, err := validateEnqueueRequest(EnqueueEmailRequest{
		Category:    "space_invite",
		TemplateKey: TemplateSpaceInviteCreated,
		Recipient: EmailRecipient{
			Email: "user@example.com",
		},
	})
	if err == nil {
		t.Fatal("expected missing message key error")
	}
}
