package auth

import (
	"context"
	"crypto"
	"crypto/subtle"
	"net/http"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-jose/go-jose/v4"
)

func identityError() error {
	return failure("account_verification_failed", "Unable to verify the identity-provider account. Sign in again.")
}

// Only the configured issuer's fixed JWKS and UserInfo endpoints are used.
// Signed ID-token validation never uses a token-supplied jku/x5u/issuer URL.
func (s *Manager) verifyTokenAccount(ctx context.Context, result tokenResponse, expectedSubject, nonce string) (string, error) {
	if s.verifyAccount != nil {
		return s.verifyAccount(ctx, result, expectedSubject, nonce)
	}
	if nonce == "" || s.cfg == nil {
		return "", identityError()
	}
	ctx, cancel := context.WithTimeout(ctx, s.requestBudget())
	defer cancel()
	issuer, err := trustedOrigin(s.cfg.ZitadelURL)
	if err != nil {
		return "", identityError()
	}
	var signedSubject string
	if result.IDToken != "" {
		endpoint, err := s.providerURL("/oauth/v2/keys")
		if err != nil {
			return "", identityError()
		}
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		response, err := s.httpClient().Do(req)
		if err != nil {
			return "", identityError()
		}
		var jwks jose.JSONWebKeySet
		decodeErr := decodeProviderJSON(response.Body, &jwks, 256*1024)
		response.Body.Close()
		if response.StatusCode != http.StatusOK || decodeErr != nil {
			return "", identityError()
		}
		var keys []crypto.PublicKey
		for _, key := range jwks.Keys {
			if key.Valid() && (key.Use == "" || key.Use == "sig") && (key.Algorithm == "" || key.Algorithm == "RS256") {
				keys = append(keys, key.Public().Key)
			}
		}
		if len(keys) == 0 || len(keys) > 100 {
			return "", identityError()
		}
		verifier := oidc.NewVerifier(issuer, &oidc.StaticKeySet{PublicKeys: keys}, &oidc.Config{ClientID: s.cfg.ClientID, SupportedSigningAlgs: []string{"RS256"}})
		id, err := verifier.Verify(ctx, result.IDToken)
		if err != nil || id.Subject == "" || len(id.Subject) > 255 || id.IssuedAt.IsZero() || id.IssuedAt.After(time.Now().Add(time.Minute)) {
			return "", identityError()
		}
		if (expectedSubject == "" || id.Nonce != "") && subtle.ConstantTimeCompare([]byte(id.Nonce), []byte(nonce)) != 1 {
			return "", identityError()
		}
		var claims struct {
			AuthorizedParty string `json:"azp"`
		}
		if id.Claims(&claims) != nil || (claims.AuthorizedParty != "" && claims.AuthorizedParty != s.cfg.ClientID) || (len(id.Audience) > 1 && claims.AuthorizedParty != s.cfg.ClientID) {
			return "", identityError()
		}
		if id.AccessTokenHash != "" && id.VerifyAccessToken(result.AccessToken) != nil {
			return "", identityError()
		}
		signedSubject = id.Subject
	} else if expectedSubject == "" {
		return "", identityError()
	}
	endpoint, err := s.providerURL("/oidc/v1/userinfo")
	if err != nil {
		return "", identityError()
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	req.Header.Set("Authorization", "Bearer "+result.AccessToken)
	response, err := s.httpClient().Do(req)
	if err != nil {
		return "", identityError()
	}
	defer response.Body.Close()
	var info struct {
		Subject string `json:"sub"`
	}
	if response.StatusCode != http.StatusOK || decodeProviderJSON(response.Body, &info, 64*1024) != nil || info.Subject == "" || len(info.Subject) > 255 {
		return "", identityError()
	}
	if (signedSubject != "" && signedSubject != info.Subject) || (expectedSubject != "" && expectedSubject != info.Subject) {
		return "", identityError()
	}
	return info.Subject, nil
}
