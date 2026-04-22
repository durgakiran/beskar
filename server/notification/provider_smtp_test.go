package notification

import (
	"bytes"
	"strings"
	"testing"
)

func TestBuildGoMailMessageCreatesMultipartAlternative(t *testing.T) {
	email, messageID, err := buildGoMailMessage(OutboundEmail{
		FromName:    "Beskar",
		FromAddress: "no-reply@example.com",
		ToName:      "User",
		ToAddress:   "user@example.com",
		Subject:     "Welcome",
		TextBody:    "Text body",
		HTMLBody:    "<p>HTML body</p>",
	})
	if err != nil {
		t.Fatalf("expected message build to succeed: %v", err)
	}
	var buf bytes.Buffer
	if _, err := email.WriteTo(&buf); err != nil {
		t.Fatalf("expected message write to succeed: %v", err)
	}

	raw := buf.String()
	for _, expected := range []string{
		`From: "Beskar" <no-reply@example.com>`,
		`To: "User" <user@example.com>`,
		"Subject: Welcome",
		"multipart/alternative",
		"Text body",
		"<p>HTML body</p>",
	} {
		if !strings.Contains(raw, expected) {
			t.Fatalf("expected raw message to contain %q, got:\n%s", expected, raw)
		}
	}
	if messageID == "" {
		t.Fatal("expected message id")
	}
}
