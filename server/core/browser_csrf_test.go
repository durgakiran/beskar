package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/cors"
	"github.com/zitadel/oidc/v3/pkg/crypto"
	"github.com/zitadel/zitadel-go/v3/pkg/authentication"
)

func csrfFixture(t *testing.T) (*BrowserCSRF, *http.Cookie) {
	t.Helper()
	t.Setenv("KEY", redisSessionTestKey)
	c, err := NewBrowserCSRF(redisSessionTestKey, "https://app.example.com")
	if err != nil {
		t.Fatal(err)
	}
	value, err := crypto.EncryptAES("session", redisSessionTestKey)
	if err != nil {
		t.Fatal(err)
	}
	return c, &http.Cookie{Name: "zitadel.session", Value: value}
}

func TestBrowserCSRFAllMethods(t *testing.T) {
	c, cookie := csrfFixture(t)
	for _, tc := range []struct {
		name, origin, referer, token, contentType string
		cookie                                    bool
		status                                    int
	}{
		{"valid", c.origin, "", c.token("session"), "application/json", true, 204},
		{"multipart", c.origin, "", c.token("session"), "multipart/form-data; boundary=test", true, 204},
		{"referer fallback", "", c.origin + "/editor", c.token("session"), "application/json", true, 204},
		{"missing token", c.origin, "", "", "application/json", true, 403},
		{"wrong token", c.origin, "", "wrong", "application/json", true, 403},
		{"other session", c.origin, "", c.token("other-session"), "application/json", true, 403},
		{"missing cookie", c.origin, "", c.token("session"), "application/json", false, 403},
		{"cross site form", "https://attacker.test", "", c.token("session"), "application/x-www-form-urlencoded", true, 403},
		{"sibling subdomain", "https://evil.example.com", "", c.token("session"), "application/json", true, 403},
		{"origin suffix", c.origin + ".evil.test", "", c.token("session"), "application/json", true, 403},
		{"wrong scheme", "http://app.example.com", "", c.token("session"), "application/json", true, 403},
		{"wrong port", c.origin + ":444", "", c.token("session"), "application/json", true, 403},
		{"null origin", "null", c.origin + "/editor", c.token("session"), "application/json", true, 403},
		{"no origin or referer", "", "", c.token("session"), "application/json", true, 403},
		{"referer spoof", "", "https://app.example.com@evil.test/editor", c.token("session"), "application/json", true, 403},
	} {
		for _, method := range []string{"GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE", "CUSTOM"} {
			t.Run(tc.name+"/"+method, func(t *testing.T) {
				req := httptest.NewRequest(method, "/api/v1/media/upload?csrf="+c.token("session"), strings.NewReader("unchanged body"))
				if tc.cookie {
					req.AddCookie(cookie)
				}
				if tc.origin != "" {
					req.Header.Set("Origin", tc.origin)
				}
				req.Header.Set("Referer", tc.referer)
				req.Header.Set("X-CSRF-Token", tc.token)
				req.Header.Set("Content-Type", tc.contentType)
				req.Header.Set("X-Forwarded-Host", "attacker.test")
				called := false
				w := httptest.NewRecorder()
				c.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(204) })).ServeHTTP(w, req)
				if w.Code != tc.status || called != (tc.status == 204) {
					t.Fatalf("status=%d side effect=%v", w.Code, called)
				}
				if tc.status == 403 && (!strings.Contains(w.Body.String(), "CSRF_FAILED") || w.Header().Get("Cache-Control") != "no-store") {
					t.Fatal("missing CSRF error")
				}
			})
		}
	}
}

func TestBrowserCSRFBearerPaths(t *testing.T) {
	c, _ := csrfFixture(t)
	// The bearer validator alone decides whether an explicitly supplied credential
	// is valid. Neither an invalid header nor a query token may fall back to cookies.
	for _, token := range []string{"Bearer valid", "Bearer invalid"} {
		req := httptest.NewRequest("POST", "/write", nil)
		req.Header.Set("Authorization", token)
		w := httptest.NewRecorder()
		bearer := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer valid" {
				w.WriteHeader(401)
				return
			}
			w.WriteHeader(204)
		})
		SelectAuthentication(c.Middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("cookie fallback") })), bearer, false).ServeHTTP(w, req)
		want := 401
		if token == "Bearer valid" {
			want = 204
		}
		if w.Code != want {
			t.Fatalf("bearer status %d", w.Code)
		}
	}
}

func TestBrowserCSRFTokenEndpoint(t *testing.T) {
	c, cookie := csrfFixture(t)
	for _, tc := range []struct {
		origin, fetchSite string
		cookie            bool
		status            int
	}{
		{"", "same-origin", true, 200},
		{c.origin, "same-origin", true, 200},
		{"https://evil.example.com", "same-site", true, 403},
		{"", "cross-site", true, 403},
		{"", "same-site", true, 403},
		{"null", "", true, 403},
		{c.origin, "same-origin", false, 401},
	} {
		req := httptest.NewRequest("GET", "/auth/csrf", nil)
		if tc.cookie {
			req.AddCookie(cookie)
		}
		if tc.origin != "" {
			req.Header.Set("Origin", tc.origin)
		}
		req.Header.Set("Sec-Fetch-Site", tc.fetchSite)
		w := httptest.NewRecorder()
		c.TokenHandler(w, req)
		if w.Code != tc.status || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("status %d", w.Code)
		}
		if tc.status == 200 {
			var body map[string]string
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			second, _ := NewBrowserCSRF(redisSessionTestKey, c.origin)
			if body["csrfToken"] != second.token("session") || strings.Contains(w.Body.String(), cookie.Value) {
				t.Fatal("token not session-bound across replicas")
			}
		}
	}
}

func TestBrowserCSRFDuplicateHeaders(t *testing.T) {
	c, cookie := csrfFixture(t)
	for _, header := range []string{"Origin", "X-CSRF-Token"} {
		req := httptest.NewRequest("POST", "/write", nil)
		req.AddCookie(cookie)
		req.Header.Set("Origin", c.origin)
		req.Header.Set("X-CSRF-Token", c.token("session"))
		req.Header.Add(header, req.Header.Get(header))
		w := httptest.NewRecorder()
		c.Middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("duplicate accepted") })).ServeHTTP(w, req)
		if w.Code != 403 {
			t.Fatalf("status %d", w.Code)
		}
	}
}

func TestBrowserCSRFRejectsInvalidConfiguration(t *testing.T) {
	for _, publicURL := range []string{"", "app.example.com", "//app.example.com", "ftp://app.example.com", "https://user@app.example.com", "https://app.example.com?x=1"} {
		if _, err := NewBrowserCSRF(redisSessionTestKey, publicURL); err == nil {
			t.Fatalf("accepted %q", publicURL)
		}
	}
	if _, err := NewBrowserCSRF("", "https://app.example.com"); err == nil {
		t.Fatal("empty key accepted")
	}
}

func TestBrowserCSRFNativeImages(t *testing.T) {
	c, cookie := csrfFixture(t)
	const preview = "/api/v2/editor/space/space/whiteboard/1/published/version/preview"
	for _, tc := range []struct {
		name, path, method, site, dest, origin, token string
		status                                        int
	}{
		{"stored image", "/api/v1/media/image/id", "GET", "same-origin", "image", "", "", 204},
		{"whiteboard image", "/api/v1/media/whiteboard-asset/1/hash", "GET", "same-origin", "image", "", "", 204},
		{"preview", preview, "GET", "same-origin", "image", c.origin, "", 204},
		{"asset content", "/api/v2/editor/space/space/whiteboard/1/assets/" + strings.Repeat("a", 64) + "/content", "GET", "same-origin", "image", "", "", 204},
		{"cross-site", preview, "GET", "cross-site", "image", "", "", 403},
		{"sibling site", preview, "GET", "same-site", "image", "", "", 403},
		{"no metadata", preview, "GET", "", "image", c.origin, "", 403},
		{"hostile origin", preview, "GET", "same-origin", "image", "https://evil.test", "", 403},
		{"navigation", preview, "GET", "same-origin", "document", "", "", 403},
		{"fetch needs token", preview, "GET", "same-origin", "empty", "", "", 403},
		{"invalid token cannot fall back", preview, "GET", "same-origin", "image", "", "invalid", 403},
		{"JSON endpoint cannot fall back", "/api/v1/editor/save", "GET", "same-origin", "image", "", "", 403},
		{"method cannot fall back", preview, "POST", "same-origin", "image", "", "", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			req.AddCookie(cookie)
			if tc.site != "" {
				req.Header.Set("Sec-Fetch-Site", tc.site)
			}
			if tc.dest != "" {
				req.Header.Set("Sec-Fetch-Dest", tc.dest)
			}
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.token != "" {
				req.Header.Set("X-CSRF-Token", tc.token)
			}
			w := httptest.NewRecorder()
			called := false
			c.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(204) })).ServeHTTP(w, req)
			if w.Code != tc.status || called != (tc.status == 204) {
				t.Fatalf("status=%d called=%v", w.Code, called)
			}
		})
	}
}

func TestBrowserCSRFBootstrapOriginBeforeHandler(t *testing.T) {
	c, _ := csrfFixture(t)
	for _, tc := range []struct {
		origin, site string
		status       int
	}{
		{c.origin, "", 204},
		{"", "same-origin", 204},
		{"https://evil.test", "cross-site", 403},
		{"", "same-site", 403},
		{"", "cross-site", 403},
		{"", "", 403},
	} {
		req := httptest.NewRequest("GET", "/api/v1/authenticated", nil)
		if tc.origin != "" {
			req.Header.Set("Origin", tc.origin)
		}
		if tc.site != "" {
			req.Header.Set("Sec-Fetch-Site", tc.site)
		}
		w := httptest.NewRecorder()
		c.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })).ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Fatalf("origin=%q site=%q status=%d", tc.origin, tc.site, w.Code)
		}
	}
	// no-referrer must also work for protected fetches, with a valid token.
	_, cookie := csrfFixture(t)
	req := httptest.NewRequest("GET", "/api/v1/read", nil)
	req.AddCookie(cookie)
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	req.Header.Set("X-CSRF-Token", c.token("session"))
	w := httptest.NewRecorder()
	c.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })).ServeHTTP(w, req)
	if w.Code != 204 {
		t.Fatal("same-origin fetch with no referrer was blocked")
	}
}

func TestBrowserCSRFPreflightDoesNotReachApplication(t *testing.T) {
	c, _ := csrfFixture(t)
	called := false
	handler := cors.Handler(cors.Options{
		AllowedOrigins: []string{c.origin}, AllowedMethods: []string{"GET", "POST"},
		AllowedHeaders: []string{"X-CSRF-Token"},
	})(c.Middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true })))
	req := httptest.NewRequest("OPTIONS", "/api/v1/read", nil)
	req.Header.Set("Origin", c.origin)
	req.Header.Set("Access-Control-Request-Method", "GET")
	req.Header.Set("Access-Control-Request-Headers", "X-CSRF-Token")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code >= 300 || called {
		t.Fatalf("preflight status=%d reached application=%v", w.Code, called)
	}
}

func TestBrowserLogoutCannotBypassCSRFViaSDK(t *testing.T) {
	c, cookie := csrfFixture(t)
	previous := authN
	// Route construction binds SDK methods; forbidden requests must never call them.
	authN = &authentication.Authenticator[*browserAuthContext]{}
	t.Cleanup(func() { authN = previous })
	router := ZitadelAuthRouter(&BrowserAccessTokenValidator{}, c)
	for _, method := range []string{"GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS", "POST"} {
		req := httptest.NewRequest(method, "/logout", nil)
		req.AddCookie(cookie)
		req.Header.Set("Origin", c.origin)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		want := 405
		if method == "POST" {
			want = 403
		}
		if w.Code != want || w.Header().Get("Set-Cookie") != "" || w.Header().Get("Location") != "" {
			t.Fatalf("%s: %d", method, w.Code)
		}
	}
}
