package auth

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os/exec"
	"strings"
	"time"


	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sync/singleflight"
	"beskar/desktop/config"
)

const (
	RedirectURI   = "teddox://callback"
)

var insecureClient = &http.Client{
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	},
}

// UserInfo represents the standard OIDC user claims.
type UserInfo struct {
	Subject string `json:"sub"`
	Email   string `json:"email"`
}

// AuthService manages the authentication lifecycle for the desktop app.
type AuthService struct {
	ctx               context.Context
	accessToken       string
	refreshToken      string
	idToken           string
	expiry            time.Time
	cfg               *config.AppConfig
	loginCallbackChan chan string

	refreshGroup singleflight.Group
}

// Initialize should be called on application startup.
func (s *AuthService) Initialize(ctx context.Context, cfg *config.AppConfig) {
	s.ctx = ctx
	s.cfg = cfg
	// AUTH-6: App startup token recovery
	store, err := LoadTokens()
	if err == nil && store.RefreshToken != "" {
		s.accessToken = store.AccessToken
		s.refreshToken = store.RefreshToken
		s.idToken = store.IDToken
		s.expiry = store.Expiry

		if s.isExpired() {
			if err := s.doRefresh(); err != nil {
				// Refresh token expired or failed
				_ = ClearTokens()
			}
		}

		// Start background refresh loop
		if s.refreshToken != "" {
			go s.startRefreshLoop(s.ctx)
		}
	}
}

func (s *AuthService) isExpired() bool {
	return time.Now().Add(5 * time.Minute).After(s.expiry)
}

// HandleCallback processes the deep link callback from the browser.
func (s *AuthService) HandleCallback(callbackURL string) {
	if s.loginCallbackChan == nil {
		return
	}
	parsed, err := url.Parse(callbackURL)
	if err != nil {
		return
	}
	code := parsed.Query().Get("code")
	if code != "" {
		select {
		case s.loginCallbackChan <- code:
		default:
		}
	}
}

// Login initiates the PKCE flow.
func (s *AuthService) Login() error {
	if s.cfg == nil || s.cfg.ZitadelURL == "" {
		return errors.New("application not configured")
	}

	verifier, err := GenerateCodeVerifier()
	if err != nil {
		return err
	}
	challenge := GenerateCodeChallenge(verifier)

	authURL := fmt.Sprintf("%s/oauth/v2/authorize?client_id=%s&redirect_uri=%s&response_type=code&scope=openid%%20profile%%20email%%20offline_access&code_challenge=%s&code_challenge_method=S256",
		s.cfg.ZitadelURL, s.cfg.ClientID, url.QueryEscape(RedirectURI), challenge)

	s.loginCallbackChan = make(chan string, 1)

	application.Get().Logger.Info("Opening URL: " + authURL)
	if err := exec.Command("cmd", "/c", "start", "", strings.ReplaceAll(authURL, "&", "^&")).Start(); err != nil {
		return err
	}

	select {
	case code := <-s.loginCallbackChan:
		return s.exchangeCode(code, verifier)
	case <-s.ctx.Done():
		return errors.New("login cancelled")
	}
}

func (s *AuthService) exchangeCode(code, verifier string) error {
	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	data.Set("client_id", s.cfg.ClientID)
	data.Set("code", code)
	data.Set("redirect_uri", RedirectURI)
	data.Set("code_verifier", verifier)

	return s.fetchTokens(data)
}

func (s *AuthService) fetchTokens(data url.Values) error {
	req, _ := http.NewRequest("POST", s.cfg.ZitadelURL+"/oauth/v2/token", strings.NewReader(data.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := insecureClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to fetch tokens: status %d", resp.StatusCode)
	}

	var result struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		IDToken      string `json:"id_token"`
		ExpiresIn    int    `json:"expires_in"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return err
	}

	s.accessToken = result.AccessToken
	s.refreshToken = result.RefreshToken
	s.idToken = result.IDToken
	s.expiry = time.Now().Add(time.Duration(result.ExpiresIn) * time.Second)

	_ = SaveTokens(TokenStore{
		AccessToken:  s.accessToken,
		RefreshToken: s.refreshToken,
		IDToken:      s.idToken,
		Expiry:       s.expiry,
	})

	// Restart refresh loop if needed
	go s.startRefreshLoop(s.ctx)

	application.Get().Event.Emit("auth:ready")
	return nil
}

// Logout actively revokes tokens at Zitadel and clears the keychain.
func (s *AuthService) Logout() error {
	s.revoke(s.accessToken)
	s.revoke(s.refreshToken)

	s.accessToken = ""
	s.refreshToken = ""
	s.idToken = ""

	_ = ClearTokens()

	application.Get().Event.Emit("auth:logout")
	return nil
}

func (s *AuthService) revoke(token string) {
	if token == "" {
		return
	}
	data := url.Values{}
	data.Set("client_id", s.cfg.ClientID)
	data.Set("token", token)
	req, _ := http.NewRequest("POST", s.cfg.ZitadelURL+"/oauth/v2/revoke", strings.NewReader(data.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := insecureClient.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}

// GetAccessToken returns the access token, refreshing if necessary.
func (s *AuthService) GetAccessToken() string {
	if !s.isExpired() {
		return s.idToken
	}
	result, err, _ := s.refreshGroup.Do("refresh", func() (any, error) {
		err := s.doRefresh()
		return s.idToken, err
	})
	if err != nil {
		return ""
	}
	return result.(string)
}

// IsAuthenticated returns true if a valid access token is available.
func (s *AuthService) IsAuthenticated() bool {
	return s.GetAccessToken() != ""
}

// GetUserInfo fetches user profile from Zitadel.
func (s *AuthService) GetUserInfo() UserInfo {
	if s.accessToken == "" {
		return UserInfo{}
	}

	req, _ := http.NewRequest("GET", s.cfg.ZitadelURL+"/oidc/v1/userinfo", nil)
	req.Header.Set("Authorization", "Bearer "+s.accessToken)

	resp, err := insecureClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		return UserInfo{}
	}
	defer resp.Body.Close()

	var info UserInfo
	_ = json.NewDecoder(resp.Body).Decode(&info)
	return info
}

// startRefreshLoop is a background loop that proactively refreshes the token.
func (s *AuthService) startRefreshLoop(ctx context.Context) {
	for {
		if s.refreshToken == "" {
			return
		}
		sleepUntil := s.expiry.Add(-5 * time.Minute)
		duration := time.Until(sleepUntil)
		if duration <= 0 {
			duration = 10 * time.Second
		}

		select {
		case <-time.After(duration):
			_, _, _ = s.refreshGroup.Do("refresh", func() (any, error) {
				err := s.doRefresh()
				if err != nil {
					_ = s.Logout() // Emit logout if rejected
				}
				return nil, err
			})
		case <-ctx.Done():
			return
		}
	}
}

func (s *AuthService) doRefresh() error {
	if s.refreshToken == "" {
		return errors.New("no refresh token")
	}
	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("client_id", s.cfg.ClientID)
	data.Set("refresh_token", s.refreshToken)

	return s.fetchTokens(data)
}
