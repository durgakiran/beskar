package main

import (
	"net/http"
	"net/url"

	"beskar/desktop/transport"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Intersect the built HTML policy with this process's exact bridge origin.
// Metadata is fetched only over the explicitly registered public providers.
func securityMiddleware(bridge *transport.Service, proxy application.Middleware) application.Middleware {
	return func(next http.Handler) http.Handler {
		handler := proxy(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			endpoint, err := url.Parse(bridge.GetBaseURL())
			if err != nil || endpoint.Host == "" {
				http.Error(w, "native transport unavailable", http.StatusServiceUnavailable)
				return
			}
			w.Header().Set("Content-Security-Policy", "connect-src 'self' http://"+endpoint.Host+" ws://"+endpoint.Host+" https://www.youtube.com https://vimeo.com https://www.loom.com https://www.figma.com https://miro.com https://noembed.com; frame-ancestors 'none'")
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			handler.ServeHTTP(w, r)
		})
	}
}
