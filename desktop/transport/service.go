package transport

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"beskar/desktop/config"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Service bridges standard HTTP/WebSockets to the configured backend. WebKit's
// custom wails scheme cannot supply a WebSocket endpoint or reliable PUT bodies.
type Service struct {
	cfg      *config.AppConfig
	token    func() string
	server   *http.Server
	baseURL  string
	savePath func(string) (string, error)
}

func New(cfg *config.AppConfig, token func() string) *Service {
	return &Service{cfg: cfg, token: token}
}

func (s *Service) GetBaseURL() string { return s.baseURL }

func (s *Service) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	target, err := url.Parse(s.cfg.ServerURL)
	if err != nil || target == nil || target.Scheme != "https" || target.Host == "" || target.User != nil {
		return fmt.Errorf("desktop transport requires an HTTPS backend")
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return err
	}
	prefix := "/" + hex.EncodeToString(secret)
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	s.baseURL = "http://" + listener.Addr().String() + prefix
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = config.NewHTTPTransport()
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		r.URL.Path = strings.TrimPrefix(r.URL.Path, prefix)
		r.URL.RawPath = ""
		director(r)
		r.Host = target.Host
		r.Header.Set("Origin", target.Scheme+"://"+target.Host)
		r.Header.Del("Cookie")
		r.Header.Del("Referer")
		r.Header.Del("Forwarded")
		r.Header.Del("X-Forwarded-Host")
		r.Header.Del("X-Forwarded-Proto")
	}
	proxy.ModifyResponse = func(r *http.Response) error {
		// Backend CORS is for the web client. The local bridge accepts only the
		// native origin below, so never reflect a remote site's origin here.
		r.Header.Del("Access-Control-Allow-Origin")
		r.Header.Del("Access-Control-Allow-Credentials")
		r.Header.Del("Set-Cookie")
		// Never forward an upstream redirect containing the capability or send
		// the renderer to an untrusted destination with native credentials.
		if r.StatusCode >= 300 && r.StatusCode < 400 && r.Header.Get("Location") != "" {
			return fmt.Errorf("native transport refuses upstream redirects")
		}
		r.Header.Set("Cache-Control", "no-store")
		r.Header.Set("Content-Security-Policy", "default-src 'none'; sandbox")
		return nil
	}
	s.server = &http.Server{ReadHeaderTimeout: 10 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The capability is only valid on this exact listener (DNS rebinding).
		if r.Host != listener.Addr().String() {
			http.Error(w, "native host required", http.StatusForbidden)
			return
		}
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		// Authenticated bridge responses are data, never executable documents.
		w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
		path := strings.TrimPrefix(r.URL.Path, prefix)
		if path == r.URL.Path || !(strings.HasPrefix(path, "/api/v1/") || path == "/ws" || path == "/collab") {
			http.NotFound(w, r)
			return
		}
		origin := r.Header.Get("Origin")
		if origin != "null" && origin != "wails://localhost" && origin != "http://wails.localhost" {
			http.Error(w, "native origin required", http.StatusForbidden)
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Vary", "Origin")
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, Cache-Control")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		token := s.token()
		if token == "" {
			http.Error(w, "sign in required", http.StatusUnauthorized)
			return
		}
		r.Header.Set("Authorization", "Bearer "+token)
		requestCtx, cancel := context.WithCancel(r.Context())
		stop := context.AfterFunc(ctx, cancel)
		defer stop()
		defer cancel()
		proxy.ServeHTTP(w, r.WithContext(requestCtx))
	})}
	go s.server.Serve(listener)
	return nil
}

func (s *Service) ServiceShutdown() error {
	if s.server == nil {
		return nil
	}
	return s.server.Close()
}
