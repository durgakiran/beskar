package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"beskar/desktop/config"
	"github.com/go-jose/go-jose/v4"
)

func signedIdentity(t *testing.T, key *rsa.PrivateKey, claims map[string]any) string {
	t.Helper()
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithType("JWT"))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(claims)
	jwt, err := signer.Sign(raw)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := jwt.CompactSerialize()
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
func TestSignedAccountVerification(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	wrongKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	cases := []string{"valid", "wrong issuer", "wrong audience", "expired", "future issued", "empty subject", "wrong nonce", "missing nonce", "bad signature", "wrong azp", "multi audience missing azp", "multi audience valid azp", "wrong access hash", "userinfo mismatch", "userinfo missing", "keys redirect"}
	for _, name := range cases {
		t.Run(name, func(t *testing.T) {
			var userinfoCalls atomic.Int32
			infoSubject := "verified-account"
			if name == "userinfo mismatch" {
				infoSubject = "another-account"
			}
			if name == "userinfo missing" {
				infoSubject = ""
			}
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/oauth/v2/keys":
					if name == "keys redirect" {
						http.Redirect(w, r, "https://must-not-follow.invalid/keys", 302)
						return
					}
					_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "key", Use: "sig", Algorithm: "RS256"}}})
				case "/oidc/v1/userinfo":
					userinfoCalls.Add(1)
					if r.Header.Get("Authorization") != "Bearer new-access" {
						t.Error("userinfo credential incorrect")
					}
					_ = json.NewEncoder(w).Encode(map[string]string{"sub": infoSubject})
				default:
					t.Error("unexpected identity endpoint")
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			claims := map[string]any{"iss": server.URL, "aud": "native-client", "sub": "verified-account", "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(), "nonce": "login-nonce"}
			signingKey := key
			switch name {
			case "wrong issuer":
				claims["iss"] = "https://wrong.test"
			case "wrong audience":
				claims["aud"] = "other-client"
			case "expired":
				claims["exp"] = time.Now().Add(-time.Minute).Unix()
			case "future issued":
				claims["iat"] = time.Now().Add(time.Hour).Unix()
			case "empty subject":
				claims["sub"] = ""
			case "wrong nonce":
				claims["nonce"] = "other-nonce"
			case "missing nonce":
				delete(claims, "nonce")
			case "bad signature":
				signingKey = wrongKey
			case "wrong azp":
				claims["azp"] = "other-client"
			case "multi audience missing azp":
				claims["aud"] = []string{"native-client", "other-client"}
			case "multi audience valid azp":
				claims["aud"] = []string{"native-client", "other-client"}
				claims["azp"] = "native-client"
			case "wrong access hash":
				claims["at_hash"] = "wrong-hash"
			}
			manager := &Manager{cfg: &config.AppConfig{ZitadelURL: server.URL, ClientID: "native-client"}, client: server.Client()}
			subject, err := manager.verifyTokenAccount(context.Background(), tokenResponse{AccessToken: "new-access", IDToken: signedIdentity(t, signingKey, claims)}, "", "login-nonce")
			valid := name == "valid" || name == "multi audience valid azp"
			if (err == nil) != valid || (valid && subject != "verified-account") {
				t.Fatalf("account verification outcome incorrect: %v", err)
			}
			if err != nil && (strings.Contains(err.Error(), "new-access") || strings.Contains(err.Error(), "eyJ")) {
				t.Fatal("verification error leaked credentials")
			}
			if !valid && !strings.HasPrefix(name, "userinfo") && userinfoCalls.Load() != 0 {
				t.Fatal("userinfo called before ID token was verified")
			}
		})
	}
}

func TestRefreshCannotSwitchVerifiedAccount(t *testing.T) {
	for _, infoSubject := range []string{"account-a", "account-b"} {
		t.Run(infoSubject, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_ = json.NewEncoder(w).Encode(map[string]string{"sub": infoSubject})
			}))
			defer server.Close()
			manager := &Manager{cfg: &config.AppConfig{ZitadelURL: server.URL, ClientID: "native-client"}, client: server.Client()}
			subject, err := manager.verifyTokenAccount(context.Background(), tokenResponse{AccessToken: "renewed-access"}, "account-a", "original-nonce")
			if (err == nil) != (infoSubject == "account-a") || (err == nil && subject != "account-a") {
				t.Fatal("refresh account binding failed")
			}
		})
	}
}

func TestVerifiedLoginWritesOnlyScopedCredentials(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var encodedID string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth/v2/token":
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "access", "refresh_token": "refresh", "id_token": encodedID, "expires_in": 3600})
		case "/oauth/v2/keys":
			_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, Use: "sig", Algorithm: "RS256"}}})
		case "/oidc/v1/userinfo":
			_ = json.NewEncoder(w).Encode(map[string]string{"sub": "account-from-provider"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	encodedID = signedIdentity(t, key, map[string]any{"iss": server.URL, "aud": "native-client", "sub": "account-from-provider", "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(), "nonce": "transaction-nonce"})
	backend := newMemorySecrets()
	backend.values[secretKey(legacyServiceName, legacyAccountName)] = "unknown-legacy-credential"
	cfg := &config.AppConfig{ZitadelURL: server.URL, ServerURL: "https://api.test", ClientID: "native-client"}
	store, err := newKeychainStore(cfg, backend)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	manager := &Manager{store: store, client: server.Client(), emit: func(string) {}}
	manager.Initialize(ctx, cfg)
	if manager.GetStatus().Code != "credential_migration_required" {
		t.Fatal("legacy login was not retired")
	}
	if err := manager.exchangeCode(ctx, "code", "verifier", manager.currentGeneration(), "transaction-nonce"); err != nil {
		t.Fatal(err)
	}
	if manager.GetAccessToken() != "access" {
		t.Fatal("verified login not adopted")
	}
	saved, err := store.Load()
	if err != nil || saved.Subject != "account-from-provider" || saved.LoginNonce != "transaction-nonce" {
		t.Fatal("verified identity not persisted")
	}
	restartedStore, _ := newKeychainStore(cfg, backend)
	restarted := &Manager{store: restartedStore, client: server.Client(), emit: func(string) {}}
	restarted.Initialize(ctx, cfg)
	if restarted.GetAccessToken() != "access" {
		t.Fatal("scoped login did not survive restart")
	}
}

func TestScopedRefreshKeepsAccountBindingAndRejectsSwitch(t *testing.T) {
	for _, subject := range []string{"account-a", "account-b"} {
		t.Run(subject, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/oauth/v2/token":
					_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "renewed", "refresh_token": "rotated", "expires_in": 3600})
				case "/oidc/v1/userinfo":
					_ = json.NewEncoder(w).Encode(map[string]string{"sub": subject})
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			backend := newMemorySecrets()
			cfg := &config.AppConfig{ZitadelURL: server.URL, ServerURL: "https://api.test", ClientID: "native-client"}
			store, _ := newKeychainStore(cfg, backend)
			_ = store.Save(fixtureTokens("other-account"))
			expired := fixtureTokens("account-a")
			expired.Expiry = time.Now().Add(-time.Minute)
			_ = store.Save(expired)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			manager := &Manager{store: store, client: server.Client(), emit: func(string) {}}
			manager.Initialize(ctx, cfg)
			if subject == "account-a" {
				saved, err := store.Load()
				if err != nil || saved.Subject != "account-a" || saved.LoginNonce != expired.LoginNonce || saved.RefreshPending || manager.GetAccessToken() != "renewed" {
					t.Fatal("renewal lost scoped account binding")
				}
			} else if manager.GetAccessToken() != "" || manager.GetStatus().Code != "account_verification_failed" {
				t.Fatal("renewal switched account")
			}
			if _, err := backend.Get(store.service(), store.accountKey("other-account")); err != nil {
				t.Fatal("renewal/logout deleted unrelated account")
			}
		})
	}
}
