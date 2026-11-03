package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"beskar/desktop/auth"
	"beskar/desktop/config"
)

func TestDesktopAPIProxy(t *testing.T) {
	t.Setenv("BESKAR_DEV_ALLOW_SELF_SIGNED", "1")
	backend := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RequestURI() != "/api/v1/space/list?limit=10" {
			t.Errorf("unexpected backend request: %s", r.URL.RequestURI())
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"status":"success","data":[]}`)
	}))
	defer backend.Close()
	assets := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "native assets or IPC")
	})
	handler := ProxyMiddleware(&auth.AuthService{}, &config.AppConfig{ServerURL: backend.URL})(assets)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/space/list?limit=10", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"success"`) {
		t.Fatalf("API was not proxied: %d %s", response.Code, response.Body.String())
	}
	for _, path := range []string{"/wails/runtime", "/index.desktop.html", "/api/v10/other"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Body.String() != "native assets or IPC" {
			t.Errorf("%s must remain on native handler", path)
		}
	}
}
