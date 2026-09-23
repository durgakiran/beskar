package core

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Delay the SDK response until provider revocation and shared-session deletion
// succeed. Failures retain the cookie so the caller can retry logout.
type browserLogoutResponse struct {
	header http.Header
	body   bytes.Buffer
	status int
}

func (w *browserLogoutResponse) Header() http.Header { return w.header }
func (w *browserLogoutResponse) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}
func (w *browserLogoutResponse) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	return w.body.Write(data)
}
func browserLogoutHandler(store *browserSessionStore, logout http.HandlerFunc, revoke func(context.Context, *browserAuthContext) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := browserSessionID(r)
		response := &browserLogoutResponse{header: make(http.Header)}
		logout(response, r)
		if err := store.endSession(r.Context(), id, revoke); err != nil {
			SlogLogger.WarnContext(r.Context(), "browser logout failed", "reason", "revocation_or_storage_unavailable")
			w.Header().Set("Cache-Control", "no-store")
			http.Error(w, "Unable to end your session. Please retry.", http.StatusServiceUnavailable)
			return
		}
		for key, values := range response.header {
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
		// The SDK does not clear a cookie when its session has already expired.
		http.SetCookie(w, &http.Cookie{Name: "zitadel.session", Value: "", Path: "/", MaxAge: -1, Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode})
		w.Header().Set("Cache-Control", "no-store")
		status := response.status
		if status == 0 {
			status = 200
		}
		w.WriteHeader(status)
		_, _ = w.Write(response.body.Bytes())
	}
}

// Revocation uses the same confidential client and trusted HTTP transport as refresh.
// A shared deadline bounds both requests; redirects never receive credentials.
func (v *BrowserAccessTokenValidator) revokeSessionTokens(ctx context.Context, session *browserAuthContext) error {
	if session == nil || session.Tokens == nil || session.Tokens.Token == nil {
		return errors.New("logout tokens unavailable")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	client := *v.refreshClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	for _, credential := range []struct{ token, hint string }{
		{session.Tokens.RefreshToken, "refresh_token"},
		{session.Tokens.AccessToken, "access_token"},
	} {
		if credential.token == "" {
			continue
		}
		form := url.Values{"token": {credential.token}, "token_type_hint": {credential.hint}}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(v.issuer, "/")+"/oauth/v2/revoke", strings.NewReader(form.Encode()))
		if err != nil {
			return errors.New("token revocation unavailable")
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.SetBasicAuth(url.QueryEscape(v.refreshConfig.ClientID), url.QueryEscape(v.refreshConfig.ClientSecret))
		response, err := client.Do(req)
		if err != nil {
			return errors.New("token revocation unavailable")
		}
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return errors.New("token revocation unavailable")
		}
	}
	return nil
}

// Keep tokens for a caller-driven retry on failure, but fence authentication and
// refresh before the first provider call. No asynchronous revocation jobs exist.
func (s *browserSessionStore) endSession(ctx context.Context, id string, revoke func(context.Context, *browserAuthContext) error) error {
	finish := func(e *browserSession, checkpoint func() error) error {
		if e.session == nil {
			return nil
		}
		e.loggingOut = true
		if err := checkpoint(); err != nil {
			return err
		}
		if err := revoke(ctx, cloneBrowserSession(e.session)); err != nil {
			return err
		}
		e.session = nil
		return nil
	}
	if s.backend != nil {
		completed, invoked := false, false
		err := s.backend.withSession(ctx, id, s, func(e *browserSession, checkpoint func() error) error {
			invoked = true
			err := finish(e, checkpoint)
			completed = err == nil
			return err
		})
		// Invalid means already absent before the callback, or our confirmed
		// deletion after successful revocation. Preserve all other failures.
		if errors.Is(err, errBrowserTokenInvalid) && (completed || !invoked) {
			return nil
		}
		return err
	}
	e := s.entry(id)
	if e == nil {
		return nil
	}
	e.mu.Lock()
	err := finish(e, func() error { return nil })
	e.mu.Unlock()
	if err == nil {
		return s.Delete(id)
	}
	return err
}
