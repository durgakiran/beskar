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
// Production uses Redis; the in-memory backend is retained for isolated unit tests.
type browserSession struct {
	mu                            sync.Mutex
	session                       *browserAuthContext
	created, lastSeen, retryAfter time.Time
	refreshing                    bool
	loggingOut                    bool
}
type browserSessionStore struct {
	backend        *redisBrowserSessions
	idle, absolute time.Duration
	mu             sync.RWMutex
	sessions       map[string]*browserSession
	now            func() time.Time
}

func newBrowserSessionStore() *browserSessionStore {
	return &browserSessionStore{sessions: make(map[string]*browserSession), now: time.Now, idle: 30 * time.Minute, absolute: 8 * time.Hour}
}

var browserSessions *browserSessionStore

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
	if s.backend != nil {
		err := s.backend.create(id, &browserSession{session: session, created: now, lastSeen: now}, s)
		if err != nil {
			return err
		}
		logBrowserSessionStored(session)
		return nil
	}
	logBrowserSessionStored(session)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[id] = &browserSession{session: cloneBrowserSession(session), created: now, lastSeen: now}
	return nil
}
func logBrowserSessionStored(session *browserAuthContext) {
	refreshPresent := session != nil && session.Tokens != nil && session.Tokens.Token != nil && session.Tokens.RefreshToken != ""
	var accessExpiry time.Time
	if session != nil && session.Tokens != nil && session.Tokens.Token != nil {
		accessExpiry = session.Tokens.Expiry
	}
	SlogLogger.Info("browser login session stored", "refresh_token_present", refreshPresent,
		"access_token_expires_at", browserTokenExpiryLogValue(accessExpiry))
}
func (s *browserSessionStore) Get(id string) (*browserAuthContext, error) {
	if s.backend != nil {
		return s.backend.get(id, s)
	}
	e := s.entry(id)
	if e == nil {
		return nil, authentication.ErrNoSession
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if s.expired(e, s.now()) {
		e.session = nil
		return nil, authentication.ErrNoSession
	}
	return cloneBrowserSession(e.session), nil
}
func (s *browserSessionStore) Delete(id string) error {
	if s.backend != nil {
		return s.backend.delete(id)
	}
	e := s.entry(id)
	if e == nil {
		return nil
	}
	e.mu.Lock()
	e.session = nil // Also invalidates requests already waiting for this entry.
	e.mu.Unlock()
	s.mu.Lock()
	if s.sessions[id] == e {
		delete(s.sessions, id)
	}
	s.mu.Unlock()
	return nil
}

// Sweep exercises the in-memory test backend; Redis handles production cleanup through TTLs.
func (s *browserSessionStore) Sweep() {
	s.mu.RLock()
	entries := make(map[string]*browserSession, len(s.sessions))
	for id, entry := range s.sessions {
		entries[id] = entry
	}
	s.mu.RUnlock()
	for id, e := range entries {
		e.mu.Lock()
		expired := s.expired(e, s.now())
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
	if store.backend != nil {
		var result *browserAuthContext
		err := store.backend.withSession(ctx, id, store, func(e *browserSession, checkpoint func() error) error {
			var err error
			result, err = v.prepareSessionEntry(ctx, store, e, checkpoint)
			return err
		})
		return result, err
	}
	e := store.entry(id)
	if e == nil {
		return nil, errBrowserTokenInvalid
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return v.prepareSessionEntry(ctx, store, e, func() error { return nil })
}
func (v *BrowserAccessTokenValidator) prepareSessionEntry(ctx context.Context, store *browserSessionStore, e *browserSession, checkpoint func() error) (*browserAuthContext, error) {
	now := store.now()
	if e.loggingOut {
		return nil, errBrowserTokenInvalid
	}
	if store.expired(e, now) || e.refreshing {
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
			SlogLogger.WarnContext(ctx, "browser token refresh unavailable", "reason", "missing_refresh_token", "refresh_token_present", false)
			e.session = nil
			return nil, errBrowserTokenInvalid
		}
		if now.Before(e.retryAfter) {
			return nil, errors.New("browser refresh temporarily unavailable")
		}
		// Persist intent before redeeming a rotating token. A crashed or lease-lost
		// worker must not cause another replica to replay that credential.
		e.refreshing = true
		if err := checkpoint(); err != nil {
			return nil, err
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
			e.refreshing = false
			reason := "request_or_response_error"
			var failure *oauth2.RetrieveError
			if !errors.As(err, &failure) {
				// Ambiguous exchange outcome: never replay a possibly consumed
				// rotating credential after a lost/malformed response.
				e.refreshing = true
			}
			if failure != nil {
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
		// Extra reflects the provider response; RefreshToken may instead contain
		// the old token preserved by oauth2 when the response omits a replacement.
		receivedRefresh, _ := next.Extra("refresh_token").(string)
		SlogLogger.InfoContext(ctx, "browser token refresh response received",
			"access_token_expires_at", browserTokenExpiryLogValue(next.Expiry),
			"refresh_token_received", receivedRefresh != "",
			"refresh_token_present", next.RefreshToken != "",
			"refresh_token_rotated", next.RefreshToken != "" && next.RefreshToken != token.RefreshToken)
		updated := cloneBrowserSession(s)
		updated.Tokens.Token = next
		// Refreshed ID tokens are not used as identity assertions. Keep the original
		// verified ID token/claims; bind the new access token to the subject below.
		e.session = updated
		e.refreshing = false
		if err := checkpoint(); err != nil {
			return nil, err
		}
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

func (s *browserSessionStore) expired(e *browserSession, now time.Time) bool {
	return e.session == nil || !now.Before(e.created.Add(s.absolute)) || !now.Before(e.lastSeen.Add(s.idle))
}

// A missing expiry must not appear as a real date in authentication logs.
func browserTokenExpiryLogValue(expiry time.Time) string {
	if expiry.IsZero() {
		return "unknown"
	}
	return expiry.UTC().Format(time.RFC3339)
}
