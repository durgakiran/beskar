package notification

import (
	"strings"
	"testing"
)

func validInviteTemplateData() map[string]any {
	return map[string]any{
		"space_name":  "Roadmap",
		"sender_name": "Kiran",
		"role":        "editor",
		"accept_url":  "https://app.example.com/accept?token=abc",
		"reject_url":  "https://app.example.com/reject?token=abc",
		"app_url":     "https://app.example.com",
	}
}

func TestSpaceInviteCreatedTemplateRenders(t *testing.T) {
	rendered, err := (SpaceInviteCreatedTemplate{}).Render(validInviteTemplateData())
	if err != nil {
		t.Fatalf("expected render to succeed: %v", err)
	}
	if rendered.Subject == "" || rendered.Text == "" || rendered.HTML == "" {
		t.Fatalf("expected subject, text, and html to be populated")
	}
	if strings.Contains(rendered.Text, "<strong>") {
		t.Fatalf("text body should not contain html markup: %s", rendered.Text)
	}
}

func TestSpaceInviteCreatedTemplateRequiresFields(t *testing.T) {
	data := validInviteTemplateData()
	delete(data, "accept_url")
	_, err := (SpaceInviteCreatedTemplate{}).Render(data)
	if err == nil {
		t.Fatal("expected missing field error")
	}
}

func TestSpaceInviteCreatedTemplateEscapesHTML(t *testing.T) {
	data := validInviteTemplateData()
	data["space_name"] = `<script>alert("x")</script>`
	rendered, err := (SpaceInviteCreatedTemplate{}).Render(data)
	if err != nil {
		t.Fatalf("expected render to succeed: %v", err)
	}
	if strings.Contains(rendered.HTML, "<script>") {
		t.Fatalf("html body should escape script tags: %s", rendered.HTML)
	}
	if !strings.Contains(rendered.HTML, "&lt;script&gt;") {
		t.Fatalf("html body should contain escaped script tag: %s", rendered.HTML)
	}
}

func TestTemplateRegistryUnknownTemplate(t *testing.T) {
	_, err := NewTemplateRegistry().Render("missing", map[string]any{})
	if err == nil {
		t.Fatal("expected unknown template error")
	}
}
