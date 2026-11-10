package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/durgakiran/beskar/core"
	"github.com/zitadel/oidc/v3/pkg/crypto"
)

func TestAuthenticatedSessionCSRF(t *testing.T) {
	const key = "12345678901234567890123456789012"
	t.Setenv("KEY", key)
	csrf, err := core.NewBrowserCSRF(key, "https://app.example.com")
	if err != nil {
		t.Fatal(err)
	}
	value, err := crypto.EncryptAES("test-session", key)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, origin, authorization string
		cookie, signedIn            bool
		status                      int
	}{
		{"browser", "https://app.example.com", "", true, true, 200},
		{"service forwarding a cookie", "", "", true, true, 200},
		{"hostile origin", "https://evil.example.com", "", true, true, 403},
		{"bearer", "", "Bearer verified-by-middleware", false, true, 200},
		{"bearer with cookie", "", "Bearer verified-by-middleware", true, true, 200},
		{"signed out", "https://app.example.com", "", true, false, 401},
		{"missing cookie", "https://app.example.com", "", false, true, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/authenticated", nil)
			if tc.cookie {
				req.AddCookie(&http.Cookie{Name: "zitadel.session", Value: value})
			}
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.authorization != "" {
				req.Header.Set("Authorization", tc.authorization)
			}
			resolve := func(context.Context) (core.UserInfo, error) {
				if !tc.signedIn {
					return core.UserInfo{}, errors.New("not authenticated")
				}
				return core.UserInfo{Id: "verified-user"}, nil
			}
			w := httptest.NewRecorder()
			authenticated(csrf, resolve).ServeHTTP(w, req)
			if w.Code != tc.status || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("status=%d headers=%v", w.Code, w.Header())
			}
			var body struct {
				Data *struct {
					CSRFToken string `json:"csrfToken"`
				} `json:"data"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if tc.status == 200 && tc.authorization == "" {
				if body.Data == nil || body.Data.CSRFToken == "" {
					t.Fatal("browser session response missing CSRF token")
				}
				fallback := httptest.NewRecorder()
				csrf.TokenHandler(fallback, req)
				var token map[string]string
				if err := json.Unmarshal(fallback.Body.Bytes(), &token); err != nil {
					t.Fatal(err)
				}
				if body.Data.CSRFToken != token["csrfToken"] {
					t.Fatal("session and fallback tokens differ")
				}
			} else if body.Data != nil {
				t.Fatal("token exposed to bearer or failed authentication")
			}
			if strings.Contains(w.Body.String(), value) || strings.Contains(w.Body.String(), "test-session") {
				t.Fatal("session credential exposed")
			}
		})
	}
}
