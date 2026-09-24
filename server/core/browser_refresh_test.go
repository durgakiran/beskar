package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"golang.org/x/exp/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/zitadel/oidc/v3/pkg/crypto"
	"github.com/zitadel/oidc/v3/pkg/oidc"
	"github.com/zitadel/zitadel-go/v3/pkg/authentication"
	"github.com/zitadel/zitadel-go/v3/pkg/zitadel"
	"golang.org/x/oauth2"
)

type refreshFixture struct {
	onRefresh              func()
	validator              *BrowserAccessTokenValidator
	store                  *browserSessionStore
	refreshes, inspections atomic.Int32
	refreshStatus          int
	refreshBody            string
	introspectStatus       int
	active                 bool
	now                    time.Time
}

func newRefreshFixture(t *testing.T) *refreshFixture {
	t.Helper()
	f := &refreshFixture{now: time.Now(), active: true, refreshBody: `{"access_token":"new-access","refresh_token":"new-refresh","token_type":"Bearer","expires_in":3600}`}
	var issuer string
	provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		id, secret, ok := r.BasicAuth()
		if !ok || id != url.QueryEscape("web@app") || secret != url.QueryEscape("secret+:/=") {
			t.Error("missing confidential client Basic authentication")
		}
		if r.Method != http.MethodPost {
			t.Error("expected POST")
		}
		switch r.URL.Path {
		case "/oauth/v2/token":
			count := f.refreshes.Add(1)
			if f.onRefresh != nil {
				f.onRefresh()
			}
			expectedRefresh := "old-refresh"
			if count > 1 {
				expectedRefresh = "new-refresh"
			}
			if r.FormValue("grant_type") != "refresh_token" || r.FormValue("refresh_token") != expectedRefresh {
				t.Error("unexpected refresh grant")
			}
			if r.FormValue("client_secret") != "" {
				t.Error("secret in form")
			}
			if f.refreshStatus != 0 {
				w.WriteHeader(f.refreshStatus)
			}
			_, _ = w.Write([]byte(f.refreshBody))
		case "/oauth/v2/introspect":
			f.inspections.Add(1)
			if f.introspectStatus != 0 {
				w.WriteHeader(f.introspectStatus)
				return
			}
			if r.FormValue("token") != "new-access" && r.FormValue("token") != "old-access" {
				t.Error("unexpected introspected token")
			}
			_ = json.NewEncoder(w).Encode(&oidc.IntrospectionResponse{Active: f.active, Subject: "user", ClientID: "web@app", Issuer: issuer, Audience: []string{"project"}, TokenType: "Bearer", Expiration: oidc.FromTime(f.now.Add(time.Hour))})
		default:
			t.Error("unexpected endpoint")
			w.WriteHeader(404)
		}
	}))
	issuer = provider.URL
	t.Cleanup(provider.Close)
	client := provider.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	var err error
	f.validator, err = newBrowserAccessTokenValidator(browserTokenConfig{issuer: issuer, clientID: "web@app", clientSecret: "secret+:/=", audience: "project"}, client)
	if err != nil {
		t.Fatal(err)
	}
	f.store = newBrowserSessionStore()
	f.store.now = func() time.Time { return f.now }
	f.validator.sessions = f.store
	f.validator.now = func() time.Time { return f.now }
	_ = f.store.Set("session", &browserAuthContext{UserInfo: &oidc.UserInfo{Subject: "user"}, Tokens: &oidc.Tokens[*oidc.IDTokenClaims]{IDToken: "original-verified-id-token", Token: &oauth2.Token{AccessToken: "old-access", RefreshToken: "old-refresh", TokenType: "Bearer", Expiry: f.now.Add(-time.Minute)}}})
	return f
}
func TestBrowserRefreshConcurrentCookieRequests(t *testing.T) {
	f := newRefreshFixture(t)
	const key = "01234567890123456789012345678901"
	t.Setenv("KEY", key)
	authenticator, err := authentication.New(context.Background(), zitadel.New("unused.example"), key,
		func(context.Context, *zitadel.Zitadel) (authentication.Handler[*browserAuthContext], error) {
			return nil, nil
		},
		authentication.WithSessionStore[*browserAuthContext](f.store))
	if err != nil {
		t.Fatal(err)
	}
	handler := authentication.Middleware(authenticator).CheckAuthentication()(f.validator.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s := authentication.Context[*browserAuthContext](r.Context())
		if s.Tokens.AccessToken != "new-access" || s.Tokens.RefreshToken != "new-refresh" {
			t.Error("handler saw stale tokens")
		}
		w.WriteHeader(204)
	})))
	value, _ := crypto.EncryptAES("session", key)
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := httptest.NewRequest("GET", "/api/v1/authenticated", nil)
			req.AddCookie(&http.Cookie{Name: "zitadel.session", Value: value})
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, req)
			if recorder.Code != 204 {
				t.Errorf("status %d", recorder.Code)
			}
		}()
	}
	wg.Wait()
	if f.refreshes.Load() != 1 || f.inspections.Load() != 12 {
		t.Fatalf("refresh=%d introspect=%d", f.refreshes.Load(), f.inspections.Load())
	}
	saved, _ := f.store.Get("session")
	if saved.Tokens.RefreshToken != "new-refresh" || saved.Tokens.IDToken != "original-verified-id-token" {
		t.Fatal("rotation or identity lost")
	}
	saved.Tokens.AccessToken = "mutated"
	again, _ := f.store.Get("session")
	if again.Tokens.AccessToken != "new-access" {
		t.Fatal("store leaked mutable token state")
	}
}
func TestBrowserRefreshFailures(t *testing.T) {
	for _, tc := range []struct {
		name    string
		status  int
		body    string
		invalid bool
	}{
		{"revoked refresh", 400, `{"error":"invalid_grant"}`, true},
		{"credentials", 401, `{"error":"invalid_client","error_description":"secret"}`, false},
		{"outage", 503, `unavailable`, false},
		{"rate limited", 429, `limited`, false},
		{"malformed", 200, `not json`, false},
		{"missing expiry", 200, `{"access_token":"new-access","token_type":"Bearer"}`, true},
		{"wrong type", 200, `{"access_token":"new-access","token_type":"unexpected","expires_in":3600}`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newRefreshFixture(t)
			f.refreshStatus = tc.status
			f.refreshBody = tc.body
			for i := 0; i < 2; i++ {
				_, err := f.validator.prepareSession(context.Background(), f.store, "session")
				if err == nil || (err == errBrowserTokenInvalid) != (tc.invalid || (tc.name == "malformed" && i > 0)) {
					t.Fatalf("unexpected error %v", err)
				}
			}
			if f.refreshes.Load() != 1 {
				t.Fatal("failed refresh was immediately retried")
			}
			_, err := f.store.Get("session")
			if (err != nil) != (tc.invalid || tc.name == "malformed") {
				t.Fatal("incorrect session retention")
			}
		})
	}
}
func TestBrowserRefreshRetainsRotationAcrossIntrospectionOutage(t *testing.T) {
	f := newRefreshFixture(t)
	f.introspectStatus = 503
	if _, err := f.validator.prepareSession(context.Background(), f.store, "session"); err == nil {
		t.Fatal("outage accepted")
	}
	saved, err := f.store.Get("session")
	if err != nil || saved.Tokens.RefreshToken != "new-refresh" {
		t.Fatal("rotated refresh token lost")
	}
	f.introspectStatus = 0
	if _, err := f.validator.prepareSession(context.Background(), f.store, "session"); err != nil {
		t.Fatal(err)
	}
	if f.refreshes.Load() != 1 {
		t.Fatal("rotated token unnecessarily refreshed")
	}
}
func TestBrowserRefreshDoesNotReviveInactiveAccessToken(t *testing.T) {
	f := newRefreshFixture(t)
	s, _ := f.store.Get("session")
	s.Tokens.Expiry = f.now.Add(time.Hour)
	_ = f.store.Set("session", s)
	f.active = false
	if _, err := f.validator.prepareSession(context.Background(), f.store, "session"); err != errBrowserTokenInvalid {
		t.Fatal(err)
	}
	f.now = f.now.Add(2 * time.Hour)
	if _, err := f.validator.prepareSession(context.Background(), f.store, "session"); err != errBrowserTokenInvalid {
		t.Fatal(err)
	}
	if f.refreshes.Load() != 0 {
		t.Fatal("inactive session refreshed")
	}
}
func TestBrowserRefreshMissingRefreshAndSessionDeadlines(t *testing.T) {
	for _, kind := range []string{"missing refresh", "idle", "absolute", "deleted"} {
		t.Run(kind, func(t *testing.T) {
			f := newRefreshFixture(t)
			switch kind {
			case "missing refresh":
				s, _ := f.store.Get("session")
				s.Tokens.RefreshToken = ""
				_ = f.store.Set("session", s)
			case "idle":
				f.now = f.now.Add(30 * time.Minute)
			case "absolute":
				e := f.store.entry("session")
				f.now = f.now.Add(8 * time.Hour)
				e.lastSeen = f.now
			case "deleted":
				f.store.Delete("session")
			}
			if _, err := f.validator.prepareSession(context.Background(), f.store, "session"); err != errBrowserTokenInvalid {
				t.Fatal(err)
			}
			if f.refreshes.Load() != 0 {
				t.Fatal("invalid session refreshed")
			}
			f.store.Sweep()
			if f.store.entry("session") != nil {
				t.Fatal("expired session retained")
			}
		})
	}
}
func TestBrowserSessionStoreConcurrentAccess(t *testing.T) {
	store := newBrowserSessionStore()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := fmt.Sprint(i)
			for j := 0; j < 30; j++ {
				_ = store.Set(id, &browserAuthContext{})
				_, _ = store.Get(id)
				store.Sweep()
				store.Delete(id)
			}
		}(i)
	}
	wg.Wait()
}

func TestBrowserRefreshReusesLatestRotation(t *testing.T) {
	f := newRefreshFixture(t)
	if _, err := f.validator.prepareSession(context.Background(), f.store, "session"); err != nil {
		t.Fatal(err)
	}
	// Expire access only, keeping the application session active.
	e := f.store.entry("session")
	e.session.Tokens.Expiry = f.now.Add(-time.Second)
	if _, err := f.validator.prepareSession(context.Background(), f.store, "session"); err != nil {
		t.Fatal(err)
	}
	if f.refreshes.Load() != 2 {
		t.Fatal("second rotation not performed")
	}
}
func TestBrowserRefreshPreservesOmittedRefreshToken(t *testing.T) {
	f := newRefreshFixture(t)
	f.refreshBody = `{"access_token":"new-access","token_type":"Bearer","expires_in":3600}`
	if _, err := f.validator.prepareSession(context.Background(), f.store, "session"); err != nil {
		t.Fatal(err)
	}
	saved, _ := f.store.Get("session")
	if saved.Tokens.RefreshToken != "old-refresh" {
		t.Fatal("omitted refresh token erased existing credential")
	}
}
func TestBrowserRefreshTransientRecovery(t *testing.T) {
	f := newRefreshFixture(t)
	f.refreshStatus = 503
	if _, err := f.validator.prepareSession(context.Background(), f.store, "session"); err == nil {
		t.Fatal("outage accepted")
	}
	f.refreshStatus = 0
	// The failed exchange did not consume the refresh token.
	f.refreshes.Store(0)
	f.now = f.now.Add(4 * time.Second)
	if _, err := f.validator.prepareSession(context.Background(), f.store, "session"); err != nil {
		t.Fatal(err)
	}
}
func TestBrowserRefreshDeletedSessionCannotReturn(t *testing.T) {
	f := newRefreshFixture(t)
	if _, err := f.validator.prepareSession(context.Background(), f.store, "session"); err != nil {
		t.Fatal(err)
	}
	f.store.Delete("session")
	if _, err := f.validator.prepareSession(context.Background(), f.store, "session"); err != errBrowserTokenInvalid {
		t.Fatal("deleted session accepted")
	}
	if f.refreshes.Load() != 1 {
		t.Fatal("logout allowed another refresh")
	}
}

func TestBrowserRefreshDisconnectRetainsRotation(t *testing.T) {
	f := newRefreshFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	f.onRefresh = cancel
	_, _ = f.validator.prepareSession(ctx, f.store, "session")
	saved, err := f.store.Get("session")
	if err != nil || saved.Tokens.RefreshToken != "new-refresh" {
		t.Fatal("disconnect lost rotation")
	}
}
func TestBrowserRefreshLogoutDuringExchange(t *testing.T) {
	f := newRefreshFixture(t)
	started, release := make(chan struct{}), make(chan struct{})
	f.onRefresh = func() { close(started); <-release }
	refreshed := make(chan struct{})
	go func() {
		defer close(refreshed)
		_, _ = f.validator.prepareSession(context.Background(), f.store, "session")
	}()
	<-started
	deleted := make(chan struct{})
	go func() { defer close(deleted); f.store.Delete("session") }()
	close(release)
	<-refreshed
	<-deleted
	if _, err := f.store.Get("session"); err == nil {
		t.Fatal("refresh restored logged out session")
	}
}

func TestBrowserRefreshPresenceLogs(t *testing.T) {
	for _, replacement := range []bool{true, false} {
		t.Run(fmt.Sprint(replacement), func(t *testing.T) {
			var logs bytes.Buffer
			previous := SlogLogger
			SlogLogger = slog.New(slog.NewJSONHandler(&logs, nil))
			t.Cleanup(func() { SlogLogger = previous })
			f := newRefreshFixture(t)
			if !replacement {
				f.refreshBody = `{"access_token":"new-access","token_type":"Bearer","expires_in":3600}`
			}
			if _, err := f.validator.prepareSession(context.Background(), f.store, "session"); err != nil {
				t.Fatal(err)
			}
			saved, _ := f.store.Get("session")
			output := logs.String()
			if !strings.Contains(output, `"access_token_expires_at":"`+saved.Tokens.Expiry.UTC().Format(time.RFC3339)+`"`) {
				t.Fatal("refreshed expiry missing from logs")
			}
			for _, expected := range []string{`"msg":"browser login session stored"`, `"refresh_token_present":true`, `"access_token_expires_at":"` + f.now.Add(-time.Minute).UTC().Format(time.RFC3339) + `"`, fmt.Sprintf(`"refresh_token_received":%t`, replacement), fmt.Sprintf(`"refresh_token_rotated":%t`, replacement)} {
				if !strings.Contains(output, expected) {
					t.Fatalf("missing log field %s", expected)
				}
			}
			for _, secret := range []string{"old-refresh", "new-refresh", "old-access", "new-access", "original-verified-id-token", "secret+:/="} {
				if strings.Contains(output, secret) {
					t.Fatal("credential leaked in logs")
				}
			}
			logs.Reset()
			_ = f.store.Set("empty", &browserAuthContext{})
			if !strings.Contains(logs.String(), `"refresh_token_present":false`) || !strings.Contains(logs.String(), `"access_token_expires_at":"unknown"`) {
				t.Fatal("missing-token login not logged")
			}
		})
	}
}
