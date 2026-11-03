package auth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"beskar/desktop/config"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sync/singleflight"
)

const RedirectURI = "teddox://callback"
const refreshLead = 5 * time.Minute

var authClient = boundedClient(&http.Client{Transport: config.NewHTTPTransport()}, providerTimeout)
var errSessionChanged = errors.New("authentication session changed")

// UserInfo represents the standard OIDC user claims.
type UserInfo struct {
	Subject string `json:"sub"`
	Email   string `json:"email"`
}

type credentialStore interface {
	Load() (TokenStore, error)
	Save(TokenStore) error
	Clear() error
}

// Manager owns native authentication state. Never register it as a Wails service;
// only UIAuthService may be bound to the renderer. ctx/cfg and the dependencies
// are set once before use; mu owns all token, session and worker state.
type Manager struct {
	ctx                                context.Context
	cfg                                *config.AppConfig
	mu                                 sync.Mutex
	accessToken, refreshToken, idToken string
	subject, loginNonce                string
	expiry                             time.Time
	refreshAt                          time.Time
	generation                         uint64
	sessionCtx                         context.Context
	sessionCancel                      context.CancelFunc
	workerDone                         chan struct{}
	status                             Status
	retryAt                            time.Time
	lastRefreshError                   error
	refreshGroup                       singleflight.Group
	eventMu                            sync.Mutex
	logoutMu                           sync.Mutex
	loginMu                            sync.Mutex
	pendingLogin                       *loginTransaction
	// Private dependencies let tests exercise real lifecycle code without keychain/UI.
	store          credentialStore
	client         *http.Client
	emit           func(string)
	requestTimeout time.Duration
	verifyAccount  func(context.Context, tokenResponse, string, string) (string, error)
}

func (s *Manager) storage() credentialStore {
	if s.store != nil {
		return s.store
	}
	return unavailableStore{}
}
func (s *Manager) httpClient() *http.Client {
	base := authClient
	if s.client != nil {
		base = s.client
	}
	return boundedClient(base, s.requestBudget())
}
func (s *Manager) appContext() context.Context {
	if s.ctx != nil {
		return s.ctx
	}
	return context.Background()
}
func (s *Manager) currentGeneration() uint64 { s.mu.Lock(); defer s.mu.Unlock(); return s.generation }

// Initialize restores a session without starting an additional worker on refresh.
func (s *Manager) Initialize(ctx context.Context, cfg *config.AppConfig) {
	s.ctx = ctx
	if cfg != nil {
		snapshot := *cfg
		s.cfg = &snapshot
	}
	cfg = s.cfg
	if s.store == nil {
		scoped, err := newKeychainStore(cfg, nativeSecretBackend())
		if err != nil {
			s.reportStatus(s.currentGeneration(), signedOutStatus("credential_configuration_invalid", "Saved credentials cannot be used with this application configuration. Check the server settings and sign in again."))
			return
		}
		s.store = scoped
	}
	if scoped, ok := s.store.(*keychainStore); ok {
		expected, err := newKeychainStore(cfg, scoped.backend)
		if err != nil || scoped.context != expected.context {
			s.reportStatus(s.currentGeneration(), signedOutStatus("credential_context_mismatch", "Saved credentials do not match this app, server or account. Sign in again."))
			return
		}
	}
	tokens, err := s.storage().Load()
	if err != nil {
		switch {
		case errors.Is(err, errCredentialMigration):
			s.reportStatus(s.currentGeneration(), signedOutStatus("credential_migration_required", "Credential storage has been upgraded. Sign in again; the previous shared credentials were removed."))
		case errors.Is(err, errCredentialContext):
			s.reportStatus(s.currentGeneration(), signedOutStatus("credential_context_mismatch", "Saved credentials do not match this app, server or account. Sign in again."))
		case errors.Is(err, errCredentialAppIdentity):
			s.reportStatus(s.currentGeneration(), signedOutStatus("credential_app_identity_invalid", "This app's signing identity could not be verified. Use a trusted signed build or an explicit development build."))
		case errors.Is(err, errLegacyCleanup):
			s.reportStatus(s.currentGeneration(), signedOutStatus("credential_migration_failed", "Unable to remove the old shared credentials. Check your operating system credential store and restart before signing in."))
		case !errors.Is(err, errCredentialsNotFound):
			s.reportStatus(s.currentGeneration(), signedOutStatus("credential_load_failed", "Unable to load saved credentials. Check your operating system credential store and sign in again."))
		}
		return
	}
	if tokens.RefreshPending {
		s.mu.Lock()
		_, generation, clearErr := s.invalidateLocked()
		s.mu.Unlock()
		s.reportStatus(generation, storageStatus("refresh_uncertain", "A previous token renewal was interrupted. Sign in again; the previous refresh token will not be retried.", clearErr))
		return
	}
	if tokens.RefreshToken == "" {
		return
	}
	s.mu.Lock()
	generation := s.installSessionLocked(tokens)
	s.mu.Unlock()
	// Refresh immediately if due. A transient outage retains the saved credential;
	// invalid_grant invalidates only this session, never a newer login.
	_ = s.doRefresh(generation)
}

func (s *Manager) snapshotLocked() TokenStore {
	return TokenStore{Subject: s.subject, LoginNonce: s.loginNonce, AccessToken: s.accessToken, RefreshToken: s.refreshToken, IDToken: s.idToken, Expiry: s.expiry}
}
func (s *Manager) setTokensLocked(tokens TokenStore) {
	s.subject, s.loginNonce = tokens.Subject, tokens.LoginNonce
	s.accessToken, s.refreshToken, s.idToken, s.expiry = tokens.AccessToken, tokens.RefreshToken, tokens.IDToken, tokens.Expiry
	// A fixed five-minute lead would immediately refresh every short-lived token.
	lead := time.Until(tokens.Expiry) / 10
	if lead < 0 {
		lead = 0
	}
	if lead > refreshLead {
		lead = refreshLead
	}
	s.refreshAt = tokens.Expiry.Add(-lead)
}

func (s *Manager) freshLocked() bool {
	refreshAt := s.refreshAt
	if refreshAt.IsZero() {
		refreshAt = s.expiry.Add(-refreshLead)
	}
	now := time.Now()
	return s.accessToken != "" && now.Before(s.expiry) && now.Before(refreshAt)
}
func (s *Manager) sessionActiveLocked(generation uint64) bool {
	return generation == s.generation && (s.sessionCtx == nil || s.sessionCtx.Err() == nil)
}

// Called only for login/restoration. Refresh updates tokens in the same session.
func (s *Manager) installSessionLocked(tokens TokenStore) uint64 {
	if s.sessionCancel != nil {
		s.sessionCancel()
	}
	s.generation++
	s.status = Status{}
	s.retryAt = time.Time{}
	s.lastRefreshError = nil
	s.setTokensLocked(tokens)
	s.sessionCtx, s.sessionCancel = context.WithCancel(s.appContext())
	s.workerDone = nil
	if tokens.RefreshToken != "" {
		done := make(chan struct{})
		s.workerDone = done
		go s.refreshLoop(s.sessionCtx, s.generation, done)
	}
	return s.generation
}

// Order UI events across logout/replacement, and suppress events from old sessions.
func (s *Manager) emitForSession(event string, generation uint64) {
	s.eventMu.Lock()
	defer s.eventMu.Unlock()
	s.mu.Lock()
	current := generation == s.generation
	s.mu.Unlock()
	if !current {
		return
	}
	if s.emit != nil {
		s.emit(event)
	} else if app := application.Get(); app != nil {
		app.Event.Emit(event)
	}
}

func (s *Manager) adoptLogin(ctx context.Context, generation uint64, result tokenResponse) error {
	if result.subject == "" || result.nonce == "" {
		return failure("account_verification_failed", "Unable to verify the login account. Sign in again.")
	}
	s.mu.Lock()
	if generation != s.generation || ctx.Err() != nil || s.appContext().Err() != nil {
		s.mu.Unlock()
		return errSessionChanged
	}
	tokens := TokenStore{Subject: result.subject, LoginNonce: result.nonce, AccessToken: result.AccessToken, RefreshToken: result.RefreshToken, IDToken: result.IDToken, Expiry: time.Now().Add(time.Duration(result.ExpiresIn) * time.Second)}
	// Serialize persistence with logout/refresh so late writes cannot restore tokens.
	if err := s.storage().Save(tokens); err != nil {
		_, next, clearErr := s.invalidateLocked()
		s.mu.Unlock()
		issue := storageStatus("credential_save_failed", "Unable to save login credentials. Check your operating system credential store and sign in again.", clearErr)
		s.reportStatus(next, issue)
		s.emitForSession("auth:logout", next)
		return errors.New(issue.Message)
	}
	// Cancellation can occur while the keychain write is in progress.
	if ctx.Err() != nil || s.appContext().Err() != nil {
		_, next, clearErr := s.invalidateLocked()
		s.mu.Unlock()
		if clearErr != nil {
			s.reportStatus(next, storageStatus("credential_delete_failed", "Login was cancelled, but saved credentials could not be removed.", nil))
		}
		return errSessionChanged
	}
	generation = s.installSessionLocked(tokens)
	s.mu.Unlock()
	s.emitForSession("auth:ready", generation)
	return nil
}

// Invalidate local state before any provider I/O. The lock also orders keychain
// deletion after all accepted writes; old generations cannot commit afterward.
func (s *Manager) invalidateLocked() (TokenStore, uint64, error) {
	old := s.snapshotLocked()
	if s.sessionCancel != nil {
		s.sessionCancel()
	}
	s.generation++
	s.setTokensLocked(TokenStore{})
	err := s.storage().Clear()
	return old, s.generation, err
}

func (s *Manager) Logout() error {
	expected := s.currentGeneration()
	s.cancelPendingLogin()
	s.logoutMu.Lock()
	defer s.logoutMu.Unlock()
	s.mu.Lock()
	// A queued logout must neither erase a newer login nor hide a preceding
	// logout's provider/storage failure when its session was already cleared.
	if s.generation != expected {
		status := s.status
		localOnly := s.accessToken == "" && status.LocalSignedOut
		s.mu.Unlock()
		if localOnly {
			if status.Message != "" {
				return errors.New(status.Message)
			}
			return nil
		}
		return errSessionChanged
	}
	previous := s.status
	old, generation, clearErr := s.invalidateLocked()
	s.mu.Unlock()
	initial := signedOutStatus("signed_out", "")
	if old.AccessToken == "" && old.RefreshToken == "" && previous.RequiresSignIn && previous.Message != "" {
		initial = previous
	}
	if clearErr != nil {
		initial = storageStatus("credential_delete_failed", "Signed out locally, but unable to delete saved credentials. Check your operating system credential store before restarting the app.", nil)
	}
	s.reportStatus(generation, initial)
	s.emitForSession("auth:logout", generation)
	// Share a finite total budget; attempt both revocations independently.
	ctx, cancel := context.WithTimeout(s.appContext(), s.requestBudget())
	defer cancel()
	var wg sync.WaitGroup
	var revocationFailed bool
	var resultMu sync.Mutex
	for _, token := range []string{old.RefreshToken, old.AccessToken} {
		if token == "" {
			continue
		}
		wg.Add(1)
		go func(token string) {
			defer wg.Done()
			if s.revoke(ctx, token) != nil {
				resultMu.Lock()
				revocationFailed = true
				resultMu.Unlock()
			}
		}(token)
	}
	wg.Wait()
	final := initial
	if old.RefreshToken != "" || old.AccessToken != "" {
		final.Revocation = "confirmed"
	}
	if revocationFailed {
		final.Revocation = "unconfirmed"
		if clearErr == nil {
			final.Code = "revocation_unconfirmed"
			final.Message = "Signed out locally. The identity provider could not confirm token revocation; those tokens may remain valid until they expire."
		} else {
			final.Message += " The identity provider also could not confirm token revocation."
		}
	}
	s.reportLogoutResult(generation, final)
	if final.Message != "" {
		return errors.New(final.Message)
	}
	return nil
}

func (s *Manager) revoke(ctx context.Context, token string) error {
	endpoint, err := s.providerURL("/oauth/v2/revoke")
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, s.requestBudget())
	defer cancel()
	data := url.Values{"client_id": {s.cfg.ClientID}, "token": {token}}
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return failure("invalid_configuration", "Unable to create revocation request.")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := s.httpClient().Do(req)
	if err != nil {
		return transportFailure(ctx, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return failure("revocation_unconfirmed", "The identity provider did not confirm token revocation.")
	}
	return nil
}

func (s *Manager) GetAccessToken() string {
	s.mu.Lock()
	generation := s.generation
	fresh := s.freshLocked()
	active := s.sessionActiveLocked(generation)
	token := s.accessToken
	s.mu.Unlock()
	if !active {
		return ""
	}
	if fresh {
		return token
	}
	_ = s.doRefresh(generation)
	s.mu.Lock()
	defer s.mu.Unlock()
	// Temporary refresh failures may use a still-valid access token, never an
	// expired token or a result from an account replaced while waiting.
	if !s.sessionActiveLocked(generation) || !time.Now().Before(s.expiry) {
		return ""
	}
	return s.accessToken
}
func (s *Manager) IsAuthenticated() bool { return s.GetAccessToken() != "" }

func (s *Manager) GetUserInfo() UserInfo {
	generation := s.currentGeneration()
	token := s.GetAccessToken()
	if token == "" {
		return UserInfo{}
	}
	endpoint, err := s.providerURL("/oidc/v1/userinfo")
	if err != nil {
		s.reportStatus(generation, Status{Code: "invalid_configuration", Message: "Invalid identity-provider configuration."})
		return UserInfo{}
	}
	ctx, cancel := context.WithTimeout(s.appContext(), s.requestBudget())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := s.httpClient().Do(req)
	if err != nil {
		s.reportStatus(generation, Status{Code: "userinfo_unavailable", Message: "Unable to load your identity-provider profile."})
		return UserInfo{}
	}
	defer resp.Body.Close()
	var info UserInfo
	if resp.StatusCode != http.StatusOK || decodeProviderJSON(resp.Body, &info, 1024*1024) != nil {
		s.reportStatus(generation, Status{Code: "userinfo_unavailable", Message: "Unable to load your identity-provider profile."})
		return UserInfo{}
	}
	return info
}

func (s *Manager) doRefresh(generation uint64) error {
	_, err, _ := s.refreshGroup.Do(strconv.FormatUint(generation, 10), func() (any, error) {
		s.mu.Lock()
		if !s.sessionActiveLocked(generation) {
			s.mu.Unlock()
			return nil, errSessionChanged
		}
		if s.freshLocked() {
			s.mu.Unlock()
			return nil, nil
		}
		if time.Now().Before(s.retryAt) {
			err := s.lastRefreshError
			s.mu.Unlock()
			return nil, err
		}
		old := s.snapshotLocked()
		ctx := s.sessionCtx
		if ctx == nil {
			ctx = s.appContext()
		}
		if old.RefreshToken == "" || s.cfg == nil {
			s.mu.Unlock()
			return nil, errors.New("no refresh token")
		}
		// Validate the trusted destination before recording an outgoing attempt.
		if _, err := s.providerURL("/oauth/v2/token"); err != nil {
			s.mu.Unlock()
			return nil, s.failRefresh(generation, "invalid_configuration", err.Error())
		}
		pending := old
		pending.RefreshPending = true
		if err := s.storage().Save(pending); err != nil {
			s.mu.Unlock()
			return nil, s.failRefresh(generation, "credential_save_failed", "Unable to record token renewal securely. Check your operating system credential store and sign in again.")
		}
		s.mu.Unlock()
		result, err := s.requestTokens(ctx, url.Values{"grant_type": {"refresh_token"}, "client_id": {s.cfg.ClientID}, "refresh_token": {old.RefreshToken}})
		if err != nil {
			if ctx.Err() != nil {
				return nil, errSessionChanged
			} // logout/shutdown; pending marker remains safe across restart
			var provider *authFailure
			if errors.As(err, &provider) && provider.retrySafe {
				s.mu.Lock()
				if !s.sessionActiveLocked(generation) {
					s.mu.Unlock()
					return nil, errSessionChanged
				}
				if saveErr := s.storage().Save(old); saveErr != nil {
					s.mu.Unlock()
					return nil, s.failRefresh(generation, "credential_save_failed", "Unable to store the renewal outcome securely. Sign in again.")
				}
				s.retryAt = time.Now().Add(30 * time.Second)
				s.lastRefreshError = err
				s.mu.Unlock()
				s.reportStatus(generation, Status{Code: provider.code, Message: provider.message})
				return nil, err
			}
			if errors.As(err, &provider) && (provider.code == "invalid_grant" || provider.code == "provider_rejected") {
				return nil, s.failRefresh(generation, provider.code, provider.message)
			}
			return nil, s.failRefresh(generation, "refresh_uncertain", "Token renewal could not be confirmed. Sign in again; the previous refresh token will not be retried.")
		}
		subject, verifyErr := s.verifyTokenAccount(ctx, result, old.Subject, old.LoginNonce)
		if verifyErr != nil {
			return nil, s.failRefresh(generation, "account_verification_failed", "Token renewal returned an unverified or different account. Sign in again.")
		}
		s.mu.Lock()
		if !s.sessionActiveLocked(generation) || ctx.Err() != nil {
			s.mu.Unlock()
			return nil, errSessionChanged
		}
		tokens := TokenStore{Subject: subject, LoginNonce: old.LoginNonce, AccessToken: result.AccessToken, RefreshToken: result.RefreshToken, IDToken: result.IDToken, Expiry: time.Now().Add(time.Duration(result.ExpiresIn) * time.Second)}
		if tokens.RefreshToken == "" {
			tokens.RefreshToken = old.RefreshToken
		}
		if tokens.IDToken == "" {
			tokens.IDToken = old.IDToken
		}
		if err := s.storage().Save(tokens); err != nil {
			s.mu.Unlock()
			return nil, s.failRefresh(generation, "credential_save_failed", "Unable to store refreshed credentials. Check your operating system credential store and sign in again.")
		}
		s.setTokensLocked(tokens)
		s.retryAt = time.Time{}
		s.lastRefreshError = nil
		s.status = Status{}
		s.mu.Unlock()
		s.emitForSession("auth:status", generation)
		return nil, nil
	})
	return err
}

func (s *Manager) failRefresh(generation uint64, code, message string) error {
	s.mu.Lock()
	if !s.sessionActiveLocked(generation) {
		s.mu.Unlock()
		return errSessionChanged
	}
	_, next, clearErr := s.invalidateLocked()
	s.mu.Unlock()
	issue := storageStatus(code, message, clearErr)
	s.reportStatus(next, issue)
	s.emitForSession("auth:logout", next)
	return errors.New(issue.Message)
}

func (s *Manager) refreshLoop(ctx context.Context, generation uint64, done chan struct{}) {
	defer close(done)
	for {
		s.mu.Lock()
		if !s.sessionActiveLocked(generation) || s.refreshToken == "" {
			s.mu.Unlock()
			return
		}
		delay := time.Until(s.refreshAt)
		if retryDelay := time.Until(s.retryAt); retryDelay > delay {
			delay = retryDelay
		}
		s.mu.Unlock()
		if delay < 10*time.Second {
			delay = 10 * time.Second
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			_ = s.doRefresh(generation)
		}
	}
}
