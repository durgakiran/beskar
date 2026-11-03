package transport

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"beskar/desktop/config"
	"github.com/coder/websocket"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestNativeTransport(t *testing.T) {
	t.Setenv("BESKAR_DEV_ALLOW_SELF_SIGNED", "1")
	backend := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-access" || r.Header.Get("Cookie") != "" {
			t.Error("native credential was not used exclusively")
		}
		if r.URL.Path == "/ws" {
			conn, err := websocket.Accept(w, r, nil)
			if err != nil {
				t.Error(err)
				return
			}
			defer conn.CloseNow()
			kind, message, err := conn.Read(r.Context())
			if err == nil {
				_ = conn.Write(r.Context(), kind, message)
			}
			return
		}
		body, _ := io.ReadAll(r.Body)
		if r.URL.Path != "/api/v1/editor/update" || r.Method != "PUT" || string(body) != `{"data":"draft"}` {
			t.Error("draft request was altered")
		}
		_, _ = w.Write(body)
	}))
	defer backend.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	token := "test-access"
	service := New(&config.AppConfig{ServerURL: backend.URL}, func() string { return token })
	if err := service.ServiceStartup(ctx, application.ServiceOptions{}); err != nil {
		t.Fatal(err)
	}
	defer service.ServiceShutdown()
	request := func(path, origin, method string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest(method, service.GetBaseURL()+path, strings.NewReader(`{"data":"draft"}`))
		req.Header.Set("Origin", origin)
		req.Header.Set("Cookie", "browser-cookie=must-not-forward")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	res := request("/api/v1/editor/update", "null", "PUT")
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || string(body) != `{"data":"draft"}` || res.Header.Get("Access-Control-Allow-Origin") != "null" {
		t.Fatalf("draft bridge failed: %d %s", res.StatusCode, body)
	}
	for _, tc := range []struct {
		path, origin, method string
		status               int
	}{
		{"/api/v1/editor/update", "https://evil.example", "PUT", 403},
		{"/wails/runtime", "null", "POST", 404},
		{"/api/v1/editor/update", "null", "OPTIONS", 204},
	} {
		res := request(tc.path, tc.origin, tc.method)
		res.Body.Close()
		if res.StatusCode != tc.status {
			t.Errorf("%s %s: %d", tc.method, tc.path, res.StatusCode)
		}
	}
	socketCtx, socketCancel := context.WithTimeout(ctx, 5*time.Second)
	defer socketCancel()
	conn, _, err := websocket.Dial(socketCtx, strings.Replace(service.GetBaseURL(), "http:", "ws:", 1)+"/ws", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"null"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	if err := conn.Write(socketCtx, websocket.MessageText, []byte("live-update")); err != nil {
		t.Fatal(err)
	}
	_, message, err := conn.Read(socketCtx)
	if err != nil || string(message) != "live-update" {
		t.Fatalf("WebSocket bridge failed: %v", err)
	}
	token = ""
	res = request("/api/v1/editor/update", "null", "PUT")
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatal("logged-out request was forwarded")
	}
	// Knowing the port is insufficient: a per-run capability is required.
	endpoint := strings.Split(service.GetBaseURL(), "/")
	req, _ := http.NewRequest("GET", strings.Join(endpoint[:3], "/")+"/api/v1/space/list", nil)
	req.Header.Set("Origin", "null")
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatal("request without capability accepted")
	}
}
