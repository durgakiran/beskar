package main

import "testing"

func TestResolveAttachmentCanonicalPath(t *testing.T) {
	key, candidates, err := resolveAttachment("attachments/report.pdf", "/srv/uploads", "public")
	if err != nil {
		t.Fatalf("resolveAttachment error: %v", err)
	}
	if key != "attachments/report.pdf" {
		t.Fatalf("key = %q, want %q", key, "attachments/report.pdf")
	}
	if len(candidates) != 2 {
		t.Fatalf("candidate count = %d, want 2", len(candidates))
	}
	if candidates[0] != "/srv/uploads/attachments/report.pdf" {
		t.Fatalf("candidate[0] = %q", candidates[0])
	}
	if candidates[1] != "public/attachments/report.pdf" {
		t.Fatalf("candidate[1] = %q", candidates[1])
	}
}

func TestResolveAttachmentLegacyPublicPath(t *testing.T) {
	key, candidates, err := resolveAttachment("public/attachments/report.pdf", "/srv/uploads", "public")
	if err != nil {
		t.Fatalf("resolveAttachment error: %v", err)
	}
	if key != "attachments/report.pdf" {
		t.Fatalf("key = %q, want %q", key, "attachments/report.pdf")
	}
	if len(candidates) != 2 {
		t.Fatalf("candidate count = %d, want 2", len(candidates))
	}
	if candidates[0] != "public/attachments/report.pdf" {
		t.Fatalf("candidate[0] = %q", candidates[0])
	}
}

func TestResolveAttachmentAbsolutePath(t *testing.T) {
	key, candidates, err := resolveAttachment("/var/lib/beskar/uploads/attachments/a/b/report.pdf", "/srv/uploads", "public")
	if err != nil {
		t.Fatalf("resolveAttachment error: %v", err)
	}
	if key != "attachments/a/b/report.pdf" {
		t.Fatalf("key = %q, want %q", key, "attachments/a/b/report.pdf")
	}
	if len(candidates) == 0 || candidates[0] != "/var/lib/beskar/uploads/attachments/a/b/report.pdf" {
		t.Fatalf("unexpected candidates: %#v", candidates)
	}
}
