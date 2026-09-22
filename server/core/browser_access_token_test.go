package core

import (
	"bytes"
	"context"
	"encoding/json"
	"golang.org/x/exp/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/zitadel/oidc/v3/pkg/crypto"
	"github.com/zitadel/oidc/v3/pkg/oidc"
	"github.com/zitadel/zitadel-go/v3/pkg/authentication"
	"github.com/zitadel/zitadel-go/v3/pkg/zitadel"
	"golang.org/x/oauth2"
)

func TestBrowserAccessTokenMiddleware(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	for _, tc := range []struct {
		name   string
		mutate func(*browserAuthContext, *oidc.IntrospectionResponse)
		status int
		body   string
		want   int
		calls  int
	}{
		{name: "valid opaque access token", want: 204, calls: 1},
		{name: "revoked", mutate: func(_ *browserAuthContext, r *oidc.IntrospectionResponse) { r.Active = false }, want: 401, calls: 1},
		{name: "wrong subject", mutate: func(_ *browserAuthContext, r *oidc.IntrospectionResponse) { r.Subject = "another-user" }, want: 401, calls: 1},
		{name: "wrong issuer", mutate: func(_ *browserAuthContext, r *oidc.IntrospectionResponse) { r.Issuer = "https://another.example" }, want: 401, calls: 1},
		{name: "wrong client", mutate: func(_ *browserAuthContext, r *oidc.IntrospectionResponse) { r.ClientID = "another-client" }, want: 401, calls: 1},
		{name: "wrong audience", mutate: func(_ *browserAuthContext, r *oidc.IntrospectionResponse) { r.Audience = []string{"another-api"} }, want: 401, calls: 1},
		{name: "multiple audiences", mutate: func(_ *browserAuthContext, r *oidc.IntrospectionResponse) { r.Audience = []string{"other", "project"} }, want: 204, calls: 1},
		{name: "provider token expired", mutate: func(_ *browserAuthContext, r *oidc.IntrospectionResponse) { r.Expiration = oidc.FromTime(now) }, want: 401, calls: 1},
		{name: "provider expiry missing", mutate: func(_ *browserAuthContext, r *oidc.IntrospectionResponse) { r.Expiration = 0 }, want: 401, calls: 1},
		{name: "not yet valid", mutate: func(_ *browserAuthContext, r *oidc.IntrospectionResponse) {
			r.NotBefore = oidc.FromTime(now.Add(time.Minute))
		}, want: 401, calls: 1},
		{name: "wrong token type", mutate: func(_ *browserAuthContext, r *oidc.IntrospectionResponse) { r.TokenType = "refresh_token" }, want: 401, calls: 1},
		{name: "local token expired", mutate: func(s *browserAuthContext, _ *oidc.IntrospectionResponse) { s.Tokens.Expiry = now }, want: 401},
		{name: "local expiry missing", mutate: func(s *browserAuthContext, _ *oidc.IntrospectionResponse) { s.Tokens.Expiry = time.Time{} }, want: 401},
		{name: "access token missing", mutate: func(s *browserAuthContext, _ *oidc.IntrospectionResponse) { s.Tokens.AccessToken = "" }, want: 401},
		{name: "tokens missing", mutate: func(s *browserAuthContext, _ *oidc.IntrospectionResponse) { s.Tokens = nil }, want: 401},
		{name: "oauth token missing", mutate: func(s *browserAuthContext, _ *oidc.IntrospectionResponse) { s.Tokens.Token = nil }, want: 401},
		{name: "userinfo missing", mutate: func(s *browserAuthContext, _ *oidc.IntrospectionResponse) { s.UserInfo = nil }, want: 401},
		{name: "provider outage", status: 503, body: "provider secret diagnostics", want: 503, calls: 1},
		{name: "bad client credentials", status: 401, body: "invalid_client secret", want: 503, calls: 1},
		{name: "rate limited", status: 429, body: "rate limited", want: 503, calls: 1},
		{name: "invalid JSON", body: "not JSON", want: 503, calls: 1},
		{name: "null response", body: "null", want: 503, calls: 1},
		{name: "redirect refused", status: 302, body: "redirect", want: 503, calls: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			response := &oidc.IntrospectionResponse{Active: true, Subject: "user", ClientID: "browser-client",
				Audience: []string{"project"}, TokenType: "Bearer", Expiration: oidc.FromTime(now.Add(time.Hour))}
			provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != "POST" || r.URL.Path != "/oauth/v2/introspect" {
					t.Errorf("unexpected provider request %s %s", r.Method, r.URL.Path)
				}
				if id, secret, ok := r.BasicAuth(); !ok || id != "browser-client" || secret != "browser-secret" {
					t.Error("missing shared confidential client authentication")
				}
				if r.FormValue("token") != "opaque-access-token" {
					t.Error("introspection did not receive the stored access token")
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
			session := &browserAuthContext{UserInfo: &oidc.UserInfo{Subject: "user"},
				Tokens: &oidc.Tokens[*oidc.IDTokenClaims]{Token: &oauth2.Token{
					AccessToken: "opaque-access-token", TokenType: "Bearer", Expiry: now.Add(time.Hour),
				}, IDToken: "never-send-this-id-token"}}
			if tc.mutate != nil {
				tc.mutate(session, response)
			}
			client := provider.Client()
			client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
			validator, err := newBrowserAccessTokenValidator(browserTokenConfig{
				issuer: provider.URL, clientID: "browser-client", audience: "project",
				clientSecret: "browser-secret",
			}, client)
			if err != nil {
				t.Fatal(err)
			}
			validator.now = func() time.Time { return now }
			reached := false
			handler := validator.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reached = true
				w.WriteHeader(204)
			}))
			req := httptest.NewRequest("GET", "/api/v1/authenticated", nil)
			req = req.WithContext(authentication.WithAuthContext(req.Context(), session))
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, req)
			if recorder.Code != tc.want || reached != (tc.want == 204) || calls != tc.calls {
				t.Fatalf("status=%d reached=%v calls=%d; want status=%d calls=%d", recorder.Code, reached, calls, tc.want, tc.calls)
			}
			if strings.Contains(recorder.Body.String(), "secret") {
				t.Fatal("leaked provider diagnostics")
			}
			if tc.want != 204 && recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("auth error is cacheable")
			}
		})
	}
}

func TestBrowserAccessTokenNoSessionPreservesPublicHandler(t *testing.T) {
	validator := &BrowserAccessTokenValidator{}
	recorder := httptest.NewRecorder()
	validator.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })).ServeHTTP(
		recorder, httptest.NewRequest("GET", "/public-invitation", nil))
	if recorder.Code != 204 {
		t.Fatalf("got %d", recorder.Code)
	}
}

func TestBrowserAccessTokenConfiguration(t *testing.T) {
	for _, key := range []string{"ZITADEL_CLIENT_ID", "ZITADEL_API_AUDIENCE", "ZITADEL_CLIENT_SECRET"} {
		t.Run(key, func(t *testing.T) {
			t.Setenv("ISSUER_URL", "https://issuer.example")
			for _, field := range []string{"ZITADEL_CLIENT_ID", "ZITADEL_API_AUDIENCE", "ZITADEL_CLIENT_SECRET"} {
				t.Setenv(field, "configured")
			}
			t.Setenv(key, "")
			if _, err := NewBrowserAccessTokenValidator(); err == nil {
				t.Fatal("missing configuration accepted")
			}
		})
	}
	for _, issuer := range []string{"", "http://issuer.example", "https://user:secret@issuer.example", "https://issuer.example?query=1"} {
		if _, err := newBrowserAccessTokenValidator(browserTokenConfig{issuer: issuer}, http.DefaultClient); err == nil {
			t.Fatalf("invalid issuer accepted: %q", issuer)
		}
	}
}

func TestBrowserAccessTokenCancellation(t *testing.T) {
	provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(500) }))
	defer provider.Close()
	validator, err := newBrowserAccessTokenValidator(browserTokenConfig{
		issuer: provider.URL, clientID: "browser", audience: "project", clientSecret: "secret",
	}, provider.Client())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	session := &browserAuthContext{UserInfo: &oidc.UserInfo{Subject: "user"}, Tokens: &oidc.Tokens[*oidc.IDTokenClaims]{Token: &oauth2.Token{
		AccessToken: "token", TokenType: "Bearer", Expiry: time.Now().Add(time.Hour),
	}}}
	if err := validator.validate(ctx, session); err == nil || err == errBrowserTokenInvalid {
		t.Fatalf("cancellation misclassified: %v", err)
	}
}

func TestBrowserAuthScopeIncludesAPIAudienceAndRefresh(t *testing.T) {
	t.Setenv("ZITADEL_API_AUDIENCE", "project")
	t.Setenv("ZITADEL_REGISTRATION_ORG_ID", "org")
	scopes := strings.Join(zitadelAuthScopes(), " ")
	if !strings.Contains(scopes, "urn:zitadel:iam:org:project:id:project:aud") || !strings.Contains(scopes, "urn:zitadel:iam:org:id:org") {
		t.Fatalf("missing scope: %s", scopes)
	}
	if !strings.Contains(scopes, "offline_access") {
		t.Fatal("refresh scope is missing")
	}
}

type browserTestSessionStore struct{ session *browserAuthContext }

func (s *browserTestSessionStore) Get(string) (*browserAuthContext, error) { return s.session, nil }
func (s *browserTestSessionStore) Set(_ string, session *browserAuthContext) error {
	s.session = session
	return nil
}

// Exercise the actual SDK cookie decoding/context path, not only a manually
// attached context. Revocation must be observed on the next request using the
// same cookie and still-unexpired local token.
func TestBrowserCookieRevalidatedAfterRevocation(t *testing.T) {
	var active atomic.Bool
	active.Store(true)
	var calls atomic.Int32
	now := time.Now().Truncate(time.Second)
	var issuer string
	provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_ = json.NewEncoder(w).Encode(&oidc.IntrospectionResponse{
			Active: active.Load(), Issuer: issuer, Subject: "user", ClientID: "browser", Audience: []string{"project"},
			TokenType: "Bearer", Expiration: oidc.FromTime(now.Add(time.Hour)),
		})
	}))
	defer provider.Close()
	issuer = provider.URL
	validator, err := newBrowserAccessTokenValidator(browserTokenConfig{
		issuer: issuer, clientID: "browser", audience: "project", clientSecret: "secret",
	}, provider.Client())
	if err != nil {
		t.Fatal(err)
	}
	store := &browserTestSessionStore{session: &browserAuthContext{
		UserInfo: &oidc.UserInfo{Subject: "user"},
		Tokens:   &oidc.Tokens[*oidc.IDTokenClaims]{Token: &oauth2.Token{AccessToken: "access", TokenType: "Bearer", Expiry: now.Add(time.Hour)}},
	}}
	const key = "01234567890123456789012345678901"
	authenticator, err := authentication.New(context.Background(), zitadel.New("unused.example"), key,
		func(context.Context, *zitadel.Zitadel) (authentication.Handler[*browserAuthContext], error) {
			return nil, nil
		},
		authentication.WithSessionStore[*browserAuthContext](store))
	if err != nil {
		t.Fatal(err)
	}
	cookieValue, err := crypto.EncryptAES("session-id", key)
	if err != nil {
		t.Fatal(err)
	}
	handler := authentication.Middleware(authenticator).CheckAuthentication()(validator.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !authentication.IsAuthenticated(r.Context()) {
			t.Error("SDK did not populate session")
		}
		w.WriteHeader(204)
	})))
	for _, want := range []int{204, 401} {
		req := httptest.NewRequest("GET", "/api/v1/authenticated", nil)
		req.AddCookie(&http.Cookie{Name: "zitadel.session", Value: cookieValue})
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		if recorder.Code != want {
			t.Fatalf("got %d want %d", recorder.Code, want)
		}
		active.Store(false)
	}
	if calls.Load() != 2 {
		t.Fatalf("introspection called %d times", calls.Load())
	}
}

func TestBrowserIntrospectionDiagnosticsRedactProviderDetails(t *testing.T) {
	var logs bytes.Buffer
	previous := SlogLogger
	SlogLogger = slog.New(slog.NewJSONHandler(&logs, nil))
	t.Cleanup(func() { SlogLogger = previous })
	provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid_client","error_description":"sensitive-provider-details"}`))
	}))
	defer provider.Close()
	validator, err := newBrowserAccessTokenValidator(browserTokenConfig{
		issuer: provider.URL, clientID: "private-client-id", clientSecret: "private-client-secret", audience: "project",
	}, provider.Client())
	if err != nil {
		t.Fatal(err)
	}
	session := &browserAuthContext{UserInfo: &oidc.UserInfo{Subject: "private-subject"}, Tokens: &oidc.Tokens[*oidc.IDTokenClaims]{Token: &oauth2.Token{
		AccessToken: "private-access-token", TokenType: "Bearer", Expiry: time.Now().Add(time.Hour),
	}}}
	if err := validator.validate(context.Background(), session); err == nil || err == errBrowserTokenInvalid {
		t.Fatalf("unexpected error: %v", err)
	}
	output := logs.String()
	if !strings.Contains(output, `"status":401`) || !strings.Contains(output, `"reason":"invalid_client"`) {
		t.Fatalf("missing diagnostics: %s", output)
	}
	for _, sensitive := range []string{"sensitive-provider-details", "private-client-id", "private-client-secret", "private-subject", "private-access-token", provider.URL} {
		if strings.Contains(output, sensitive) {
			t.Fatal("diagnostics leaked sensitive details")
		}
	}
}
