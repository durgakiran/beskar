package core

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/zitadel/oidc/v3/pkg/crypto"
	"github.com/zitadel/oidc/v3/pkg/oidc"
	"github.com/zitadel/zitadel-go/v3/pkg/authentication"
)

const redisSessionTestKey = "01234567890123456789012345678901"

// Exercise actual Redis TTL and Lua semantics, without using any configured database.
func browserTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	binary, err := exec.LookPath("redis-server")
	if err != nil {
		t.Skip("redis-server is required for Redis integration tests")
	}
	// macOS Unix socket paths are limited to 104 bytes.
	dir, err := os.MkdirTemp("/tmp", "beskar-redis-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket := filepath.Join(dir, "redis.sock")
	command := exec.Command(binary, "--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no")
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = command.Process.Kill(); _ = command.Wait() })
	client := redis.NewClient(&redis.Options{Network: "unix", Addr: socket, MaxRetries: -1, DialTimeout: time.Second, ReadTimeout: time.Second, WriteTimeout: time.Second, ContextTimeoutEnabled: true})
	t.Cleanup(func() { _ = client.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for client.Ping(ctx).Err() != nil {
		select {
		case <-ctx.Done():
			t.Fatal("test Redis failed to start")
		case <-time.After(10 * time.Millisecond):
		}
	}
	return client
}
func redisFixture(t *testing.T) (*refreshFixture, *browserSessionStore) {
	t.Helper()
	f := newRefreshFixture(t)
	initial, _ := f.store.Get("session")
	initial.Tokens.IDTokenClaims = &oidc.IDTokenClaims{TokenClaims: oidc.TokenClaims{Subject: "user", Issuer: "https://identity.example"}}
	client := browserTestRedis(t)
	store, err := newRedisBrowserSessionStore(client, redisSessionTestKey, 30*time.Minute, 8*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	store.now = func() time.Time { return f.now }
	if err := store.Set("session", initial); err != nil {
		t.Fatal(err)
	}
	replicaClient := redis.NewClient(client.Options())
	t.Cleanup(func() { _ = replicaClient.Close() })
	second, err := newRedisBrowserSessionStore(replicaClient, redisSessionTestKey, 30*time.Minute, 8*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	second.now = func() time.Time { return f.now }
	f.store = store
	f.validator.sessions = store
	return f, second
}
func TestBrowserRedisRoundTripAcrossRestart(t *testing.T) {
	f, second := redisFixture(t)
	saved, err := second.Get("session")
	if err != nil {
		t.Fatal(err)
	}
	if saved.Tokens.RefreshToken != "old-refresh" || saved.Tokens.IDToken != "original-verified-id-token" || saved.Tokens.IDTokenClaims.Subject != "user" || saved.UserInfo.Subject != "user" {
		t.Fatal("session did not round trip")
	}
	key, _ := browserRedisKeys("session")
	raw, err := f.store.backend.client.Get(context.Background(), key).Result()
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"old-refresh", "old-access", "original-verified-id-token", "identity.example"} {
		if strings.Contains(raw, secret) {
			t.Fatal("Redis contains plaintext session credentials")
		}
	}
	// A mismatched key or record copied to another session must not authenticate.
	wrong, _ := newRedisBrowserSessionStore(f.store.backend.client, strings.Repeat("x", 32), 30*time.Minute, 8*time.Hour)
	if _, err := wrong.Get("session"); err != errBrowserStoreUnavailable {
		t.Fatal("wrong encryption key accepted")
	}
	other, _ := browserRedisKeys("other")
	_ = f.store.backend.client.Set(context.Background(), other, raw, time.Minute).Err()
	if _, err := second.Get("other"); err != errBrowserStoreUnavailable {
		t.Fatal("record substitution accepted")
	}
}
func TestBrowserRedisConcurrentReplicaRefresh(t *testing.T) {
	f, second := redisFixture(t)
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			store := f.store
			if i%2 == 1 {
				store = second
			}
			s, err := f.validator.prepareSession(context.Background(), store, "session")
			if err != nil {
				t.Error(err)
				return
			}
			if s.Tokens.RefreshToken != "new-refresh" {
				t.Error("replica saw stale rotation")
			}
		}(i)
	}
	wg.Wait()
	if f.refreshes.Load() != 1 || f.inspections.Load() != 12 {
		t.Fatalf("refresh=%d introspection=%d", f.refreshes.Load(), f.inspections.Load())
	}
	saved, err := second.Get("session")
	if err != nil || saved.Tokens.RefreshToken != "new-refresh" {
		t.Fatal("rotation not persisted")
	}
}

func TestBrowserRedisConcurrentIntrospection(t *testing.T) {
	f, second := redisFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	if err := f.store.backend.withSession(ctx, "session", f.store, func(e *browserSession, _ func() error) error {
		e.session.Tokens.Expiry = f.now.Add(time.Hour)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	const requests = 5
	started := make(chan struct{}, requests)
	release := make(chan struct{})
	var revoked atomic.Bool
	f.onIntrospect = func(string) bool {
		if revoked.Load() {
			return false
		}
		started <- struct{}{}
		select {
		case <-release:
		case <-ctx.Done():
		}
		return true
	}
	results := make(chan error, requests)
	for i := range requests {
		store := f.store
		if i%2 == 1 {
			store = second
		}
		go func() {
			_, err := f.validator.prepareSession(ctx, store, "session")
			results <- err
		}()
	}
	for range requests {
		select {
		case <-started:
		case <-ctx.Done():
			t.Fatal("same-session requests did not reach introspection concurrently")
		}
	}
	close(release)
	for range requests {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	if got := f.inspections.Load(); got != requests {
		t.Fatalf("introspection calls = %d, want %d", got, requests)
	}
	revoked.Store(true)
	if _, err := f.validator.prepareSession(ctx, second, "session"); !errors.Is(err, errBrowserTokenInvalid) {
		t.Fatalf("revoked token accepted: %v", err)
	}
	if _, err := f.store.Get("session"); !errors.Is(err, authentication.ErrNoSession) {
		t.Fatalf("revoked session was not cleared: %v", err)
	}
}

func TestBrowserRedisSessionChangesDuringIntrospection(t *testing.T) {
	for _, change := range []string{"logout", "rotation"} {
		t.Run(change, func(t *testing.T) {
			f, second := redisFixture(t)
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			err := f.store.backend.withSession(ctx, "session", f.store, func(e *browserSession, _ func() error) error {
				e.session.Tokens.Expiry = f.now.Add(time.Hour)
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			started := make(chan struct{}, 1)
			release := make(chan struct{})
			f.onIntrospect = func(token string) bool {
				if token == "old-access" {
					started <- struct{}{}
					select {
					case <-release:
					case <-ctx.Done():
					}
					// An earlier response can be active before logout or inactive
					// after rotation. Neither result applies to the current session.
					return change == "logout"
				}
				return true
			}
			done := make(chan error, 1)
			go func() {
				session, err := f.validator.prepareSession(ctx, f.store, "session")
				if change == "rotation" && err == nil && session.Tokens.AccessToken != "new-access" {
					err = errors.New("request authorized with the old access token")
				}
				done <- err
			}()
			select {
			case <-started:
			case <-ctx.Done():
				t.Fatal("introspection did not start")
			}
			if change == "logout" {
				revokeFailed := errors.New("test revocation unavailable")
				if err := second.endSession(ctx, "session", func(context.Context, *browserAuthContext) error { return revokeFailed }); !errors.Is(err, revokeFailed) {
					t.Fatalf("logout did not record its marker: %v", err)
				}
				close(release)
				if err := <-done; !errors.Is(err, errBrowserTokenInvalid) {
					t.Fatalf("request accepted after logout started: %v", err)
				}
				return
			}
			if err := second.backend.withSession(ctx, "session", second, func(e *browserSession, _ func() error) error {
				e.session.Tokens.AccessToken = "new-access"
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			close(release)
			if err := <-done; err != nil {
				t.Fatal(err)
			}
			if got := f.inspections.Load(); got != 2 {
				t.Fatalf("introspection calls = %d, want one per token", got)
			}
		})
	}
}
func TestBrowserRedisLogoutDuringRefresh(t *testing.T) {
	f, second := redisFixture(t)
	started, release := make(chan struct{}), make(chan struct{})
	f.onRefresh = func() { close(started); <-release }
	done := make(chan error, 1)
	go func() { _, err := f.validator.prepareSession(context.Background(), f.store, "session"); done <- err }()
	<-started
	if err := second.Delete("session"); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-done; err != errBrowserTokenInvalid {
		t.Fatalf("late refresh not rejected: %v", err)
	}
	if _, err := second.Get("session"); !errors.Is(err, authentication.ErrNoSession) {
		t.Fatal("logout resurrected")
	}
}
func TestBrowserRedisLeaseLossDoesNotReplayRefresh(t *testing.T) {
	f, second := redisFixture(t)
	started, release := make(chan struct{}), make(chan struct{})
	f.onRefresh = func() { close(started); <-release }
	done := make(chan error, 1)
	go func() { _, err := f.validator.prepareSession(context.Background(), f.store, "session"); done <- err }()
	<-started
	_, lock := browserRedisKeys("session")
	// Simulate expiry while the first process is paused in its provider call.
	_ = f.store.backend.client.Del(context.Background(), lock).Err()
	if _, err := f.validator.prepareSession(context.Background(), second, "session"); err != errBrowserTokenInvalid {
		t.Fatalf("ambiguous refresh not rejected: %v", err)
	}
	close(release)
	if err := <-done; err == nil {
		t.Fatal("stale worker accepted")
	}
	if f.refreshes.Load() != 1 {
		t.Fatal("consumed refresh credential replayed")
	}
	if _, err := second.Get("session"); !errors.Is(err, authentication.ErrNoSession) {
		t.Fatal("stale rotation recreated session")
	}
}
func TestBrowserRedisTTLAndDeadlines(t *testing.T) {
	f, second := redisFixture(t)
	key, _ := browserRedisKeys("session")
	ttl := f.store.backend.client.PTTL(context.Background(), key).Val()
	if ttl <= 29*time.Minute || ttl > 30*time.Minute {
		t.Fatalf("initial TTL %s", ttl)
	}
	f.now = f.now.Add(20 * time.Minute)
	if _, err := f.validator.prepareSession(context.Background(), second, "session"); err != nil {
		t.Fatal(err)
	}
	ttl = f.store.backend.client.PTTL(context.Background(), key).Val()
	if ttl <= 29*time.Minute || ttl > 30*time.Minute {
		t.Fatalf("idle extension TTL %s", ttl)
	}
	// Move creation to just before the absolute cap without letting the idle cap expire.
	err := f.store.backend.withSession(context.Background(), "session", f.store, func(e *browserSession, _ func() error) error {
		e.created = f.now.Add(-8*time.Hour + time.Minute)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	ttl = f.store.backend.client.PTTL(context.Background(), key).Val()
	if ttl <= 0 || ttl > time.Minute {
		t.Fatalf("absolute cap extended: %s", ttl)
	}
	f.now = f.now.Add(time.Minute)
	if _, err := f.validator.prepareSession(context.Background(), second, "session"); err != errBrowserTokenInvalid {
		t.Fatal("absolute expiry accepted")
	}
	if f.store.backend.client.Exists(context.Background(), key).Val() != 0 {
		t.Fatal("expired session retained")
	}
}
func TestBrowserRedisAutomaticCleanup(t *testing.T) {
	f, second := redisFixture(t)
	key, _ := browserRedisKeys("session")
	if err := f.store.backend.client.PExpire(context.Background(), key, 5*time.Millisecond).Err(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if f.store.backend.client.Exists(context.Background(), key).Val() == 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if _, err := second.Get("session"); !errors.Is(err, authentication.ErrNoSession) {
		t.Fatal("TTL did not expire session")
	}
}
func TestBrowserRedisOutageReturns503(t *testing.T) {
	f, _ := redisFixture(t)
	t.Setenv("KEY", redisSessionTestKey)
	_ = f.store.backend.client.Close()
	value, _ := crypto.EncryptAES("session", redisSessionTestKey)
	req := httptest.NewRequest("GET", "/api/v1/authenticated", nil)
	req.AddCookie(&http.Cookie{Name: "zitadel.session", Value: value})
	response := httptest.NewRecorder()
	f.validator.Middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("outage reached handler") })).ServeHTTP(response, req)
	if response.Code != 503 || !strings.Contains(response.Body.String(), "AUTH_UNAVAILABLE") {
		t.Fatalf("status %d", response.Code)
	}
	response = httptest.NewRecorder()
	browserLogoutHandler(f.store, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://identity.example/logout", 302)
	}, func(context.Context, *browserAuthContext) error { return nil }).ServeHTTP(response, req)
	if response.Code != 503 || response.Header().Get("Location") != "" {
		t.Fatal("logout reported success without deletion")
	}
}
func TestBrowserRedisPersistsRotationBeforeIntrospection(t *testing.T) {
	f, second := redisFixture(t)
	f.introspectStatus = 503
	if _, err := f.validator.prepareSession(context.Background(), f.store, "session"); err == nil {
		t.Fatal("outage accepted")
	}
	f.introspectStatus = 0
	if _, err := f.validator.prepareSession(context.Background(), second, "session"); err != nil {
		t.Fatal(err)
	}
	if f.refreshes.Load() != 1 {
		t.Fatal("rotation lost on replica change")
	}
}
func TestBrowserRedisConfiguration(t *testing.T) {
	t.Setenv("REDIS_ADDR", "")
	t.Setenv("REDIS_HOST", "")
	if _, err := browserRedisOptions(); err == nil {
		t.Fatal("missing Redis accepted")
	}
	t.Setenv("REDIS_HOST", "localhost")
	t.Setenv("REDIS_PASSWORD", "a+:/@")
	opts, err := browserRedisOptions()
	if err != nil || opts.Password != "a+:/@" {
		t.Fatal("password mangled")
	}
	t.Setenv("REDIS_ADDR", "rediss://user:secret@redis.example:6379/2")
	opts, err = browserRedisOptions()
	if err != nil || opts.TLSConfig == nil || opts.DB != 2 {
		t.Fatal("TLS URL not respected")
	}
	t.Setenv("BROWSER_SESSION_IDLE_TIMEOUT", "invalid")
	if _, err := browserSessionDuration("BROWSER_SESSION_IDLE_TIMEOUT", time.Minute); err == nil {
		t.Fatal("bad timeout accepted")
	}
	if _, err := newRedisBrowserSessionStore(nil, "short", time.Minute, time.Hour); err == nil {
		t.Fatal("weak key accepted")
	}
}

func TestBrowserRedisCookieAcrossReplicasAndLogout(t *testing.T) {
	f, second := redisFixture(t)
	t.Setenv("KEY", redisSessionTestKey)
	other := *f.validator
	other.sessions = second
	value, _ := crypto.EncryptAES("session", redisSessionTestKey)
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s := authentication.Context[*browserAuthContext](r.Context())
		if s == nil || s.UserInfo.Subject != "user" || s.Tokens.RefreshToken != "new-refresh" {
			t.Error("missing Redis auth context")
		}
		w.WriteHeader(204)
	})
	for _, v := range []*BrowserAccessTokenValidator{f.validator, &other} {
		request := httptest.NewRequest("GET", "/api/v1/authenticated", nil)
		request.AddCookie(&http.Cookie{Name: "zitadel.session", Value: value})
		response := httptest.NewRecorder()
		v.Middleware(next).ServeHTTP(response, request)
		if response.Code != 204 {
			t.Fatalf("replica returned %d", response.Code)
		}
	}
	logoutRequest := httptest.NewRequest("POST", "/auth/logout", nil)
	logoutRequest.AddCookie(&http.Cookie{Name: "zitadel.session", Value: value})
	response := httptest.NewRecorder()
	browserLogoutHandler(second, func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "zitadel.session", MaxAge: -1, Path: "/", Secure: true, HttpOnly: true})
		http.Redirect(w, r, "https://identity.example/logout", 302)
	}, func(context.Context, *browserAuthContext) error { return nil }).ServeHTTP(response, logoutRequest)
	if response.Code != 200 || response.Header().Get("Set-Cookie") == "" {
		t.Fatal("successful logout response lost")
	}
	request := httptest.NewRequest("GET", "/api/v1/authenticated", nil)
	request.AddCookie(&http.Cookie{Name: "zitadel.session", Value: value})
	response = httptest.NewRecorder()
	f.validator.Middleware(next).ServeHTTP(response, request)
	if response.Code != 401 {
		t.Fatal("logged out cookie accepted")
	}
	// Intentionally public routes still work without a cookie.
	response = httptest.NewRecorder()
	f.validator.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })).ServeHTTP(response, httptest.NewRequest("GET", "/public", nil))
	if response.Code != 204 {
		t.Fatal("anonymous public request blocked")
	}
}
func TestBrowserRedisIdleExpiry(t *testing.T) {
	f, second := redisFixture(t)
	f.now = f.now.Add(30 * time.Minute)
	if _, err := f.validator.prepareSession(context.Background(), second, "session"); err != errBrowserTokenInvalid {
		t.Fatal("idle expiry accepted")
	}
	if f.refreshes.Load() != 0 {
		t.Fatal("expired session refreshed")
	}
	key, _ := browserRedisKeys("session")
	if f.store.backend.client.Exists(context.Background(), key).Val() != 0 {
		t.Fatal("expired record retained")
	}
}
