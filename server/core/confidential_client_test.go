package core

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/zitadel/oidc/v3/pkg/client/rp"
	"github.com/zitadel/oidc/v3/pkg/oidc"
	"golang.org/x/oauth2"
)

func TestConfidentialBrowserExchangeUsesSecretAndPKCE(t *testing.T) {
	for _, rejected := range []bool{false, true} {
		t.Run(map[bool]string{false: "accepted", true: "rejected without fallback"}[rejected], func(t *testing.T) {
			const secret = "test+secret:/="
			t.Setenv("ZITADEL_CLIENT_ID", "browser-client")
			t.Setenv("ZITADEL_CLIENT_SECRET", secret)
			t.Setenv("KEY", "01234567890123456789012345678901")
			t.Setenv("SERVER_URL", "https://app.example")
			var issuer, challenge string
			var exchanges atomic.Int32
			provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/.well-known/openid-configuration":
					_ = json.NewEncoder(w).Encode(map[string]any{
						"issuer": issuer, "authorization_endpoint": issuer + "/authorize", "token_endpoint": issuer + "/token",
						"jwks_uri": issuer + "/keys", "userinfo_endpoint": issuer + "/userinfo",
						"token_endpoint_auth_methods_supported": []string{"client_secret_basic"},
						"code_challenge_methods_supported":      []string{"S256"},
					})
				case "/token":
					exchanges.Add(1)
					id, encodedSecret, ok := r.BasicAuth()
					decodedSecret, err := url.QueryUnescape(encodedSecret)
					if !ok || id != "browser-client" || err != nil || decodedSecret != secret {
						t.Error("token exchange did not authenticate the confidential client")
					}
					if r.Method != "POST" || r.FormValue("grant_type") != "authorization_code" || r.FormValue("code") != "test-code" || r.FormValue("redirect_uri") != "https://app.example/auth/callback" {
						t.Error("incorrect authorization-code exchange")
					}
					verifier := r.FormValue("code_verifier")
					if verifier == "" || oidc.NewSHACodeChallenge(verifier) != challenge {
						t.Error("exchange verifier does not match the login challenge")
					}
					if r.FormValue("client_secret") != "" {
						t.Error("secret belongs in Basic header, not body")
					}
					if rejected {
						w.WriteHeader(401)
						_, _ = w.Write([]byte(`{"error":"invalid_client"}`))
						return
					}
					_, _ = w.Write([]byte(`{"access_token":"test-access","token_type":"Bearer","expires_in":3600}`))
				default:
					t.Errorf("unexpected provider request %s", r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer provider.Close()
			issuer = provider.URL
			party, err := zitadelClientAuthenticationWithHTTPClient(provider.Client())(context.Background(), issuer)
			if err != nil {
				t.Fatal(err)
			}
			if !party.IsPKCE() || party.OAuthConfig().Endpoint.AuthStyle != oauth2.AuthStyleInHeader {
				t.Fatal("PKCE and confidential authentication must both be enabled")
			}
			login := httptest.NewRecorder()
			rp.AuthURLHandler(func() string { return "test-state" }, party)(login, httptest.NewRequest("GET", "/auth/login", nil))
			location, err := url.Parse(login.Header().Get("Location"))
			if err != nil {
				t.Fatal(err)
			}
			challenge = location.Query().Get("code_challenge")
			if challenge == "" || location.Query().Get("code_challenge_method") != "S256" || strings.Contains(location.String(), "secret") {
				t.Fatal("login must expose a PKCE challenge but no client secret")
			}
			callback := httptest.NewRequest("GET", "/auth/callback", nil)
			for _, cookie := range login.Result().Cookies() {
				callback.AddCookie(cookie)
			}
			verifier, err := party.CookieHandler().CheckCookie(callback, "pkce")
			if err != nil {
				t.Fatal(err)
			}
			// Exercise the same oauth2 exchange used by rp.CodeExchange. ID-token
			// signature verification remains the SDK's existing responsibility.
			ctx := context.WithValue(context.Background(), oauth2.HTTPClient, party.HttpClient())
			token, err := party.OAuthConfig().Exchange(ctx, "test-code", oauth2.SetAuthURLParam("code_verifier", verifier))
			if rejected && err == nil {
				t.Fatal("invalid client credentials accepted")
			}
			if !rejected && (err != nil || token.AccessToken != "test-access") {
				t.Fatalf("exchange failed: %v", err)
			}
			if exchanges.Load() != 1 {
				t.Fatal("client authentication retried with a different method")
			}
		})
	}
}

func TestConfidentialBrowserClientRequiresSecret(t *testing.T) {
	t.Setenv("ZITADEL_CLIENT_ID", "browser-client")
	t.Setenv("ZITADEL_CLIENT_SECRET", "")
	t.Setenv("KEY", "not-an-oauth-client-secret")
	if _, err := zitadelClientAuthentication()(context.Background(), "https://unused.example"); err == nil {
		t.Fatal("missing secret must fail before discovery, not fall back to KEY or public authentication")
	}
}
