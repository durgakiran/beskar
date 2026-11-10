package auth

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"beskar/desktop/config"
)

type memoryCredentials struct {
	mu                sync.Mutex
	tokens            TokenStore
	saves, clears     int
	saveErr, clearErr error
	saveErrAt         int
}

func (m *memoryCredentials) Load() (TokenStore, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.tokens, nil
}
func (m *memoryCredentials) Save(tokens TokenStore) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.saves++
	if m.saveErr != nil && (m.saveErrAt == 0 || m.saves == m.saveErrAt) {
		return m.saveErr
	}
	m.tokens = tokens
	return nil
}
func (m *memoryCredentials) Clear() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.clears++
	if m.clearErr != nil {
		return m.clearErr
	}
	m.tokens = TokenStore{}
	return nil
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func tokenHTTP(status int, body string) (*http.Response, error) {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
}
func testSession(t *testing.T, transport roundTripFunc) (*Manager, *memoryCredentials, uint64) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	store := &memoryCredentials{}
	s := &Manager{ctx: ctx, cfg: &config.AppConfig{ZitadelURL: "https://identity.test", ClientID: "test-client"}, store: store, client: &http.Client{Transport: transport}, emit: func(string) {}, verifyAccount: func(_ context.Context, _ tokenResponse, subject, nonce string) (string, error) { return subject, nil }}
	initial := TokenStore{Subject: "test-subject", LoginNonce: "test-nonce", AccessToken: "old-access", RefreshToken: "old-refresh", IDToken: "old-id", Expiry: time.Now().Add(-time.Minute)}
	_ = store.Save(initial)
	s.mu.Lock()
	generation := s.installSessionLocked(initial)
	s.mu.Unlock()
	return s, store, generation
}
func waitClosed(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("worker/request did not stop")
	}
}

func TestRefreshPreservesOmissionsAndPersistsRotation(t *testing.T) {
	for _, rotate := range []bool{false, true} {
		t.Run(map[bool]string{false: "omitted", true: "rotated"}[rotate], func(t *testing.T) {
			s, store, generation := testSession(t, func(r *http.Request) (*http.Response, error) {
				if err := r.ParseForm(); err != nil {
					t.Error(err)
				}
				if r.Form.Get("refresh_token") != "old-refresh" || r.Form.Get("grant_type") != "refresh_token" {
					t.Error("wrong renewal credential")
				}
				if rotate {
					return tokenHTTP(200, `{"access_token":"new-access","refresh_token":"new-refresh","id_token":"new-id","expires_in":3600}`)
				}
				return tokenHTTP(200, `{"access_token":"new-access","expires_in":3600}`)
			})
			if err := s.doRefresh(generation); err != nil {
				t.Fatal(err)
			}
			saved, _ := store.Load()
			expectedRefresh, expectedID := "old-refresh", "old-id"
			if rotate {
				expectedRefresh, expectedID = "new-refresh", "new-id"
			}
			if saved.RefreshPending || saved.RefreshToken != expectedRefresh || saved.IDToken != expectedID || saved.AccessToken != "new-access" {
				t.Fatal("rotation/omission not persisted correctly")
			}
			if s.GetAccessToken() != "new-access" {
				t.Fatal("new access token unavailable")
			}
		})
	}
}

func TestConcurrentRefreshRequestsShareOneExchange(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var requests atomic.Int32
	s, _, _ := testSession(t, func(r *http.Request) (*http.Response, error) {
		if requests.Add(1) == 1 {
			close(started)
		}
		<-release
		return tokenHTTP(200, `{"access_token":"new-access","refresh_token":"rotated","expires_in":3600}`)
	})
	var wg sync.WaitGroup
	var failures atomic.Int32
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if s.GetAccessToken() != "new-access" {
				failures.Add(1)
			}
		}()
	}
	waitClosed(t, started)
	close(release)
	wg.Wait()
	if requests.Load() != 1 || failures.Load() != 0 {
		t.Fatal("concurrent callers did not share renewal")
	}
}

func TestShortLivedTokensDoNotRefreshOnEveryRead(t *testing.T) {
	var requests atomic.Int32
	s, _, _ := testSession(t, func(*http.Request) (*http.Response, error) {
		requests.Add(1)
		return tokenHTTP(200, `{"access_token":"short-lived","expires_in":60}`)
	})
	for i := 0; i < 5; i++ {
		if s.GetAccessToken() != "short-lived" {
			t.Fatal("short-lived token not usable")
		}
	}
	if requests.Load() != 1 {
		t.Fatal("short-lived token caused repeated renewal")
	}
}

func TestRefreshDoesNotStartAnotherWorker(t *testing.T) {
	s, _, generation := testSession(t, func(*http.Request) (*http.Response, error) {
		return tokenHTTP(200, `{"access_token":"new-access","expires_in":3600}`)
	})
	s.mu.Lock()
	worker := s.workerDone
	s.mu.Unlock()
	for i := 0; i < 5; i++ {
		s.mu.Lock()
		s.expiry = time.Now().Add(-time.Minute)
		s.mu.Unlock()
		if err := s.doRefresh(generation); err != nil {
			t.Fatal(err)
		}
		s.mu.Lock()
		same := s.workerDone == worker && s.generation == generation
		s.mu.Unlock()
		if !same {
			t.Fatal("refresh replaced the session worker")
		}
	}
	s.sessionCancel()
	waitClosed(t, worker)
}

func TestLogoutAndReplacementRejectLateRefresh(t *testing.T) {
	for _, response := range []string{"success", "invalid_grant"} {
		t.Run(response, func(t *testing.T) {
			started, release := make(chan struct{}), make(chan struct{})
			s, store, generation := testSession(t, func(r *http.Request) (*http.Response, error) {
				if strings.HasSuffix(r.URL.Path, "/revoke") {
					return tokenHTTP(200, `{}`)
				}
				close(started)
				<-release // deliberately ignore request cancellation
				if response == "invalid_grant" {
					return tokenHTTP(400, `{"error":"invalid_grant"}`)
				}
				return tokenHTTP(200, `{"access_token":"late-access","refresh_token":"late-refresh","expires_in":3600}`)
			})
			s.mu.Lock()
			oldWorker := s.workerDone
			s.mu.Unlock()
			done := make(chan struct{})
			go func() { defer close(done); _ = s.doRefresh(generation) }()
			waitClosed(t, started)
			if err := s.Logout(); err != nil {
				t.Fatal(err)
			}
			waitClosed(t, oldWorker)
			if s.GetAccessToken() != "" {
				t.Fatal("logout retained a local token")
			}
			if saved, _ := store.Load(); saved.RefreshToken != "" {
				t.Fatal("logout retained saved credentials")
			}
			if err := s.adoptLogin(context.Background(), s.currentGeneration(), tokenResponse{AccessToken: "account-b", RefreshToken: "account-b-refresh", ExpiresIn: 3600, subject: "test-subject", nonce: "test-nonce"}); err != nil {
				t.Fatal(err)
			}
			close(release)
			waitClosed(t, done)
			if s.GetAccessToken() != "account-b" {
				t.Fatal("old refresh affected new account")
			}
			if saved, _ := store.Load(); saved.RefreshToken != "account-b-refresh" {
				t.Fatal("old refresh changed saved new account")
			}
		})
	}
}

func TestLateLoginCannotResurrectLogout(t *testing.T) {
	s, store, generation := testSession(t, func(*http.Request) (*http.Response, error) { return tokenHTTP(200, `{}`) })
	if err := s.Logout(); err != nil {
		t.Fatal(err)
	}
	if err := s.adoptLogin(context.Background(), generation, tokenResponse{AccessToken: "late-login", RefreshToken: "late-refresh", ExpiresIn: 3600, subject: "test-subject", nonce: "test-nonce"}); !errors.Is(err, errSessionChanged) {
		t.Fatal("stale login was accepted")
	}
	if saved, _ := store.Load(); saved.AccessToken != "" {
		t.Fatal("late login rewrote keychain")
	}
}

func TestRefreshFailureClassification(t *testing.T) {
	for _, tc := range []struct {
		name        string
		status      int
		body        string
		invalidates bool
	}{
		{"invalid grant", 400, `{"error":"invalid_grant"}`, true},
		{"provider outage", 503, `{"error":"temporarily_unavailable"}`, true},
		{"malformed", 200, `not-json`, true},
		{"empty access token", 200, `{"expires_in":3600}`, true},
		{"expired response", 200, `{"access_token":"new","expires_in":0}`, true},
		{"overflow", 200, `{"access_token":"new","expires_in":9223372036854775807}`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, store, generation := testSession(t, func(*http.Request) (*http.Response, error) { return tokenHTTP(tc.status, tc.body) })
			if err := s.doRefresh(generation); err == nil {
				t.Fatal("invalid response accepted")
			}
			saved, _ := store.Load()
			if (saved.RefreshToken == "") != tc.invalidates {
				t.Fatal("unexpected credential deletion/retention")
			}
			if s.GetAccessToken() != "" {
				t.Fatal("expired token returned after failure")
			}
		})
	}
}

func TestFailedRotationPersistenceInvalidatesSession(t *testing.T) {
	s, store, generation := testSession(t, func(*http.Request) (*http.Response, error) {
		return tokenHTTP(200, `{"access_token":"new","refresh_token":"rotated","expires_in":3600}`)
	})
	store.saveErr = errors.New("keychain unavailable")
	store.saveErrAt = 3
	if err := s.doRefresh(generation); err == nil {
		t.Fatal("failed save ignored")
	}
	if s.GetAccessToken() != "" {
		t.Fatal("session continued with unpersisted rotation")
	}
	if saved, _ := store.Load(); saved.RefreshToken != "" {
		t.Fatal("old renewal credential retained after rotation failure")
	}
}

func TestRestoreUsesOneWorkerAndShutdownStopsIt(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store := &memoryCredentials{tokens: TokenStore{AccessToken: "restored-access", RefreshToken: "restored-refresh", Expiry: time.Now().Add(time.Hour)}}
	s := &Manager{store: store, emit: func(string) {}, client: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Error("fresh token unnecessarily refreshed")
		return tokenHTTP(500, `{}`)
	})}}
	s.Initialize(ctx, &config.AppConfig{ZitadelURL: "https://identity.test"})
	if s.GetAccessToken() != "restored-access" {
		t.Fatal("session not restored")
	}
	s.mu.Lock()
	worker := s.workerDone
	s.mu.Unlock()
	if worker == nil {
		t.Fatal("restored session lacks worker")
	}
	cancel()
	waitClosed(t, worker)
	if s.GetAccessToken() != "" {
		t.Fatal("stopped session returned token")
	}
}

func TestTemporaryOutageKeepsValidSessionButNeverReturnsExpiredToken(t *testing.T) {
	s, store, _ := testSession(t, func(*http.Request) (*http.Response, error) {
		return tokenHTTP(400, `{"error":"temporarily_unavailable"}`)
	})
	s.mu.Lock()
	s.expiry = time.Now().Add(time.Minute)
	s.mu.Unlock()
	if s.GetAccessToken() != "old-access" {
		t.Fatal("temporary outage discarded a still-valid token")
	}
	s.mu.Lock()
	s.expiry = time.Now().Add(-time.Second)
	s.mu.Unlock()
	if s.GetAccessToken() != "" {
		t.Fatal("expired token forwarded during outage")
	}
	if saved, _ := store.Load(); saved.RefreshToken != "old-refresh" {
		t.Fatal("network outage erased renewal credential")
	}
}

type gatedCredentials struct {
	*memoryCredentials
	started, release chan struct{}
	once             sync.Once
}

func (g *gatedCredentials) Save(tokens TokenStore) error {
	g.once.Do(func() { close(g.started); <-g.release })
	return g.memoryCredentials.Save(tokens)
}

func TestLogoutDeletesCredentialsAfterInFlightPersistence(t *testing.T) {
	s, store, generation := testSession(t, func(*http.Request) (*http.Response, error) {
		return tokenHTTP(200, `{"access_token":"new","refresh_token":"rotated","expires_in":3600}`)
	})
	gate := &gatedCredentials{memoryCredentials: store, started: make(chan struct{}), release: make(chan struct{})}
	s.store = gate // set before either concurrent operation starts
	refreshed, loggedOut := make(chan struct{}), make(chan struct{})
	go func() { defer close(refreshed); _ = s.doRefresh(generation) }()
	waitClosed(t, gate.started)
	go func() { defer close(loggedOut); _ = s.Logout() }()
	close(gate.release)
	waitClosed(t, refreshed)
	waitClosed(t, loggedOut)
	if s.GetAccessToken() != "" {
		t.Fatal("logout failed to clear memory")
	}
	if saved, _ := store.Load(); saved.RefreshToken != "" {
		t.Fatal("in-flight persistence restored logged-out credential")
	}
}

func TestLogoutReportsCredentialDeletionFailure(t *testing.T) {
	s, store, _ := testSession(t, func(*http.Request) (*http.Response, error) { return tokenHTTP(200, `{}`) })
	store.clearErr = errors.New("keychain unavailable")
	if err := s.Logout(); err == nil {
		t.Fatal("keychain deletion failure hidden")
	}
	if s.GetAccessToken() != "" {
		t.Fatal("failed keychain deletion kept local session active")
	}
}
