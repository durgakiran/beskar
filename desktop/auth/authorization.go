package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"beskar/desktop/config"
)

// Read the API's public audience configuration before login, so newly issued
// access tokens target that API. Existing grants require a fresh login.
func loginAuthorizationURL(ctx context.Context, cfg *config.AppConfig, challenge string, client *http.Client) (string, error) {
	for _, raw := range []string{cfg.ServerURL, cfg.ZitadelURL} {
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return "", errors.New("login requires HTTPS server and Zitadel URLs")
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(cfg.ServerURL, "/")+"/.well-known/beskar", nil)
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
	if json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&metadata) != nil ||
		strings.TrimRight(metadata.Issuer, "/") != strings.TrimRight(cfg.ZitadelURL, "/") ||
		metadata.Audience == "" || strings.ContainsAny(metadata.Audience, " \t\r\n") {
		return "", errors.New("invalid API audience or mismatched Zitadel issuer")
	}
	params := url.Values{
		"client_id": {cfg.ClientID}, "redirect_uri": {RedirectURI}, "response_type": {"code"},
		"scope":          {"openid profile email offline_access urn:zitadel:iam:org:project:id:" + metadata.Audience + ":aud"},
		"code_challenge": {challenge}, "code_challenge_method": {"S256"},
	}
	return strings.TrimRight(cfg.ZitadelURL, "/") + "/oauth/v2/authorize?" + params.Encode(), nil
}
