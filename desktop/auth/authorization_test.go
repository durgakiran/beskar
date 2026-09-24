package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"beskar/desktop/config"
)

func TestDesktopLoginRequestsAPIAudience(t *testing.T) {
	for _, tc := range []struct {
		name, audience, issuer string
		status                 int
		valid                  bool
	}{
		{name: "configured", audience: "project-123", issuer: "https://identity.example", valid: true},
		{name: "missing audience", issuer: "https://identity.example"},
		{name: "scope injection", audience: "project extra", issuer: "https://identity.example"},
		{name: "wrong issuer", audience: "project-123", issuer: "https://other.example"},
		{name: "unavailable", status: 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/.well-known/beskar" || r.Method != "GET" {
					t.Error("unexpected discovery request")
				}
				if tc.status != 0 {
					w.WriteHeader(tc.status)
				}
				_ = json.NewEncoder(w).Encode(map[string]string{"zitadel_url": tc.issuer, "api_audience": tc.audience})
			}))
			defer server.Close()
			cfg := &config.AppConfig{ServerURL: server.URL, ZitadelURL: "https://identity.example", ClientID: "desktop+client"}
			raw, err := loginAuthorizationURL(context.Background(), cfg, "pkce-challenge", server.Client())
			if (err == nil) != tc.valid {
				t.Fatalf("url=%s error=%v", raw, err)
			}
			if !tc.valid {
				return
			}
			u, err := url.Parse(raw)
			if err != nil {
				t.Fatal(err)
			}
			params := u.Query()
			if params.Get("client_id") != cfg.ClientID || params.Get("redirect_uri") != RedirectURI || params.Get("code_challenge") != "pkce-challenge" || params.Get("code_challenge_method") != "S256" {
				t.Fatal("login parameters lost")
			}
			scopes := strings.Fields(params.Get("scope"))
			if len(scopes) != 5 || scopes[4] != "urn:zitadel:iam:org:project:id:project-123:aud" {
				t.Fatalf("scopes %v", scopes)
			}
		})
	}
}

func TestDesktopUsesAccessTokenForAPI(t *testing.T) {
	service := &AuthService{accessToken: "access-token", idToken: "id-token", expiry: time.Now().Add(time.Hour)}
	if got := service.GetAccessToken(); got != "access-token" {
		t.Fatalf("wrong API credential: %q", got)
	}
}
