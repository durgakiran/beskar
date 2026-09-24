package core

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"testing"
	"time"

	"github.com/zitadel/oidc/v3/pkg/crypto"
)

func TestBrowserLogoutRevocationProtocol(t *testing.T) {
	for _, status := range []int{200, 400, 401, 429, 500, 503, 302} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			f := newRefreshFixture(t)
			session, _ := f.store.Get("session")
			var tokens []string
			provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				id, secret, ok := r.BasicAuth()
				if !ok || id != url.QueryEscape("web@app") || secret != url.QueryEscape("secret+:/=") {
					t.Error("incorrect client authentication")
				}
				if r.Method != "POST" || r.URL.Path != "/oauth/v2/revoke" || r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
					t.Error("incorrect revocation request")
				}
				tokens = append(tokens, r.FormValue("token"))
				wantHint := "refresh_token"
				if len(tokens) == 2 {
					wantHint = "access_token"
				}
				if r.FormValue("token_type_hint") != wantHint {
					t.Error("incorrect token hint")
				}
				if status == 302 {
					w.Header().Set("Location", "/should-not-follow")
				}
				w.WriteHeader(status)
			}))
			defer provider.Close()
			f.validator.issuer = provider.URL
			f.validator.refreshClient = provider.Client()
			err := f.validator.revokeSessionTokens(context.Background(), session)
			if (err == nil) != (status == 200) {
				t.Fatalf("status %d: %v", status, err)
			}
			want := []string{"old-refresh"}
			if status == 200 {
				want = append(want, "old-access")
			}
			if !reflect.DeepEqual(tokens, want) {
				t.Fatalf("tokens %v", tokens)
			}
		})
	}
}

func TestBrowserLogoutFailureAndManualRetry(t *testing.T) {
	f, second := redisFixture(t)
	t.Setenv("KEY", redisSessionTestKey)
	value, _ := crypto.EncryptAES("session", redisSessionTestKey)
	req := httptest.NewRequest("GET", "/auth/logout", nil)
	req.AddCookie(&http.Cookie{Name: "zitadel.session", Value: value})
	fail := true
	calls := 0
	handler := browserLogoutHandler(f.store, func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "zitadel.session", MaxAge: -1})
		http.Redirect(w, r, "https://identity.example/logout", 302)
	}, func(ctx context.Context, s *browserAuthContext) error {
		calls++
		if s.Tokens.RefreshToken != "old-refresh" {
			t.Error("lost retry credential")
		}
		if fail {
			return errors.New("provider unavailable")
		}
		return nil
	})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != 503 || response.Header().Get("Location") != "" || response.Header().Get("Set-Cookie") != "" {
		t.Fatal("failure cleared cookie or reported success")
	}
	if _, err := second.Get("session"); err != nil {
		t.Fatal("retry credentials lost", err)
	}
	if _, err := f.validator.prepareSession(context.Background(), second, "session"); !errors.Is(err, errBrowserTokenInvalid) {
		t.Fatal("ending session authorized", err)
	}
	if f.refreshes.Load() != 0 {
		t.Fatal("ending session refreshed")
	}
	fail = false
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != 302 || response.Header().Get("Set-Cookie") == "" || calls != 2 {
		t.Fatal("manual retry failed")
	}
	if _, err := second.Get("session"); err == nil {
		t.Fatal("session survived logout")
	}
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != 302 || calls != 2 {
		t.Fatal("repeated logout not idempotent")
	}
}

func TestBrowserLogoutWaitsForRotation(t *testing.T) {
	f, second := redisFixture(t)
	entered, release := make(chan struct{}), make(chan struct{})
	f.onRefresh = func() { close(entered); <-release }
	refreshDone := make(chan error, 1)
	go func() {
		_, err := f.validator.prepareSession(context.Background(), f.store, "session")
		refreshDone <- err
	}()
	<-entered
	logoutDone := make(chan error, 1)
	go func() {
		logoutDone <- second.endSession(context.Background(), "session", func(ctx context.Context, s *browserAuthContext) error {
			if s.Tokens.RefreshToken != "new-refresh" || s.Tokens.AccessToken != "new-access" {
				t.Error("revoked stale tokens")
			}
			return nil
		})
	}()
	select {
	case err := <-logoutDone:
		t.Fatal("logout did not wait for refresh", err)
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	if err := <-refreshDone; err != nil {
		t.Fatal(err)
	}
	if err := <-logoutDone; err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.Get("session"); err == nil {
		t.Fatal("session survived")
	}
}

func TestBrowserRevocationNetworkFailure(t *testing.T) {
	f := newRefreshFixture(t)
	s, _ := f.store.Get("session")
	provider := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	f.validator.issuer = provider.URL
	f.validator.refreshClient = provider.Client()
	provider.Close()
	if err := f.validator.revokeSessionTokens(context.Background(), s); err == nil {
		t.Fatal("network failure accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := f.validator.revokeSessionTokens(ctx, s); err == nil {
		t.Fatal("canceled revocation accepted")
	}
}

func TestBrowserLogoutPartialRevocationRetry(t *testing.T) {
	f, second := redisFixture(t)
	var tokens []string
	failAccess := true
	provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.FormValue("token")
		tokens = append(tokens, token)
		if token == "old-access" && failAccess {
			w.WriteHeader(503)
			return
		}
		w.WriteHeader(200)
	}))
	defer provider.Close()
	f.validator.issuer = provider.URL
	f.validator.refreshClient = provider.Client()
	if err := f.store.endSession(context.Background(), "session", f.validator.revokeSessionTokens); err == nil {
		t.Fatal("partial revocation reported success")
	}
	if _, err := second.Get("session"); err != nil {
		t.Fatal("partial revocation lost credentials", err)
	}
	if _, err := f.validator.prepareSession(context.Background(), second, "session"); !errors.Is(err, errBrowserTokenInvalid) {
		t.Fatal("partial revocation session accepted")
	}
	failAccess = false
	if err := second.endSession(context.Background(), "session", f.validator.revokeSessionTokens); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(tokens, []string{"old-refresh", "old-access", "old-refresh", "old-access"}) {
		t.Fatalf("unexpected retries: %v", tokens)
	}
	if _, err := f.store.Get("session"); err == nil {
		t.Fatal("session survived retry")
	}
}

func TestBrowserLogoutDeletionFailure(t *testing.T) {
	f, _ := redisFixture(t)
	err := f.store.endSession(context.Background(), "session", func(context.Context, *browserAuthContext) error {
		// Provider succeeded, but the final Redis deletion cannot be confirmed.
		return f.store.backend.client.Close()
	})
	if !errors.Is(err, errBrowserStoreUnavailable) {
		t.Fatalf("deletion failure reported success: %v", err)
	}
}
