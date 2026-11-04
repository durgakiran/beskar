package main

import (
	"beskar/desktop/config"
	"beskar/desktop/transport"
	"context"
	"github.com/wailsapp/wails/v3/pkg/application"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestDesktopAssetPolicy(t *testing.T) {
	bridge := transport.New(&config.AppConfig{ServerURL: "https://backend.example"}, func() string { return "synthetic" })
	identity := func(next http.Handler) http.Handler { return next }
	handler := securityMiddleware(bridge, identity)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("assets")) }))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, httptest.NewRequest("GET", "/index.desktop.html", nil))
	if res.Code != 503 {
		t.Fatal("assets served without initialized native transport")
	}
	if err := bridge.ServiceStartup(context.Background(), application.ServiceOptions{}); err != nil {
		t.Fatal(err)
	}
	defer bridge.ServiceShutdown()
	endpoint, _ := url.Parse(bridge.GetBaseURL())
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, httptest.NewRequest("GET", "/index.desktop.html", nil))
	policy := res.Header().Get("Content-Security-Policy")
	if !strings.Contains(policy, "http://"+endpoint.Host+" ws://"+endpoint.Host) || strings.Contains(policy, endpoint.Path) || strings.Contains(policy, "127.0.0.1:*") {
		t.Fatal("asset CSP does not isolate this process's bridge")
	}
	if !strings.Contains(policy, "frame-ancestors 'none'") || res.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatal("renderer isolation headers missing")
	}
}
