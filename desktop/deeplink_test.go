package main

import "testing"

func TestDeepLinkRouting(t *testing.T) {
	for _, tc := range []struct {
		url, want string
	}{
		{"teddox://callback?code=test-code", "callback"},
		{"teddox://space/123", "navigate"},
		{"https://callback?code=test-code", ""},
		{"teddox://callback/other?code=test-code", ""},
		{"teddox://user@callback?code=test-code", ""},
		{"%", ""},
	} {
		t.Run(tc.url, func(t *testing.T) {
			got := ""
			handleDeepLink(tc.url, func(raw string) { got = "callback" }, func(raw string) { got = "navigate" })
			if got != tc.want {
				t.Fatalf("routed to %q; want %q", got, tc.want)
			}
		})
	}
}
