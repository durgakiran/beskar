package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"beskar/desktop/config"
)

type memorySecrets struct {
	mu         sync.Mutex
	values     map[string]string
	gets       map[string]int
	deletes    map[string]int
	failDelete string
	failSet    string
}

func secretKey(s, a string) string { return s + "/" + a }
func newMemorySecrets() *memorySecrets {
	return &memorySecrets{values: map[string]string{}, gets: map[string]int{}, deletes: map[string]int{}}
}
func (b *memorySecrets) Get(s, a string) (string, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	k := secretKey(s, a)
	b.gets[k]++
	v, ok := b.values[k]
	if !ok {
		return "", errCredentialsNotFound
	}
	return v, nil
}
func (b *memorySecrets) Set(s, a, v string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	k := secretKey(s, a)
	if k == b.failSet {
		return errors.New("private store failure")
	}
	b.values[k] = v
	return nil
}
func (b *memorySecrets) Delete(s, a string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	k := secretKey(s, a)
	b.deletes[k]++
	if k == b.failDelete {
		return errors.New("private delete failure")
	}
	if _, ok := b.values[k]; !ok {
		return errCredentialsNotFound
	}
	delete(b.values, k)
	return nil
}
func fixtureScope(t *testing.T, backend secretBackend) *keychainStore {
	t.Helper()
	s, err := newKeychainStore(&config.AppConfig{ServerURL: "https://api.test", ZitadelURL: "https://issuer.test", ClientID: "client-a"}, backend)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func fixtureTokens(subject string) TokenStore {
	return TokenStore{Subject: subject, LoginNonce: "verified-login-nonce", AccessToken: "access-" + subject, RefreshToken: "refresh-" + subject, IDToken: "id-" + subject, Expiry: time.Now().Add(time.Hour)}
}

func TestCredentialIsolationByAuthenticationContext(t *testing.T) {
	changes := map[string]func(*credentialContext){
		"app":               func(c *credentialContext) { c.AppID += ".other" },
		"environment":       func(c *credentialContext) { c.Environment = "another-environment" },
		"signing authority": func(c *credentialContext) { c.SigningAuthority = "OTHERTEAM" },
		"issuer":            func(c *credentialContext) { c.Issuer = "https://other-issuer.test" },
		"client":            func(c *credentialContext) { c.ClientID = "other-client" },
		"API":               func(c *credentialContext) { c.APIOrigin = "https://other-api.test" },
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			backend := newMemorySecrets()
			original := fixtureScope(t, backend)
			if err := original.Save(fixtureTokens("account-a")); err != nil {
				t.Fatal(err)
			}
			isolated := fixtureScope(t, backend)
			change(&isolated.context)
			if _, err := isolated.Load(); !errors.Is(err, errCredentialsNotFound) {
				t.Fatal("another context restored credentials")
			}
			if err := isolated.Save(fixtureTokens("account-b")); err != nil {
				t.Fatal(err)
			}
			if err := isolated.Clear(); err != nil {
				t.Fatal(err)
			}
			restored, err := original.Load()
			if err != nil || restored.Subject != "account-a" || restored.RefreshToken != "refresh-account-a" {
				t.Fatal("other-context save/logout changed original credentials")
			}
		})
	}
}

func TestCredentialMetadataMismatchNeverTransmitsTokens(t *testing.T) {
	for _, kind := range []string{"selector context", "record context", "record subject", "token subject", "version", "missing nonce"} {
		t.Run(kind, func(t *testing.T) {
			backend := newMemorySecrets()
			scope := fixtureScope(t, backend)
			_ = scope.Save(fixtureTokens("account-a"))
			if kind == "selector context" {
				var selected credentialSelection
				raw, _ := backend.Get(scope.service(), scope.selectionKey())
				_ = json.Unmarshal([]byte(raw), &selected)
				selected.Context.Issuer = "https://wrong.test"
				changed, _ := json.Marshal(selected)
				_ = backend.Set(scope.service(), scope.selectionKey(), string(changed))
			} else {
				var record credentialRecord
				raw, _ := backend.Get(scope.service(), scope.accountKey("account-a"))
				_ = json.Unmarshal([]byte(raw), &record)
				switch kind {
				case "record context":
					record.Context.APIOrigin = "https://wrong.test"
				case "record subject":
					record.Subject = "account-b"
				case "token subject":
					record.Tokens.Subject = "account-b"
				case "version":
					record.Version = 1
				case "missing nonce":
					record.Tokens.LoginNonce = ""
				}
				changed, _ := json.Marshal(record)
				_ = backend.Set(scope.service(), scope.accountKey("account-a"), string(changed))
			}
			var sent atomic.Int32
			manager := &Manager{store: scope, emit: func(string) {}, client: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { sent.Add(1); return tokenHTTP(200, `{}`) })}}
			manager.Initialize(context.Background(), &config.AppConfig{ZitadelURL: "https://issuer.test", ServerURL: "https://api.test", ClientID: "client-a"})
			if manager.GetAccessToken() != "" || sent.Load() != 0 || manager.GetStatus().Code != "credential_context_mismatch" {
				t.Fatal("mismatched credentials were restored or sent")
			}
		})
	}
}

func TestAccountSelectionAndLogoutAreScoped(t *testing.T) {
	backend := newMemorySecrets()
	scope := fixtureScope(t, backend)
	_ = scope.Save(fixtureTokens("account-a"))
	_ = scope.Save(fixtureTokens("account-b"))
	loaded, err := scope.Load()
	if err != nil || loaded.Subject != "account-b" {
		t.Fatal("wrong active account restored")
	}
	if err := scope.Clear(); err != nil {
		t.Fatal(err)
	}
	if _, err := backend.Get(scope.service(), scope.accountKey("account-a")); err != nil {
		t.Fatal("logout deleted another account")
	}
	if _, err := scope.Load(); !errors.Is(err, errCredentialsNotFound) {
		t.Fatal("logout silently selected a different account")
	}
	_ = scope.Save(fixtureTokens("account-a"))
	loaded, err = scope.Load()
	if err != nil || loaded.Subject != "account-a" {
		t.Fatal("fresh selection of original account failed")
	}
}

func TestStaleAccountLogoutPreservesNewSelection(t *testing.T) {
	backend := newMemorySecrets()
	old := fixtureScope(t, backend)
	_ = old.Save(fixtureTokens("account-a"))
	current := fixtureScope(t, backend)
	_ = current.Save(fixtureTokens("account-b"))
	if err := old.Clear(); err != nil {
		t.Fatal(err)
	}
	got, err := current.Load()
	if err != nil || got.Subject != "account-b" {
		t.Fatal("old logout deleted new account selection")
	}
}

func TestLegacyMigrationDeletesWithoutReadingAndRequiresLogin(t *testing.T) {
	backend := newMemorySecrets()
	legacy := secretKey(legacyServiceName, legacyAccountName)
	backend.values[legacy] = "legacy-secret-must-not-be-read"
	scope := fixtureScope(t, backend)
	manager := &Manager{store: scope, emit: func(string) {}}
	manager.Initialize(context.Background(), &config.AppConfig{ZitadelURL: "https://issuer.test", ServerURL: "https://api.test", ClientID: "client-a"})
	if manager.GetStatus().Code != "credential_migration_required" || manager.GetAccessToken() != "" {
		t.Fatal("migration did not require fresh login")
	}
	if backend.gets[legacy] != 0 || backend.deletes[legacy] != 1 {
		t.Fatal("legacy tokens were read or not retired")
	}
	if _, exists := backend.values[legacy]; exists {
		t.Fatal("legacy entry retained")
	}
	if err := scope.Save(fixtureTokens("fresh-account")); err != nil {
		t.Fatal(err)
	}
	next := fixtureScope(t, backend)
	tokens, err := next.Load()
	if err != nil || tokens.Subject != "fresh-account" {
		t.Fatal("fresh scoped credentials did not restore")
	}
}

func TestMigrationFailureBlocksSaveAndPreservesOtherContexts(t *testing.T) {
	backend := newMemorySecrets()
	other := fixtureScope(t, backend)
	other.context.ClientID = "unrelated-client"
	_ = other.Save(fixtureTokens("other-account"))
	legacy := secretKey(legacyServiceName, legacyAccountName)
	backend.values[legacy] = "old-secret"
	backend.failDelete = legacy
	scope := fixtureScope(t, backend)
	if _, err := scope.Load(); !errors.Is(err, errLegacyCleanup) {
		t.Fatal("failed migration hidden")
	}
	if err := scope.Save(fixtureTokens("fresh-account")); !errors.Is(err, errLegacyCleanup) {
		t.Fatal("login saved despite failed migration")
	}
	if _, err := backend.Get(other.service(), other.accountKey("other-account")); err != nil {
		t.Fatal("migration deleted another context")
	}
	backend.failDelete = ""
	retry := fixtureScope(t, backend)
	if _, err := retry.Load(); !errors.Is(err, errCredentialMigration) {
		t.Fatal("migration could not recover")
	}
	if err := retry.Save(fixtureTokens("fresh-account")); err != nil {
		t.Fatal(err)
	}
}

func TestContextCanonicalizationAndOpaqueAccountKeys(t *testing.T) {
	backend := newMemorySecrets()
	one := fixtureScope(t, backend)
	two, err := newKeychainStore(&config.AppConfig{ServerURL: "https://API.TEST:443/", ZitadelURL: "https://ISSUER.TEST:443/", ClientID: "client-a"}, backend)
	if err != nil || one.context != two.context || one.selectionKey() != two.selectionKey() {
		t.Fatal("equivalent origins produced different contexts")
	}
	if one.accountKey("Account-A") == one.accountKey("account-a") {
		t.Fatal("case-sensitive subjects collapsed")
	}
	if len(one.accountKey("sensitive-account")) != 72 {
		t.Fatal("unexpected opaque account key")
	}
}

func TestPendingRefreshSurvivesScopedStorageAndCannotCrossContext(t *testing.T) {
	backend := newMemorySecrets()
	scope := fixtureScope(t, backend)
	tokens := fixtureTokens("account-a")
	tokens.RefreshPending = true
	_ = scope.Save(tokens)
	next := fixtureScope(t, backend)
	loaded, err := next.Load()
	if err != nil || !loaded.RefreshPending {
		t.Fatal("pending marker lost")
	}
	var requests atomic.Int32
	manager := &Manager{store: next, emit: func(string) {}, client: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { requests.Add(1); return tokenHTTP(500, `{}`) })}}
	manager.Initialize(context.Background(), &config.AppConfig{ZitadelURL: "https://issuer.test", ServerURL: "https://api.test", ClientID: "client-a"})
	if manager.GetAccessToken() != "" || requests.Load() != 0 || manager.GetStatus().Code != "refresh_uncertain" {
		t.Fatal("scoped pending refresh was resumed")
	}
}

func TestManagerRejectsStoreFromDifferentConfiguration(t *testing.T) {
	for _, field := range []string{"issuer", "API", "client"} {
		t.Run(field, func(t *testing.T) {
			backend := newMemorySecrets()
			scope := fixtureScope(t, backend)
			_ = scope.Save(fixtureTokens("account-a"))
			cfg := &config.AppConfig{ZitadelURL: "https://issuer.test", ServerURL: "https://api.test", ClientID: "client-a"}
			switch field {
			case "issuer":
				cfg.ZitadelURL = "https://other.test"
			case "API":
				cfg.ServerURL = "https://other.test"
			case "client":
				cfg.ClientID = "other-client"
			}
			manager := &Manager{store: scope, emit: func(string) {}}
			manager.Initialize(context.Background(), cfg)
			if manager.GetAccessToken() != "" || manager.GetStatus().Code != "credential_context_mismatch" {
				t.Fatal("store was used with a different native configuration")
			}
		})
	}
}
