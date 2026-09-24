package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/zitadel/oidc/v3/pkg/oidc"
)

func TestBearerAccessTokenPolicy(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	for _, tc := range []struct {
		name   string
		mutate func(*oidc.IntrospectionResponse)
		status int
		body   string
		want   int
	}{
		{name: "valid opaque token", want: 204},
		{name: "revoked or ID token", mutate: func(r *oidc.IntrospectionResponse) { r.Active = false }, want: 401},
		{name: "wrong audience", mutate: func(r *oidc.IntrospectionResponse) { r.Audience = []string{"other"} }, want: 401},
		{name: "missing audience", mutate: func(r *oidc.IntrospectionResponse) { r.Audience = nil }, want: 401},
		{name: "multiple audiences", mutate: func(r *oidc.IntrospectionResponse) { r.Audience = []string{"other", "project"} }, want: 204},
		{name: "wrong client", mutate: func(r *oidc.IntrospectionResponse) { r.ClientID = "unknown" }, want: 401},
		{name: "browser client not implicitly allowed", mutate: func(r *oidc.IntrospectionResponse) { r.ClientID = "web-client" }, want: 401},
		{name: "missing client", mutate: func(r *oidc.IntrospectionResponse) { r.ClientID = "" }, want: 401},
		{name: "second allowed client", mutate: func(r *oidc.IntrospectionResponse) { r.ClientID = "desktop-two" }, want: 204},
		{name: "wrong issuer", mutate: func(r *oidc.IntrospectionResponse) { r.Issuer = "https://other.example" }, want: 401},
		{name: "missing subject", mutate: func(r *oidc.IntrospectionResponse) { r.Subject = "" }, want: 401},
		{name: "expired", mutate: func(r *oidc.IntrospectionResponse) { r.Expiration = oidc.FromTime(now) }, want: 401},
		{name: "missing expiry", mutate: func(r *oidc.IntrospectionResponse) { r.Expiration = 0 }, want: 401},
		{name: "future nbf", mutate: func(r *oidc.IntrospectionResponse) { r.NotBefore = oidc.FromTime(now.Add(time.Minute)) }, want: 401},
		{name: "refresh token", mutate: func(r *oidc.IntrospectionResponse) { r.TokenType = "refresh_token" }, want: 401},
		{name: "outage", status: 503, body: "private provider secret", want: 503},
		{name: "client credentials rejected", status: 401, body: `{"error":"invalid_client"}`, want: 503},
		{name: "rate limit", status: 429, want: 503},
		{name: "redirect", status: 302, want: 503},
		{name: "malformed JSON", body: "private provider secret", want: 503},
		{name: "null response", body: "null", want: 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := &oidc.IntrospectionResponse{Active: true, Subject: "user", ClientID: "desktop-one", Audience: []string{"project"}, TokenType: "Bearer", Expiration: oidc.FromTime(now.Add(time.Hour))}
			response.Name = "Test User"
			response.Email = "user@example.test"
			response.EmailVerified = true
			response.Username = "test-user"
			calls := 0
			provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != "POST" || r.URL.Path != "/oauth/v2/introspect" || r.FormValue("token") != "opaque-token" {
					t.Error("unexpected introspection request")
				}
				if id, secret, ok := r.BasicAuth(); !ok || id != "web-client" || secret != "secret" {
					t.Error("missing confidential API authentication")
				}
				if tc.status != 0 {
					if tc.status == 302 {
						w.Header().Set("Location", "/credential-leak")
					}
					w.WriteHeader(tc.status)
				}
				if tc.body != "" {
					_, _ = w.Write([]byte(tc.body))
					return
				}
				_ = json.NewEncoder(w).Encode(response)
			}))
			defer provider.Close()
			response.Issuer = provider.URL
			if tc.mutate != nil {
				tc.mutate(response)
			}
			client := provider.Client()
			client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
			tokens, err := newBrowserAccessTokenValidator(browserTokenConfig{issuer: provider.URL, clientID: "web-client", clientSecret: "secret", audience: "project"}, client)
			if err != nil {
				t.Fatal(err)
			}
			tokens.now = func() time.Time { return now }
			validator, err := NewBearerAccessTokenValidator(tokens, "desktop-one, desktop-two")
			if err != nil {
				t.Fatal(err)
			}
			reached := false
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reached = true
				identity, ok := r.Context().Value(bearerIdentityKey{}).(bearerIdentity)
				if !ok || identity.Subject != "user" || identity.Email != "user@example.test" || !identity.EmailVerified || identity.Name != "Test User" || identity.Username != "test-user" {
					t.Error("validated profile lost")
				}
				w.WriteHeader(204)
			})
			// An explicit bearer must never fall back to an otherwise valid cookie.
			handler := SelectAuthentication(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("cookie fallback") }), validator.Middleware(next), true)
			for _, query := range []bool{false, true} {
				req := httptest.NewRequest("GET", "/api/v1/media/file?token=opaque-token", nil)
				req.AddCookie(&http.Cookie{Name: "zitadel.session", Value: "cookie"})
				if !query {
					req.Header.Set("Authorization", "Bearer opaque-token")
				}
				recorder := httptest.NewRecorder()
				handler.ServeHTTP(recorder, req)
				if recorder.Code != tc.want || reached != (tc.want == 204) {
					t.Fatalf("status %d; want %d", recorder.Code, tc.want)
				}
				if tc.want != 204 && (recorder.Header().Get("Cache-Control") != "no-store" || strings.Contains(recorder.Body.String(), "secret")) {
					t.Fatal("unsafe auth response")
				}
			}
			if calls != 2 {
				t.Fatalf("expected per-request introspection, calls=%d", calls)
			}
		})
	}
}

func TestBearerClientAllowlistConfiguration(t *testing.T) {
	for _, input := range []string{"", " ", "*", "one,", "one,,two", "one two", "one, *"} {
		if _, err := NewBearerAccessTokenValidator(&BrowserAccessTokenValidator{}, input); err == nil {
			t.Errorf("accepted %q", input)
		}
	}
	if _, err := NewBearerAccessTokenValidator(&BrowserAccessTokenValidator{}, "desktop-one, desktop-two"); err != nil {
		t.Fatal(err)
	}
}

func TestBearerAmbiguousHeadersDoNotFallBack(t *testing.T) {
	for _, values := range [][]string{{""}, {"Bearer one", "Bearer two"}, {"Bearer one,two"}} {
		req := httptest.NewRequest("POST", "/api/v1/editor", nil)
		req.Header["Authorization"] = values
		fail := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("credential fallback") })
		recorder := httptest.NewRecorder()
		SelectAuthentication(fail, (&BearerAccessTokenValidator{}).Middleware(fail), false).ServeHTTP(recorder, req)
		if recorder.Code != 401 {
			t.Fatalf("status %d", recorder.Code)
		}
	}
}

func TestBearerRevocationTakesEffectOnNextRequest(t *testing.T) {
	active := true
	var issuer string
	provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(&oidc.IntrospectionResponse{Active: active, Subject: "user", Issuer: issuer, ClientID: "desktop", Audience: []string{"project"}, TokenType: "Bearer", Expiration: oidc.FromTime(time.Now().Add(time.Hour))})
	}))
	defer provider.Close()
	issuer = provider.URL
	tokens, err := newBrowserAccessTokenValidator(browserTokenConfig{issuer: issuer, clientID: "web", clientSecret: "secret", audience: "project"}, provider.Client())
	if err != nil {
		t.Fatal(err)
	}
	validator, err := NewBearerAccessTokenValidator(tokens, "desktop")
	if err != nil {
		t.Fatal(err)
	}
	handler := validator.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	for _, want := range []int{204, 401} {
		req := httptest.NewRequest("GET", "/api/v1/authenticated", nil)
		req.Header.Set("Authorization", "Bearer same-token")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Fatalf("status %d want %d", rec.Code, want)
		}
		active = false
	}
}
