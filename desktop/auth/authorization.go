package auth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"beskar/desktop/config"
)

// Read the API's public audience configuration before login, so newly issued
// access tokens target that API. Existing grants require a fresh login.
func loginAuthorizationURL(ctx context.Context, cfg *config.AppConfig, challenge, state string, client *http.Client) (string, error) {
	serverOrigin, err := trustedOrigin(cfg.ServerURL)
	if err != nil {
		return "", err
	}
	issuerOrigin, err := trustedOrigin(cfg.ZitadelURL)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, providerTimeout)
	defer cancel()
	client = boundedClient(client, providerTimeout)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, serverOrigin+"/.well-known/beskar", nil)
	if err != nil {
		return "", err
	}
	response, err := client.Do(req)
	if err != nil {
		return "", errors.New("unable to discover API audience; check your connection and retry login")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", errors.New("unable to discover API audience")
	}
	var metadata struct {
		Issuer   string `json:"zitadel_url"`
		Audience string `json:"api_audience"`
	}
	if decodeProviderJSON(response.Body, &metadata, 64*1024) != nil ||
		strings.TrimRight(metadata.Issuer, "/") != issuerOrigin ||
		metadata.Audience == "" || strings.ContainsAny(metadata.Audience, " \t\r\n") {
		return "", errors.New("invalid API audience or mismatched Zitadel issuer")
	}
	params := url.Values{
		"client_id": {cfg.ClientID}, "redirect_uri": {RedirectURI}, "response_type": {"code"},
		"scope":          {"openid profile email offline_access urn:zitadel:iam:org:project:id:" + metadata.Audience + ":aud"},
		"state":          {state},
		"code_challenge": {challenge}, "code_challenge_method": {"S256"},
	}
	return issuerOrigin + "/oauth/v2/authorize?" + params.Encode(), nil
}
