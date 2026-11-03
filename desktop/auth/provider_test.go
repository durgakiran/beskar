package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"beskar/desktop/config"
)

func TestProviderRejectsUnsafeOriginsBeforeSendingCredentials(t *testing.T) {
	for _, origin := range []string{
		"http://identity.test", "https://user:password@identity.test", "https://identity.test/path",
		"https://identity.test?query", "https://identity.test?", "https://identity.test#fragment", "https://identity.test#",
		"https:identity.test", "https:///missing", "https://identity.test/%2f", "https://identity.test:bad", "https://identity.test\\evil",
	} {
		t.Run(origin, func(t *testing.T) {
			var requests atomic.Int32
			s := &Manager{cfg: &config.AppConfig{ZitadelURL: origin}, client: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { requests.Add(1); return tokenHTTP(200, `{}`) })}}
			_, err := s.requestTokens(context.Background(), url.Values{"code": {"private-code"}})
			if err == nil || requests.Load() != 0 {
				t.Fatal("unsafe destination accepted")
			}
			if strings.Contains(err.Error(), "private-code") || strings.Contains(err.Error(), "password") {
				t.Fatal("raw configuration leaked")
			}
		})
	}
}

func TestProviderOperationsRejectAllRedirects(t *testing.T) {
	var leaked atomic.Int32
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked.Add(1); w.WriteHeader(200) }))
	defer target.Close()
	for _, status := range []int{301, 302, 303, 307, 308} {
		for _, operation := range []string{"token", "revoke", "userinfo", "discovery"} {
			t.Run(http.StatusText(status)+"/"+operation, func(t *testing.T) {
				source := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					http.Redirect(w, r, target.URL+"/capture?secret=do-not-expose", status)
				}))
				defer source.Close()
				s := &Manager{cfg: &config.AppConfig{ZitadelURL: source.URL, ServerURL: source.URL}, client: source.Client(), accessToken: "private-access", expiry: time.Now().Add(time.Hour), emit: func(string) {}}
				switch operation {
				case "token":
					_, err := s.requestTokens(context.Background(), url.Values{"refresh_token": {"private-refresh"}})
					var provider *authFailure
					if !errors.As(err, &provider) || provider.code != "provider_redirect" {
						t.Fatal("token redirect accepted")
					}
					if strings.Contains(err.Error(), "do-not-expose") {
						t.Fatal("redirect destination leaked")
					}
				case "revoke":
					if s.revoke(context.Background(), "private-token") == nil {
						t.Fatal("revocation redirect accepted")
					}
				case "userinfo":
					if s.GetUserInfo().Subject != "" || s.GetStatus().Code == "" {
						t.Fatal("userinfo redirect accepted or hidden")
					}
				case "discovery":
					if _, err := loginAuthorizationURL(context.Background(), s.cfg, "challenge", "state", source.Client()); err == nil {
						t.Fatal("discovery redirect accepted")
					}
				}
			})
		}
	}
	if leaked.Load() != 0 {
		t.Fatal("credentials/request followed a redirect")
	}
}

func TestProviderTimeoutCoversHeadersAndBodies(t *testing.T) {
	for _, operation := range []string{"token headers", "token body", "revoke", "userinfo", "discovery"} {
		t.Run(operation, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				if operation == "token body" {
					w.WriteHeader(200)
					w.(http.Flusher).Flush()
				}
				<-r.Context().Done()
			}))
			defer server.Close()
			s := &Manager{cfg: &config.AppConfig{ZitadelURL: server.URL, ServerURL: server.URL}, client: server.Client(), requestTimeout: 50 * time.Millisecond, accessToken: "private-access", expiry: time.Now().Add(time.Hour), emit: func(string) {}}
			start := time.Now()
			switch operation {
			case "token headers", "token body":
				_, err := s.requestTokens(context.Background(), url.Values{"code": {"private-code"}})
				var provider *authFailure
				if !errors.As(err, &provider) || provider.code != "provider_timeout" {
					t.Fatal("token timeout not classified")
				}
			case "revoke":
				if s.revoke(context.Background(), "private-token") == nil {
					t.Fatal("revocation timeout hidden")
				}
			case "userinfo":
				if s.GetUserInfo().Subject != "" || s.GetStatus().Message == "" {
					t.Fatal("userinfo timeout hidden")
				}
			case "discovery":
				client := server.Client()
				client.Timeout = 50 * time.Millisecond
				if _, err := loginAuthorizationURL(context.Background(), s.cfg, "challenge", "state", client); err == nil {
					t.Fatal("discovery timeout hidden")
				}
			}
			if time.Since(start) > time.Second {
				t.Fatal("provider request exceeded bounded timeout")
			}
		})
	}
}

func TestAmbiguousRefreshIsDurablyBlockedAcrossRestart(t *testing.T) {
	var requests atomic.Int32
	var store *memoryCredentials
	s, credentials, generation := testSession(t, func(*http.Request) (*http.Response, error) {
		requests.Add(1)
		pending, _ := store.Load()
		if !pending.RefreshPending {
			t.Error("refresh sent before durable pending marker")
		}
		return nil, errors.New("response lost: private-refresh private-access")
	})
	store = credentials
	store.clearErr = errors.New("delete unavailable")
	if err := s.doRefresh(generation); err == nil {
		t.Fatal("ambiguous outcome accepted")
	}
	for i := 0; i < 5; i++ {
		if s.GetAccessToken() != "" {
			t.Fatal("ambiguous session remained usable")
		}
	}
	if requests.Load() != 1 {
		t.Fatal("uncertain refresh token replayed")
	}
	pending, _ := store.Load()
	if !pending.RefreshPending {
		t.Fatal("failed deletion lost durable replay protection")
	}
	status := s.GetStatus()
	if status.Code != "refresh_uncertain" || !status.RequiresSignIn || !status.LocalSignedOut {
		t.Fatal("ambiguous outcome not surfaced")
	}
	encoded, _ := json.Marshal(status)
	if strings.Contains(string(encoded), "private-") || strings.Contains(string(encoded), "old-refresh") {
		t.Fatal("sensitive error exposed to UI")
	}
	restarted := &Manager{store: store, client: s.client, emit: func(string) {}}
	restarted.Initialize(context.Background(), s.cfg)
	if restarted.GetAccessToken() != "" || requests.Load() != 1 || restarted.GetStatus().Code != "refresh_uncertain" {
		t.Fatal("restart retried an uncertain credential")
	}
}

func TestInterruptedRefreshMarkerForcesSignIn(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store := &memoryCredentials{tokens: TokenStore{RefreshPending: true, RefreshToken: "do-not-replay", AccessToken: "old-access", Expiry: time.Now().Add(time.Hour)}}
	s := &Manager{store: store, client: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Error("interrupted refresh was replayed")
		return tokenHTTP(500, `{}`)
	})}, emit: func(string) {}}
	s.Initialize(ctx, &config.AppConfig{ZitadelURL: "https://identity.test"})
	if s.GetAccessToken() != "" || s.GetStatus().Code != "refresh_uncertain" {
		t.Fatal("interrupted refresh was silently resumed")
	}
}

func TestKnownTemporaryRejectionBacksOffWithoutLosingCredentials(t *testing.T) {
	var requests atomic.Int32
	s, store, generation := testSession(t, func(*http.Request) (*http.Response, error) {
		requests.Add(1)
		return tokenHTTP(400, `{"error":"temporarily_unavailable","error_description":"PRIVATE_DESCRIPTION"}`)
	})
	for i := 0; i < 10; i++ {
		if err := s.doRefresh(generation); err == nil {
			t.Fatal("temporary rejection ignored")
		}
	}
	if requests.Load() != 1 {
		t.Fatal("temporary failure was retried without backoff")
	}
	saved, _ := store.Load()
	if saved.RefreshPending || saved.RefreshToken != "old-refresh" {
		t.Fatal("known rejection did not safely restore renewal state")
	}
	if s.GetStatus().Code != "provider_unavailable" || strings.Contains(s.GetStatus().Message, "PRIVATE_DESCRIPTION") {
		t.Fatal("unsafe/hidden provider status")
	}
}

func TestLogoutReportsRevocationFailureAfterLocalClear(t *testing.T) {
	var requests atomic.Int32
	var s *Manager
	var store *memoryCredentials
	s, store, _ = testSession(t, func(r *http.Request) (*http.Response, error) {
		requests.Add(1)
		if _, ok := r.Context().Deadline(); !ok {
			t.Error("revocation lacks deadline")
		}
		if s.GetAccessToken() != "" {
			t.Error("revocation preceded local logout")
		}
		if saved, _ := store.Load(); saved.AccessToken != "" {
			t.Error("revocation preceded credential deletion")
		}
		return tokenHTTP(503, `{"error_description":"PRIVATE_PROVIDER_DETAIL"}`)
	})
	err := s.Logout()
	status := s.GetStatus()
	if err == nil || requests.Load() != 2 || !status.LocalSignedOut || status.Revocation != "unconfirmed" {
		t.Fatal("revocation failure hidden or local logout incomplete")
	}
	if strings.Contains(err.Error(), "PRIVATE_PROVIDER_DETAIL") {
		t.Fatal("provider error leaked")
	}
}

func TestCredentialLoadFailuresVisibleButMissingEntryIsNormal(t *testing.T) {
	for _, missing := range []bool{false, true} {
		err := errors.New("PRIVATE_KEYCHAIN_DETAIL")
		if missing {
			err = errCredentialsNotFound
		}
		s := &Manager{store: loadFailureStore{err: err}, emit: func(string) {}}
		s.Initialize(context.Background(), &config.AppConfig{})
		if (s.GetStatus().Message == "") != missing {
			t.Fatal("credential loading failure classification incorrect")
		}
		if strings.Contains(s.GetStatus().Message, "PRIVATE_KEYCHAIN_DETAIL") {
			t.Fatal("keychain error leaked")
		}
	}
}

type loadFailureStore struct{ err error }

func (s loadFailureStore) Load() (TokenStore, error) { return TokenStore{}, s.err }
func (s loadFailureStore) Save(TokenStore) error     { return nil }
func (s loadFailureStore) Clear() error              { return nil }

func TestDefaultProviderPolicyIsFinite(t *testing.T) {
	s := &Manager{}
	client := s.httpClient()
	if client.Timeout <= 0 || client.Timeout > providerTimeout || client.CheckRedirect == nil {
		t.Fatal("provider policy is unbounded")
	}
}

func TestRefreshCannotSendWithoutPersistingPendingMarker(t *testing.T) {
	var requests atomic.Int32
	s, store, generation := testSession(t, func(*http.Request) (*http.Response, error) { requests.Add(1); return tokenHTTP(200, `{}`) })
	store.saveErr = errors.New("PRIVATE_SAVE_DETAIL")
	if err := s.doRefresh(generation); err == nil || requests.Load() != 0 {
		t.Fatal("renewal sent without durable replay protection")
	}
	if s.GetStatus().Code != "credential_save_failed" || s.GetStatus().Message == "" {
		t.Fatal("storage failure hidden")
	}
}

func TestLogoutHasOneTotalRevocationBudget(t *testing.T) {
	var requests atomic.Int32
	s, _, _ := testSession(t, func(r *http.Request) (*http.Response, error) {
		requests.Add(1)
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	s.requestTimeout = 50 * time.Millisecond
	start := time.Now()
	if err := s.Logout(); err == nil {
		t.Fatal("revocation deadline hidden")
	}
	if requests.Load() != 2 || time.Since(start) > time.Second || s.GetStatus().Revocation != "unconfirmed" {
		t.Fatal("logout revocations were not bounded and reported")
	}
}

func TestConcurrentLogoutDoesNotHideUnconfirmedRevocation(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var requests atomic.Int32
	s, _, _ := testSession(t, func(*http.Request) (*http.Response, error) {
		if requests.Add(1) == 2 {
			close(started)
		}
		<-release
		return tokenHTTP(503, `{}`)
	})
	first, second := make(chan struct{}), make(chan struct{})
	go func() { defer close(first); _ = s.Logout() }()
	waitClosed(t, started)
	go func() { defer close(second); _ = s.Logout() }()
	close(release)
	waitClosed(t, first)
	waitClosed(t, second)
	if requests.Load() != 2 || s.GetStatus().Revocation != "unconfirmed" || s.GetStatus().Message == "" {
		t.Fatal("concurrent logout hid provider failure")
	}
}

func TestLoginStorageFailurePublishesSanitizedStatus(t *testing.T) {
	store := &memoryCredentials{saveErr: errors.New("PRIVATE_SAVE_DETAIL"), clearErr: errors.New("PRIVATE_DELETE_DETAIL")}
	s := &Manager{store: store, emit: func(string) {}}
	err := s.adoptLogin(context.Background(), 0, tokenResponse{AccessToken: "PRIVATE_ACCESS", RefreshToken: "PRIVATE_REFRESH", ExpiresIn: 3600})
	status := s.GetStatus()
	if err == nil || status.Code != "credential_save_failed" || !status.RequiresSignIn || !strings.Contains(status.Message, "could not be removed") {
		t.Fatal("login storage/cleanup failure hidden")
	}
	encoded, _ := json.Marshal(status)
	if strings.Contains(string(encoded), "PRIVATE_") || strings.Contains(err.Error(), "PRIVATE_") {
		t.Fatal("raw credential/storage error exposed")
	}
}

func TestShutdownLeavesPendingMarkerWithoutReplayingOnRestart(t *testing.T) {
	started := make(chan struct{})
	s, store, generation := testSession(t, func(r *http.Request) (*http.Response, error) {
		close(started)
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	done := make(chan struct{})
	go func() { defer close(done); _ = s.doRefresh(generation) }()
	waitClosed(t, started)
	s.mu.Lock()
	s.sessionCancel()
	s.mu.Unlock()
	waitClosed(t, done)
	if saved, _ := store.Load(); !saved.RefreshPending {
		t.Fatal("shutdown lost renewal uncertainty marker")
	}
	restarted := &Manager{store: store, client: s.client, emit: func(string) {}}
	restarted.Initialize(context.Background(), s.cfg)
	if restarted.GetAccessToken() != "" || restarted.GetStatus().Code != "refresh_uncertain" {
		t.Fatal("shutdown renewal was resumed unsafely")
	}
}

func TestPreviousLogoutFailureWarnsWithoutEndingNewLogin(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var requests atomic.Int32
	s, _, _ := testSession(t, func(*http.Request) (*http.Response, error) {
		if requests.Add(1) == 2 {
			close(started)
		}
		<-release
		return tokenHTTP(503, `{}`)
	})
	done := make(chan struct{})
	go func() { defer close(done); _ = s.Logout() }()
	waitClosed(t, started)
	if err := s.adoptLogin(context.Background(), s.currentGeneration(), tokenResponse{AccessToken: "new-account", RefreshToken: "new-account-refresh", ExpiresIn: 3600}); err != nil {
		t.Fatal(err)
	}
	close(release)
	waitClosed(t, done)
	status := s.GetStatus()
	if s.GetAccessToken() != "new-account" || status.RequiresSignIn || status.LocalSignedOut || status.Code != "previous_revocation_unconfirmed" {
		t.Fatal("old logout hid its error or ended a new session")
	}
}
