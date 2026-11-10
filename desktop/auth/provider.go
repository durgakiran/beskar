package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const providerTimeout = 15 * time.Second

// Failure messages/codes are controlled locally: never expose provider bodies,
// request URLs, transport errors or credential-store details to the renderer.
type authFailure struct {
	code, message string
	// retrySafe requires an explicit, recognized OAuth error response. Network
	// errors, redirects, 5xx and malformed success responses are ambiguous.
	retrySafe bool
}

func (e *authFailure) Error() string            { return e.message }
func failure(code, message string) *authFailure { return &authFailure{code: code, message: message} }

func boundedClient(base *http.Client, timeout time.Duration) *http.Client {
	client := *base
	if client.Timeout == 0 || client.Timeout > timeout {
		client.Timeout = timeout
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &client
}

// These deployments use HTTPS origins, not arbitrary discovery-supplied token
// endpoints. No userinfo, path prefix, query, fragment or opaque URI is accepted.
func trustedOrigin(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Opaque != "" ||
		(u.Path != "" && u.Path != "/") || u.RawPath != "" || u.RawQuery != "" || u.ForceQuery ||
		u.Fragment != "" || strings.ContainsAny(raw, "#\\ \t\r\n") {
		return "", failure("invalid_configuration", "Authentication requires valid HTTPS server and identity-provider origins.")
	}
	return "https://" + strings.TrimSuffix(strings.ToLower(u.Host), ":443"), nil
}

func (s *Manager) requestBudget() time.Duration {
	if s.requestTimeout > 0 && s.requestTimeout < providerTimeout {
		return s.requestTimeout
	}
	return providerTimeout
}

func (s *Manager) providerURL(path string) (string, error) {
	if s.cfg == nil {
		return "", failure("invalid_configuration", "Application not configured for authentication.")
	}
	origin, err := trustedOrigin(s.cfg.ZitadelURL)
	if err != nil {
		return "", err
	}
	switch path {
	case "/oauth/v2/token", "/oauth/v2/revoke", "/oidc/v1/userinfo", "/oauth/v2/keys":
		return origin + path, nil
	default:
		return "", failure("invalid_configuration", "Unsupported identity-provider endpoint.")
	}
}

func transportFailure(ctx context.Context, err error) *authFailure {
	var timeout net.Error
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &timeout) && timeout.Timeout()) {
		return failure("provider_timeout", "The identity provider did not respond in time.")
	}
	if ctx.Err() != nil {
		return failure("provider_cancelled", "Authentication request cancelled.")
	}
	return failure("provider_network", "Unable to reach the identity provider.")
}

type tokenResponse struct {
	subject, nonce string
	AccessToken    string `json:"access_token"`
	RefreshToken   string `json:"refresh_token"`
	IDToken        string `json:"id_token"`
	ExpiresIn      int64  `json:"expires_in"`
}

func decodeProviderJSON(body io.Reader, target any, limit int64) error {
	data, err := io.ReadAll(io.LimitReader(body, limit+1))
	if err != nil || int64(len(data)) > limit || json.Unmarshal(data, target) != nil {
		return failure("invalid_provider_response", "The identity provider returned an invalid response.")
	}
	return nil
}

// Fetching never mutates a session or automatically retries a credential POST.
func (s *Manager) requestTokens(ctx context.Context, data url.Values) (tokenResponse, error) {
	var result tokenResponse
	endpoint, err := s.providerURL("/oauth/v2/token")
	if err != nil {
		return result, err
	}
	ctx, cancel := context.WithTimeout(ctx, s.requestBudget())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return result, failure("invalid_configuration", "Unable to create authentication request.")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := s.httpClient().Do(req)
	if err != nil {
		return result, transportFailure(ctx, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		return result, failure("provider_redirect", "The identity provider redirected an authentication request. Check the configured provider.")
	}
	if resp.StatusCode != http.StatusOK {
		var provider struct {
			Error string `json:"error"`
		}
		if decodeProviderJSON(resp.Body, &provider, 64*1024) == nil && resp.StatusCode == http.StatusBadRequest {
			switch provider.Error {
			case "invalid_grant":
				return result, failure("invalid_grant", "Your session is no longer valid. Sign in again.")
			case "invalid_client", "unauthorized_client", "invalid_scope", "unsupported_grant_type", "invalid_request":
				return result, failure("provider_rejected", "The identity provider rejected the authentication request. Check the application configuration.")
			case "temporarily_unavailable", "server_error":
				return result, &authFailure{code: "provider_unavailable", message: "The identity provider is temporarily unavailable. Renewal will retry shortly.", retrySafe: true}
			}
		}
		if ctx.Err() != nil {
			return result, transportFailure(ctx, err)
		}
		return result, failure("provider_uncertain", "The identity provider did not confirm the authentication request.")
	}
	if err := decodeProviderJSON(resp.Body, &result, 1024*1024); err != nil {
		if ctx.Err() != nil {
			return result, transportFailure(ctx, err)
		}
		return result, err
	}
	if result.AccessToken == "" || result.ExpiresIn <= 0 || result.ExpiresIn > int64((time.Duration(1<<63-1))/time.Second) {
		return result, failure("invalid_provider_response", "The identity provider returned an invalid token response.")
	}
	if ctx.Err() != nil {
		return result, transportFailure(ctx, err)
	}
	return result, nil
}
