package core

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
)

// BrowserCSRF is used only on the cookie authentication branch. HMAC binds the
// token to the SDK's unpredictable session ID without exposing that ID or
// changing persisted sessions. All replicas use the existing shared cookie key.
type BrowserCSRF struct {
	key    []byte
	origin string
}

func NewBrowserCSRF(key, publicURL string) (*BrowserCSRF, error) {
	u, err := url.Parse(publicURL)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(key) < 32 {
		return nil, errors.New("CSRF requires a public SERVER_URL and a KEY of at least 32 bytes")
	}
	return &BrowserCSRF{key: []byte(key), origin: u.Scheme + "://" + u.Host}, nil
}

func (c *BrowserCSRF) token(id string) string {
	mac := hmac.New(sha256.New, c.key)
	mac.Write([]byte("beskar/browser-csrf/v1\x00" + id))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (c *BrowserCSRF) trustedOrigin(r *http.Request) bool {
	// Never infer the public origin from attacker-controlled Host/Forwarded headers.
	if values := r.Header.Values("Origin"); len(values) != 0 {
		return len(values) == 1 && values[0] == c.origin
	}
	// Some clients omit Origin. Require a matching Referer in that case.
	if r.Referer() != "" {
		u, err := url.Parse(r.Referer())
		return err == nil && u.User == nil && u.Scheme+"://"+u.Host == c.origin
	}
	// The UI deliberately uses Referrer-Policy: no-referrer. Modern browsers
	// supply Fetch Metadata on same-origin GETs and cannot forge this header.
	values := r.Header.Values("Sec-Fetch-Site")
	return len(values) == 1 && values[0] == "same-origin"
}

var browserImagePath = regexp.MustCompile(`^/api/v1/media/(image/[^/]+|whiteboard-asset/[^/]+/[^/]+)$|^/api/v2/editor/space/[^/]+/whiteboard/[^/]+/(published/[^/]+/preview|assets/[a-f0-9]{64}/content|published/[^/]+/assets/[a-f0-9]{64}/content)$`)

func csrfFailure(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	_ = json.NewEncoder(w).Encode(map[string]any{"code": "CSRF_FAILED", "error": map[string]string{
		"message": "CSRF_FAILED", "detail": "Request verification failed. Reload the page and try again.",
	}})
}

func (c *BrowserCSRF) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Session bootstrap must work before the browser knows its token. Check
		// the initiating origin before authentication can perform any side effects.
		if r.Method == http.MethodGet && r.URL.Path == "/api/v1/authenticated" {
			if !c.trustedOrigin(r) {
				csrfFailure(w)
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		id := browserSessionID(r)
		tokens := r.Header.Values("X-CSRF-Token")
		// Native image elements cannot attach headers. This is a separate CSRF
		// defense for a closed set of image routes, never a general GET exemption.
		if id != "" && len(tokens) == 0 && r.Method == http.MethodGet && browserImagePath.MatchString(r.URL.Path) &&
			r.Header.Get("Sec-Fetch-Dest") == "image" && r.Header.Get("Sec-Fetch-Site") == "same-origin" && c.trustedOrigin(r) {
			next.ServeHTTP(w, r)
			return
		}
		if id == "" || !c.trustedOrigin(r) || len(tokens) != 1 || !hmac.Equal([]byte(tokens[0]), []byte(c.token(id))) {
			csrfFailure(w)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// TokenHandler also works for a session fenced by a failed logout, so the user
// can retry revocation after reloading. This token grants no authentication;
// normal API handlers still validate the session and provider access token.
func (c *BrowserCSRF) TokenHandler(w http.ResponseWriter, r *http.Request) {
	if token, ok := c.SessionToken(w, r); ok {
		_ = json.NewEncoder(w).Encode(map[string]string{"csrfToken": token})
	}
}

// SessionToken supplies a token for cookie responses, with the same origin and
// cache controls as the fallback endpoint. Callers must validate authentication
// separately; knowing this token does not establish an authenticated session.
func (c *BrowserCSRF) SessionToken(w http.ResponseWriter, r *http.Request) (string, bool) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Add("Vary", "Cookie")
	if (len(r.Header.Values("Origin")) != 0 || r.Referer() != "") && !c.trustedOrigin(r) || r.Header.Get("Sec-Fetch-Site") == "cross-site" || r.Header.Get("Sec-Fetch-Site") == "same-site" {
		csrfFailure(w)
		return "", false
	}
	id := browserSessionID(r)
	if id == "" {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": "AUTH_REQUIRED"})
		return "", false
	}
	return c.token(id), true
}
