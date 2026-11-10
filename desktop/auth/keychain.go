package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"beskar/desktop/config"
	"github.com/zalando/go-keyring"
)

const legacyServiceName = "Beskar"
const legacyAccountName = "user_tokens"
const credentialVersion = 2

var errCredentialsNotFound = keyring.ErrNotFound
var errCredentialContext = errors.New("saved credential context does not match")
var errCredentialMigration = errors.New("legacy credentials retired; fresh login required")
var errLegacyCleanup = errors.New("unable to retire legacy credentials")
var errCredentialAppIdentity = errors.New("application signing identity could not be verified")

// TokenStore never crosses Wails IPC. Subject/nonce originate in a verified
// provider response, and are persisted together with the rotating token set.
type TokenStore struct {
	Subject        string    `json:"subject"`
	LoginNonce     string    `json:"login_nonce"`
	RefreshPending bool      `json:"refresh_pending,omitempty"`
	AccessToken    string    `json:"access_token"`
	RefreshToken   string    `json:"refresh_token"`
	IDToken        string    `json:"id_token"`
	Expiry         time.Time `json:"expiry"`
}

type secretBackend interface {
	Get(service, account string) (string, error)
	Set(service, account, value string) error
	Delete(service, account string) error
}

type credentialContext struct {
	AppID            string `json:"app_id"`
	Environment      string `json:"environment"`
	SigningAuthority string `json:"signing_authority"`
	Issuer           string `json:"issuer"`
	ClientID         string `json:"client_id"`
	APIOrigin        string `json:"api_origin"`
}
type credentialSelection struct {
	Version int               `json:"version"`
	Context credentialContext `json:"context"`
	Subject string            `json:"subject"`
}
type credentialRecord struct {
	credentialSelection
	Tokens TokenStore `json:"tokens"`
}

type keychainStore struct {
	mu             sync.Mutex
	backend        secretBackend
	context        credentialContext
	activeSubject  string
	cleanupSubject string
	legacyBlocked  bool
}

func newKeychainStore(cfg *config.AppConfig, backend secretBackend) (*keychainStore, error) {
	if cfg == nil || cfg.ClientID == "" || strings.TrimSpace(cfg.ClientID) != cfg.ClientID {
		return nil, errCredentialContext
	}
	issuer, err := trustedOrigin(cfg.ZitadelURL)
	if err != nil {
		return nil, err
	}
	api, err := trustedOrigin(cfg.ServerURL)
	if err != nil {
		return nil, err
	}
	// Canonicalize origin spelling, but keep OAuth client IDs and subjects exact.
	issuer = strings.ToLower(strings.TrimSuffix(issuer, ":443"))
	api = strings.ToLower(strings.TrimSuffix(api, ":443"))
	return &keychainStore{backend: backend, context: credentialContext{AppID: config.ApplicationID, Environment: config.Environment, SigningAuthority: config.ReleaseTeamID, Issuer: issuer, ClientID: cfg.ClientID, APIOrigin: api}}, nil
}
func (s *keychainStore) service() string { return s.context.AppID + ".credentials.v2" }
func digest(value any) string {
	raw, _ := json.Marshal(value)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func (s *keychainStore) selectionKey() string { return "profile:" + digest(s.context) }
func (s *keychainStore) accountKey(subject string) string {
	return "account:" + digest(struct {
		Context credentialContext
		Subject string
	}{s.context, subject})
}
func (s *keychainStore) valid(selection credentialSelection) bool {
	return selection.Version == credentialVersion && selection.Context == s.context && selection.Subject != ""
}
func (s *keychainStore) selection() (credentialSelection, error) {
	var selection credentialSelection
	raw, err := s.backend.Get(s.service(), s.selectionKey())
	if err != nil {
		return selection, err
	}
	if json.Unmarshal([]byte(raw), &selection) != nil || !s.valid(selection) {
		return selection, errCredentialContext
	}
	return selection, nil
}
func deleteIfPresent(backend secretBackend, service, account string) error {
	err := backend.Delete(service, account)
	if errors.Is(err, errCredentialsNotFound) {
		return nil
	}
	return err
}

// Legacy values are deleted without reading or importing their tokens. An
// existing valid v2 selection is independent of the old global slot.
func (s *keychainStore) Load() (TokenStore, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	legacyErr := s.backend.Delete(legacyServiceName, legacyAccountName)
	retired := legacyErr == nil
	if legacyErr != nil && !errors.Is(legacyErr, errCredentialsNotFound) {
		s.legacyBlocked = true
		return TokenStore{}, errors.Join(errLegacyCleanup, legacyErr)
	}
	selection, err := s.selection()
	if errors.Is(err, errCredentialsNotFound) {
		if retired {
			return TokenStore{}, errCredentialMigration
		}
		return TokenStore{}, errCredentialsNotFound
	}
	if err != nil {
		return TokenStore{}, err
	}
	raw, err := s.backend.Get(s.service(), s.accountKey(selection.Subject))
	if err != nil {
		return TokenStore{}, err
	}
	var record credentialRecord
	if len(raw) > 2*1024*1024 || json.Unmarshal([]byte(raw), &record) != nil || !s.valid(record.credentialSelection) || record.Subject != selection.Subject || record.Tokens.Subject != selection.Subject || record.Tokens.LoginNonce == "" {
		return TokenStore{}, errCredentialContext
	}
	s.activeSubject = selection.Subject
	return record.Tokens, nil
}
func (s *keychainStore) Save(tokens TokenStore) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.legacyBlocked {
		return errLegacyCleanup
	}
	if tokens.Subject == "" || len(tokens.Subject) > 255 || tokens.LoginNonce == "" || len(tokens.LoginNonce) > 256 {
		return errCredentialContext
	}
	selection := credentialSelection{Version: credentialVersion, Context: s.context, Subject: tokens.Subject}
	raw, _ := json.Marshal(credentialRecord{credentialSelection: selection, Tokens: tokens})
	s.cleanupSubject = tokens.Subject
	if err := s.backend.Set(s.service(), s.accountKey(tokens.Subject), string(raw)); err != nil {
		return err
	}
	raw, _ = json.Marshal(selection)
	if err := s.backend.Set(s.service(), s.selectionKey(), string(raw)); err != nil {
		return err
	}
	s.activeSubject = tokens.Subject
	s.cleanupSubject = ""
	return nil
}
func (s *keychainStore) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	selection, err := s.selection()
	if err != nil && !errors.Is(err, errCredentialsNotFound) {
		return err
	}
	subject := s.activeSubject
	if subject == "" && err == nil {
		subject = selection.Subject
	}
	var failures []error
	if subject != "" {
		failures = append(failures, deleteIfPresent(s.backend, s.service(), s.accountKey(subject)))
	}
	if s.cleanupSubject != "" && s.cleanupSubject != subject {
		failures = append(failures, deleteIfPresent(s.backend, s.service(), s.accountKey(s.cleanupSubject)))
	}
	// Never delete another account's selector if it changed independently.
	if err == nil && selection.Subject == subject {
		failures = append(failures, deleteIfPresent(s.backend, s.service(), s.selectionKey()))
	}
	result := errors.Join(failures...)
	if result == nil {
		s.activeSubject = ""
		s.cleanupSubject = ""
	}
	return result
}

// Missing/invalid configuration must never fall back to the legacy global slot.
type unavailableStore struct{}

func (unavailableStore) Load() (TokenStore, error) { return TokenStore{}, errCredentialContext }
func (unavailableStore) Save(TokenStore) error     { return errCredentialContext }
func (unavailableStore) Clear() error              { return errCredentialContext }
