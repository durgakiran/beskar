package auth

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const loginTimeout = 5 * time.Minute

type loginResult struct {
	code string
	err  error
}

type loginTransaction struct {
	ctx                 context.Context
	cancel              context.CancelFunc
	stopAppCancellation func() bool
	state, verifier     string
	generation          uint64
	responded           bool // protected by loginMu; consumed before delivering a callback
	result              chan loginResult
}

func (s *Manager) beginLogin(ctx context.Context, timeout time.Duration) (*loginTransaction, error) {
	s.loginMu.Lock()
	defer s.loginMu.Unlock()
	if s.pendingLogin != nil {
		return nil, errors.New("a login is already in progress")
	}
	state, err := GenerateState()
	if err != nil {
		return nil, err
	}
	verifier, err := GenerateCodeVerifier()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	tx := &loginTransaction{ctx: ctx, cancel: cancel, state: state, verifier: verifier, generation: s.currentGeneration(), result: make(chan loginResult, 1)}
	if s.ctx != nil {
		tx.stopAppCancellation = context.AfterFunc(s.ctx, cancel)
	}
	s.pendingLogin = tx
	return tx, nil
}

func (s *Manager) finishLogin(tx *loginTransaction) {
	s.loginMu.Lock()
	defer s.loginMu.Unlock()
	tx.cancel()
	if tx.stopAppCancellation != nil {
		tx.stopAppCancellation()
	}
	if s.pendingLogin == tx {
		s.pendingLogin = nil
	}
}

func (s *Manager) cancelPendingLogin() {
	s.loginMu.Lock()
	defer s.loginMu.Unlock()
	if s.pendingLogin != nil {
		s.pendingLogin.cancel()
	}
}

// HandleCallback accepts only the exact registered redirect and one response
// matching the active transaction. Unrelated callbacks cannot consume a login.
func (s *Manager) HandleCallback(raw string) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "teddox" || u.Host != "callback" || u.User != nil ||
		u.Path != "" || u.Opaque != "" || u.Fragment != "" || u.RawFragment != "" {
		return
	}
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return
	}
	// Reject ambiguous repeated parameters, including encoded duplicates.
	for _, values := range q {
		if len(values) != 1 {
			return
		}
	}
	s.loginMu.Lock()
	defer s.loginMu.Unlock()
	tx := s.pendingLogin
	if tx == nil || tx.responded || tx.ctx.Err() != nil ||
		subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(tx.state)) != 1 {
		return
	}
	code, providerError := q.Get("code"), q.Get("error")
	_, hasCode := q["code"]
	_, hasError := q["error"]
	if hasCode == hasError || (hasCode && code == "") || (hasError && providerError == "") {
		return
	}
	result := loginResult{code: code}
	if hasError {
		// Provider-controlled descriptions are not surfaced or logged.
		result.err = errors.New("identity provider could not complete login; please retry")
		if providerError == "access_denied" {
			result.err = errors.New("login was denied or cancelled in the browser")
		}
	}
	tx.responded = true
	tx.result <- result
}

// Login's context comes from the Wails call, so cancelling the JS promise also
// cancels the native transaction. App shutdown and the deadline cancel it too.
func (s *Manager) Login(ctx context.Context) error {
	if s.cfg == nil || s.cfg.ZitadelURL == "" {
		return errors.New("application not configured")
	}
	var generation uint64
	return s.runLogin(ctx, loginTimeout, func(ctx context.Context, tx *loginTransaction) error {
		generation = tx.generation
		authURL, err := loginAuthorizationURL(ctx, s.cfg, GenerateCodeChallenge(tx.verifier), tx.state, &http.Client{
			Transport: s.httpClient().Transport, Timeout: s.httpClient().Timeout,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		})
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := application.Get().Browser.OpenURL(authURL); err != nil {
			return errors.New("Unable to open the sign-in browser. Please retry.")
		}
		return nil
	}, func(ctx context.Context, code, verifier string) error {
		return s.exchangeCode(ctx, code, verifier, generation)
	})
}

// Separate OS/browser and provider I/O from transaction control for regression
// tests that never load credentials, launch a browser, or write to the keychain.
func (s *Manager) runLogin(ctx context.Context, timeout time.Duration, open func(context.Context, *loginTransaction) error, exchange func(context.Context, string, string) error) error {
	tx, err := s.beginLogin(ctx, timeout)
	if err != nil {
		return err
	}
	defer s.finishLogin(tx)
	if err := tx.ctx.Err(); err != nil {
		return loginContextError(err)
	}
	if err := open(tx.ctx, tx); err != nil {
		if tx.ctx.Err() != nil {
			return loginContextError(tx.ctx.Err())
		}
		return err
	}
	select {
	case result := <-tx.result:
		if err := tx.ctx.Err(); err != nil {
			return loginContextError(err)
		}
		if result.err != nil {
			return result.err
		}
		return exchange(tx.ctx, result.code, tx.verifier)
	case <-tx.ctx.Done():
		return loginContextError(tx.ctx.Err())
	}
}

func loginContextError(err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return errors.New("login timed out; please retry")
	}
	return errors.New("login cancelled")
}

func (s *Manager) exchangeCode(ctx context.Context, code, verifier string, generation uint64) error {
	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	data.Set("client_id", s.cfg.ClientID)
	data.Set("code", code)
	data.Set("redirect_uri", RedirectURI)
	data.Set("code_verifier", verifier)
	result, err := s.requestTokens(ctx, data)
	if err != nil {
		return err
	}
	return s.adoptLogin(ctx, generation, result)
}
