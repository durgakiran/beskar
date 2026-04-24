package core

import (
	"net/http/httptest"
	"testing"
)

func TestSanitizeAuthReturnToAllowsRelativeAppPaths(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "space view path",
			input: "/space/aded26dc-f200-43b8-b0c0-251ef06a2aa0/view/31",
			want:  "/space/aded26dc-f200-43b8-b0c0-251ef06a2aa0/view/31",
		},
		{
			name:  "query string",
			input: "/space/aded26dc-f200-43b8-b0c0-251ef06a2aa0/view/31?comment=thread-123",
			want:  "/space/aded26dc-f200-43b8-b0c0-251ef06a2aa0/view/31?comment=thread-123",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sanitizeAuthReturnTo(tt.input); got != tt.want {
				t.Fatalf("sanitizeAuthReturnTo(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestSanitizeAuthReturnToRejectsOpenRedirectsAndAuthLoops(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{name: "empty", input: ""},
		{name: "same origin absolute URL", input: "https://app.durgakiran.com/user/notifications?tab=mentions"},
		{name: "empty path same origin absolute URL", input: "https://app.durgakiran.com"},
		{name: "external absolute URL", input: "https://evil.example/path"},
		{name: "external absolute URL with app prefix", input: "https://evil.example/app.durgakiran.com"},
		{name: "protocol relative URL", input: "//evil.example/path"},
		{name: "encoded-looking protocol relative URL without slash", input: "%2F%2Fevil.example/path"},
		{name: "scheme without host", input: "https:evil.example/path"},
		{name: "relative without slash", input: "space/foo"},
		{name: "auth route", input: "/auth/login"},
		{name: "auth route with query", input: "/auth/login?returnTo=/space/foo"},
		{name: "mixed case auth route", input: "/Auth/callback"},
		{name: "backslash protocol relative variant", input: `/\evil.example\path`},
		{name: "newline injection", input: "/space/foo\nLocation: https://evil.example"},
		{name: "tab injection", input: "/space/foo\tbar"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sanitizeAuthReturnTo(tt.input); got != "/" {
				t.Fatalf("sanitizeAuthReturnTo(%q) = %q, want /", tt.input, got)
			}
		})
	}
}

func TestSanitizeAuthReturnToRejectsDecodedQueryAttacks(t *testing.T) {
	tests := []struct {
		name string
		raw  string
	}{
		{
			name: "encoded protocol relative URL",
			raw:  "https://app.durgakiran.com/auth/login?returnTo=%2F%2Fevil.example%2Fpath",
		},
		{
			name: "encoded newline injection",
			raw:  "https://app.durgakiran.com/auth/login?returnTo=%2Fspace%2Ffoo%0ALocation%3A%20https%3A%2F%2Fevil.example",
		},
		{
			name: "encoded auth loop",
			raw:  "https://app.durgakiran.com/auth/login?returnTo=%2Fauth%2Flogin%3FreturnTo%3D%2Fspace%2Ffoo",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", tt.raw, nil)
			if got := sanitizeAuthReturnTo(req.URL.Query().Get("returnTo")); got != "/" {
				t.Fatalf("sanitizeAuthReturnTo decoded query = %q, want /", got)
			}
		})
	}
}
