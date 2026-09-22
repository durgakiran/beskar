package core

import (
	"context"
	"errors"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/zitadel/oidc/v3/pkg/crypto"
	"github.com/zitadel/zitadel-go/v3/pkg/authentication"
	"golang.org/x/oauth2"
)

// Session state is private to the store. SDK and handler callers receive snapshots.
// This store is process-local; multiple replicas still require shared storage.
type browserSession struct {
	mu                            sync.Mutex
	session                       *browserAuthContext
	created, lastSeen, retryAfter time.Time
}
type browserSessionStore struct {
	mu       sync.RWMutex
	sessions map[string]*browserSession
	now      func() time.Time
}

func newBrowserSessionStore() *browserSessionStore {
	return &browserSessionStore{sessions: make(map[string]*browserSession), now: time.Now}
}

var browserSessions = newBrowserSessionStore()

func cloneBrowserSession(s *browserAuthContext) *browserAuthContext {
	if s == nil {
		return nil
	}
	copy := *s
	if s.Tokens != nil {
		tokens := *s.Tokens
		copy.Tokens = &tokens
		if tokens.Token != nil {
			token := *tokens.Token
			copy.Tokens.Token = &token
		}
	}
	// UserInfo and verified ID claims are immutable after login.
	return &copy
}
func (s *browserSessionStore) entry(id string) *browserSession {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.sessions[id]
}
func (s *browserSessionStore) Set(id string, session *browserAuthContext) error {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[id] = &browserSession{session: cloneBrowserSession(session), created: now, lastSeen: now}
	return nil
}
func (e *browserSession) expired(now time.Time) bool {
	return e.session == nil || !now.Before(e.created.Add(8*time.Hour)) || !now.Before(e.lastSeen.Add(30*time.Minute))
}
func (s *browserSessionStore) Get(id string) (*browserAuthContext, error) {
	e := s.entry(id)
	if e == nil {
		return nil, authentication.ErrNoSession
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.expired(s.now()) {
		e.session = nil
		return nil, authentication.ErrNoSession
	}
	return cloneBrowserSession(e.session), nil
}
func (s *browserSessionStore) Delete(id string) {
	e := s.entry(id)
	if e == nil {
		return
	}
	e.mu.Lock()
	e.session = nil // Also invalidates requests already waiting for this entry.
	e.mu.Unlock()
	s.mu.Lock()
	if s.sessions[id] == e {
		delete(s.sessions, id)
	}
	s.mu.Unlock()
}

// Sweep is run by application maintenance, not on every request.
func (s *browserSessionStore) Sweep() {
	s.mu.RLock()
	entries := make(map[string]*browserSession, len(s.sessions))
	for id, entry := range s.sessions {
		entries[id] = entry
	}
	s.mu.RUnlock()
	for id, e := range entries {
		e.mu.Lock()
		expired := e.expired(s.now())
		if expired {
			e.session = nil
		}
		e.mu.Unlock()
		if expired {
			s.mu.Lock()
			if s.sessions[id] == e {
				delete(s.sessions, id)
			}
			s.mu.Unlock()
		}
	}
}
func browserSessionID(r *http.Request) string {
	cookie, err := r.Cookie("zitadel.session")
	if err != nil {
		return ""
	}
	id, err := crypto.DecryptAES(cookie.Value, os.Getenv("KEY"))
	if err != nil {
		return ""
	}
	return id
}

// Serialize refresh per session, not globally. Publish replacement tokens before
// introspection so a transient introspection failure cannot lose a rotated token.
func (v *BrowserAccessTokenValidator) prepareSession(ctx context.Context, store *browserSessionStore, id string) (*browserAuthContext, error) {
	e := store.entry(id)
	if e == nil {
		return nil, errBrowserTokenInvalid
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	now := store.now()
	if e.expired(now) {
		e.session = nil
		return nil, errBrowserTokenInvalid
	}
	s := e.session
	if s.Tokens == nil || s.Tokens.Token == nil || s.UserInfo == nil || s.UserInfo.Subject == "" {
		e.session = nil
		return nil, errBrowserTokenInvalid
	}
	token := s.Tokens.Token
	if !token.Expiry.After(v.now()) {
		if token.RefreshToken == "" {
			e.session = nil
			return nil, errBrowserTokenInvalid
		}
		if now.Before(e.retryAfter) {
			return nil, errors.New("browser refresh temporarily unavailable")
		}
		// Finish a bounded refresh even if this browser request disconnects, so
		// a successful rotation is not discarded with the request context.
		refreshContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		refreshContext = context.WithValue(refreshContext, oauth2.HTTPClient, v.refreshClient)
		// Force refresh, including when a malformed stored expiry is zero.
		expired := *token
		expired.Expiry = time.Unix(1, 0)
		next, err := v.refreshConfig.TokenSource(refreshContext, &expired).Token()
		cancel()
		if err != nil {
			reason := "request_or_response_error"
			var failure *oauth2.RetrieveError
			if errors.As(err, &failure) {
				switch failure.ErrorCode {
				case "invalid_grant":
					e.session = nil
					SlogLogger.WarnContext(ctx, "browser token refresh failed", "reason", "invalid_grant")
					return nil, errBrowserTokenInvalid
				case "invalid_client", "unauthorized_client", "invalid_request", "server_error":
					reason = failure.ErrorCode
				}
			}
			SlogLogger.WarnContext(ctx, "browser token refresh failed", "reason", reason)
			e.retryAfter = store.now().Add(3 * time.Second)
			return nil, errors.New("browser refresh temporarily unavailable")
		}
		if next.AccessToken == "" || next.Expiry.IsZero() || !next.Expiry.After(v.now()) {
			// A successful but malformed response may have consumed the old refresh token.
			e.session = nil
			return nil, errBrowserTokenInvalid
		}
		updated := cloneBrowserSession(s)
		updated.Tokens.Token = next
		// Refreshed ID tokens are not used as identity assertions. Keep the original
		// verified ID token/claims; bind the new access token to the subject below.
		e.session = updated
		s = updated
	}
	if err := v.validate(ctx, s); err != nil {
		if errors.Is(err, errBrowserTokenInvalid) {
			e.session = nil
		}
		return nil, err
	}
	e.lastSeen = store.now()
	return cloneBrowserSession(s), nil
}

func RunBrowserSessionCleanup(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			browserSessions.Sweep()
		}
	}
}
